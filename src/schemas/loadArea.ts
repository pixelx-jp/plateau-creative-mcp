import { z } from "zod";
import { bboxSchema, lodSchema } from "./common.js";

export const loadAreaSchema = z
  .object({
    city: z.string().min(1).max(64),
    bbox: bboxSchema,
    lod: lodSchema,
    dataset_year: z.number().int().min(2014).max(2100).optional(),
  })
  .strict();

export type LoadAreaInput = z.infer<typeof loadAreaSchema>;
