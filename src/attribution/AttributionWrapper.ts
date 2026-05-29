import type { AttributionMetadata } from "../schemas/common.js";

export interface ToolEnvelope<T> {
  result: T;
  attribution_metadata: AttributionMetadata;
}

export interface AttributionWrapInput<T> {
  tool: string;
  input: unknown;
  result: T;
  attribution: AttributionMetadata;
}

export class AttributionWrapper {
  wrap<T>(input: AttributionWrapInput<T>): ToolEnvelope<T> {
    if (!input.attribution.license) {
      throw new Error(`Tool ${input.tool} produced result without attribution license`);
    }
    return {
      result: input.result,
      attribution_metadata: {
        ...input.attribution,
        generated_at: input.attribution.generated_at || new Date().toISOString(),
      },
    };
  }
}

function splitLicense(s: string): string[] {
  return s
    .split(/\s+AND\s+|;\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function mergeAttribution(
  base: AttributionMetadata,
  extra?: AttributionMetadata,
): AttributionMetadata {
  if (!extra) return { ...base, generated_at: new Date().toISOString() };
  const licenses = Array.from(
    new Set([...splitLicense(base.license), ...splitLicense(extra.license)]),
  );
  return {
    license: licenses.join(" AND "),
    datasets: Array.from(new Set([...base.datasets, ...extra.datasets])),
    source_urls: Array.from(new Set([...base.source_urls, ...extra.source_urls])),
    notes: Array.from(new Set([...(base.notes ?? []), ...(extra.notes ?? [])])),
    generated_at: new Date().toISOString(),
  };
}
