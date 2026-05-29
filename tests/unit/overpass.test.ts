import { describe, expect, it } from "vitest";
import { type FetchLike, OverpassClient } from "../../src/data/OverpassClient.js";
import { asBuildingUid } from "../../src/utils/ids.js";

function fakeFetch(body: unknown, opts: { ok?: boolean; status?: number } = {}): FetchLike {
  return async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: "OK",
    json: async () => body,
  });
}

const BUILDINGS = [
  { building_uid: asBuildingUid("near"), lon: 139.7, lat: 35.66 },
  { building_uid: asBuildingUid("far"), lon: 139.75, lat: 35.7 },
];

describe("OverpassClient", () => {
  it("matches a POI to the nearest building within max distance", async () => {
    const client = new OverpassClient({
      url: "https://overpass.invalid",
      fetchImpl: fakeFetch({
        elements: [
          {
            type: "node",
            id: 1,
            lat: 35.66005,
            lon: 139.70005,
            tags: { name: "Starbucks", amenity: "cafe" },
          },
        ],
      }),
    });
    const r = await client.fetch({
      bbox: [139.69, 35.65, 139.71, 35.67],
      buildings: BUILDINGS,
      maxDistanceM: 100,
    });
    expect(r.poi_count).toBe(1);
    expect(r.links[asBuildingUid("near")]).toHaveLength(1);
    expect(r.links[asBuildingUid("near")]![0]!.kind).toMatch(/^amenity:/);
  });

  it("drops POIs farther than max_distance_m", async () => {
    const client = new OverpassClient({
      url: "https://overpass.invalid",
      fetchImpl: fakeFetch({
        elements: [
          {
            type: "node",
            id: 2,
            lat: 35.8,
            lon: 139.9,
            tags: { name: "Far", amenity: "bar" },
          },
        ],
      }),
    });
    const r = await client.fetch({
      bbox: [139.69, 35.65, 139.95, 35.85],
      buildings: BUILDINGS,
      maxDistanceM: 30,
    });
    expect(r.poi_count).toBe(1);
    expect(Object.keys(r.links)).toHaveLength(0);
  });

  it("ignores nodes without a name", async () => {
    const client = new OverpassClient({
      url: "https://overpass.invalid",
      fetchImpl: fakeFetch({
        elements: [{ type: "node", id: 3, lat: 35.66, lon: 139.7, tags: { amenity: "cafe" } }],
      }),
    });
    const r = await client.fetch({
      bbox: [139.69, 35.65, 139.71, 35.67],
      buildings: BUILDINGS,
      maxDistanceM: 100,
    });
    expect(r.poi_count).toBe(0);
  });

  it("maps HTTP errors to OSM_OVERPASS_ERROR", async () => {
    const client = new OverpassClient({
      url: "https://overpass.invalid",
      fetchImpl: fakeFetch({}, { ok: false, status: 503 }),
    });
    await expect(
      client.fetch({
        bbox: [139.69, 35.65, 139.71, 35.67],
        buildings: BUILDINGS,
        maxDistanceM: 30,
      }),
    ).rejects.toMatchObject({ code: "OSM_OVERPASS_ERROR" });
  });
});
