import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "../errors/AppError.js";
import { mapMcpError } from "../errors/mapMcpError.js";
import type { Logger } from "../utils/logger.js";
import { ToolRegistry } from "./ToolRegistry.js";
import type { ExecutionDeps } from "./toolEnvelope.js";

export interface PlateauCreativeMcpServerOptions {
  deps: ExecutionDeps;
  logger: Logger;
  serverName?: string;
  serverVersion?: string;
}

export class PlateauCreativeMcpServer {
  private readonly registry: ToolRegistry;
  private readonly server: Server;
  private readonly logger: Logger;

  constructor(opts: PlateauCreativeMcpServerOptions) {
    this.logger = opts.logger;
    this.registry = new ToolRegistry(opts.deps);
    this.registry.registerAll();
    this.server = new Server(
      {
        name: opts.serverName ?? "plateau-creative-mcp",
        version: opts.serverVersion ?? "0.1.0",
      },
      { capabilities: { tools: {} } },
    );
    this.bind();
  }

  private bind(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.registry.get(request.params.name);
      if (!tool) {
        throw new AppError("INVALID_INPUT", `Unknown tool: ${request.params.name}`);
      }
      const client = "stdio";
      try {
        const envelope = await tool.execute(request.params.arguments ?? {}, client);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(envelope),
            },
          ],
        };
      } catch (err) {
        const mapped = err instanceof AppError ? err : mapMcpError(err);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: mapped.toPayload() }),
            },
          ],
        };
      }
    });
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info("server.started", { transport: "stdio" });
  }
}
