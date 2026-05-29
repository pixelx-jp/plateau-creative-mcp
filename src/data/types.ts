import type { AttributionMetadata, BuildingFilter } from "../schemas/common.js";
import type { BBox } from "../utils/bbox.js";
import type { BuildingUid } from "../utils/ids.js";

export interface ArtifactManifest {
  city_code: string;
  city_name: string;
  dataset_year: number;
  attribution: string;
  datasets: string[];
  sources: Record<string, { dataset_id: string; year: number; url: string | null }>;
  n_buildings: number;
}

export interface LoadAreaQuery {
  city: string;
  bbox: BBox;
  lod: 0 | 1 | 2;
  dataset_year?: number;
}

export interface LoadedArea {
  artifact_dir: string;
  manifest: ArtifactManifest;
  building_uids: BuildingUid[];
  attribution: AttributionMetadata;
  available_attributes: string[];
}

export type FootprintRing = Array<[lon: number, lat: number]>;

export interface FootprintPolygon {
  outer: FootprintRing;
  holes: FootprintRing[];
}

export interface BuildingRow {
  building_uid: BuildingUid;
  centroid_lon: number;
  centroid_lat: number;
  height: number;
  usage: string | null;
  structure: number | null;
  year_built: number | null;
  zoning_use: string | null;
  far_max: number | null;
  footprints?: FootprintPolygon[];
}

export interface PoiLink {
  name: string;
  kind: string;
  distance_m: number;
}

export interface PoiLinkResult {
  links: Record<BuildingUid, PoiLink[]>;
  attribution: AttributionMetadata;
  poi_count: number;
}

export interface LinkPoisInput {
  bbox: BBox;
  buildings: Array<{ building_uid: BuildingUid; lon: number; lat: number }>;
  maxDistanceM: number;
}

export interface PoiSource {
  fetch(input: LinkPoisInput): Promise<PoiLinkResult>;
}

export interface DataAccessLayer {
  loadArea(input: LoadAreaQuery): Promise<LoadedArea>;
  queryBuildings(
    artifactDir: string,
    bbox: BBox,
    filter: BuildingFilter,
    limit?: number,
  ): Promise<BuildingUid[]>;
  getBuildingGeometry(artifactDir: string, uids: BuildingUid[]): Promise<BuildingRow[]>;
  linkPois(input: LinkPoisInput): Promise<PoiLinkResult>;
}
