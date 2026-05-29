import type { FootprintPolygon, FootprintRing } from "./types.js";

type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: string; coordinates: unknown };

function toRing(coords: number[][]): FootprintRing {
  const out: FootprintRing = [];
  for (const c of coords) {
    if (typeof c[0] === "number" && typeof c[1] === "number") out.push([c[0], c[1]]);
  }
  return out;
}

export function parseFootprint(raw: string | null | undefined): FootprintPolygon[] {
  if (!raw) return [];
  let geom: Geometry;
  try {
    geom = JSON.parse(raw) as Geometry;
  } catch {
    return [];
  }
  if (geom.type === "Polygon") {
    const rings = (geom as { coordinates: number[][][] }).coordinates;
    if (!rings || rings.length === 0) return [];
    return [{ outer: toRing(rings[0]!), holes: rings.slice(1).map(toRing) }];
  }
  if (geom.type === "MultiPolygon") {
    const polys = (geom as { coordinates: number[][][][] }).coordinates;
    const out: FootprintPolygon[] = [];
    for (const poly of polys ?? []) {
      if (!poly || poly.length === 0) continue;
      out.push({ outer: toRing(poly[0]!), holes: poly.slice(1).map(toRing) });
    }
    return out;
  }
  return [];
}
