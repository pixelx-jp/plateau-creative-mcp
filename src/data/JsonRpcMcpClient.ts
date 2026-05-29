import { AppError } from "../errors/AppError.js";
import type { FetchLike } from "./OverpassClient.js";

export interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: object;
}

export interface JsonRpcMcpClientOptions {
  url: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  headers?: Record<string, string>;
  errorCode?: "UPSTREAM_PLATEAU_ERROR" | "PLATEAU_CORE_ERROR";
}

interface JsonRpcResponse<T> {
  jsonrpc?: "2.0";
  id?: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let nextRequestId = 1;

export class JsonRpcMcpClient {
  private readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly errorCode: "UPSTREAM_PLATEAU_ERROR" | "PLATEAU_CORE_ERROR";

  constructor(opts: JsonRpcMcpClientOptions) {
    this.url = opts.url;
    this.fetchImpl =
      opts.fetchImpl ??
      ((input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.headers = opts.headers ?? {};
    this.errorCode = opts.errorCode ?? "UPSTREAM_PLATEAU_ERROR";
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const id = nextRequestId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Awaited<ReturnType<FetchLike>>;
    try {
      resp = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...this.headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new AppError(this.errorCode, `JSON-RPC transport failed: ${(err as Error).message}`, {
        url: this.url,
        method,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      throw new AppError(this.errorCode, `JSON-RPC HTTP ${resp.status}`, {
        method,
        status: resp.status,
      });
    }
    let body: JsonRpcResponse<T>;
    try {
      body = (await resp.json()) as JsonRpcResponse<T>;
    } catch (err) {
      throw new AppError(
        this.errorCode,
        `JSON-RPC response was not JSON: ${(err as Error).message}`,
        {
          method,
        },
      );
    }
    if (body.error) {
      throw new AppError(this.errorCode, body.error.message, {
        method,
        code: body.error.code,
        data: body.error.data,
      });
    }
    if (body.result === undefined) {
      throw new AppError(this.errorCode, "JSON-RPC response missing result", { method });
    }
    return body.result;
  }

  async listTools(): Promise<RemoteTool[]> {
    const r = await this.rpc<{ tools?: RemoteTool[] }>("tools/list", {});
    return r.tools ?? [];
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const r = await this.rpc<{ content?: Array<{ type: string; text?: string }>; result?: T }>(
      "tools/call",
      { name, arguments: args },
    );
    if (r.result !== undefined) return r.result;
    if (r.content) {
      const text = r.content.find((c) => c.type === "text")?.text;
      if (text === undefined) {
        throw new AppError(this.errorCode, "Remote tool returned no textual content", { name });
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    }
    throw new AppError(this.errorCode, "Remote tool returned no result field", { name });
  }
}
