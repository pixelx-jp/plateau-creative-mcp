import path from "node:path";
import { AttributionWrapper } from "../src/attribution/AttributionWrapper.js";
import { ArtifactDataAccess } from "../src/data/ArtifactClient.js";
import { GltfExporter } from "../src/export/GltfExporter.js";
import { RateLimiter } from "../src/rateLimit/RateLimiter.js";
import { SceneStore } from "../src/scene/SceneStore.js";
import { ToolRegistry } from "../src/server/ToolRegistry.js";
import { createLogger } from "../src/utils/logger.js";

async function main() {
  const artifactDir = process.env.PLATEAU_ARTIFACT_DIR ?? path.resolve("../plateau-core");
  const outputDir = path.resolve("./out");
  const logger = createLogger();
  const dataAccess = new ArtifactDataAccess(artifactDir);
  const sceneStore = new SceneStore({
    maxScenes: 8,
    ttlMs: 60 * 60 * 1000,
    persistToDisk: false,
    diskDir: "./.scene-store",
  });
  const gltfExporter = new GltfExporter(outputDir, dataAccess);
  const registry = new ToolRegistry({
    sceneStore,
    dataAccess,
    gltfExporter,
    attributionWrapper: new AttributionWrapper(),
    rateLimiter: new RateLimiter(),
    logger,
  });
  registry.registerAll();

  const load = registry.get("load_area")!;
  const filter = registry.get("filter_buildings")!;
  const del = registry.get("delete_buildings")!;
  const exportGlb = registry.get("export_glb")!;

  const loaded = (await load.execute(
    {
      city: "shibuya",
      bbox: [139.6975, 35.6555, 139.7045, 35.6605],
      lod: 2,
    },
    "smoke",
  )) as { result: { scene_id: string; summary: { building_count: number } } };
  console.log("load_area:", loaded.result.summary);

  const sceneId = loaded.result.scene_id;
  const filtered = (await filter.execute(
    {
      scene_id: sceneId,
      filter: { height_min: 50 },
    },
    "smoke",
  )) as { result: { count: number; building_uids: string[] } };
  console.log("filter_buildings (height>=50):", filtered.result.count);

  const deleted = (await del.execute(
    {
      scene_id: sceneId,
      filter: { height_min: 100 },
    },
    "smoke",
  )) as { result: { deleted_count: number; version: number } };
  console.log("delete_buildings (height>=100):", deleted.result);

  const exported = (await exportGlb.execute(
    {
      scene_id: sceneId,
      mode: "single_glb",
      options: {},
    },
    "smoke",
  )) as { result: { file_path: string; stats: unknown } };
  console.log("export_glb:", exported.result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
