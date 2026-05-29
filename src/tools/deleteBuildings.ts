import { type DeleteBuildingsInput, deleteBuildingsSchema } from "../schemas/mutateBuildings.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type BuildingUid, type SceneId, asSceneId } from "../utils/ids.js";
import { assertVersion, resolveBuildingSet } from "./shared/resolveBuildingSet.js";

export interface DeleteBuildingsResult {
  scene_id: SceneId;
  version: number;
  deleted_count: number;
  deleted_building_uids: BuildingUid[];
}

export const deleteBuildingsTool: ToolDefinition<DeleteBuildingsInput, DeleteBuildingsResult> = {
  name: "delete_buildings",
  description: "Mark buildings as deleted within a scene. Idempotent for already-deleted uids.",
  schema: deleteBuildingsSchema,
  handler: async (input, ctx) => {
    const sceneId = asSceneId(input.scene_id);
    return ctx.sceneStore.mutate(sceneId, async (draft) => {
      assertVersion(draft, input.expected_version);
      const uids = await resolveBuildingSet({
        scene: draft,
        explicitUids: input.building_uids as BuildingUid[] | undefined,
        filter: input.filter,
        dataAccess: ctx.dataAccess,
      });
      const newly: BuildingUid[] = [];
      for (const uid of uids) {
        if (!draft.buildings.deleted_uids.has(uid)) {
          draft.buildings.deleted_uids.add(uid);
          draft.buildings.extrusions.delete(uid);
          newly.push(uid);
        }
      }
      if (newly.length > 0) draft.version += 1;
      return {
        result: {
          scene_id: draft.scene_id,
          version: draft.version,
          deleted_count: newly.length,
          deleted_building_uids: newly,
        },
        attribution: draft.attribution,
      };
    });
  },
};
