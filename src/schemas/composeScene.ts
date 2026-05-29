import { z } from "zod";
import { sceneIdSchema } from "./common.js";

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const composeSceneSchema = z
  .object({
    scene_id: sceneIdSchema,
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    weather: z.enum(["clear", "cloudy", "rain", "fog", "night"]).optional(),
    camera_pos: vec3.optional(),
    camera_lookat: vec3.optional(),
  })
  .strict();

export type ComposeSceneInput = z.infer<typeof composeSceneSchema>;
