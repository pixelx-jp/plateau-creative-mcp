import type { AttributionMetadata } from "../schemas/common.js";
import type { BBox } from "../utils/bbox.js";
import type { BuildingUid, SceneId } from "../utils/ids.js";

export interface ExtrusionEdit {
  factor: number;
}

export interface UpstreamRef {
  source: "plateau-core-artifact" | "official-plateau-mcp" | "osm";
  dataset_id?: string;
  url?: string;
}

export interface SceneState {
  scene_id: SceneId;
  version: number;
  created_at: string;
  updated_at: string;
  expires_at: number;
  source: {
    city: string;
    bbox: BBox;
    lod: 0 | 1 | 2;
    dataset_year?: number;
    artifact_dir: string;
    upstream_refs: UpstreamRef[];
  };
  buildings: {
    all_uids: BuildingUid[];
    deleted_uids: Set<BuildingUid>;
    extrusions: Map<BuildingUid, ExtrusionEdit>;
  };
  composition: {
    time?: string;
    weather?: "clear" | "cloudy" | "rain" | "fog" | "night";
    camera_pos?: [number, number, number];
    camera_lookat?: [number, number, number];
  };
  attribution: AttributionMetadata;
}
