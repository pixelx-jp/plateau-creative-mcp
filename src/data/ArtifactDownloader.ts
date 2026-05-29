import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Decompress } from "fzstd";
import * as tar from "tar";
import { AppError } from "../errors/AppError.js";

const CITY_SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
// Japanese municipal suffixes stripped to turn an index `city_name`
// ("Shibuya-ku", "Sapporo-shi") into the MCP's city slug ("shibuya", "sapporo").
const MUNI_SUFFIX_RE = /-(ku|shi|cho|machi|mura|son|gun|to|fu|ken)$/;
// Only these files are extracted from a bundle — the rest (style/, buildings/,
// pmtiles, tile_index) are not read by this server. Bundles do not ship 3D Tiles.
const KEEP_FILES = new Set(["buildings.parquet", "manifest.json"]);

export interface ArtifactDownloaderOptions {
  artifactRoot: string;
  /** URL of the plateau-bridge cache index JSON (source of truth for bundle URLs + sha256). */
  indexUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface DownloadResult {
  city: string;
  artifact_dir: string;
  bytes_downloaded: number;
  cached: boolean;
  sha256_verified: boolean;
  dataset_year?: number;
  city_code?: string;
}

interface IndexEntry {
  city_code: string;
  city_name: string;
  dataset_year: number;
  bundle_url: string;
  sha256: string;
  bytes?: number;
  n_buildings?: number;
  tool_version?: string;
}

interface CacheIndex {
  schema?: number;
  updated?: string;
  cities: IndexEntry[];
}

interface ManifestShape {
  city_code?: string;
  city_name?: string;
  dataset_year?: number;
}

function citySlugFromName(name: string): string {
  return name.trim().toLowerCase().replace(MUNI_SUFFIX_RE, "");
}

export class ArtifactDownloader {
  private readonly inflight = new Map<string, Promise<DownloadResult>>();

  constructor(private readonly opts: ArtifactDownloaderOptions) {}

  get artifactRoot(): string {
    return this.opts.artifactRoot;
  }

  private cityDir(city: string): string {
    if (!CITY_SLUG_RE.test(city)) {
      throw new AppError("INVALID_INPUT", "Invalid city slug", { city });
    }
    return path.resolve(this.opts.artifactRoot, `out_${city}`);
  }

  async hasArtifact(city: string): Promise<boolean> {
    const dir = this.cityDir(city);
    try {
      await fs.access(path.join(dir, "buildings.parquet"));
      await fs.access(path.join(dir, "manifest.json"));
      return true;
    } catch {
      return false;
    }
  }

