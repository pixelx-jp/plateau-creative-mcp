import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AttributionWrapper } from "../src/attribution/AttributionWrapper.js";
import { ArtifactDataAccess } from "../src/data/ArtifactClient.js";
import { GltfExporter } from "../src/export/GltfExporter.js";
import { RateLimiter } from "../src/rateLimit/RateLimiter.js";
import { SceneStore } from "../src/scene/SceneStore.js";
import { ToolRegistry } from "../src/server/ToolRegistry.js";
import { createLogger } from "../src/utils/logger.js";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "size-"));
const dataAccess = new ArtifactDataAccess(path.resolve("../plateau-core"));
const sceneStore = new SceneStore({
  maxScenes: 4,
  ttlMs: 600000,
  persistToDisk: false,
  diskDir: tmp,
});
const gltfExporter = new GltfExporter(tmp, dataAccess);
const reg = new ToolRegistry({
  sceneStore,
  dataAccess,
  gltfExporter,
  attributionWrapper: new AttributionWrapper(),
  rateLimiter: new RateLimiter(),
  logger: createLogger(),
});
reg.registerAll();
const loaded = (await reg
  .get("load_area")!
  .execute({ city: "shibuya", bbox: [139.6975, 35.6555, 139.7045, 35.6605], lod: 2 }, "m")) as any;
const sid = loaded.result.scene_id;
const a = (await reg.get("export_glb")!.execute(
  {
    scene_id: sid,
    mode: "single_glb",
    options: { compress: false, output_name: "uncompressed" },
  },
  "m",
)) as any;
const b = (await reg.get("export_glb")!.execute(
  {
    scene_id: sid,
    mode: "single_glb",
    options: { compress: true, output_name: "compressed" },
  },
  "m",
)) as any;
console.log("uncompressed:", a.result.stats);
console.log("compressed:  ", b.result.stats);
console.log(
  "shrink ratio:",
  (b.result.stats.output_bytes / a.result.stats.output_bytes).toFixed(3),
);
