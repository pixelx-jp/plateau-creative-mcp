import { z } from "zod";
import { sceneIdSchema } from "./common.js";

export const exportGlbSchema = z
  .object({
    scene_id: sceneIdSchema,
    mode: z.enum(["single_glb", "scene_manifest"]).default("single_glb"),
    expected_version: z.number().int().min(0).optional(),
    options: z
      .object({
        compress: z.boolean().default(false),
        output_name: z
          .string()
          .regex(/^[A-Za-z0-9._-]+$/)
          .max(128)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ExportGlbInput = z.infer<typeof exportGlbSchema>;

export const linkPoisSchema = z
  .object({
    scene_id: sceneIdSchema,
    max_distance_m: z.number().min(0).max(500).default(30),
  })
  .strict();

export type LinkPoisInput = z.infer<typeof linkPoisSchema>;

export const getAttributionSchema = z
  .object({
    scene_id: sceneIdSchema,
  })
  .strict();

export type GetAttributionInput = z.infer<typeof getAttributionSchema>;
