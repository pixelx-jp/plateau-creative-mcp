import fs from "node:fs/promises";
import path from "node:path";
import { Database } from "duckdb-async";
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

function cityToDir(city: string): string {
  const lower = city.trim().toLowerCase();
  if (!CITY_SLUG_RE.test(lower)) {
    throw new AppError("INVALID_INPUT", "Invalid city slug", { city });
  }
  return `out_${lower}`;
}

export interface ArtifactDataAccessOptions {
  poiSource?: PoiSource;
  enableSpatial?: boolean;
}

export class ArtifactDataAccess implements DataAccessLayer {
  private db: Database | null = null;
  private spatialReady: boolean | null = null;
  private readonly poiSource: PoiSource | undefined;
  private readonly enableSpatial: boolean;
  // Parsed manifests keyed by path, validated by mtime — loadArea reads the
  // same manifest.json on every request; reuse the parse unless it changed.
  private readonly manifestCache = new Map<string, { mtimeMs: number; manifest: ArtifactManifest }>();

  constructor(
    private readonly artifactRoot: string,
    options: ArtifactDataAccessOptions = {},
  ) {
    this.poiSource = options.poiSource;
    this.enableSpatial = options.enableSpatial ?? true;
  }

  private async getDb(): Promise<Database> {
    if (this.db) return this.db;
    const db = await Database.create(":memory:");
    this.db = db;
    if (this.enableSpatial) {
      try {
        await db.exec("LOAD spatial");
        this.spatialReady = true;
      } catch {
        try {
          await db.exec("INSTALL spatial; LOAD spatial;");
          this.spatialReady = true;
        } catch {
          this.spatialReady = false;
        }
      }
    } else {
      this.spatialReady = false;
    }
    return db;
  }

