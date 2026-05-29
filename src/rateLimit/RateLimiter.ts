import { AppError } from "../errors/AppError.js";
import { TokenBucket } from "./TokenBucket.js";

export interface ToolRateLimit {
  capacity: number;
  refillPerMinute: number;
  maxConcurrent: number;
}

export const DEFAULT_LIMITS: Record<string, ToolRateLimit> = {
  download_area: { capacity: 2, refillPerMinute: 2, maxConcurrent: 1 },
  load_area: { capacity: 10, refillPerMinute: 10, maxConcurrent: 2 },
  filter_buildings: { capacity: 60, refillPerMinute: 60, maxConcurrent: 8 },
  delete_buildings: { capacity: 60, refillPerMinute: 60, maxConcurrent: 8 },
  extrude_buildings: { capacity: 60, refillPerMinute: 60, maxConcurrent: 8 },
  compose_scene: { capacity: 120, refillPerMinute: 120, maxConcurrent: 8 },
  export_glb: { capacity: 3, refillPerMinute: 3, maxConcurrent: 1 },
  link_buildings_to_pois: { capacity: 5, refillPerMinute: 5, maxConcurrent: 1 },
  get_attribution: { capacity: 120, refillPerMinute: 120, maxConcurrent: 8 },
  render_via_blender: { capacity: 3, refillPerMinute: 3, maxConcurrent: 1 },
  plateau_spec_outline: { capacity: 30, refillPerMinute: 30, maxConcurrent: 2 },
  plateau_spec_read: { capacity: 30, refillPerMinute: 30, maxConcurrent: 2 },
  plateau_get_metadata: { capacity: 30, refillPerMinute: 30, maxConcurrent: 2 },
  plateau_search_areas: { capacity: 30, refillPerMinute: 30, maxConcurrent: 2 },
  plateau_get_area: { capacity: 60, refillPerMinute: 60, maxConcurrent: 4 },
  plateau_search_datasets: { capacity: 30, refillPerMinute: 30, maxConcurrent: 2 },
  plateau_get_dataset: { capacity: 60, refillPerMinute: 60, maxConcurrent: 4 },
  plateau_list_dataset_types: { capacity: 30, refillPerMinute: 30, maxConcurrent: 2 },
  plateau_citygml_get_attributes: { capacity: 15, refillPerMinute: 15, maxConcurrent: 1 },
  plateau_citygml_get_features: { capacity: 15, refillPerMinute: 15, maxConcurrent: 1 },
  plateau_citygml_get_geoid_height: { capacity: 60, refillPerMinute: 60, maxConcurrent: 4 },
  plateau_get_citygml_files: { capacity: 15, refillPerMinute: 15, maxConcurrent: 1 },
  plateau_explain_spatial_id: { capacity: 30, refillPerMinute: 30, maxConcurrent: 2 },
};

export interface CheckOptions {
  client: string;
  tool: string;
}

interface ToolBucket {
  bucket: TokenBucket;
  inflight: number;
  limit: ToolRateLimit;
}

export class RateLimiter {
  private readonly perClient = new Map<string, Map<string, ToolBucket>>();

  constructor(private readonly limits: Record<string, ToolRateLimit> = DEFAULT_LIMITS) {}

  private get(client: string, tool: string): ToolBucket {
    let m = this.perClient.get(client);
    if (!m) {
      m = new Map();
      this.perClient.set(client, m);
    }
    let b = m.get(tool);
    if (!b) {
      const limit = this.limits[tool] ?? { capacity: 30, refillPerMinute: 30, maxConcurrent: 4 };
      b = {
        bucket: new TokenBucket(limit.capacity, limit.refillPerMinute / 60),
        inflight: 0,
        limit,
      };
      m.set(tool, b);
    }
    return b;
  }

  async acquire(opts: CheckOptions): Promise<() => void> {
    const b = this.get(opts.client, opts.tool);
    if (b.inflight >= b.limit.maxConcurrent) {
      throw new AppError("RATE_LIMITED", `Too many concurrent ${opts.tool} calls`, {
        tool: opts.tool,
        max_concurrent: b.limit.maxConcurrent,
      });
    }
    if (!b.bucket.tryAcquire()) {
      throw new AppError("RATE_LIMITED", `Rate limit exceeded for ${opts.tool}`, {
        tool: opts.tool,
        refill_per_minute: b.limit.refillPerMinute,
      });
    }
    b.inflight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      b.inflight -= 1;
    };
  }
}
