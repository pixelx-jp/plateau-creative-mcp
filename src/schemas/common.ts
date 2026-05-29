import { z } from "zod";

export const sceneIdSchema = z
  .string()
  .regex(/^scene_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid scene_id format");

export const bboxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([minLon, minLat, maxLon, maxLat]) => minLon < maxLon && minLat < maxLat,
    "bbox min must be less than max",
  )
  .refine(
    ([minLon, minLat, maxLon, maxLat]) =>
      minLon >= -180 && maxLon <= 180 && minLat >= -90 && maxLat <= 90,
    "bbox out of geographic range",
  );

export const lodSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const buildingUidSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_\-:.]+$/);

export const buildingFilterSchema = z
  .object({
    building_uids: z.array(buildingUidSchema).max(50_000).optional(),
    height_min: z.number().min(0).max(2000).optional(),
    height_max: z.number().min(0).max(2000).optional(),
    year_min: z.number().int().min(1800).max(2100).optional(),
    year_max: z.number().int().min(1800).max(2100).optional(),
    structure: z
      .array(z.union([z.number().int().min(0).max(99), z.string().regex(/^\d{1,2}$/)]))
      .max(32)
      .optional(),
    use: z.array(z.string().max(64)).max(32).optional(),
    flood_depth_min: z.number().min(0).max(50).optional(),
    zoning_use: z.array(z.string().max(64)).max(32).optional(),
    far_max_min: z.number().min(0).max(10_000).optional(),
    bbox: bboxSchema.optional(),
  })
  .strict();

export type BuildingFilter = z.infer<typeof buildingFilterSchema>;

export const attributionMetadataSchema = z.object({
  license: z.string(),
  datasets: z.array(z.string()),
  source_urls: z.array(z.string()),
  generated_at: z.string(),
  notes: z.array(z.string()).optional(),
});

export type AttributionMetadata = z.infer<typeof attributionMetadataSchema>;
