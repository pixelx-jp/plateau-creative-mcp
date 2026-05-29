import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { attributionMetadataSchema, bboxSchema } from "../schemas/common.js";
import type { BuildingUid, SceneId } from "../utils/ids.js";
import { isSceneId } from "../utils/ids.js";
import { safeJoinUnderRoot } from "../utils/paths.js";
import type { SceneState } from "./SceneState.js";

const SCHEMA_VERSION = 1;

const buildingUidStringSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_\-:.]+$/);

const persistedSceneSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  state: z.object({
    scene_id: z.string().refine(isSceneId, "Invalid scene_id format"),
    version: z.number().int().nonnegative(),
    created_at: z.string(),
    updated_at: z.string(),
    expires_at: z.number().int().nonnegative(),
    source: z.object({
      city: z.string().min(1).max(64),
      bbox: bboxSchema,
      lod: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      dataset_year: z.number().int().min(2014).max(2100).optional(),
      artifact_dir: z
        .string()
        .min(1)
        .refine((p) => path.isAbsolute(p), "artifact_dir must be absolute"),
      upstream_refs: z.array(
        z.object({
          source: z.enum(["plateau-core-artifact", "official-plateau-mcp", "osm"]),
          dataset_id: z.string().optional(),
          url: z.string().optional(),
        }),
      ),
    }),
    buildings: z.object({
      all_uids: z.array(buildingUidStringSchema).max(200_000),
      deleted_uids: z.array(buildingUidStringSchema).max(200_000),
      extrusions: z.array(
        z.tuple([buildingUidStringSchema, z.object({ factor: z.number().min(0.1).max(10) })]),
      ),
    }),
    composition: z.object({
      time: z.string().optional(),
      weather: z.enum(["clear", "cloudy", "rain", "fog", "night"]).optional(),
      camera_pos: z.tuple([z.number(), z.number(), z.number()]).optional(),
      camera_lookat: z.tuple([z.number(), z.number(), z.number()]).optional(),
    }),
    attribution: attributionMetadataSchema,
  }),
});

type PersistedScene = z.infer<typeof persistedSceneSchema>;

export class SceneSerializer {
  constructor(private readonly dir: string) {}

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private filePath(sceneId: SceneId): string {
    return safeJoinUnderRoot(this.dir, `${sceneId}.json`);
  }

  async save(state: SceneState): Promise<void> {
    await this.ensureDir();
    const serialized: PersistedScene = {
      schema_version: SCHEMA_VERSION,
      state: {
        ...state,
        buildings: {
          all_uids: state.buildings.all_uids,
          deleted_uids: Array.from(state.buildings.deleted_uids),
          extrusions: Array.from(state.buildings.extrusions.entries()),
        },
      },
    };
    const target = this.filePath(state.scene_id);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(serialized), "utf8");
    await fs.rename(tmp, target);
  }

  async load(sceneId: SceneId): Promise<SceneState | null> {
    const target = this.filePath(sceneId);
    let raw: string;
    try {
      raw = await fs.readFile(target, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      throw new AppError("SCENE_VERSION_UNSUPPORTED", "Scene snapshot is not valid JSON", {
        scene_id: sceneId,
        cause: (err as Error).message,
      });
    }
    const declaredVersion = (parsedJson as { schema_version?: unknown })?.schema_version;
    if (declaredVersion !== SCHEMA_VERSION) {
      throw new AppError(
        "SCENE_VERSION_UNSUPPORTED",
        "Scene snapshot has unsupported schema version",
        { scene_id: sceneId, found: declaredVersion, expected: SCHEMA_VERSION },
      );
    }
    const parsed = persistedSceneSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AppError("SCENE_VERSION_UNSUPPORTED", "Scene snapshot failed schema validation", {
        scene_id: sceneId,
        issues: parsed.error.issues.slice(0, 5),
      });
    }
    const s = parsed.data.state;
    if (s.scene_id !== sceneId) {
      throw new AppError("SCENE_VERSION_UNSUPPORTED", "Persisted scene_id mismatch", {
        requested: sceneId,
        found: s.scene_id,
      });
    }
    return {
      ...s,
      scene_id: s.scene_id as SceneId,
      buildings: {
        all_uids: s.buildings.all_uids as BuildingUid[],
        deleted_uids: new Set(s.buildings.deleted_uids as BuildingUid[]),
        extrusions: new Map(s.buildings.extrusions as Array<[BuildingUid, { factor: number }]>),
      },
    } satisfies SceneState;
  }

  async delete(sceneId: SceneId): Promise<void> {
    try {
      await fs.unlink(this.filePath(sceneId));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  basenameOf(sceneId: SceneId): string {
    return path.basename(this.filePath(sceneId));
  }
}
