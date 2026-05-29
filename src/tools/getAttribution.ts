import type { AttributionMetadata } from "../schemas/common.js";
import { type GetAttributionInput, getAttributionSchema } from "../schemas/exportGlb.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type SceneId, asSceneId } from "../utils/ids.js";

export interface GetAttributionResult {
  scene_id: SceneId;
  version: number;
  attribution: AttributionMetadata;
}

export const getAttributionTool: ToolDefinition<GetAttributionInput, GetAttributionResult> = {
  name: "get_attribution",
  description: "Return the full attribution metadata for a scene (datasets, source URLs, license).",
  schema: getAttributionSchema,
  handler: async (input, ctx) => {
    const sceneId = asSceneId(input.scene_id);
    return ctx.sceneStore.read(sceneId, async (scene) => ({
      result: {
        scene_id: scene.scene_id,
        version: scene.version,
        attribution: scene.attribution,
      },
      attribution: scene.attribution,
    }));
  },
};
