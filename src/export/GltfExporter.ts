import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import "./nodePolyfills.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { DataAccessLayer } from "../data/types.js";
import { AppError } from "../errors/AppError.js";
import type { SceneState } from "../scene/SceneState.js";
import type { AttributionMetadata } from "../schemas/common.js";
import { bboxAreaKm2 } from "../utils/bbox.js";
import { ensureSafeBasename, safeJoinUnderRoot } from "../utils/paths.js";
import { ThreeSceneBuilder } from "./ThreeSceneBuilder.js";
import { indexTileset } from "./TilesetIndexer.js";
import { compressGlb } from "./compress.js";

export interface ExportLimits {
  maxBboxAreaKm2: number;
  maxBuildings: number;
}

export const DEFAULT_LIMITS: ExportLimits = {
  maxBboxAreaKm2: 1,
  maxBuildings: 5000,
};

export interface ExportGlbOptions {
  mode: "single_glb" | "scene_manifest";
  compress: boolean;
  outputName?: string;
}

export interface ExportStats {
  bbox_area_km2: number;
  building_count: number;
  triangle_count?: number;
  output_bytes?: number;
  pre_compress_bytes?: number;
  compressed?: boolean;
  used_footprints?: number;
  used_boxes?: number;
  merged?: boolean;
  tiles_indexed?: number;
  tileset_available?: boolean;
  tileset_note?: string;
}

export interface ExportResult {
  mode: "single_glb" | "scene_manifest";
  file_path: string;
  sidecar_path?: string;
  license_path: string;
  stats: ExportStats;
}

function shortToken(): string {
  return randomBytes(4).toString("hex");
}

function appendToken(base: string, token: string, ext: string): string {
  const stripped = base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  return `${stripped}_${token}${ext}`;
}

export class GltfExporter {
  private readonly builder = new ThreeSceneBuilder();

  constructor(
    private readonly outputDir: string,
    private readonly dataAccess: DataAccessLayer,
    private readonly limits: ExportLimits = DEFAULT_LIMITS,
  ) {}

  async ensureOutputDir(): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  private effectiveBuildingCount(scene: Readonly<SceneState>): number {
    return scene.buildings.all_uids.length - scene.buildings.deleted_uids.size;
  }

  async export(
    scene: Readonly<SceneState>,
    options: ExportGlbOptions,
    attribution: AttributionMetadata,
  ): Promise<ExportResult> {
    await this.ensureOutputDir();
    const areaKm2 = bboxAreaKm2(scene.source.bbox);
    const count = this.effectiveBuildingCount(scene);

    if (options.mode === "single_glb") {
      if (areaKm2 > this.limits.maxBboxAreaKm2 || count > this.limits.maxBuildings) {
        throw new AppError(
          "EXPORT_LIMIT_EXCEEDED",
          "Single-GLB export exceeds limits; narrow the bbox, delete more buildings, or switch to scene_manifest mode.",
          {
            bbox_area_km2: areaKm2,
            building_count: count,
            max_bbox_area_km2: this.limits.maxBboxAreaKm2,
            max_buildings: this.limits.maxBuildings,
            suggested_mode: "scene_manifest",
          },
        );
      }
      return this.exportSingleGlb(scene, options, attribution, areaKm2, count);
    }
    return this.exportManifest(scene, options, attribution, areaKm2, count);
  }

  private resolveFilename(
    scene: Readonly<SceneState>,
    outputName: string | undefined,
    ext: string,
  ): string {
    const token = shortToken();
    if (outputName) {
      const safe = ensureSafeBasename(outputName);
      const withExt = safe.endsWith(ext) ? safe : `${safe}${ext}`;
      return appendToken(withExt, token, ext);
    }
    return `${scene.scene_id}_v${scene.version}_${token}${ext}`;
  }

