#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AttributionWrapper } from "./attribution/AttributionWrapper.js";
import { loadConfig } from "./config/Config.js";
import { ArtifactDataAccess } from "./data/ArtifactClient.js";
import { ArtifactDownloader } from "./data/ArtifactDownloader.js";
import { OfficialPlateauMcpClient } from "./data/OfficialPlateauMcpClient.js";
import { OverpassClient } from "./data/OverpassClient.js";
import { PlateauCoreSubprocessClient } from "./data/PlateauCoreSubprocessClient.js";
import type { DataAccessLayer, PoiSource } from "./data/types.js";
import { AppError } from "./errors/AppError.js";
import { GltfExporter } from "./export/GltfExporter.js";
import { RateLimiter } from "./rateLimit/RateLimiter.js";
import { SceneStore } from "./scene/SceneStore.js";
import { PlateauCreativeMcpServer } from "./server/McpServer.js";
import { registerUpstreamPlateauTools } from "./tools/upstream/registerUpstream.js";
import { type Logger, createLogger } from "./utils/logger.js";

export { PlateauCreativeMcpServer } from "./server/McpServer.js";
export { ToolRegistry } from "./server/ToolRegistry.js";
export { SceneStore } from "./scene/SceneStore.js";
export { ArtifactDataAccess } from "./data/ArtifactClient.js";
export { ArtifactDownloader } from "./data/ArtifactDownloader.js";
export { PlateauCoreSubprocessClient } from "./data/PlateauCoreSubprocessClient.js";
export { OverpassClient } from "./data/OverpassClient.js";
export { JsonRpcMcpClient } from "./data/JsonRpcMcpClient.js";
export {
  OFFICIAL_PLATEAU_MCP_URL,
  OfficialPlateauMcpClient,
} from "./data/OfficialPlateauMcpClient.js";
export { GltfExporter } from "./export/GltfExporter.js";
export { loadConfig } from "./config/Config.js";

function buildPoiSource(
  config: ReturnType<typeof loadConfig>,
  logger: Logger,
): PoiSource | undefined {
  if (!config.osmOverpassUrl) {
    logger.info("poi.disabled", { reason: "OSM_OVERPASS_URL not set" });
    return undefined;
  }
  return new OverpassClient({
    url: config.osmOverpassUrl,
    timeoutMs: config.osmOverpassTimeoutMs,
  });
}

function defaultSubprocessScript(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "python", "plateau_query.py");
}

function buildDataAccess(
  config: ReturnType<typeof loadConfig>,
  poiSource: PoiSource | undefined,
): DataAccessLayer {
  if (config.dataMode === "subprocess") {
    const scriptPath = config.subprocessScript ?? defaultSubprocessScript();
    return new PlateauCoreSubprocessClient({
      artifactRoot: config.artifactDir,
      pythonBin: config.pythonBin,
      scriptPath,
      poiSource,
    });
  }
  return new ArtifactDataAccess(config.artifactDir, { poiSource });
}

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadConfig();
  const poiSource = buildPoiSource(config, logger);
  const dataAccess = buildDataAccess(config, poiSource);
  const sceneStore = new SceneStore({
    maxScenes: config.maxScenes,
    ttlMs: config.sceneTtlMs,
    persistToDisk: config.persistScenes,
    diskDir: config.sceneDir,
  });
  const gltfExporter = new GltfExporter(config.outputDir, dataAccess);
  const attributionWrapper = new AttributionWrapper();
  const rateLimiter = new RateLimiter();

  const downloader = new ArtifactDownloader({
    artifactRoot: config.artifactDir,
    indexUrl: config.artifactIndexUrl,
    timeoutMs: config.artifactDownloadTimeoutMs,
  });

  const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
  const server = new PlateauCreativeMcpServer({
    serverVersion: pkg.version,
    deps: {
      sceneStore,
      dataAccess,
      gltfExporter,
      attributionWrapper,
      rateLimiter,
      logger,
      downloader,
      autoDownload: config.autoDownload,
    },
    logger,
  });

  let upstreamToolCount = 0;
  if (config.upstreamEnabled) {
    const upstream = new OfficialPlateauMcpClient({ url: config.officialPlateauMcpUrl });
    const registered = registerUpstreamPlateauTools(server.getRegistry(), upstream);
    upstreamToolCount = registered.length;
    logger.info("upstream.registered", {
      count: upstreamToolCount,
      url: config.officialPlateauMcpUrl ?? "default",
    });
  }

  await server.start();
  logger.info("server.ready", {
    artifact_dir: config.artifactDir,
    artifact_dir_explicit: config.artifactDirExplicit,
    dataMode: config.dataMode,
    artifact_index_url: config.artifactIndexUrl,
    auto_download: config.autoDownload,
    overpass: !!config.osmOverpassUrl,
    upstream_tools: upstreamToolCount,
  });
}

const isEntry = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isEntry) {
  main().catch((err) => {
    const payload = err instanceof AppError ? err.toPayload() : { message: String(err) };
    process.stderr.write(`${JSON.stringify({ level: "fatal", err: payload })}\n`);
    process.exit(1);
  });
}
