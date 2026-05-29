import { describe, expect, it } from "vitest";
import { parseFootprint } from "../../src/data/geojson.js";

describe("parseFootprint", () => {
  it("parses a Polygon with one hole", () => {
    const raw = JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
        [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.75, 0.75],
          [0.25, 0.75],
          [0.25, 0.25],
        ],
      ],
    });
    const out = parseFootprint(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.outer).toHaveLength(5);
    expect(out[0]!.holes).toHaveLength(1);
  });

  it("parses a MultiPolygon", () => {
    const raw = JSON.stringify({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 2],
          ],
        ],
      ],
    });
    const out = parseFootprint(raw);
    expect(out).toHaveLength(2);
  });

  it("returns empty for null / garbage input", () => {
    expect(parseFootprint(null)).toEqual([]);
    expect(parseFootprint("not json")).toEqual([]);
    expect(parseFootprint(JSON.stringify({ type: "LineString", coordinates: [] }))).toEqual([]);
  });
});
