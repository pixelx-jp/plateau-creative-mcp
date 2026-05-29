import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttributionWrapper } from "../../src/attribution/AttributionWrapper.js";
import type {
  BuildingRow,
  DataAccessLayer,
  LoadAreaQuery,
  LoadedArea,
  PoiLinkResult,
} from "../../src/data/types.js";
import { GltfExporter } from "../../src/export/GltfExporter.js";
import { RateLimiter } from "../../src/rateLimit/RateLimiter.js";
import { SceneStore } from "../../src/scene/SceneStore.js";
import type { AttributionMetadata, BuildingFilter } from "../../src/schemas/common.js";
import { ToolRegistry } from "../../src/server/ToolRegistry.js";
import { type BuildingUid, asBuildingUid } from "../../src/utils/ids.js";
import { createLogger } from "../../src/utils/logger.js";

const ATTR: AttributionMetadata = {
  license: "CC BY 4.0",
  datasets: ["plateau-test"],
  source_urls: ["https://example.invalid"],
  generated_at: new Date().toISOString(),
};

class FakeDataAccess implements DataAccessLayer {
  constructor(private readonly uids: BuildingUid[]) {}

  async loadArea(input: LoadAreaQuery): Promise<LoadedArea> {
    return {
      artifact_dir: "/tmp/fake",
      manifest: {
        city_code: "00000",
        city_name: input.city,
        dataset_year: 2023,
        attribution: "© test",
        datasets: ["plateau-test"],
        sources: {},
        n_buildings: this.uids.length,
      },
      building_uids: this.uids,
      available_attributes: ["height"],
      attribution: ATTR,
    };
  }
  async queryBuildings(
    _dir: string,
    _bbox: [number, number, number, number],
    filter: BuildingFilter,
  ): Promise<BuildingUid[]> {
    if (filter.height_min !== undefined && filter.height_min >= 1000) return [];
    return this.uids;
  }
  async getBuildingGeometry(_dir: string, uids: BuildingUid[]): Promise<BuildingRow[]> {
    return uids.map((u, i) => ({
      building_uid: u,
      centroid_lon: 139.7 + i * 0.0001,
      centroid_lat: 35.66 + i * 0.0001,
      height: 20,
      usage: null,
      structure: null,
      year_built: null,
      zoning_use: null,
      far_max: null,
    }));
  }
  async linkPois(): Promise<PoiLinkResult> {
    return { links: {}, poi_count: 0, attribution: ATTR };
  }
}

function makeRegistry(uids: BuildingUid[], outputDir: string, sceneDir = "/tmp/no-disk") {
  const dataAccess = new FakeDataAccess(uids);
  const sceneStore = new SceneStore({
    maxScenes: 4,
    ttlMs: 60_000,
    persistToDisk: false,
    diskDir: sceneDir,
  });
  const gltfExporter = new GltfExporter(outputDir, dataAccess);
  const registry = new ToolRegistry({
    sceneStore,
    dataAccess,
    gltfExporter,
    attributionWrapper: new AttributionWrapper(),
    rateLimiter: new RateLimiter(),
    logger: createLogger(),
  });
  registry.registerAll();
  return { registry, sceneStore, dataAccess };
}

async function loadScene(registry: ToolRegistry): Promise<string> {
  const r = (await registry
    .get("load_area")!
    .execute(
      { city: "shibuya", bbox: [139.6975, 35.6555, 139.7045, 35.6605], lod: 2 },
      "test",
    )) as { result: { scene_id: string } };
  return r.result.scene_id;
}

