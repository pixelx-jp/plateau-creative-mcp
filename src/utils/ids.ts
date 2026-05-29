import { ulid } from "ulid";

export type SceneId = string & { readonly __brand: "SceneId" };
export type BuildingUid = string & { readonly __brand: "BuildingUid" };

const SCENE_ID_PREFIX = "scene_";
const SCENE_ID_RE = /^scene_[0-9A-HJKMNP-TV-Z]{26}$/;

export function newSceneId(): SceneId {
  return (SCENE_ID_PREFIX + ulid()) as SceneId;
}

export function asSceneId(s: string): SceneId {
  if (!SCENE_ID_RE.test(s)) {
    throw new Error(`Invalid scene_id format: ${s}`);
  }
  return s as SceneId;
}

export function isSceneId(s: string): s is SceneId {
  return SCENE_ID_RE.test(s);
}

export function asBuildingUid(s: string): BuildingUid {
  return s as BuildingUid;
}
