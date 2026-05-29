import { z } from "zod";
import { buildingFilterSchema, sceneIdSchema } from "./common.js";

export const filterBuildingsSchema = z
  .object({
    scene_id: sceneIdSchema,
    filter: buildingFilterSchema,
    limit: z.number().int().min(1).max(50_000).optional(),
  })
  .strict();

export type FilterBuildingsInput = z.infer<typeof filterBuildingsSchema>;