describe("scene invariants", () => {
  let outputDir: string;
  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "plateau-inv-"));
  });
  afterAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("rejects building_uids that are not part of the scene", async () => {
    const { registry } = makeRegistry([asBuildingUid("a"), asBuildingUid("b")], outputDir);
    const sceneId = await loadScene(registry);
    await expect(
      registry
        .get("delete_buildings")!
        .execute({ scene_id: sceneId, building_uids: ["not_in_scene"] }, "test"),
    ).rejects.toMatchObject({ code: "BUILDING_UID_NOT_IN_SCENE" });
  });

  it("enforces expected_version on mutate", async () => {
    const { registry } = makeRegistry([asBuildingUid("a")], outputDir);
    const sceneId = await loadScene(registry);
    await expect(
      registry
        .get("delete_buildings")!
        .execute({ scene_id: sceneId, building_uids: ["a"], expected_version: 999 }, "test"),
    ).rejects.toMatchObject({ code: "SCENE_VERSION_CONFLICT" });
  });

  it("refuses to extrude a deleted building", async () => {
    const { registry } = makeRegistry([asBuildingUid("a")], outputDir);
    const sceneId = await loadScene(registry);
    await registry
      .get("delete_buildings")!
      .execute({ scene_id: sceneId, building_uids: ["a"] }, "test");
    await expect(
      registry
        .get("extrude_buildings")!
        .execute({ scene_id: sceneId, building_uids: ["a"], factor: 2 }, "test"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns EXPORT_LIMIT_EXCEEDED with a manifest suggestion when bbox is too large", async () => {
    const uids = Array.from({ length: 3 }, (_, i) => asBuildingUid(`u${i}`));
    const { registry, sceneStore } = makeRegistry(uids, outputDir);
    const r = (await registry
      .get("load_area")!
      .execute({ city: "shibuya", bbox: [139.5, 35.5, 139.9, 35.9], lod: 2 }, "test")) as {
      result: { scene_id: string };
    };
    expect(sceneStore.size()).toBe(1);
    await expect(
      registry
        .get("export_glb")!
        .execute({ scene_id: r.result.scene_id, mode: "single_glb" }, "test"),
    ).rejects.toMatchObject({
      code: "EXPORT_LIMIT_EXCEEDED",
      details: expect.objectContaining({ suggested_mode: "scene_manifest" }),
    });
  });

  it("scene_manifest mode bypasses the single-GLB limit", async () => {
    const uids = Array.from({ length: 3 }, (_, i) => asBuildingUid(`u${i}`));
    const { registry } = makeRegistry(uids, outputDir);
    const r = (await registry
      .get("load_area")!
      .execute({ city: "shibuya", bbox: [139.5, 35.5, 139.9, 35.9], lod: 2 }, "test")) as {
      result: { scene_id: string };
    };
    const out = (await registry
      .get("export_glb")!
      .execute({ scene_id: r.result.scene_id, mode: "scene_manifest" }, "test")) as {
      result: { mode: string; file_path: string };
    };
    expect(out.result.mode).toBe("scene_manifest");
    expect(out.result.file_path).toMatch(/\.json$/);
    const body = JSON.parse(await fs.readFile(out.result.file_path, "utf8"));
    expect(body.mode).toBe("scene_manifest");
    expect(Array.isArray(body.tiles)).toBe(true);
    expect(typeof body.tileset_available).toBe("boolean");
  });

  it("keeps two scenes independent", async () => {
    const { registry } = makeRegistry([asBuildingUid("a")], outputDir);
    const s1 = await loadScene(registry);
    const s2 = await loadScene(registry);
    expect(s1).not.toEqual(s2);
    await registry.get("delete_buildings")!.execute({ scene_id: s1, building_uids: ["a"] }, "test");
    const filtered = (await registry
      .get("filter_buildings")!
      .execute({ scene_id: s2, filter: {} }, "test")) as { result: { building_uids: string[] } };
    expect(filtered.result.building_uids).toContain("a");
  });

  it("mutate is atomic on failure — state is unchanged when handler throws", async () => {
    const { registry } = makeRegistry([asBuildingUid("a"), asBuildingUid("b")], outputDir);
    const sceneId = await loadScene(registry);
    await expect(
      registry
        .get("delete_buildings")!
        .execute({ scene_id: sceneId, building_uids: ["c"] }, "test"),
    ).rejects.toMatchObject({ code: "BUILDING_UID_NOT_IN_SCENE" });
    const filtered = (await registry
      .get("filter_buildings")!
      .execute({ scene_id: sceneId, filter: {} }, "test")) as {
      result: { version: number; building_uids: string[] };
    };
    expect(filtered.result.version).toBe(1);
    expect(filtered.result.building_uids).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
