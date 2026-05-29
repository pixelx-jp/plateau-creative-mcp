import { AppError } from "../errors/AppError.js";
import { type BuildingUid, type SceneId, newSceneId } from "../utils/ids.js";
import { SceneLock } from "./SceneLock.js";
import { SceneSerializer } from "./SceneSerializer.js";
import type { ExtrusionEdit, SceneState } from "./SceneState.js";

export interface SceneStoreConfig {
  maxScenes: number;
  ttlMs: number;
  persistToDisk: boolean;
  diskDir: string;
}

interface SceneEntry {
  state: SceneState;
  lastAccess: number;
  lock: SceneLock;
  pinned: number;
}

export interface CreateSceneInput {
  initial: Omit<SceneState, "scene_id" | "version" | "created_at" | "updated_at" | "expires_at">;
}

function cloneScene(s: SceneState): SceneState {
  return {
    ...s,
    source: {
      ...s.source,
      bbox: [...s.source.bbox] as SceneState["source"]["bbox"],
      upstream_refs: s.source.upstream_refs.map((r) => ({ ...r })),
    },
    buildings: {
      all_uids: s.buildings.all_uids,
      deleted_uids: new Set<BuildingUid>(s.buildings.deleted_uids),
      extrusions: new Map<BuildingUid, ExtrusionEdit>(s.buildings.extrusions),
    },
    composition: { ...s.composition },
    attribution: {
      ...s.attribution,
      datasets: [...s.attribution.datasets],
      source_urls: [...s.attribution.source_urls],
      notes: s.attribution.notes ? [...s.attribution.notes] : undefined,
    },
  };
}

export class SceneStore {
  private readonly map = new Map<SceneId, SceneEntry>();
  private readonly inflightLoads = new Map<SceneId, Promise<SceneEntry>>();
  private readonly serializer: SceneSerializer;

  constructor(private readonly config: SceneStoreConfig) {
    this.serializer = new SceneSerializer(config.diskDir);
  }

  size(): number {
    return this.map.size;
  }

  async create(input: CreateSceneInput): Promise<SceneState> {
    const sceneId = newSceneId();
    const now = new Date();
    const state: SceneState = {
      ...input.initial,
      scene_id: sceneId,
      version: 1,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: now.getTime() + this.config.ttlMs,
    };
    this.map.set(sceneId, {
      state,
      lastAccess: now.getTime(),
      lock: new SceneLock(),
      pinned: 0,
    });
    this.evictIfNeeded();
    if (this.config.persistToDisk) await this.serializer.save(state);
    return state;
  }

  private async loadEntry(sceneId: SceneId): Promise<SceneEntry> {
    const cached = this.map.get(sceneId);
    if (cached) {
      if (cached.state.expires_at < Date.now()) {
        if (cached.pinned === 0) this.map.delete(sceneId);
        throw new AppError("SCENE_EXPIRED", "Scene has expired", { scene_id: sceneId });
      }
      cached.lastAccess = Date.now();
      return cached;
    }
    const inflight = this.inflightLoads.get(sceneId);
    if (inflight) return inflight;
    const promise = this.loadEntryFromDisk(sceneId).finally(() => {
      this.inflightLoads.delete(sceneId);
    });
    this.inflightLoads.set(sceneId, promise);
    return promise;
  }

  private async loadEntryFromDisk(sceneId: SceneId): Promise<SceneEntry> {
    if (this.config.persistToDisk) {
      const loaded = await this.serializer.load(sceneId);
      if (loaded) {
        if (loaded.scene_id !== sceneId) {
          throw new AppError("SCENE_VERSION_UNSUPPORTED", "Persisted scene_id mismatch", {
            requested: sceneId,
            found: loaded.scene_id,
          });
        }
        if (loaded.expires_at < Date.now()) {
          throw new AppError("SCENE_EXPIRED", "Scene has expired", { scene_id: sceneId });
        }
        const existing = this.map.get(sceneId);
        if (existing) {
          existing.lastAccess = Date.now();
          return existing;
        }
        const entry: SceneEntry = {
          state: loaded,
          lastAccess: Date.now(),
          lock: new SceneLock(),
          pinned: 0,
        };
        this.map.set(sceneId, entry);
        this.evictIfNeeded();
        return entry;
      }
    }
    throw new AppError("SCENE_NOT_FOUND", "Scene not found", { scene_id: sceneId });
  }

  async get(sceneId: SceneId): Promise<SceneState> {
    const e = await this.loadEntry(sceneId);
    return e.state;
  }

  async read<T>(sceneId: SceneId, fn: (scene: Readonly<SceneState>) => Promise<T>): Promise<T> {
    const entry = await this.loadEntry(sceneId);
    entry.pinned += 1;
    const snapshot = entry.state;
    try {
      return await fn(snapshot);
    } finally {
      entry.pinned -= 1;
    }
  }

  async mutate<T>(sceneId: SceneId, fn: (draft: SceneState) => Promise<T>): Promise<T> {
    const entry = await this.loadEntry(sceneId);
    return entry.lock.run(async () => {
      entry.pinned += 1;
      try {
        const draft = cloneScene(entry.state);
        const result = await fn(draft);
        draft.updated_at = new Date().toISOString();
        if (this.config.persistToDisk) await this.serializer.save(draft);
        entry.state = draft;
        entry.lastAccess = Date.now();
        return result;
      } finally {
        entry.pinned -= 1;
      }
    });
  }

  private evictIfNeeded(): void {
    if (this.map.size <= this.config.maxScenes) return;
    const candidates = Array.from(this.map.entries())
      .filter(([, e]) => e.pinned === 0)
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const overflow = this.map.size - this.config.maxScenes;
    for (let i = 0; i < overflow && i < candidates.length; i++) {
      this.map.delete(candidates[i]![0]);
    }
  }
}