  async download(city: string, indexUrlOverride?: string): Promise<DownloadResult> {
    const key = `${city}::${indexUrlOverride ?? ""}`;
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;
    const promise = this.downloadInner(city, indexUrlOverride).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async downloadInner(city: string, indexUrlOverride?: string): Promise<DownloadResult> {
    const dir = this.cityDir(city);
    if (await this.hasArtifact(city)) {
      const manifest = await this.readManifest(dir);
      return {
        city,
        artifact_dir: dir,
        bytes_downloaded: 0,
        cached: true,
        sha256_verified: false,
        dataset_year: manifest?.dataset_year,
        city_code: manifest?.city_code,
      };
    }

    const index = await this.fetchIndex(indexUrlOverride ?? this.opts.indexUrl);
    const entry = this.resolveEntry(city, index);

    await fs.mkdir(this.opts.artifactRoot, { recursive: true });
    const tmpRoot = await fs.mkdtemp(path.join(this.opts.artifactRoot, `.dl-${city}-`));
    const tmpBundle = path.join(tmpRoot, "bundle.tar.zst");

    try {
      const bytes = await this.fetchTo(entry.bundle_url, tmpBundle);
      const actualSha = await this.hashFile(tmpBundle);
      if (actualSha !== entry.sha256.toLowerCase()) {
        throw new AppError("PLATEAU_CORE_ERROR", "Downloaded bundle SHA256 mismatch", {
          city,
          expected: entry.sha256,
          actual: actualSha,
        });
      }

      const extractDir = path.join(tmpRoot, "extracted");
      await fs.mkdir(extractDir, { recursive: true });
      await this.decompressAndExtract(tmpBundle, extractDir);

      try {
        await fs.access(path.join(extractDir, "buildings.parquet"));
      } catch {
        throw new AppError("PLATEAU_CORE_ERROR", "Bundle did not contain a buildings.parquet", {
          city,
          bundle: entry.bundle_url,
        });
      }

      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(extractDir, dir);

      const manifest = await this.readManifest(dir);
      return {
        city,
        artifact_dir: dir,
        bytes_downloaded: bytes,
        cached: false,
        sha256_verified: true,
        dataset_year: manifest?.dataset_year ?? entry.dataset_year,
        city_code: manifest?.city_code ?? entry.city_code,
      };
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchIndex(url: string): Promise<CacheIndex> {
    const f = this.opts.fetchImpl ?? fetch;
    let resp: Response;
    try {
      resp = await f(url);
    } catch (err) {
      throw new AppError(
        "PLATEAU_CORE_ERROR",
        `Artifact index fetch error: ${(err as Error).message}`,
        { url },
      );
    }
    if (!resp.ok) {
      throw new AppError("PLATEAU_CORE_ERROR", `Artifact index fetch failed: HTTP ${resp.status}`, {
        url,
        status: resp.status,
      });
    }
    const json = (await resp.json()) as CacheIndex;
    if (!json || !Array.isArray(json.cities)) {
      throw new AppError("PLATEAU_CORE_ERROR", "Artifact index is malformed (no cities array)", {
        url,
      });
    }
    return json;
  }

  private resolveEntry(city: string, index: CacheIndex): IndexEntry {
    const matches = index.cities.filter((c) => citySlugFromName(c.city_name) === city);
    if (matches.length === 0) {
      const available = [...new Set(index.cities.map((c) => citySlugFromName(c.city_name)))].sort();
      throw new AppError("INVALID_INPUT", `City '${city}' is not available in the artifact index`, {
        city,
        available,
      });
    }
    // Prefer the most recent dataset year if a slug maps to several entries.
    matches.sort((a, b) => b.dataset_year - a.dataset_year);
    return matches[0]!;
  }

  /** A Transform that zstd-decompresses its input using fzstd's streaming decoder. */
  private zstdTransform(): Transform {
    const pending: Buffer[] = [];
    const decompress = new Decompress((chunk) => {
      pending.push(Buffer.from(chunk));
    });
    return new Transform({
      transform(chunk: Buffer, _enc, cb) {
        try {
          decompress.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), false);
          for (const p of pending) this.push(p);
          pending.length = 0;
          cb();
        } catch (err) {
          cb(err as Error);
        }
      },
      flush(cb) {
        try {
          decompress.push(new Uint8Array(0), true);
          for (const p of pending) this.push(p);
          pending.length = 0;
          cb();
        } catch (err) {
          cb(err as Error);
        }
      },
    });
  }

  private async decompressAndExtract(bundlePath: string, extractDir: string): Promise<void> {
    await pipeline(
      createReadStream(bundlePath),
      this.zstdTransform(),
      tar.x({
        cwd: extractDir,
        filter: (p: string) => KEEP_FILES.has(p.replace(/^\.\//, "")),
      }),
    );
  }

  private async fetchTo(url: string, dest: string): Promise<number> {
    const controller = new AbortController();
    const timer = this.opts.timeoutMs
      ? setTimeout(() => controller.abort(), this.opts.timeoutMs)
      : null;
    try {
      const f = this.opts.fetchImpl ?? fetch;
      const resp = await f(url, { signal: controller.signal });
      if (!resp.ok) {
        throw new AppError("PLATEAU_CORE_ERROR", `Bundle fetch failed: HTTP ${resp.status}`, {
          url,
          status: resp.status,
        });
      }
      if (!resp.body) {
        throw new AppError("PLATEAU_CORE_ERROR", "Bundle fetch returned empty body", { url });
      }
      let bytes = 0;
      const file = createWriteStream(dest);
      const nodeStream = Readable.fromWeb(
        resp.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      nodeStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      await pipeline(nodeStream, file);
      return bytes;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("PLATEAU_CORE_ERROR", `Bundle fetch error: ${(err as Error).message}`, {
        url,
        cause: (err as Error).message,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async hashFile(file: string): Promise<string> {
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      createReadStream(file)
        .on("data", (c) => hash.update(c))
        .on("end", () => resolve())
        .on("error", reject);
    });
    return hash.digest("hex");
  }

  private async readManifest(dir: string): Promise<ManifestShape | null> {
    try {
      const raw = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
      return JSON.parse(raw) as ManifestShape;
    } catch {
      return null;
    }
  }
}
