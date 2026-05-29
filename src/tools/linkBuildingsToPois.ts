import { mergeAttribution } from "../attribution/AttributionWrapper.js";
import type { PoiLink } from "../data/types.js";
import { type LinkPoisInput, linkPoisSchema } from "../schemas/exportGlb.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type BuildingUid, type SceneId, asSceneId } from "../utils/ids.js";

export interface LinkBuildingsToPoisResult {
  scene_id: SceneId;
  version: number;
  links: Record<BuildingUid, PoiLink[]>;
  link_count: number;
  poi_count: number;
}

export const linkBuildingsToPoisTool: ToolDefinition<LinkPoisInput, LinkBuildingsToPoisResult> = {
  name: "link_buildings_to_pois",
  description:
    "Associate buildings in the scene with nearby OSM POIs. Requires OSM_OVERPASS_URL to be configured; otherwise returns an empty mapping with stub attribution.",
  schema: linkPoisSchema,
  handler: async (input, ctx) => {
    const sceneId = asSceneId(input.scene_id);
    return ctx.sceneStore.read(sceneId, async (scene) => {
      const aliveUids = scene.buildings.all_uids.filter(
        (u) => !scene.buildings.deleted_uids.has(u),
      );
      const rows = await ctx.dataAccess.getBuildingGeometry(scene.source.artifact_dir, aliveUids);
      const result = await ctx.dataAccess.linkPois({
        bbox: scene.source.bbox,
        buildings: rows.map((r) => ({
          building_uid: r.building_uid,
          lon: r.centroid_lon,
          lat: r.centroid_lat,
        })),
        maxDistanceM: input.max_distance_m,
      });
      const linkCount = Object.values(result.links).reduce((s, arr) => s + arr.length, 0);
      return {
        result: {
          scene_id: scene.scene_id,
          version: scene.version,
          links: result.links,
          link_count: linkCount,
          poi_count: result.poi_count,
        },
        attribution: mergeAttribution(scene.attribution, result.attribution),
      };
    });
  },
};
