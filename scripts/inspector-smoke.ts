/**
 * Headless MCP stdio smoke test.
 *
 * Spawns `tsx src/index.ts` as a real MCP server, performs the full
 * initialize handshake, lists tools, and exercises load_area on the
 * Shibuya artifact. Mirrors what Claude Desktop / MCP Inspector does
 * under the hood, so it catches stdio framing / capabilities bugs the
 * unit tests can't see.
 *
 * Usage:
 *   PLATEAU_ARTIFACT_DIR=../plateau-core npx tsx scripts/inspector-smoke.ts
 *   PLATEAU_ARTIFACT_DIR=../plateau-core PLATEAU_UPSTREAM_ENABLED=true npx tsx scripts/inspector-smoke.ts
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

class StdioMcpDriver {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, (r: JsonRpcResponse) => void>();
  private nextId = 1;
  private rl: readline.Interface;

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) process.stderr.write(`  [server] ${line}\n`);
      }
    });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => this.onLine(line));
    this.child.on("exit", (code) => {
      if (this.pending.size > 0) {
        for (const resolve of this.pending.values()) {
          resolve({
            jsonrpc: "2.0",
            error: { code: -32000, message: `server exited with code ${code}` },
          });
        }
        this.pending.clear();
      }
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof msg.id !== "number") return;
    const resolver = this.pending.get(msg.id);
    if (resolver) {
      this.pending.delete(msg.id);
      resolver(msg);
    }
  }

  async request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (r) => {
        if (r.error) reject(new Error(`${method}: ${r.error.message}`));
        else resolve(r.result as T);
      });
      this.child.stdin.write(payload);
    });
  }

  notify(method: string, params: unknown = {}): void {
    const payload = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
    this.child.stdin.write(payload);
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    await new Promise((r) => setTimeout(r, 50));
    this.child.kill("SIGTERM");
  }
}

interface ListToolsResult {
  tools: Array<{ name: string; description: string; inputSchema: object }>;
}

interface CallToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const artifactDir = process.env.PLATEAU_ARTIFACT_DIR
    ? path.resolve(process.env.PLATEAU_ARTIFACT_DIR)
    : path.resolve(projectRoot, "..", "plateau-core");
  const upstreamEnabled = process.env.PLATEAU_UPSTREAM_ENABLED === "true";

  console.log(`spawning MCP server (artifactDir=${artifactDir}, upstream=${upstreamEnabled})...`);
  const driver = new StdioMcpDriver("npx", ["tsx", path.join(projectRoot, "src/index.ts")], {
    PLATEAU_ARTIFACT_DIR: artifactDir,
    PLATEAU_UPSTREAM_ENABLED: upstreamEnabled ? "true" : "false",
    PLATEAU_OUTPUT_DIR: path.join(projectRoot, "out"),
  });

  try {
    console.log("→ initialize");
    const init = await driver.request<{
      protocolVersion: string;
      capabilities: unknown;
      serverInfo: { name: string; version: string };
    }>("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "inspector-smoke", version: "0.1" },
    });
    console.log(
      `  ← server ${init.serverInfo.name} v${init.serverInfo.version}, protocol ${init.protocolVersion}`,
    );
    driver.notify("notifications/initialized");

    console.log("→ tools/list");
    const list = await driver.request<ListToolsResult>("tools/list");
    const names = list.tools.map((t) => t.name).sort();
    const expectedOwn = [
      "compose_scene",
      "delete_buildings",
      "export_glb",
      "extrude_buildings",
      "filter_buildings",
      "get_attribution",
      "link_buildings_to_pois",
      "load_area",
      "render_via_blender",
    ];
    const ownPresent = expectedOwn.every((n) => names.includes(n));
    console.log(`  ← ${list.tools.length} tools total. own 9: ${ownPresent ? "✓" : "✗"}`);
    if (!ownPresent) {
      const missing = expectedOwn.filter((n) => !names.includes(n));
      throw new Error(`missing own tools: ${missing.join(", ")}`);
    }
    if (upstreamEnabled) {
      const upstreamPresent = names.filter((n) => n.startsWith("plateau_")).length;
      console.log(
        `  ← upstream plateau_*: ${upstreamPresent}/13 ${upstreamPresent === 13 ? "✓" : "✗"}`,
      );
      if (upstreamPresent !== 13)
        throw new Error(`expected 13 upstream tools, got ${upstreamPresent}`);
    }

    console.log("→ tools/call load_area shibuya");
    const callResult = await driver.request<CallToolResult>("tools/call", {
      name: "load_area",
      arguments: {
        city: "shibuya",
        bbox: [139.6975, 35.6555, 139.7045, 35.6605],
        lod: 2,
      },
    });
    if (callResult.isError) throw new Error("load_area returned isError");
    const text = callResult.content[0]?.text;
    if (!text) throw new Error("load_area returned no text content");
    const envelope = JSON.parse(text) as {
      result: { scene_id: string; summary: { building_count: number } };
      attribution_metadata: { license: string };
    };
    console.log(
      `  ← scene_id=${envelope.result.scene_id}, buildings=${envelope.result.summary.building_count}, license="${envelope.attribution_metadata.license}"`,
    );
    if (envelope.attribution_metadata.license !== "CC BY 4.0") {
      throw new Error(`unexpected license: ${envelope.attribution_metadata.license}`);
    }
    if (envelope.result.summary.building_count === 0) {
      throw new Error("expected >0 buildings");
    }

    console.log("→ tools/call filter_buildings height_min=100");
    const filterCall = await driver.request<CallToolResult>("tools/call", {
      name: "filter_buildings",
      arguments: { scene_id: envelope.result.scene_id, filter: { height_min: 100 } },
    });
    const filterEnv = JSON.parse(filterCall.content[0]!.text!) as {
      result: { count: number };
    };
    console.log(`  ← height≥100m count=${filterEnv.result.count}`);

    console.log("→ tools/call delete_buildings + export_glb");
    await driver.request<CallToolResult>("tools/call", {
      name: "delete_buildings",
      arguments: { scene_id: envelope.result.scene_id, filter: { height_min: 80 } },
    });
    const exportCall = await driver.request<CallToolResult>("tools/call", {
      name: "export_glb",
      arguments: {
        scene_id: envelope.result.scene_id,
        mode: "single_glb",
        options: { compress: true },
      },
    });
    const exportEnv = JSON.parse(exportCall.content[0]!.text!) as {
      result: {
        file_path: string;
        license_path: string;
        stats: { compressed: boolean; output_bytes: number; pre_compress_bytes: number };
      };
    };
    console.log(
      `  ← glb=${path.basename(exportEnv.result.file_path)} (${(exportEnv.result.stats.output_bytes / 1024).toFixed(1)} KB, ${((exportEnv.result.stats.output_bytes / exportEnv.result.stats.pre_compress_bytes) * 100).toFixed(0)}% of uncompressed)`,
    );
    console.log(`  ← license=${path.basename(exportEnv.result.license_path)}`);
    if (upstreamEnabled && process.env.PLATEAU_UPSTREAM_LIVE_PROBE === "true") {
      console.log("→ tools/call plateau_get_metadata (LIVE upstream)");
      const metaCall = await driver.request<CallToolResult>("tools/call", {
        name: "plateau_get_metadata",
        arguments: {},
      });
      if (metaCall.isError) {
        const errText = metaCall.content[0]?.text ?? "(no body)";
        throw new Error(`live upstream call failed: ${errText}`);
      }
      const metaEnv = JSON.parse(metaCall.content[0]!.text!) as {
        result: { available_years?: number[]; total_areas?: number; total_datasets?: number };
      };
      console.log(
        `  ← years=${JSON.stringify(metaEnv.result.available_years)}, areas=${metaEnv.result.total_areas}, datasets=${metaEnv.result.total_datasets}`,
      );
    }

    console.log("ALL GREEN ✓");
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error("✗ FAIL:", err.message);
  process.exit(1);
});
