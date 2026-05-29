import type { z } from "zod";
import type { AttributionWrapper, ToolEnvelope } from "../attribution/AttributionWrapper.js";
import type { ArtifactDownloader } from "../data/ArtifactDownloader.js";
import type { DataAccessLayer } from "../data/types.js";
import { AppError } from "../errors/AppError.js";
import { mapMcpError } from "../errors/mapMcpError.js";
import type { GltfExporter } from "../export/GltfExporter.js";
import type { RateLimiter } from "../rateLimit/RateLimiter.js";
import type { SceneStore } from "../scene/SceneStore.js";
import type { AttributionMetadata } from "../schemas/common.js";
import type { Logger } from "../utils/logger.js";
import type { ToolName } from "./toolNames.js";

export interface ToolContext {
  sceneStore: SceneStore;
  dataAccess: DataAccessLayer;
  gltfExporter: GltfExporter;
  logger: Logger;
  client: string;
  downloader?: ArtifactDownloader;
  autoDownload?: boolean;
}

export interface HandlerResult<T> {
  result: T;
  attribution: AttributionMetadata;
}

export interface ToolDefinition<I, O> {
  name: ToolName;
  description: string;
  schema: z.ZodType<I, z.ZodTypeDef, unknown>;
  handler: (input: I, ctx: ToolContext) => Promise<HandlerResult<O>>;
}

export interface ExecutionDeps {
  rateLimiter: RateLimiter;
  attributionWrapper: AttributionWrapper;
  sceneStore: SceneStore;
  dataAccess: DataAccessLayer;
  gltfExporter: GltfExporter;
  logger: Logger;
  downloader?: ArtifactDownloader;
  autoDownload?: boolean;
}

export function createExecutor<I, O>(def: ToolDefinition<I, O>, deps: ExecutionDeps) {
  return async (rawInput: unknown, client: string): Promise<ToolEnvelope<O>> => {
    const release = await deps.rateLimiter.acquire({ client, tool: def.name });
    const started = Date.now();
    try {
      const input = def.schema.parse(rawInput);
      const handlerResult = await def.handler(input, {
        sceneStore: deps.sceneStore,
        dataAccess: deps.dataAccess,
        gltfExporter: deps.gltfExporter,
        logger: deps.logger,
        client,
        downloader: deps.downloader,
        autoDownload: deps.autoDownload,
      });
      const envelope = deps.attributionWrapper.wrap({
        tool: def.name,
        input,
        result: handlerResult.result,
        attribution: handlerResult.attribution,
      });
      deps.logger.info("tool.ok", { tool: def.name, ms: Date.now() - started });
      return envelope;
    } catch (err) {
      const mapped = err instanceof AppError ? err : mapMcpError(err);
      deps.logger.warn("tool.err", {
        tool: def.name,
        code: mapped.code,
        ms: Date.now() - started,
      });
      throw mapped;
    } finally {
      release();
    }
  };
}
