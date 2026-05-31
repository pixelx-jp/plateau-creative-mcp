import fs from "node:fs/promises";
import path from "node:path";
import type { BBox } from "../utils/bbox.js";

interface TileNode {
  boundingVolume?: { region?: number[] };
  content?: { uri?: string };
  children?: TileNode[];
}

interface Tileset {
  root?: TileNode;
}

// A 3D Tiles tileset.json can be 1–10 MB and is re-indexed on every export
// (each with a different sceneBbox). The bbox-dependent walk is cheap; the
// read + JSON.parse is the cost. Cache the parsed tree per path, validated by
// mtime so a rebuilt tileset is picked up without serving stale data.
interface CachedTileset {
  mtimeMs: number;
  parsed: Tileset;
}
const parsedTilesetCache = new Map<string, CachedTileset>();

export interface TilesetTileEntry {
  uri: string;
  bbox: BBox;
  min_height_m: number;
  max_height_m: number;
}

export interface TilesetIndex {
  tileset_path: string;
  bbox: BBox | null;
  tiles: TilesetTileEntry[];
}

function radRegionToBbox(region: number[]): { bbox: BBox; minH: number; maxH: number } | null {
  if (region.length < 6) return null;
  const [west, south, east, north, minH, maxH] = region as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const toDeg = (r: number) => (r * 180) / Math.PI;
  return {
    bbox: [toDeg(west), toDeg(south), toDeg(east), toDeg(north)],
    minH,
    maxH,
  };
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function sanitizeRelativeUri(uri: string): string | null {
  if (!uri) return null;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(uri)) return null;
  if (path.isAbsolute(uri)) return null;
  const normalized = path.posix.normalize(uri.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized === "..") return null;
  if (normalized.startsWith("/")) return null;
  return normalized;
}

function walk(node: TileNode | undefined, out: TilesetTileEntry[], sceneBbox: BBox): void {
  if (!node) return;
  const uri = node.content?.uri;
  if (uri) {
    const safe = sanitizeRelativeUri(uri);
    const region = node.boundingVolume?.region;
    if (safe && region) {
      const conv = radRegionToBbox(region);
      if (conv && bboxIntersects(conv.bbox, sceneBbox)) {
        out.push({
          uri: safe,
          bbox: conv.bbox,
          min_height_m: conv.minH,
          max_height_m: conv.maxH,
        });
      }
    }
  }
  if (node.children) {
    for (const c of node.children) walk(c, out, sceneBbox);
  }
}

export async function indexTileset(
  tilesetPath: string,
  sceneBbox: BBox,
): Promise<TilesetIndex | null> {
  let parsed: Tileset;
  try {
    const key = path.resolve(tilesetPath);
    const stat = await fs.stat(tilesetPath);
    const cached = parsedTilesetCache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      parsed = cached.parsed;
    } else {
      const raw = await fs.readFile(tilesetPath, "utf8");
      parsed = JSON.parse(raw) as Tileset;
      parsedTilesetCache.set(key, { mtimeMs: stat.mtimeMs, parsed });
    }
  } catch {
    // Missing file, read error, or malformed JSON — same as before: no index.
    return null;
  }
  const tiles: TilesetTileEntry[] = [];
  walk(parsed.root, tiles, sceneBbox);
  const rootConv = parsed.root?.boundingVolume?.region
    ? radRegionToBbox(parsed.root.boundingVolume.region)
    : null;
  return {
    tileset_path: path.resolve(tilesetPath),
    bbox: rootConv?.bbox ?? null,
    tiles,
  };
}
