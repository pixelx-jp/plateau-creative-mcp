import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AttributionWrapper } from "../../src/attribution/AttributionWrapper.js";
import type {
  BuildingRow,
  DataAccessLayer,
  LinkPoisInput,
  LoadAreaQuery,
  LoadedArea,
  PoiLinkResult,
} from "../../src/data/types.js";
import { GltfExporter } from "../../src/export/GltfExporter.js";
import { RateLimiter } from "../../src/rateLimit/RateLimiter.js";
import { SceneStore } from "../../src/scene/SceneStore.js";
import type { BuildingFilter } from "../../src/schemas/common.js";
import { ToolRegistry } from "../../src/server/ToolRegistry.js";
import { type BuildingUid, asBuildingUid } from "../../src/utils/ids.js";
import { createLogger } from "../../src/utils/logger.js";

const ATTR = {
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
  async queryBuildings(_d: string, _b: [number, number, number, number], _f: BuildingFilter) {
    return this.uids;
  }
  async getBuildingGeometry(_d: string, uids: BuildingUid[]): Promise<BuildingRow[]> {
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
  async linkPois(_: LinkPoisInput): Promise<PoiLinkResult> {
    return { links: {}, poi_count: 0, attribution: ATTR };
  }
}

function makeRegistry(outputDir: string) {
  const da = new FakeDataAccess([asBuildingUid("a"), asBuildingUid("b")]);
  const store = new SceneStore({
    maxScenes: 4,
    ttlMs: 60_000,
    persistToDisk: false,
    diskDir: "/tmp/no",
  });
  const gltf = new GltfExporter(outputDir, da);
  const reg = new ToolRegistry({
    sceneStore: store,
    dataAccess: da,
    gltfExporter: gltf,
    attributionWrapper: new AttributionWrapper(),
    rateLimiter: new RateLimiter(),
    logger: createLogger(),
  });
  reg.registerAll();
  return reg;
}

async function newScene(reg: ToolRegistry): Promise<string> {
  const r = (await reg
    .get("load_area")!
    .execute(
      { city: "shibuya", bbox: [139.6975, 35.6555, 139.7045, 35.6605], lod: 2 },
      "test",
    )) as { result: { scene_id: string } };
  return r.result.scene_id;
}

describe("render_via_blender", () => {
  let outputDir: string;
  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "rvb-"));
  });
  afterAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("dry_run returns suggested_next_calls with templates applied", async () => {
    const reg = makeRegistry(outputDir);
    const sid = await newScene(reg);
    const r = (await reg.get("render_via_blender")!.execute(
      {
        scene_id: sid,
        dry_run: true,
        tool_calls: [
          { tool: "import_glb", args: { path: "{{glb_path}}" } },
          { tool: "render", args: { tag: "scene_{{scene_id}}_v{{version}}", samples: 32 } },
        ],
      },
      "test",
    )) as {
      result: {
        bridged: boolean;
        glb_path: string;
        suggested_next_calls: Array<{ tool: string; args: Record<string, unknown> }>;
      };
    };
    expect(r.result.bridged).toBe(false);
    expect(r.result.glb_path).toMatch(/\.glb$/);
    expect(r.result.suggested_next_calls).toHaveLength(2);
    expect(r.result.suggested_next_calls[0]!.args.path).toBe(r.result.glb_path);
    expect(r.result.suggested_next_calls[1]!.args.tag).toMatch(/^scene_scene_/);
    expect(r.result.suggested_next_calls[1]!.args.samples).toBe(32);
  });

  it("defaults to import_glb when no tool_calls provided and no endpoint set", async () => {
    const reg = makeRegistry(outputDir);
    const sid = await newScene(reg);
    const r = (await reg.get("render_via_blender")!.execute({ scene_id: sid }, "test")) as {
      result: {
        bridged: boolean;
        suggested_next_calls: Array<{ tool: string }>;
      };
    };
    expect(r.result.bridged).toBe(false);
    expect(r.result.suggested_next_calls).toEqual([
      expect.objectContaining({ tool: "import_glb" }),
    ]);
  });

  it("bridges to a remote MCP HTTP server when endpoint is set", async () => {
    const reg = makeRegistry(outputDir);
    const sid = await newScene(reg);
    const calls: Array<{ method: string; params: unknown }> = [];
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      _url: string,
      init: RequestInit,
    ) => {
      const body = JSON.parse(String(init.body));
      calls.push({ method: body.method, params: body.params });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ ok: true, name: body.params.name }) }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const r = (await reg.get("render_via_blender")!.execute(
        {
          scene_id: sid,
          blender_mcp_endpoint: "http://localhost:8765/rpc",
        },
        "test",
      )) as {
        result: { bridged: boolean; bridge_responses?: Array<{ tool: string; result: unknown }> };
      };
      expect(r.result.bridged).toBe(true);
      expect(r.result.bridge_responses).toHaveLength(1);
      expect(r.result.bridge_responses![0]!.tool).toBe("import_glb");
      expect(calls[0]!.method).toBe("tools/call");
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("rejects endpoints not in the host allowlist", async () => {
    const reg = makeRegistry(outputDir);
    const sid = await newScene(reg);
    await expect(
      reg.get("render_via_blender")!.execute(
        {
          scene_id: sid,
          blender_mcp_endpoint: "https://attacker.invalid/rpc",
        },
        "test",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      details: expect.objectContaining({ host: "attacker.invalid" }),
    });
  });
});
