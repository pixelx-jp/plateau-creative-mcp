import { describe, expect, it } from "vitest";
import { SceneStore } from "../../src/scene/SceneStore.js";
import { asBuildingUid } from "../../src/utils/ids.js";

function makeStore() {
  return new SceneStore({
    maxScenes: 4,
    ttlMs: 60_000,
    persistToDisk: false,
    diskDir: "/tmp/should-not-write",
  });
}

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

describe("SceneStore", () => {
  it("creates scene with ulid and bumps version on mutate", async () => {
    const s = makeStore();
    const scene = await s.create({ initial });
    expect(scene.scene_id).toMatch(/^scene_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(scene.version).toBe(1);

    const r = await s.mutate(scene.scene_id, async (draft) => {
      draft.version += 1;
      draft.buildings.deleted_uids.add(asBuildingUid("a"));
      return draft.version;
    });
    expect(r).toBe(2);
    const after = await s.get(scene.scene_id);
    expect(after.version).toBe(2);
    expect(after.buildings.deleted_uids.has(asBuildingUid("a"))).toBe(true);
  });

  it("serializes mutations per scene via lock", async () => {
    const s = makeStore();
    const scene = await s.create({ initial });
    const order: number[] = [];
    await Promise.all([
      s.mutate(scene.scene_id, async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      }),
      s.mutate(scene.scene_id, async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });

  it("throws SCENE_NOT_FOUND for unknown id", async () => {
    const s = makeStore();
    await expect(s.get("scene_01ARZ3NDEKTSV4RRFFQ69G5FAV" as never)).rejects.toThrow(
      /SCENE_NOT_FOUND|not found/i,
    );
  });
});