  private async exportSingleGlb(
    scene: Readonly<SceneState>,
    options: ExportGlbOptions,
    attribution: AttributionMetadata,
    areaKm2: number,
    count: number,
  ): Promise<ExportResult> {
    const includedUids = scene.buildings.all_uids.filter(
      (u) => !scene.buildings.deleted_uids.has(u),
    );
    const rows = await this.dataAccess.getBuildingGeometry(scene.source.artifact_dir, includedUids);
    const built = this.builder.build(scene, rows);

    const exporter = new GLTFExporter();
    let buffer: ArrayBuffer;
    try {
      buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          built.scene,
          (result) => {
            if (result instanceof ArrayBuffer) resolve(result);
            else reject(new Error("Expected binary GLB output"));
          },
          (err) => reject(err),
          {
            binary: true,
            onlyVisible: true,
            includeCustomExtensions: false,
            embedImages: false,
          },
        );
      });
    } catch (err) {
      throw new AppError("EXPORT_GLTF_FAILED", `Failed to encode GLB: ${(err as Error).message}`, {
        cause: (err as Error).message,
        stack: (err as Error).stack,
      });
    }

    const finalName = this.resolveFilename(scene, options.outputName, ".glb");
    const target = safeJoinUnderRoot(this.outputDir, finalName);

    let preCompressBytes: number | undefined;
    let finalBuffer = await this.injectAttributionIntoGlb(buffer, attribution);
    if (options.compress) {
      preCompressBytes = finalBuffer.byteLength;
      const compressed = await compressGlb(finalBuffer);
      finalBuffer = await this.injectAttributionIntoGlb(compressed.buffer, attribution);
    }
    await fs.writeFile(target, Buffer.from(finalBuffer));

    const sidecarBase = finalName.replace(/\.glb$/, "");
    const sidecarPath = safeJoinUnderRoot(this.outputDir, `${sidecarBase}.buildings.json`);
    const licensePath = safeJoinUnderRoot(this.outputDir, `${sidecarBase}.LICENSE.txt`);
    const sidecar = {
      scene_id: scene.scene_id,
      version: scene.version,
      origin_lon_lat: built.origin,
      merged: built.merged,
      total_triangles: built.totalTriangles,
      ranges: built.ranges,
    };
    await fs.writeFile(sidecarPath, JSON.stringify(sidecar), "utf8");
    await fs.writeFile(licensePath, this.licenseText(attribution), "utf8");

    return {
      mode: "single_glb",
      file_path: target,
      sidecar_path: sidecarPath,
      license_path: licensePath,
      stats: {
        bbox_area_km2: areaKm2,
        building_count: count,
        triangle_count: built.totalTriangles,
        output_bytes: finalBuffer.byteLength,
        pre_compress_bytes: preCompressBytes,
        compressed: options.compress,
        used_footprints: built.usedFootprints,
        used_boxes: built.usedBoxes,
        merged: built.merged,
      },
    };
  }

  private async exportManifest(
    scene: Readonly<SceneState>,
    options: ExportGlbOptions,
    attribution: AttributionMetadata,
    areaKm2: number,
    count: number,
  ): Promise<ExportResult> {
    const finalName = this.resolveFilename(scene, options.outputName, ".manifest.json");
    const target = safeJoinUnderRoot(this.outputDir, finalName);

    const tilesetPath = path.join(scene.source.artifact_dir, "3dtiles", "tileset.json");
    const tilesRoot = path.join(scene.source.artifact_dir, "3dtiles");
    const tilesetIndex = await indexTileset(tilesetPath, scene.source.bbox);
    const tiles: Array<{
      url: string;
      relative_uri: string;
      bbox: [number, number, number, number];
      min_height_m: number;
      max_height_m: number;
    }> = [];
    for (const t of tilesetIndex?.tiles ?? []) {
      let safeUrl: string;
      try {
        safeUrl = safeJoinUnderRoot(tilesRoot, t.uri);
      } catch {
        continue;
      }
      tiles.push({
        url: safeUrl,
        relative_uri: t.uri,
        bbox: t.bbox,
        min_height_m: t.min_height_m,
        max_height_m: t.max_height_m,
      });
    }
    const tilesetNote = tilesetIndex
      ? undefined
      : `No 3D Tiles found for '${scene.source.city}'. Downloaded artifact bundles ship without tiles. For full geometry, narrow the bbox to within single_glb limits (≤1 km² and ≤5000 buildings) and export single_glb, or run \`plateau build ${scene.source.city}\` locally to generate 3D Tiles for scene_manifest.`;
    const manifest = {
      scene_id: scene.scene_id,
      version: scene.version,
      mode: "scene_manifest",
      bbox: scene.source.bbox,
      city: scene.source.city,
      lod: scene.source.lod,
      tileset: tilesetIndex ? tilesetIndex.tileset_path : tilesetPath,
      tileset_available: !!tilesetIndex,
      tileset_note: tilesetNote,
      tiles,
      edits: {
        deleted_building_uids: Array.from(scene.buildings.deleted_uids),
        extrusions: Array.from(scene.buildings.extrusions.entries()).map(([uid, e]) => ({
          building_uid: uid,
          factor: e.factor,
        })),
      },
      attribution,
    };

    await fs.writeFile(target, JSON.stringify(manifest, null, 2), "utf8");
    const manifestBase = finalName.replace(/\.manifest\.json$/, "").replace(/\.json$/, "");
    const licensePath = safeJoinUnderRoot(this.outputDir, `${manifestBase}.LICENSE.txt`);
    await fs.writeFile(licensePath, this.licenseText(attribution), "utf8");

    return {
      mode: "scene_manifest",
      file_path: target,
      license_path: licensePath,
      stats: {
        bbox_area_km2: areaKm2,
        building_count: count,
        tiles_indexed: tiles.length,
        tileset_available: !!tilesetIndex,
        tileset_note: tilesetNote,
      },
    } satisfies ExportResult;
  }

  private licenseText(attribution: AttributionMetadata): string {
    const lines = [
      "This export bundles data derived from Project PLATEAU (Ministry of Land, Infrastructure, Transport and Tourism, Japan).",
      `License: ${attribution.license}`,
      "",
      "Datasets:",
      ...attribution.datasets.map((d) => `  - ${d}`),
      "",
      "Source URLs:",
      ...attribution.source_urls.map((u) => `  - ${u}`),
      "",
      "You must retain this attribution in any derived video, image, or 3D asset.",
      "",
      ...(attribution.notes ?? []),
    ];
    return lines.join("\n");
  }

  private async injectAttributionIntoGlb(
    glb: ArrayBuffer,
    attribution: AttributionMetadata,
  ): Promise<ArrayBuffer> {
    const view = new DataView(glb);
    const magic = view.getUint32(0, true);
    if (magic !== 0x46546c67) return glb;
    const headerLen = 12;
    const jsonLen = view.getUint32(headerLen, true);
    const jsonChunkStart = headerLen + 8;
    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(new Uint8Array(glb, jsonChunkStart, jsonLen));
    const gltf = JSON.parse(jsonStr) as Record<string, unknown>;
    const asset = (gltf.asset ?? {}) as Record<string, unknown>;
    const extras = (asset.extras ?? {}) as Record<string, unknown>;
    extras.attribution = attribution;
    asset.extras = extras;
    gltf.asset = asset;
    const newJson = JSON.stringify(gltf);
    const encoder = new TextEncoder();
    const newJsonBytes = encoder.encode(newJson);
    const padding = (4 - (newJsonBytes.length % 4)) % 4;
    const paddedJsonLen = newJsonBytes.length + padding;

    const binChunkStart = jsonChunkStart + jsonLen;
    const binLen = view.getUint32(binChunkStart, true);
    const binType = view.getUint32(binChunkStart + 4, true);
    const binChunkBody = new Uint8Array(glb, binChunkStart + 8, binLen);

    const totalLen = 12 + 8 + paddedJsonLen + 8 + binLen;
    const out = new ArrayBuffer(totalLen);
    const outView = new DataView(out);
    const outBytes = new Uint8Array(out);
    outView.setUint32(0, 0x46546c67, true);
    outView.setUint32(4, 2, true);
    outView.setUint32(8, totalLen, true);
    outView.setUint32(12, paddedJsonLen, true);
    outView.setUint32(16, 0x4e4f534a, true);
    outBytes.set(newJsonBytes, 20);
    for (let i = 0; i < padding; i++) outBytes[20 + newJsonBytes.length + i] = 0x20;
    const binHeaderOff = 20 + paddedJsonLen;
    outView.setUint32(binHeaderOff, binLen, true);
    outView.setUint32(binHeaderOff + 4, binType, true);
    outBytes.set(binChunkBody, binHeaderOff + 8);
    return out;
  }
}
