import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SceneStore } from "../../src/scene/SceneStore.js";
import { asBuildingUid } from "../../src/utils/ids.js";

const initial = {
  source: {
    city: "shibuya",
    bbox: [139.69, 35.65, 139.71, 35.66] as [number, number, number, number],
    lod: 2 as const,
    artifact_dir: "/tmp/x",
    upstream_refs: [],
  },
  buildings: {
    all_uids: [asBuildingUid("a"), asBuildingUid("b")],
    deleted_uids: new Set<ReturnType<typeof asBuildingUid>>(),
    extrusions: new Map(),
  },
  composition: {},
  attribution: {
    license: "CC BY 4.0",
    datasets: ["d"],
    source_urls: ["u"],
    generated_at: new Date().toISOString(),
  },
};

describe("SceneStore disk persistence", () => {
  let diskDir: string;

  beforeEach(async () => {
    diskDir = await fs.mkdtemp(path.join(os.tmpdir(), "scene-disk-"));
  });
  afterEach(async () => {
    await fs.rm(diskDir, { recursive: true, force: true });
  });

  it("roundtrips version, deletions, and extrusions across stores", async () => {
    const a = new SceneStore({ maxScenes: 4, ttlMs: 60_000, persistToDisk: true, diskDir });
    const scene = await a.create({ initial });
    await a.mutate(scene.scene_id, async (draft) => {
      draft.buildings.deleted_uids.add(asBuildingUid("a"));
      draft.buildings.extrusions.set(asBuildingUid("b"), { factor: 2.5 });
      draft.composition.weather = "rain";
      draft.version += 1;
    });

    const b = new SceneStore({ maxScenes: 4, ttlMs: 60_000, persistToDisk: true, diskDir });
    const loaded = await b.get(scene.scene_id);
    expect(loaded.version).toBe(2);
    expect(loaded.buildings.deleted_uids.has(asBuildingUid("a"))).toBe(true);
    expect(loaded.buildings.extrusions.get(asBuildingUid("b"))?.factor).toBe(2.5);
    expect(loaded.composition.weather).toBe("rain");
  });

  it("returns SCENE_VERSION_UNSUPPORTED on schema mismatch", async () => {
    const store = new SceneStore({ maxScenes: 4, ttlMs: 60_000, persistToDisk: true, diskDir });
    const scene = await store.create({ initial });
    const fname = path.join(diskDir, `${scene.scene_id}.json`);
    const raw = JSON.parse(await fs.readFile(fname, "utf8"));
    raw.schema_version = 999;
    await fs.writeFile(fname, JSON.stringify(raw));

    const fresh = new SceneStore({ maxScenes: 4, ttlMs: 60_000, persistToDisk: true, diskDir });
    await expect(fresh.get(scene.scene_id)).rejects.toMatchObject({
      code: "SCENE_VERSION_UNSUPPORTED",
    });
  });
});
