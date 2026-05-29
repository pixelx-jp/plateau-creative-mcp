import type { ArtifactDownloader, DownloadResult } from "../data/ArtifactDownloader.js";
import { AppError } from "../errors/AppError.js";
import type { AttributionMetadata } from "../schemas/common.js";
import { type DownloadAreaInput, downloadAreaSchema } from "../schemas/downloadArea.js";
import type { ToolDefinition } from "../server/toolEnvelope.js";

export type DownloadAreaResult = DownloadResult;

const ATTRIBUTION: AttributionMetadata = {
  license: "CC BY 4.0",
  datasets: ["plateau-prebuilt-artifact"],
  source_urls: ["https://www.mlit.go.jp/plateau/"],
  generated_at: "",
  notes: [
    "Prebuilt PLATEAU artifact bundles derived from MLIT CityGML datasets. © Project PLATEAU / MLIT (CC BY 4.0).",
  ],
};

export function buildDownloadAreaTool(
  downloader: ArtifactDownloader | null,
): ToolDefinition<DownloadAreaInput, DownloadAreaResult> {
  return {
    name: "download_area",
    description:
      "Fetch and cache the prebuilt artifact bundle for a given city slug (e.g. 'shibuya') from the plateau-bridge release index, then extract buildings.parquet + manifest.json into the local artifact cache. After it returns, load_area for that city works without cloning the data pipeline. Pass index_url to use a custom cache index. Disabled when no downloader is configured.",
    schema: downloadAreaSchema,
    handler: async (input) => {
      if (!downloader) {
        throw new AppError(
          "INVALID_INPUT",
          "download_area is disabled: no artifact index URL is configured.",
        );
      }
      const result = await downloader.download(input.city, input.index_url);
      return { result, attribution: ATTRIBUTION };
    },
  };
}
