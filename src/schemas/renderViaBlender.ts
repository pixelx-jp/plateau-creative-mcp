import { z } from "zod";
import { sceneIdSchema } from "./common.js";

export const renderViaBlenderSchema = z
  .object({
    scene_id: sceneIdSchema,
    blender_mcp_endpoint: z.string().url().optional(),
    export_options: z
      .object({
        compress: z.boolean().default(true),
        include_metadata: z.boolean().default(true),
        output_name: z
          .string()
          .regex(/^[A-Za-z0-9._-]+$/)
          .max(128)
          .optional(),
      })
      .strict()
      .optional(),
    tool_calls: z
      .array(
        z
          .object({
            tool: z.string().min(1).max(128),
            args: z.record(z.unknown()).default({}),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    dry_run: z.boolean().default(false),
    timeout_ms: z.number().int().min(1000).max(120_000).default(60_000),
  })
  .strict();

export type RenderViaBlenderInput = z.infer<typeof renderViaBlenderSchema>;
