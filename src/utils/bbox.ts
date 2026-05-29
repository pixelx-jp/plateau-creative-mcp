export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

const EARTH_RADIUS_M = 6378137;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function bboxAreaKm2(bbox: BBox): number {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lat1 = toRad(minLat);
  const lat2 = toRad(maxLat);
  const dLon = toRad(maxLon - minLon);
  const widthM = EARTH_RADIUS_M * dLon * Math.cos((lat1 + lat2) / 2);
  const heightM = EARTH_RADIUS_M * (lat2 - lat1);
  return (Math.abs(widthM) * Math.abs(heightM)) / 1_000_000;
}

export function validateBbox(bbox: unknown): BBox {
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    throw new Error("bbox must be [minLon, minLat, maxLon, maxLat]");
  }
  const [minLon, minLat, maxLon, maxLat] = bbox as number[];
  if (minLon! >= maxLon! || minLat! >= maxLat!) throw new Error("bbox min must be less than max");
  if (minLon! < -180 || maxLon! > 180 || minLat! < -90 || maxLat! > 90)
    throw new Error("bbox out of geographic range");
  return [minLon!, minLat!, maxLon!, maxLat!];
}

export function centroid(bbox: BBox): [lon: number, lat: number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}
