import { describe, expect, it } from "vitest";
import { AttributionWrapper, mergeAttribution } from "../../src/attribution/AttributionWrapper.js";

describe("AttributionWrapper", () => {
  it("wraps and refuses missing license", () => {
    const w = new AttributionWrapper();
    expect(() =>
      w.wrap({
        tool: "x",
        input: {},
        result: { ok: true },
        attribution: { license: "", datasets: [], source_urls: [], generated_at: "" },
      }),
    ).toThrow();
  });

  it("merges attribution from two sources", () => {
    const merged = mergeAttribution(
      {
        license: "CC BY 4.0",
        datasets: ["plateau"],
        source_urls: ["a"],
        generated_at: "",
      },
      {
        license: "ODbL",
        datasets: ["osm"],
        source_urls: ["b"],
        generated_at: "",
      },
    );
    expect(merged.datasets).toEqual(expect.arrayContaining(["plateau", "osm"]));
    expect(merged.source_urls).toEqual(expect.arrayContaining(["a", "b"]));
    expect(merged.license).toBe("CC BY 4.0 AND ODbL");
  });

  it("dedupes repeated licenses across merges", () => {
    const merged = mergeAttribution(
      {
        license: "CC BY 4.0",
        datasets: ["plateau"],
        source_urls: ["a"],
        generated_at: "",
      },
      {
        license: "CC BY 4.0",
        datasets: ["plateau-2"],
        source_urls: ["b"],
        generated_at: "",
      },
    );
    expect(merged.license).toBe("CC BY 4.0");
  });
});
