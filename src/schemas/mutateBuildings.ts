import { z } from "zod";
import { buildingFilterSchema, buildingUidSchema, sceneIdSchema } from "./common.js";

export const deleteBuildingsSchema = z
  .object({
    scene_id: sceneIdSchema,
    building_uids: z.array(buildingUidSchema).max(50_000).optional(),
    filter: buildingFilterSchema.optional(),
    expected_version: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => v.building_uids || v.filter, "Provide building_uids or filter");

export type DeleteBuildingsInput = z.infer<typeof deleteBuildingsSchema>;

export const extrudeBuildingsSchema = z
  .object({
    scene_id: sceneIdSchema,
    building_uids: z.array(buildingUidSchema).max(50_000).optional(),
    filter: buildingFilterSchema.optional(),
    factor: z.number().min(0.1).max(10),
    expected_version: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => v.building_uids || v.filter, "Provide building_uids or filter");

export type ExtrudeBuildingsInput = z.infer<typeof extrudeBuildingsSchema>;
