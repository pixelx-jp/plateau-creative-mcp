import type { ToolEnvelope } from "../attribution/AttributionWrapper.js";
import { zodToJsonSchema } from "../schemas/zodJsonSchema.js";
import { type ExecutionDeps, type ToolDefinition, createExecutor } from "./toolEnvelope.js";

import { composeSceneTool } from "../tools/composeScene.js";
import { deleteBuildingsTool } from "../tools/deleteBuildings.js";
import { buildDownloadAreaTool } from "../tools/downloadArea.js";
import { exportGlbTool } from "../tools/exportGlb.js";
import { extrudeBuildingsTool } from "../tools/extrudeBuildings.js";
import { filterBuildingsTool } from "../tools/filterBuildings.js";
import { getAttributionTool } from "../tools/getAttribution.js";
import { linkBuildingsToPoisTool } from "../tools/linkBuildingsToPois.js";
import { loadAreaTool } from "../tools/loadArea.js";
import { renderViaBlenderTool } from "../tools/renderViaBlender.js";

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: object;
  execute: (input: unknown, client: string) => Promise<ToolEnvelope<unknown>>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(private readonly deps: ExecutionDeps) {}

  registerAll(): void {
    const downloadAreaTool = this.deps.downloader
      ? buildDownloadAreaTool(this.deps.downloader)
      : null;
    const defs: ToolDefinition<unknown, unknown>[] = [
      ...(downloadAreaTool
        ? [downloadAreaTool as unknown as ToolDefinition<unknown, unknown>]
        : []),
      loadAreaTool as unknown as ToolDefinition<unknown, unknown>,
      filterBuildingsTool as unknown as ToolDefinition<unknown, unknown>,
      deleteBuildingsTool as unknown as ToolDefinition<unknown, unknown>,
      extrudeBuildingsTool as unknown as ToolDefinition<unknown, unknown>,
      composeSceneTool as unknown as ToolDefinition<unknown, unknown>,
      exportGlbTool as unknown as ToolDefinition<unknown, unknown>,
      linkBuildingsToPoisTool as unknown as ToolDefinition<unknown, unknown>,
      getAttributionTool as unknown as ToolDefinition<unknown, unknown>,
      renderViaBlenderTool as unknown as ToolDefinition<unknown, unknown>,
    ];
    for (const def of defs) this.registerTool(def);
  }

  registerTool<I, O>(def: ToolDefinition<I, O>): void {
    if (this.tools.has(def.name)) throw new Error(`Tool already registered: ${def.name}`);
    const execute = createExecutor(def, this.deps);
    this.tools.set(def.name, {
      name: def.name,
      description: def.description,
      inputSchema: zodToJsonSchema(def.schema),
      execute: (input, client) => execute(input, client) as Promise<ToolEnvelope<unknown>>,
    });
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }
}
