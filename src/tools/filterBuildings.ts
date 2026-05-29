import { AppError } from "../errors/AppError.js";
import { type FilterBuildingsInput, filterBuildingsSchema } from "../schemas/filterBuildings.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type BuildingUid, type SceneId, asSceneId } from "../utils/ids.js";

export interface FilterBuildingsResult {
  scene_id: SceneId;
  version: number;
  building_uids: BuildingUid[];
  count: number;
}

export const filterBuildingsTool: ToolDefinition<FilterBuildingsInput, FilterBuildingsResult> = {
  name: "filter_buildings",
  description:
    "Query the buildings inside a loaded scene by height / year / use / zoning / flood depth, returning building_uids.",
  schema: filterBuildingsSchema,
  handler: async (input, ctx) => {
    const sceneId = asSceneId(input.scene_id);
    return ctx.sceneStore.read(sceneId, async (scene) => {
      const sceneSet = new Set(scene.buildings.all_uids);
      if (input.filter.building_uids) {
        for (const uid of input.filter.building_uids as BuildingUid[]) {
          if (!sceneSet.has(uid)) {
            throw new AppError("BUILDING_UID_NOT_IN_SCENE", "building_uid not in scene", {
              building_uid: uid,
              scene_id: scene.scene_id,
            });
          }
        }
      }
      const uids = await ctx.dataAccess.queryBuildings(
        scene.source.artifact_dir,
        scene.source.bbox,
        input.filter,
        input.limit,
      );
      const filtered = uids.filter((u) => sceneSet.has(u) && !scene.buildings.deleted_uids.has(u));
      return {
        result: {
          scene_id: scene.scene_id,
          version: scene.version,
          building_uids: filtered,
          count: filtered.length,
        },
        attribution: scene.attribution,
      };
    });
  },
};
