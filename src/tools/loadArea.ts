import type { AttributionMetadata } from "../schemas/common.js";
import { type LoadAreaInput, loadAreaSchema } from "../schemas/loadArea.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";
import type { SceneId } from "../utils/ids.js";

export interface LoadAreaResult {
  scene_id: SceneId;
  version: number;
  summary: {
    city: string;
    bbox: [number, number, number, number];
    lod: 0 | 1 | 2;
    dataset_year?: number;
    building_count: number;
    available_attributes: string[];
  };
}

export const loadAreaTool: ToolDefinition<LoadAreaInput, LoadAreaResult> = {
  name: "load_area",
  description:
    "Load a PLATEAU city subset by bbox+lod into a new scene. Returns a scene_id for subsequent edits and exports.",
  schema: loadAreaSchema,
  handler: async (input, ctx) => {
    if (ctx.autoDownload && ctx.downloader && !(await ctx.downloader.hasArtifact(input.city))) {
      ctx.logger.info("load_area.auto_download", { city: input.city });
      await ctx.downloader.download(input.city);
    }
    const loaded = await ctx.dataAccess.loadArea(input);
    const state = await ctx.sceneStore.create({
      initial: {
        source: {
          city: input.city,
          bbox: input.bbox,
          lod: input.lod,
          dataset_year: loaded.manifest.dataset_year,
          artifact_dir: loaded.artifact_dir,
          upstream_refs: [
            { source: "plateau-core-artifact", dataset_id: loaded.manifest.city_code },
          ],
        },
        buildings: {
          all_uids: loaded.building_uids,
          deleted_uids: new Set(),
          extrusions: new Map(),
        },
        composition: {},
        attribution: loaded.attribution,
      },
    });

    const result: LoadAreaResult = {
      scene_id: state.scene_id,
      version: state.version,
      summary: {
        city: state.source.city,
        bbox: state.source.bbox,
        lod: state.source.lod,
        dataset_year: state.source.dataset_year,
        building_count: state.buildings.all_uids.length,
        available_attributes: loaded.available_attributes,
      },
    };
    const attribution: AttributionMetadata = state.attribution;
    return { result, attribution };
  },
};
