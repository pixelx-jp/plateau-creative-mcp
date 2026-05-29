import { describe, expect, it } from "vitest";
import { bboxAreaKm2 } from "../../src/utils/bbox.js";

describe("bboxAreaKm2", () => {
  it("approximates Shibuya 700m × 555m at ~0.4 km²", () => {
    const area = bboxAreaKm2([139.6975, 35.6555, 139.7045, 35.6605]);
    expect(area).toBeGreaterThan(0.3);
    expect(area).toBeLessThan(0.5);
  });
});
