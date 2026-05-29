import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactDownloader } from "../../src/data/ArtifactDownloader.js";
import { AppError } from "../../src/errors/AppError.js";

const INDEX_URL = "https://index.invalid/index.json";

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

let workRoot: string;
let artifactRoot: string;

/**
 * Build a `.tar.zst` bundle matching plateau-bridge's layout: files at the tar
 * root (buildings.parquet, manifest.json, style/…, buildings.pmtiles), zstd-compressed.
 */
async function buildBundle(opts: { code: string; name: string; year: number }): Promise<Buffer> {
  const stage = await fs.mkdtemp(path.join(workRoot, "stage-"));
  await fs.writeFile(path.join(stage, "buildings.parquet"), "PAR1-fake-parquet-data");
  await fs.writeFile(
    path.join(stage, "manifest.json"),
    JSON.stringify({ city_code: opts.code, city_name: opts.name, dataset_year: opts.year }),
  );
  // Extra files the MCP must NOT extract — present in real bundles.
  await fs.writeFile(path.join(stage, "buildings.pmtiles"), "PMTILES-noise");
  await fs.mkdir(path.join(stage, "style"), { recursive: true });
  await fs.writeFile(path.join(stage, "style", "x.arrow"), "ARROW-noise");

  const tarPath = path.join(stage, "bundle.tar");
  await tar.create({ file: tarPath, cwd: stage }, [
    "buildings.parquet",
    "manifest.json",
    "buildings.pmtiles",
    "style",
  ]);
  return zstdCompressSync(await fs.readFile(tarPath));
}

/** A fetch impl serving an index JSON and the bundle bytes it points at. */
function makeFetch(
  index: unknown,
  bundle: Buffer,
  opts: { bundleStatus?: number; indexStatus?: number } = {},
) {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith(".json")) {
      const status = opts.indexStatus ?? 200;
      if (status !== 200) return new Response(null, { status });
      return new Response(JSON.stringify(index), { status });
    }
    const status = opts.bundleStatus ?? 200;
    return new Response(status === 200 ? bundle : null, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function indexWith(entry: Record<string, unknown>) {
  return { schema: 1, updated: "2026-01-01T00:00:00Z", cities: [entry] };
}

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dlz-test-"));
  artifactRoot = path.join(workRoot, "artifacts");
});

afterEach(async () => {
  await fs.rm(workRoot, { recursive: true, force: true });
});

describe("ArtifactDownloader (index + zstd)", () => {
  it("resolves a slug via city_name, verifies sha256, and extracts only the needed files", async () => {
    const bundle = await buildBundle({ code: "13113", name: "Shibuya-ku", year: 2023 });
    const index = indexWith({
      city_code: "13113",
      city_name: "Shibuya-ku",
      dataset_year: 2023,
      bundle_url: "https://cdn.invalid/plateau-13113-2023-v1.tar.zst",
      sha256: sha256Hex(bundle),
      bytes: bundle.length,
    });
    const { impl } = makeFetch(index, bundle);
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    const result = await dl.download("shibuya");

    expect(result.cached).toBe(false);
    expect(result.sha256_verified).toBe(true);
    expect(result.bytes_downloaded).toBe(bundle.length);
    expect(result.dataset_year).toBe(2023);
    expect(result.city_code).toBe("13113");
    expect(result.artifact_dir).toBe(path.join(artifactRoot, "out_shibuya"));
    await expect(
      fs.access(path.join(result.artifact_dir, "buildings.parquet")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(result.artifact_dir, "manifest.json")),
    ).resolves.toBeUndefined();
    // The bundle's extra files must have been filtered out.
    await expect(fs.access(path.join(result.artifact_dir, "buildings.pmtiles"))).rejects.toThrow();
    await expect(fs.access(path.join(result.artifact_dir, "style"))).rejects.toThrow();
  });

  it("returns cached without re-fetching when the artifact already exists", async () => {
    const bundle = await buildBundle({ code: "13113", name: "Shibuya-ku", year: 2023 });
    const index = indexWith({
      city_code: "13113",
      city_name: "Shibuya-ku",
      dataset_year: 2023,
      bundle_url: "https://cdn.invalid/b.tar.zst",
      sha256: sha256Hex(bundle),
    });
    const { impl, calls } = makeFetch(index, bundle);
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await dl.download("shibuya");
    const firstCalls = calls.length;
    const second = await dl.download("shibuya");

    expect(second.cached).toBe(true);
    expect(second.bytes_downloaded).toBe(0);
    expect(calls.length).toBe(firstCalls);
    expect(await dl.hasArtifact("shibuya")).toBe(true);
  });

  it("rejects a sha256 mismatch and leaves no artifact behind", async () => {
    const bundle = await buildBundle({ code: "13113", name: "Shibuya-ku", year: 2023 });
    const index = indexWith({
      city_code: "13113",
      city_name: "Shibuya-ku",
      dataset_year: 2023,
      bundle_url: "https://cdn.invalid/b.tar.zst",
      sha256: "0".repeat(64),
    });
    const { impl } = makeFetch(index, bundle);
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await expect(dl.download("shibuya")).rejects.toBeInstanceOf(AppError);
    expect(await dl.hasArtifact("shibuya")).toBe(false);
  });

  it("errors when the slug is not present in the index", async () => {
    const bundle = await buildBundle({ code: "13113", name: "Shibuya-ku", year: 2023 });
    const index = indexWith({
      city_code: "13113",
      city_name: "Shibuya-ku",
      dataset_year: 2023,
      bundle_url: "https://cdn.invalid/b.tar.zst",
      sha256: sha256Hex(bundle),
    });
    const { impl } = makeFetch(index, bundle);
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await expect(dl.download("kyoto")).rejects.toBeInstanceOf(AppError);
  });

  it("throws on an HTTP error fetching the bundle", async () => {
    const bundle = await buildBundle({ code: "13113", name: "Shibuya-ku", year: 2023 });
    const index = indexWith({
      city_code: "13113",
      city_name: "Shibuya-ku",
      dataset_year: 2023,
      bundle_url: "https://cdn.invalid/b.tar.zst",
      sha256: sha256Hex(bundle),
    });
    const { impl } = makeFetch(index, bundle, { bundleStatus: 404 });
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await expect(dl.download("shibuya")).rejects.toBeInstanceOf(AppError);
  });

  it("rejects an invalid city slug before any fetch", async () => {
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL });
    await expect(dl.download("../etc")).rejects.toBeInstanceOf(AppError);
  });

  it("honors a per-call index_url override", async () => {
    const bundle = await buildBundle({ code: "01100", name: "Sapporo-shi", year: 2020 });
    const index = indexWith({
      city_code: "01100",
      city_name: "Sapporo-shi",
      dataset_year: 2020,
      bundle_url: "https://cdn.invalid/sapporo.tar.zst",
      sha256: sha256Hex(bundle),
    });
    const { impl, calls } = makeFetch(index, bundle);
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await dl.download("sapporo", "https://mirror.invalid/custom-index.json");
    expect(calls[0]).toBe("https://mirror.invalid/custom-index.json");
  });
});
