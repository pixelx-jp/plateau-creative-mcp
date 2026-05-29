import { JsonRpcMcpClient } from "../data/JsonRpcMcpClient.js";
import { AppError } from "../errors/AppError.js";
import { type RenderViaBlenderInput, renderViaBlenderSchema } from "../schemas/renderViaBlender.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type SceneId, asSceneId } from "../utils/ids.js";

export interface RenderViaBlenderSuggestion {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface RenderViaBlenderResult {
  scene_id: SceneId;
  version: number;
  glb_path: string;
  sidecar_path?: string;
  bridged: boolean;
  suggested_next_calls: RenderViaBlenderSuggestion[];
  bridge_responses?: Array<{ tool: string; result: unknown }>;
}

const TEMPLATE_RE = /\{\{\s*(glb_path|sidecar_path|scene_id|version)\s*\}\}/g;
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

function applyTemplates(
  args: Record<string, unknown>,
  vars: { glb_path: string; sidecar_path?: string; scene_id: string; version: number },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      out[k] = v.replace(TEMPLATE_RE, (_, name: keyof typeof vars) => String(vars[name] ?? ""));
    } else {
      out[k] = v;
    }
  }
  return out;
}

function defaultToolCalls(): RenderViaBlenderInput["tool_calls"] {
  return [{ tool: "import_glb", args: { path: "{{glb_path}}" } }];
}

function allowedHosts(): string[] {
  const raw = process.env.RENDER_VIA_BLENDER_ALLOWED_HOSTS;
  if (!raw) return DEFAULT_ALLOWED_HOSTS;
  const parsed = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_HOSTS;
}

function assertEndpointAllowed(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AppError("INVALID_INPUT", "blender_mcp_endpoint is not a valid URL", { endpoint });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("INVALID_INPUT", "blender_mcp_endpoint must be http(s)", {
      protocol: url.protocol,
    });
  }
  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts();
  if (!allowed.includes(host)) {
    throw new AppError(
      "INVALID_INPUT",
      "blender_mcp_endpoint host is not in the allowlist; set RENDER_VIA_BLENDER_ALLOWED_HOSTS to include it explicitly.",
      { host, allowed_hosts: allowed },
    );
  }
}

export const renderViaBlenderTool: ToolDefinition<RenderViaBlenderInput, RenderViaBlenderResult> = {
  name: "render_via_blender",
  description:
    "Export the scene as a GLB and (optionally) bridge to a BlenderMCP-compatible HTTP MCP server via JSON-RPC. Endpoint hosts are restricted to localhost by default; override via RENDER_VIA_BLENDER_ALLOWED_HOSTS. When no endpoint is configured or dry_run=true, returns the suggested cross-MCP call sequence instead of executing it.",
  schema: renderViaBlenderSchema,
  handler: async (input, ctx) => {
    const sceneId = asSceneId(input.scene_id);
    return ctx.sceneStore.read(sceneId, async (scene) => {
      if (input.blender_mcp_endpoint && !input.dry_run) {
        assertEndpointAllowed(input.blender_mcp_endpoint);
      }

      const exported = await ctx.gltfExporter.export(
        scene,
        {
          mode: "single_glb",
          compress: input.export_options?.compress ?? true,
          outputName: input.export_options?.output_name,
        },
        scene.attribution,
      );
      if (exported.mode !== "single_glb") {
        throw new AppError(
          "EXPORT_GLTF_FAILED",
          "render_via_blender requires single_glb export; switch to export_glb directly for scene_manifest.",
        );
      }

      const calls =
        input.tool_calls && input.tool_calls.length > 0 ? input.tool_calls : defaultToolCalls();
      const vars = {
        glb_path: exported.file_path,
        sidecar_path: exported.sidecar_path,
        scene_id: scene.scene_id,
        version: scene.version,
      } satisfies Parameters<typeof applyTemplates>[1];
      const suggested: RenderViaBlenderSuggestion[] = (calls ?? []).map((c) => ({
        server: "blender-mcp",
        tool: c.tool,
        args: applyTemplates(c.args, vars),
      }));

      if (input.dry_run || !input.blender_mcp_endpoint) {
        return {
          result: {
            scene_id: scene.scene_id,
            version: scene.version,
            glb_path: exported.file_path,
            sidecar_path: exported.sidecar_path,
            bridged: false,
            suggested_next_calls: suggested,
          },
          attribution: scene.attribution,
        };
      }

      const client = new JsonRpcMcpClient({
        url: input.blender_mcp_endpoint,
        timeoutMs: input.timeout_ms,
        errorCode: "UPSTREAM_PLATEAU_ERROR",
      });

      const bridgeResponses: Array<{ tool: string; result: unknown }> = [];
      for (const call of suggested) {
        const result = await client.callTool(call.tool, call.args);
        bridgeResponses.push({ tool: call.tool, result });
      }

      return {
        result: {
          scene_id: scene.scene_id,
          version: scene.version,
          glb_path: exported.file_path,
          sidecar_path: exported.sidecar_path,
          bridged: true,
          suggested_next_calls: suggested,
          bridge_responses: bridgeResponses,
        },
        attribution: scene.attribution,
      };
    });
  },
};
