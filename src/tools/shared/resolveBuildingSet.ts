import type { DataAccessLayer } from "../../data/types.js";
import { AppError } from "../../errors/AppError.js";
import type { SceneState } from "../../scene/SceneState.js";
import type { BuildingFilter } from "../../schemas/common.js";
import type { BuildingUid } from "../../utils/ids.js";

export interface ResolveBuildingSetInput {
  scene: Readonly<SceneState>;
  explicitUids?: BuildingUid[];
  filter?: BuildingFilter;
  dataAccess: DataAccessLayer;
  limit?: number;
  includeDeleted?: boolean;
}

function assertUidInScene(
  scene: Readonly<SceneState>,
  uid: BuildingUid,
  sceneSet: Set<BuildingUid>,
) {
  if (!sceneSet.has(uid)) {
    throw new AppError("BUILDING_UID_NOT_IN_SCENE", "building_uid not in scene", {
      building_uid: uid,
      scene_id: scene.scene_id,
    });
  }
}

export async function resolveBuildingSet(input: ResolveBuildingSetInput): Promise<BuildingUid[]> {
  const { scene, explicitUids, filter, dataAccess, limit, includeDeleted } = input;
  const sceneSet = new Set(scene.buildings.all_uids);
  const deletedSet = scene.buildings.deleted_uids;

  if (filter?.building_uids && filter.building_uids.length > 0) {
    for (const uid of filter.building_uids as BuildingUid[]) {
      assertUidInScene(scene, uid, sceneSet);
    }
  }

  if (explicitUids && explicitUids.length > 0) {
    for (const uid of explicitUids) assertUidInScene(scene, uid, sceneSet);
    if (!filter) {
      return [...new Set(explicitUids)];
    }
  }

  if (filter) {
    const filtered = await dataAccess.queryBuildings(
      scene.source.artifact_dir,
      scene.source.bbox,
      filter,
      limit,
    );
    let inScene = filtered.filter((u) => sceneSet.has(u));
    if (!includeDeleted) inScene = inScene.filter((u) => !deletedSet.has(u));
    if (explicitUids) {
      const explicitSet = new Set(explicitUids);
      return inScene.filter((u) => explicitSet.has(u));
    }
    return inScene;
  }

  return [];
}

export function assertVersion(scene: Readonly<SceneState>, expected?: number): void {
  if (expected !== undefined && scene.version !== expected) {
    throw new AppError("SCENE_VERSION_CONFLICT", "Scene version conflict", {
      scene_id: scene.scene_id,
      expected,
      actual: scene.version,
    });
  }
}
