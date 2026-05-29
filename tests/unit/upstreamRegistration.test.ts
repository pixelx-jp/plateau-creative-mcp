import { describe, expect, it } from "vitest";
import { AttributionWrapper } from "../../src/attribution/AttributionWrapper.js";
import { ArtifactDataAccess } from "../../src/data/ArtifactClient.js";
import { OfficialPlateauMcpClient } from "../../src/data/OfficialPlateauMcpClient.js";
import type { FetchLike } from "../../src/data/OverpassClient.js";
import { GltfExporter } from "../../src/export/GltfExporter.js";
import { RateLimiter } from "../../src/rateLimit/RateLimiter.js";
import { SceneStore } from "../../src/scene/SceneStore.js";
import { ToolRegistry } from "../../src/server/ToolRegistry.js";
import {
  UPSTREAM_TOOL_NAMES,
  registerUpstreamPlateauTools,
} from "../../src/tools/upstream/registerUpstream.js";
import { createLogger } from "../../src/utils/logger.js";

interface Capture {
  method: string;
  name: string;
  args: Record<string, unknown>;
}

function fakeFetch(payload: unknown, capture: Capture[]): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    capture.push({ method: body.method, name: body.params?.name, args: body.params?.arguments });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
      }),
    };
  };
}

function makeRegistry() {
  const dataAccess = new ArtifactDataAccess("/tmp/no");
  const sceneStore = new SceneStore({
    maxScenes: 4,
    ttlMs: 60_000,
    persistToDisk: false,
    diskDir: "/tmp/no",
  });
  const gltfExporter = new GltfExporter("/tmp/no-output", dataAccess);
  const registry = new ToolRegistry({
    sceneStore,
    dataAccess,
    gltfExporter,
    attributionWrapper: new AttributionWrapper(),
    rateLimiter: new RateLimiter(),
    logger: createLogger(),
  });
  return registry;
}

describe("upstream registration", () => {
  it("registers all 13 upstream tools", () => {
    const reg = makeRegistry();
    const client = new OfficialPlateauMcpClient({ fetchImpl: fakeFetch({}, []) });
    const names = registerUpstreamPlateauTools(reg, client);
    expect(names).toEqual(UPSTREAM_TOOL_NAMES);
    expect(names).toHaveLength(13);
    for (const n of names) {
      expect(reg.get(n)?.name).toBe(n);
    }
  });

  it("dispatches plateau_search_datasets through to upstream callTool", async () => {
    const reg = makeRegistry();
    const captures: Capture[] = [];
    const client = new OfficialPlateauMcpClient({
      fetchImpl: fakeFetch({ datasets: [{ id: "ds-1", name: "Shibuya bldg 2023" }] }, captures),
    });
    registerUpstreamPlateauTools(reg, client);

    const r = (await reg
      .get("plateau_search_datasets")!
      .execute({ area_codes: ["13113"], year: 2023, plateau_spec: "3.0" }, "test")) as {
      result: { datasets: Array<{ id: string }> };
      attribution_metadata: { license: string };
    };

    expect(r.attribution_metadata.license).toBe("CC BY 4.0");
    expect(r.result.datasets[0]!.id).toBe("ds-1");
    expect(captures[0]!.method).toBe("tools/call");
    expect(captures[0]!.name).toBe("plateau_search_datasets");
    expect(captures[0]!.args).toEqual({
      area_codes: ["13113"],
      year: 2023,
      plateau_spec: "3.0",
    });
  });

  it("rejects invalid input via Zod before hitting the upstream", async () => {
    const reg = makeRegistry();
    const captures: Capture[] = [];
    const client = new OfficialPlateauMcpClient({ fetchImpl: fakeFetch({}, captures) });
    registerUpstreamPlateauTools(reg, client);

    await expect(
      reg.get("plateau_citygml_get_geoid_height")!.execute({ latitude: 999, longitude: 0 }, "test"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(captures).toHaveLength(0);
  });
});
