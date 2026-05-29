import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactDownloader } from "../../src/data/ArtifactDownloader.js";
import { AppError } from "../../src/errors/AppError.js";

const INDEX_URL = "https://index.invalid/index.json";

// Prebuilt fixture mirroring plateau-bridge's bundle layout: a zstd-compressed
// tar with files at the root (buildings.parquet, manifest.json, plus
// buildings.pmtiles + style/ noise to verify extraction filtering).
// Committed as a binary so the test needs no zstd *compressor* — works on every
// supported Node version (node:zlib zstd is Node 22.15+ only).
const FIXTURE = readFileSync(
  fileURLToPath(new URL("../fixtures/shibuya-bundle.tar.zst", import.meta.url)),
);
// Manifest baked into the fixture.
const CITY = { slug: "shibuya", code: "13113", year: 2023 };

let workRoot: string;
let artifactRoot: string;

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** A fetch impl serving an index JSON and the fixture bundle bytes. */
function makeFetch(
  index: unknown,
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
    return new Response(status === 200 ? FIXTURE : null, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function indexWith(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    updated: "2026-01-01T00:00:00Z",
    cities: [
      {
        city_code: CITY.code,
        city_name: "Shibuya-ku",
        dataset_year: CITY.year,
        bundle_url: "https://cdn.invalid/plateau-13113-2023-v1.tar.zst",
        sha256: sha256Hex(FIXTURE),
        bytes: FIXTURE.length,
        ...overrides,
      },
    ],
  };
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
    const { impl } = makeFetch(indexWith());
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    const result = await dl.download("shibuya");

    expect(result.cached).toBe(false);
    expect(result.sha256_verified).toBe(true);
    expect(result.bytes_downloaded).toBe(FIXTURE.length);
    expect(result.dataset_year).toBe(CITY.year);
    expect(result.city_code).toBe(CITY.code);
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
    const { impl, calls } = makeFetch(indexWith());
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
    const { impl } = makeFetch(indexWith({ sha256: "0".repeat(64) }));
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await expect(dl.download("shibuya")).rejects.toBeInstanceOf(AppError);
    expect(await dl.hasArtifact("shibuya")).toBe(false);
  });

  it("errors when the slug is not present in the index", async () => {
    const { impl } = makeFetch(indexWith());
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await expect(dl.download("kyoto")).rejects.toBeInstanceOf(AppError);
  });

  it("throws on an HTTP error fetching the bundle", async () => {
    const { impl } = makeFetch(indexWith(), { bundleStatus: 404 });
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await expect(dl.download("shibuya")).rejects.toBeInstanceOf(AppError);
  });

  it("rejects an invalid city slug before any fetch", async () => {
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL });
    await expect(dl.download("../etc")).rejects.toBeInstanceOf(AppError);
  });

  it("honors a per-call index_url override", async () => {
    const { impl, calls } = makeFetch(indexWith());
    const dl = new ArtifactDownloader({ artifactRoot, indexUrl: INDEX_URL, fetchImpl: impl });

    await dl.download("shibuya", "https://mirror.invalid/custom-index.json");
    expect(calls[0]).toBe("https://mirror.invalid/custom-index.json");
  });
});
