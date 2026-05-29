import { z } from "zod";

export const downloadAreaSchema = z
  .object({
    city: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_-]{0,63}$/, "city slug must be lowercase letters / digits / - / _"),
    index_url: z.string().url().optional(),
  })
  .strict();

export type DownloadAreaInput = z.infer<typeof downloadAreaSchema>;
