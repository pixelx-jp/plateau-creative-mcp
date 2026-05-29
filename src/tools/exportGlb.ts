import { type ExportGlbInput, exportGlbSchema } from "../schemas/exportGlb.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import { type SceneId, asSceneId } from "../utils/ids.js";
import { assertVersion } from "./shared/resolveBuildingSet.js";

export interface ExportGlbResult {
  scene_id: SceneId;
  version: number;
  mode: "single_glb" | "scene_manifest";
  file_path: string;
  sidecar_path?: string;
  license_path: string;
  stats: {
    bbox_area_km2: number;
    building_count: number;
    triangle_count?: number;
    output_bytes?: number;
    pre_compress_bytes?: number;
    compressed?: boolean;
    used_footprints?: number;
    used_boxes?: number;
    merged?: boolean;
    tiles_indexed?: number;
  };
}

export const exportGlbTool: ToolDefinition<ExportGlbInput, ExportGlbResult> = {
  name: "export_glb",
  description:
    "Export the current scene to a .glb (single_glb, ≤1 km² and ≤5000 buildings) or to a scene_manifest.json referencing 3D Tiles for larger areas. PLATEAU attribution is always embedded; a per-export LICENSE.txt is written next to the output.",
  schema: exportGlbSchema,
  handler: async (input, ctx) => {
    const sceneId = asSceneId(input.scene_id);
    return ctx.sceneStore.read(sceneId, async (scene) => {
      assertVersion(scene, input.expected_version);
      const exported = await ctx.gltfExporter.export(
        scene,
        {
          mode: input.mode,
          compress: input.options?.compress ?? false,
          outputName: input.options?.output_name,
        },
        scene.attribution,
      );
      return {
        result: {
          scene_id: scene.scene_id,
          version: scene.version,
          mode: exported.mode,
          file_path: exported.file_path,
          sidecar_path: exported.sidecar_path,
          license_path: exported.license_path,
          stats: exported.stats,
        },
        attribution: scene.attribution,
      };
    });
  },
};
