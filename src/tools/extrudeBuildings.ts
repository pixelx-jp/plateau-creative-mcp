import { AppError } from "../errors/AppError.js";
import { type ExtrudeBuildingsInput, extrudeBuildingsSchema } from "../schemas/mutateBuildings.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type BuildingUid, type SceneId, asSceneId } from "../utils/ids.js";
import { assertVersion, resolveBuildingSet } from "./shared/resolveBuildingSet.js";

export interface ExtrudeBuildingsResult {
  scene_id: SceneId;
  version: number;
  extruded_count: number;
  extruded_building_uids: BuildingUid[];
}

export const extrudeBuildingsTool: ToolDefinition<ExtrudeBuildingsInput, ExtrudeBuildingsResult> = {
  name: "extrude_buildings",
  description: "Scale building heights by a factor. Buildings already deleted cannot be extruded.",
  schema: extrudeBuildingsSchema,
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
      const applied: BuildingUid[] = [];
      for (const uid of uids) {
        if (draft.buildings.deleted_uids.has(uid)) {
          throw new AppError("INVALID_INPUT", "Cannot extrude a deleted building", {
            building_uid: uid,
          });
        }
        draft.buildings.extrusions.set(uid, { factor: input.factor });
        applied.push(uid);
      }
      if (applied.length > 0) draft.version += 1;
      return {
        result: {
          scene_id: draft.scene_id,
          version: draft.version,
          extruded_count: applied.length,
          extruded_building_uids: applied,
        },
        attribution: draft.attribution,
      };
    });
  },
};
