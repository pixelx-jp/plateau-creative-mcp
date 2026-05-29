import { describe, expect, it } from "vitest";
import {
  OFFICIAL_PLATEAU_MCP_URL,
  OfficialPlateauMcpClient,
} from "../../src/data/OfficialPlateauMcpClient.js";
import type { FetchLike } from "../../src/data/OverpassClient.js";

interface JsonRpcCapture {
  url: string;
  method: string;
  params: { name?: string; arguments?: Record<string, unknown> };
}

function fakeFetchAcceptingAll(payload: unknown, capture: JsonRpcCapture[]): FetchLike {
  return async (url, init) => {
    const body = JSON.parse(String(init?.body));
    capture.push({ url, method: body.method, params: body.params });
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

describe("OfficialPlateauMcpClient", () => {
  it("uses the documented hosted URL by default", () => {
    expect(OFFICIAL_PLATEAU_MCP_URL).toBe("https://api.plateauview.mlit.go.jp/mcp");
  });

  it("calls plateau_get_metadata via tools/call", async () => {
    const captures: JsonRpcCapture[] = [];
    const client = new OfficialPlateauMcpClient({
      fetchImpl: fakeFetchAcceptingAll(
        { available_years: [2020, 2021, 2022, 2023], total_areas: 1700, total_datasets: 4321 },
        captures,
      ),
    });
    const meta = await client.getMetadata();
    expect(meta.available_years).toEqual([2020, 2021, 2022, 2023]);
    expect(meta.total_datasets).toBe(4321);
    expect(captures[0]!.method).toBe("tools/call");
    expect(captures[0]!.params.name).toBe("plateau_get_metadata");
  });

  it("typed search methods forward typed params", async () => {
    const captures: JsonRpcCapture[] = [];
    const client = new OfficialPlateauMcpClient({
      fetchImpl: fakeFetchAcceptingAll(
        { datasets: [{ id: "ds-1", name: "Shibuya bldg 2023" }] },
        captures,
      ),
    });
    const r = await client.searchDatasets({
      area_codes: ["13113"],
      year: 2023,
      plateau_spec: "3.0",
    });
    expect(r.datasets).toHaveLength(1);
    expect(captures[0]!.params.name).toBe("plateau_search_datasets");
    expect(captures[0]!.params.arguments).toEqual({
      area_codes: ["13113"],
      year: 2023,
      plateau_spec: "3.0",
    });
  });

  it("wraps citygml attribute fetch", async () => {
    const captures: JsonRpcCapture[] = [];
    const client = new OfficialPlateauMcpClient({
      fetchImpl: fakeFetchAcceptingAll(
        {
          attributes: [
            { building_id: "bldg-1", measured_height: 42, usage: "411", bbox: [0, 0, 1, 1] },
          ],
        },
        captures,
      ),
    });
    const r = await client.citygmlGetAttributes({
      url: "https://example.invalid/citygml.gml",
      building_ids: ["bldg-1"],
    });
    expect(r.attributes[0]!.measured_height).toBe(42);
    expect(captures[0]!.params.name).toBe("plateau_citygml_get_attributes");
  });
});
