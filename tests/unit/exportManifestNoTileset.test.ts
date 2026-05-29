import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataAccessLayer } from "../../src/data/types.js";
import { GltfExporter } from "../../src/export/GltfExporter.js";
import type { SceneState } from "../../src/scene/SceneStore.js";
import { asBuildingUid, asSceneId } from "../../src/utils/ids.js";

let workRoot: string;

// The scene_manifest path never touches the data layer, so a stub is fine.
const stubDataAccess = {} as unknown as DataAccessLayer;

function makeScene(artifactDir: string): SceneState {
  return {
    scene_id: asSceneId("scene_01ARZ3NDEKTSV4RRFFQ69G5FAV"),
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    expires_at: Number.MAX_SAFE_INTEGER,
    source: {
      city: "shibuya",
      bbox: [139.69, 35.65, 139.71, 35.67],
      lod: 2,
      dataset_year: 2023,
      artifact_dir: artifactDir,
      upstream_refs: [],
    },
    buildings: {
      all_uids: [asBuildingUid("a"), asBuildingUid("b")],
      deleted_uids: new Set([asBuildingUid("b")]),
      extrusions: new Map(),
    },
    composition: {},
    attribution: {
      license: "CC BY 4.0",
      datasets: ["plateau"],
      source_urls: ["https://www.mlit.go.jp/plateau/"],
      generated_at: "2026-01-01T00:00:00Z",
      notes: [],
    },
  };
}

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-test-"));
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

describe("scene_manifest export without 3D Tiles (downloaded city)", () => {
  it("degrades gracefully and returns guidance instead of failing", async () => {
    // artifact_dir has parquet+manifest but NO 3dtiles/ — the downloaded-bundle shape.
    const artifactDir = path.join(workRoot, "out_shibuya");
    await fs.mkdir(artifactDir, { recursive: true });
    const outputDir = path.join(workRoot, "out");

    const exporter = new GltfExporter(outputDir, stubDataAccess);
    const result = await exporter.export(
      makeScene(artifactDir),
      { mode: "scene_manifest", compress: false },
      makeScene(artifactDir).attribution,
    );

    expect(result.mode).toBe("scene_manifest");
    expect(result.stats.tileset_available).toBe(false);
    expect(result.stats.tiles_indexed).toBe(0);
    expect(result.stats.tileset_note).toMatch(/single_glb|plateau build/);

    // The written manifest still carries the scene edits + the note.
    const manifest = JSON.parse(await fs.readFile(result.file_path, "utf8"));
    expect(manifest.tileset_available).toBe(false);
    expect(manifest.tileset_note).toContain("shibuya");
    expect(manifest.edits.deleted_building_uids).toContain("b");
  });
});