  hasSpatial(): boolean | null {
    return this.spatialReady;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  private resolveDir(city: string): string {
    return path.resolve(this.artifactRoot, cityToDir(city));
  }

  private parquetPath(artifactDir: string): string {
    return path.join(artifactDir, "buildings.parquet");
  }

  private async readManifest(manifestPath: string, city: string): Promise<ArtifactManifest> {
    try {
      const stat = await fs.stat(manifestPath);
      const cached = this.manifestCache.get(manifestPath);
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.manifest;
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ArtifactManifest;
      this.manifestCache.set(manifestPath, { mtimeMs: stat.mtimeMs, manifest });
      return manifest;
    } catch (err: unknown) {
      throw new AppError("PLATEAU_CORE_ERROR", `Failed to read manifest for city ${city}`, {
        manifestPath,
        cause: (err as Error).message,
      });
    }
  }

  async loadArea(input: LoadAreaQuery): Promise<LoadedArea> {
    const artifactDir = this.resolveDir(input.city);
    const manifestPath = path.join(artifactDir, "manifest.json");
    const manifest = await this.readManifest(manifestPath, input.city);
    if (input.dataset_year && input.dataset_year !== manifest.dataset_year) {
      throw new AppError("PLATEAU_CORE_ERROR", "dataset_year mismatch with artifact", {
        requested: input.dataset_year,
        artifact: manifest.dataset_year,
      });
    }

    const db = await this.getDb();
    const parquet = this.parquetPath(artifactDir);
    const [minLon, minLat, maxLon, maxLat] = input.bbox;
    const rows = (await db.all(
      `SELECT building_uid FROM read_parquet(?)
       WHERE centroid_lon BETWEEN ? AND ? AND centroid_lat BETWEEN ? AND ?
       ORDER BY building_uid`,
      parquet,
      minLon,
      maxLon,
      minLat,
      maxLat,
    )) as Array<{ building_uid: string }>;

    const buildingUids = rows.map((r) => asBuildingUid(r.building_uid));

    const sourceUrls = Array.from(
      new Set(
        Object.values(manifest.sources)
          .map((s) => s.url)
          .filter((u): u is string => !!u),
      ),
    );

    return {
      artifact_dir: artifactDir,
      manifest,
      building_uids: buildingUids,
      available_attributes: [
        "height",
        "usage",
        "structure",
        "year_built",
        "zoning_use",
        "far_max",
        "river_flood_depth_max",
        "inland_flood_depth_max",
        "tsunami_depth_max",
        "storm_surge_depth_max",
        ...(this.spatialReady ? ["footprint_polygon"] : []),
      ],
      attribution: {
        license: "CC BY 4.0",
        datasets: manifest.datasets,
        source_urls: sourceUrls,
        generated_at: new Date().toISOString(),
        notes: [manifest.attribution],
      },
    };
  }

  async queryBuildings(
    artifactDir: string,
    bbox: BBox,
    filter: BuildingFilter,
    limit?: number,
  ): Promise<BuildingUid[]> {
    const db = await this.getDb();
    const parquet = this.parquetPath(artifactDir);
    const where: string[] = ["centroid_lon BETWEEN ? AND ?", "centroid_lat BETWEEN ? AND ?"];
    const params: Array<string | number> = [bbox[0], bbox[2], bbox[1], bbox[3]];

    if (filter.bbox) {
      where.push("centroid_lon BETWEEN ? AND ?", "centroid_lat BETWEEN ? AND ?");
      params.push(filter.bbox[0], filter.bbox[2], filter.bbox[1], filter.bbox[3]);
    }
    if (filter.height_min !== undefined) {
      where.push("height >= ?");
      params.push(filter.height_min);
    }
    if (filter.height_max !== undefined) {
      where.push("height <= ?");
      params.push(filter.height_max);
    }
    if (filter.year_min !== undefined) {
      where.push("year_built >= ?");
      params.push(filter.year_min);
    }
    if (filter.year_max !== undefined) {
      where.push("year_built <= ?");
      params.push(filter.year_max);
    }
    if (filter.use && filter.use.length > 0) {
      where.push(`usage IN (${filter.use.map(() => "?").join(",")})`);
      params.push(...filter.use);
    }
    if (filter.structure && filter.structure.length > 0) {
      const structureCodes: number[] = [];
      for (const s of filter.structure) {
        const n = typeof s === "number" ? s : Number(s);
        if (Number.isInteger(n)) structureCodes.push(n);
      }
      if (structureCodes.length > 0) {
        where.push(`structure IN (${structureCodes.map(() => "?").join(",")})`);
        params.push(...structureCodes);
      }
    }
    if (filter.zoning_use && filter.zoning_use.length > 0) {
      where.push(`zoning_use IN (${filter.zoning_use.map(() => "?").join(",")})`);
      params.push(...filter.zoning_use);
    }
    if (filter.far_max_min !== undefined) {
      where.push("far_max >= ?");
      params.push(filter.far_max_min);
    }
    if (filter.flood_depth_min !== undefined) {
      where.push(
        "(COALESCE(river_flood_depth_max,0) >= ? OR COALESCE(inland_flood_depth_max,0) >= ? OR COALESCE(tsunami_depth_max,0) >= ? OR COALESCE(storm_surge_depth_max,0) >= ?)",
      );
      params.push(
        filter.flood_depth_min,
        filter.flood_depth_min,
        filter.flood_depth_min,
        filter.flood_depth_min,
      );
    }
    if (filter.building_uids && filter.building_uids.length > 0) {
      where.push(`building_uid IN (${filter.building_uids.map(() => "?").join(",")})`);
      params.push(...filter.building_uids);
    }

    const sql = `SELECT building_uid FROM read_parquet(?) WHERE ${where.join(" AND ")} ORDER BY building_uid${
      limit ? ` LIMIT ${Math.min(limit, 50_000)}` : ""
    }`;
    const rows = (await db.all(sql, parquet, ...params)) as Array<{ building_uid: string }>;
    return rows.map((r) => asBuildingUid(r.building_uid));
  }

  async getBuildingGeometry(artifactDir: string, uids: BuildingUid[]): Promise<BuildingRow[]> {
    if (uids.length === 0) return [];
    const db = await this.getDb();
    const parquet = this.parquetPath(artifactDir);
    const geomCol = this.spatialReady ? ", ST_AsGeoJSON(geometry) AS geom_json" : "";
    const CHUNK = 5000;
    const out: BuildingRow[] = [];
    for (let i = 0; i < uids.length; i += CHUNK) {
      const chunk = uids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `SELECT building_uid, centroid_lon, centroid_lat, height, usage, structure, year_built, zoning_use, far_max${geomCol}
         FROM read_parquet(?)
         WHERE building_uid IN (${placeholders})`;
      const rows = (await db.all(sql, parquet, ...chunk)) as Array<{
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
      for (const r of rows) {
        const footprints = this.spatialReady ? parseFootprint(r.geom_json) : [];
        out.push({
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
        });
      }
    }
    return out;
  }

  async linkPois(input: LinkPoisInput): Promise<PoiLinkResult> {
    if (this.poiSource) return this.poiSource.fetch(input);
    return {
      links: {},
      poi_count: 0,
      attribution: {
        license: "ODbL 1.0",
        datasets: ["openstreetmap"],
        source_urls: ["https://www.openstreetmap.org/copyright"],
        generated_at: new Date().toISOString(),
        notes: ["No POI source configured; pass OSM_OVERPASS_URL to enable Overpass linking."],
      },
    };
  }
}
