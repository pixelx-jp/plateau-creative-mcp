/**
 * Interactive REPL that exercises the MCP tools without a real client.
 *
 *   Usage:
 *     PLATEAU_ARTIFACT_DIR=../plateau-core npm run repl
 *
 * Commands (whitespace-separated; arguments are JSON):
 *     load <city> <bbox-json> <lod>
 *     filter <scene_id> <filter-json>
 *     delete <scene_id> <filter-json>
 *     extrude <scene_id> <filter-json> <factor>
 *     compose <scene_id> <composition-json>
 *     export <scene_id> [single_glb|scene_manifest] [compress]
 *     poi <scene_id> [max_distance_m]
 *     attribution <scene_id>
 *     scenes        list scene ids known to the in-memory store
 *     help          show this banner
 *     quit
 */
import path from "node:path";
import readline from "node:readline";
import { AttributionWrapper } from "../src/attribution/AttributionWrapper.js";
import { ArtifactDataAccess } from "../src/data/ArtifactClient.js";
import { OverpassClient } from "../src/data/OverpassClient.js";
import { GltfExporter } from "../src/export/GltfExporter.js";
import { RateLimiter } from "../src/rateLimit/RateLimiter.js";
import { SceneStore } from "../src/scene/SceneStore.js";
import { ToolRegistry } from "../src/server/ToolRegistry.js";
import { createLogger } from "../src/utils/logger.js";

const artifactDir = path.resolve(process.env.PLATEAU_ARTIFACT_DIR ?? "../plateau-core");
const outputDir = path.resolve(process.env.PLATEAU_OUTPUT_DIR ?? "./out");

const logger = createLogger();
const poiSource = process.env.OSM_OVERPASS_URL
  ? new OverpassClient({ url: process.env.OSM_OVERPASS_URL })
  : undefined;
const dataAccess = new ArtifactDataAccess(artifactDir, { poiSource });
const sceneStore = new SceneStore({
  maxScenes: 16,
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

const banner = `\nplateau-creative-mcp REPL\n  artifact dir: ${artifactDir}\n  output dir:   ${outputDir}\n  overpass:     ${poiSource ? "on" : "off"}\n  type 'help' for command list, 'quit' to exit.\n`;
process.stdout.write(banner);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "▶ " });

async function call(tool: string, args: object): Promise<void> {
  const t = registry.get(tool);
  if (!t) {
    process.stdout.write(`unknown tool: ${tool}\n`);
    return;
  }
  try {
    const r = await t.execute(args, "repl");
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; details?: unknown };
    process.stdout.write(
      `${JSON.stringify(
        { error: { code: e.code ?? "?", message: e.message, details: e.details } },
        null,
        2,
      )}\n`,
    );
  }
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

async function handle(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed === "quit" || trimmed === "exit") return false;
  if (trimmed === "help") {
    process.stdout.write(banner);
    return true;
  }
  if (trimmed === "scenes") {
    process.stdout.write(`scenes in store: ${sceneStore.size()}\n`);
    return true;
  }
  const [cmd, ...rest] = trimmed.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const args = rest.join(" ");
  switch (cmd) {
    case "load": {
      const [city, bbox, lod] = args.split(/\s+/, 3);
      await call("load_area", {
        city,
        bbox: parseJson(bbox ?? "", [0, 0, 1, 1]),
        lod: Number(lod ?? "2"),
      });
      return true;
    }
    case "filter": {
      const [sceneId, ...filt] = args.split(/\s+/);
      await call("filter_buildings", {
        scene_id: sceneId,
        filter: parseJson(filt.join(" "), {}),
      });
      return true;
    }
    case "delete": {
      const [sceneId, ...filt] = args.split(/\s+/);
      await call("delete_buildings", {
        scene_id: sceneId,
        filter: parseJson(filt.join(" "), {}),
      });
      return true;
    }
    case "extrude": {
      const parts = args.split(/\s+/);
      const sceneId = parts[0];
      const factor = Number(parts[parts.length - 1]);
      const filt = parts.slice(1, -1).join(" ");
      await call("extrude_buildings", {
        scene_id: sceneId,
        filter: parseJson(filt, {}),
        factor,
      });
      return true;
    }
    case "compose": {
      const [sceneId, ...rest] = args.split(/\s+/);
      await call("compose_scene", {
        scene_id: sceneId,
        ...parseJson(rest.join(" "), {}),
      });
      return true;
    }
    case "export": {
      const [sceneId, mode, compress] = args.split(/\s+/);
      await call("export_glb", {
        scene_id: sceneId,
        mode: mode === "scene_manifest" ? "scene_manifest" : "single_glb",
        options: { compress: compress === "compress" },
      });
      return true;
    }
    case "poi": {
      const [sceneId, dist] = args.split(/\s+/);
      await call("link_buildings_to_pois", {
        scene_id: sceneId,
        max_distance_m: dist ? Number(dist) : 30,
      });
      return true;
    }
    case "attribution": {
      await call("get_attribution", { scene_id: args.trim() });
      return true;
    }
    default:
      process.stdout.write(`unknown command: ${cmd ?? ""}\n`);
      return true;
  }
}

async function loop(): Promise<void> {
  rl.prompt();
  for await (const line of rl) {
    const keep = await handle(line);
    if (!keep) break;
    rl.prompt();
  }
  process.stdout.write("bye.\n");
}

loop().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
