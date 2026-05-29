import { AppError } from "../errors/AppError.js";
import type { BuildingUid } from "../utils/ids.js";
import type { LinkPoisInput, PoiLink, PoiLinkResult, PoiSource } from "./types.js";

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassPoi {
  id: number;
  lat: number;
  lon: number;
  name: string;
  kind: string;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }>;

export interface OverpassClientOptions {
  url: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  userAgent?: string;
}

const EARTH_RADIUS_M = 6371000;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

const KIND_KEYS = ["amenity", "shop", "office", "tourism", "leisure"] as const;

export class OverpassClient implements PoiSource {
  private readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(opts: OverpassClientOptions) {
    this.url = opts.url;
    this.fetchImpl =
      opts.fetchImpl ??
      ((input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>);
    this.timeoutMs = opts.timeoutMs ?? 25_000;
    this.userAgent = opts.userAgent ?? "plateau-creative-mcp/0.1";
  }

  async fetch(input: LinkPoisInput): Promise<PoiLinkResult> {
    if (input.buildings.length === 0) {
      return this.emptyResult();
    }
    const pois = await this.queryPois(input);
    const links = this.matchPois(pois, input);
    return {
      links,
      poi_count: pois.length,
      attribution: this.attribution(),
    };
  }

  private emptyResult(): PoiLinkResult {
    return { links: {}, poi_count: 0, attribution: this.attribution() };
  }

  private attribution() {
    return {
      license: "ODbL 1.0",
      datasets: ["openstreetmap"],
      source_urls: ["https://www.openstreetmap.org/copyright"],
      generated_at: new Date().toISOString(),
      notes: ["POIs fetched via OSM Overpass API. Retain ODbL attribution in derivatives."],
    };
  }

  private buildQuery(bbox: LinkPoisInput["bbox"]): string {
    const [w, s, e, n] = [bbox[0], bbox[1], bbox[2], bbox[3]];
    const box = `${s},${w},${n},${e}`;
    const sec = Math.floor(this.timeoutMs / 1000);
    const filters = KIND_KEYS.map((k) => `  node["${k}"](${box});`).join("\n");
    return `[out:json][timeout:${sec}];\n(\n${filters}\n);\nout body;`;
  }

  private async queryPois(input: LinkPoisInput): Promise<OverpassPoi[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let raw: unknown;
    try {
      const resp = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": this.userAgent,
        },
        body: `data=${encodeURIComponent(this.buildQuery(input.bbox))}`,
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new AppError("OSM_OVERPASS_ERROR", `Overpass HTTP ${resp.status}`, {
          status: resp.status,
          statusText: resp.statusText,
        });
      }
      raw = await resp.json();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        "OSM_OVERPASS_ERROR",
        `Overpass request failed: ${(err as Error).message}`,
        {
          cause: (err as Error).message,
        },
      );
    } finally {
      clearTimeout(timer);
    }
    const elements = ((raw as { elements?: OverpassElement[] }).elements ??
      []) as OverpassElement[];
    const pois: OverpassPoi[] = [];
    for (const e of elements) {
      if (e.type !== "node" || !e.tags || typeof e.lat !== "number" || typeof e.lon !== "number") {
        continue;
      }
      const name = e.tags.name?.slice(0, 200);
      if (!name) continue;
      const kind =
        KIND_KEYS.map((k) => (e.tags?.[k] ? `${k}:${e.tags[k]!.slice(0, 64)}` : null)).find(
          (v): v is string => v !== null,
        ) ?? "unknown";
      pois.push({ id: e.id, lat: e.lat, lon: e.lon, name, kind });
    }
    return pois;
  }

  private matchPois(pois: OverpassPoi[], input: LinkPoisInput): Record<BuildingUid, PoiLink[]> {
    const links: Record<BuildingUid, PoiLink[]> = {};
    if (pois.length === 0 || input.buildings.length === 0) return links;
    for (const poi of pois) {
      let best: { uid: BuildingUid; dist: number } | null = null;
      for (const b of input.buildings) {
        const d = haversineM(poi.lat, poi.lon, b.lat, b.lon);
        if (d > input.maxDistanceM) continue;
        if (!best || d < best.dist) best = { uid: b.building_uid, dist: d };
      }
      if (!best) continue;
      let arr = links[best.uid];
      if (!arr) {
        arr = [];
        links[best.uid] = arr;
      }
      arr.push({ name: poi.name, kind: poi.kind, distance_m: Math.round(best.dist * 10) / 10 });
    }
    return links;
  }
}
