import { describe, expect, it } from "vitest";
import { JsonRpcMcpClient } from "../../src/data/JsonRpcMcpClient.js";
import type { FetchLike } from "../../src/data/OverpassClient.js";

function fakeFetch(body: unknown, opts: { ok?: boolean; status?: number } = {}): FetchLike {
  return async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: "OK",
    json: async () => body,
  });
}

describe("JsonRpcMcpClient", () => {
  it("parses a tools/list response", async () => {
    const client = new JsonRpcMcpClient({
      url: "https://upstream.invalid",
      fetchImpl: fakeFetch({
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [{ name: "search_datasets", description: "..." }] },
      }),
    });
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("search_datasets");
  });

  it("unwraps a text content envelope from tools/call", async () => {
    const client = new JsonRpcMcpClient({
      url: "https://upstream.invalid",
      fetchImpl: fakeFetch({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: JSON.stringify({ datasets: ["a", "b"] }) }] },
      }),
    });
    const r = await client.callTool<{ datasets: string[] }>("search_datasets", { q: "shibuya" });
    expect(r.datasets).toEqual(["a", "b"]);
  });

  it("maps an HTTP error to UPSTREAM_PLATEAU_ERROR", async () => {
    const client = new JsonRpcMcpClient({
      url: "https://upstream.invalid",
      fetchImpl: fakeFetch({}, { ok: false, status: 500 }),
    });
    await expect(client.listTools()).rejects.toMatchObject({ code: "UPSTREAM_PLATEAU_ERROR" });
  });

  it("maps a JSON-RPC error envelope", async () => {
    const client = new JsonRpcMcpClient({
      url: "https://upstream.invalid",
      fetchImpl: fakeFetch({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }),
    });
    await expect(client.callTool("nope", {})).rejects.toMatchObject({
      code: "UPSTREAM_PLATEAU_ERROR",
      details: expect.objectContaining({ code: -32601 }),
    });
  });
});
