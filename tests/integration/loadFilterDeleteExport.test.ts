import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttributionWrapper } from "../../src/attribution/AttributionWrapper.js";
import { ArtifactDataAccess } from "../../src/data/ArtifactClient.js";
import { GltfExporter } from "../../src/export/GltfExporter.js";
import { RateLimiter } from "../../src/rateLimit/RateLimiter.js";
import { SceneStore } from "../../src/scene/SceneStore.js";
import { ToolRegistry } from "../../src/server/ToolRegistry.js";
import { createLogger } from "../../src/utils/logger.js";

const artifactRoot = path.resolve(__dirname, "../../../plateau-core");
const hasArtifacts = await fs
  .stat(path.join(artifactRoot, "out_shibuya", "buildings.parquet"))
  .then(() => true)
  .catch(() => false);

const maybe = hasArtifacts ? describe : describe.skip;

maybe("integration: load → filter → delete → export", () => {
  let outputDir: string;
  let registry: ReturnType<() => ToolRegistry>;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "plateau-mcp-"));
    const dataAccess = new ArtifactDataAccess(artifactRoot);
    const sceneStore = new SceneStore({
      maxScenes: 4,
      ttlMs: 60_000,
      persistToDisk: false,
      diskDir: path.join(outputDir, "scenes"),
    });
    const gltfExporter = new GltfExporter(outputDir, dataAccess);
    registry = new ToolRegistry({
      sceneStore,
      dataAccess,
      gltfExporter,
      attributionWrapper: new AttributionWrapper(),
      rateLimiter: new RateLimiter(),
      logger: createLogger(),
    });
    registry.registerAll();
  });

  afterAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("runs the full pipeline and writes a .glb with attribution", async () => {
    const loaded = (await registry
      .get("load_area")!
      .execute(
        { city: "shibuya", bbox: [139.6975, 35.6555, 139.7045, 35.6605], lod: 2 },
        "test",
      )) as { result: { scene_id: string; summary: { building_count: number } } };
    expect(loaded.result.summary.building_count).toBeGreaterThan(0);

    const sceneId = loaded.result.scene_id;
    const filtered = (await registry
      .get("filter_buildings")!
      .execute({ scene_id: sceneId, filter: { height_min: 30 } }, "test")) as {
      result: { count: number };
    };
    expect(filtered.result.count).toBeGreaterThanOrEqual(0);

    const deleted = (await registry
      .get("delete_buildings")!
      .execute({ scene_id: sceneId, filter: { height_min: 80 } }, "test")) as {
      result: { deleted_count: number; version: number };
    };
    expect(deleted.result.version).toBeGreaterThanOrEqual(1);

    const exported = (await registry
      .get("export_glb")!
      .execute({ scene_id: sceneId, mode: "single_glb" }, "test")) as {
      result: {
        file_path: string;
        sidecar_path?: string;
        license_path: string;
        stats: {
          building_count: number;
          output_bytes?: number;
          triangle_count?: number;
          merged?: boolean;
          used_footprints?: number;
        };
      };
    };

    const stat = await fs.stat(exported.result.file_path);
    expect(stat.size).toBeGreaterThan(0);
    expect(exported.result.stats.triangle_count).toBeGreaterThan(
      12 * exported.result.stats.building_count,
    );
    expect(exported.result.stats.merged).toBe(true);
    expect(exported.result.sidecar_path).toBeDefined();

    const compressed = (await registry.get("export_glb")!.execute(
      {
        scene_id: sceneId,
        mode: "single_glb",
        options: { compress: true, output_name: "compressed" },
      },
      "test",
    )) as {
      result: {
        file_path: string;
        stats: { output_bytes?: number; pre_compress_bytes?: number; compressed?: boolean };
      };
    };
    expect(path.basename(compressed.result.file_path)).not.toBe(
      path.basename(exported.result.file_path),
    );
    expect(compressed.result.stats.compressed).toBe(true);
    expect(compressed.result.stats.pre_compress_bytes).toBeGreaterThan(
      compressed.result.stats.output_bytes!,
    );
    const sidecar = JSON.parse(await fs.readFile(exported.result.sidecar_path!, "utf8")) as Record<
      string,
      unknown
    >;
    expect(sidecar.scene_id).toBe(sceneId);
    expect(sidecar.merged).toBe(true);
    expect(typeof sidecar.total_triangles).toBe("number");
    expect(Object.keys(sidecar.ranges).length).toBeGreaterThan(0);

    const licenseTxt = await fs.readFile(exported.result.license_path, "utf8");
    expect(licenseTxt).toMatch(/PLATEAU/);
    expect(exported.result.license_path).toMatch(/\.LICENSE\.txt$/);

    const head = await fs.readFile(exported.result.file_path);
    const magic = head.readUInt32LE(0);
    expect(magic).toBe(0x46546c67);
  }, 60_000);
});
