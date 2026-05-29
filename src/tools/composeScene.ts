import { type ComposeSceneInput, composeSceneSchema } from "../schemas/composeScene.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type SceneId, asSceneId } from "../utils/ids.js";

export interface ComposeSceneResult {
  scene_id: SceneId;
  version: number;
  composition: ComposeSceneInput;
}

export const composeSceneTool: ToolDefinition<ComposeSceneInput, ComposeSceneResult> = {
  name: "compose_scene",
  description: "Configure render-time hints on a scene: time-of-day, weather, camera pos / lookat.",
  schema: composeSceneSchema,
  handler: async (input, ctx) => {
    const sceneId = asSceneId(input.scene_id);
    return ctx.sceneStore.mutate(sceneId, async (draft) => {
      if (input.time !== undefined) draft.composition.time = input.time;
      if (input.weather !== undefined) draft.composition.weather = input.weather;
      if (input.camera_pos !== undefined) draft.composition.camera_pos = input.camera_pos;
      if (input.camera_lookat !== undefined) draft.composition.camera_lookat = input.camera_lookat;
      draft.version += 1;
      return {
        result: {
          scene_id: draft.scene_id,
          version: draft.version,
          composition: input,
        },
        attribution: draft.attribution,
      };
    });
  },
};
