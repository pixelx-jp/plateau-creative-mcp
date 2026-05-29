import { spawn } from "node:child_process";
import path from "node:path";
import { AppError } from "../errors/AppError.js";
import type { BuildingFilter } from "../schemas/common.js";
import type { BBox } from "../utils/bbox.js";
import { type BuildingUid, asBuildingUid } from "../utils/ids.js";
import { parseFootprint } from "./geojson.js";
import type {
  ArtifactManifest,
  BuildingRow,
  DataAccessLayer,
  LinkPoisInput,
  LoadAreaQuery,
  LoadedArea,
  PoiLinkResult,
  PoiSource,
} from "./types.js";

const CITY_SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;

function cityToDir(artifactRoot: string, city: string): string {
  const lower = city.trim().toLowerCase();
  if (!CITY_SLUG_RE.test(lower)) {
    throw new AppError("INVALID_INPUT", "Invalid city slug", { city });
  }
  return path.resolve(artifactRoot, `out_${lower}`);
}

export interface SubprocessClientOptions {
  artifactRoot: string;
  pythonBin: string;
  scriptPath: string;
  timeoutMs?: number;
  poiSource?: PoiSource;
}

interface SubprocessEnvelope<T> {
  result?: T;
  error?: string;
  type?: string;
  trace?: string;
}

export class PlateauCoreSubprocessClient implements DataAccessLayer {
  private readonly opts: Required<Omit<SubprocessClientOptions, "poiSource">> & {
    poiSource: PoiSource | undefined;
  };

  constructor(options: SubprocessClientOptions) {
    this.opts = {
      artifactRoot: path.resolve(options.artifactRoot),
      pythonBin: options.pythonBin,
      scriptPath: path.resolve(options.scriptPath),
      timeoutMs: options.timeoutMs ?? 30_000,
      poiSource: options.poiSource,
    };
  }

  private run<T>(command: string, args: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.pythonBin, [this.opts.scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, this.opts.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (c) => {
        stdout += c;
      });
      child.stderr.on("data", (c) => {
        stderr += c;
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(
          new AppError("PLATEAU_CORE_ERROR", `Subprocess spawn failed: ${err.message}`, {
            python: this.opts.pythonBin,
          }),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (killed) {
          reject(
            new AppError(
              "PLATEAU_CORE_ERROR",
              `Subprocess timed out after ${this.opts.timeoutMs}ms`,
              {
                command,
              },
            ),
          );
          return;
        }
        let parsed: SubprocessEnvelope<T> | null = null;
        try {
          parsed = JSON.parse(stdout || "{}") as SubprocessEnvelope<T>;
        } catch (err) {
          reject(
            new AppError("PLATEAU_CORE_ERROR", "Subprocess returned non-JSON output", {
              code,
              cause: (err as Error).message,
              stdout_head: stdout.slice(0, 200),
              stderr_head: stderr.slice(0, 200),
            }),
          );
          return;
        }
        if (parsed.error || code !== 0) {
          reject(
            new AppError(
              "PLATEAU_CORE_ERROR",
              parsed.error ?? `Subprocess exited with code ${code}`,
              {
                code,
                type: parsed.type,
                stderr_head: stderr.slice(0, 200),
              },
            ),
          );
          return;
        }
        if (parsed.result === undefined) {
          reject(
            new AppError("PLATEAU_CORE_ERROR", "Subprocess response missing result field", {
              stdout_head: stdout.slice(0, 200),
            }),
          );
          return;
        }
        resolve(parsed.result);
      });

      child.stdin.end(JSON.stringify({ command, args }));
    });
  }

  async loadArea(input: LoadAreaQuery): Promise<LoadedArea> {
    const artifactDir = cityToDir(this.opts.artifactRoot, input.city);
    const payload = await this.run<{
      artifact_dir: string;
      manifest: ArtifactManifest;
      building_uids: string[];
      available_attributes: string[];
      attribution: {
        license: string;
        datasets: string[];
        source_urls: string[];
        notes: string[];
      };
    }>("load_area", {
      artifact_dir: artifactDir,
      bbox: input.bbox,
      dataset_year: input.dataset_year,
    });
    return {
      artifact_dir: payload.artifact_dir,
      manifest: payload.manifest,
      building_uids: payload.building_uids.map(asBuildingUid),
      available_attributes: payload.available_attributes,
      attribution: {
        ...payload.attribution,
        generated_at: new Date().toISOString(),
      },
    };
  }

  async queryBuildings(
    artifactDir: string,
    bbox: BBox,
    filter: BuildingFilter,
    limit?: number,
  ): Promise<BuildingUid[]> {
    const payload = await this.run<{ building_uids: string[] }>("query_buildings", {
      artifact_dir: artifactDir,
      bbox,
      filter,
      limit,
    });
    return payload.building_uids.map(asBuildingUid);
  }

  async getBuildingGeometry(artifactDir: string, uids: BuildingUid[]): Promise<BuildingRow[]> {
    if (uids.length === 0) return [];
    const payload = await this.run<{
      rows: Array<{
        building_uid: string;
        centroid_lon: number;
        centroid_lat: number;
        height: number | null;
        usage: string | null;
        structure: number | null;
        year_built: number | null;
        zoning_use: string | null;
        far_max: number | null;
        geom_json?: string | null;
      }>;
      spatial: boolean;
    }>("get_geometry", { artifact_dir: artifactDir, building_uids: uids });
    return payload.rows.map((r) => {
      const footprints = payload.spatial ? parseFootprint(r.geom_json) : [];
      return {
        building_uid: asBuildingUid(r.building_uid),
        centroid_lon: r.centroid_lon,
        centroid_lat: r.centroid_lat,
        height: r.height ?? 5,
        usage: r.usage,
        structure: r.structure,
        year_built: r.year_built,
        zoning_use: r.zoning_use,
        far_max: r.far_max,
        footprints: footprints.length > 0 ? footprints : undefined,
      };
    });
  }

  async linkPois(input: LinkPoisInput): Promise<PoiLinkResult> {
    if (this.opts.poiSource) return this.opts.poiSource.fetch(input);
    return {
      links: {},
      poi_count: 0,
      attribution: {
        license: "ODbL 1.0",
        datasets: ["openstreetmap"],
        source_urls: ["https://www.openstreetmap.org/copyright"],
        generated_at: new Date().toISOString(),
        notes: ["No POI source configured."],
      },
    };
  }
}
