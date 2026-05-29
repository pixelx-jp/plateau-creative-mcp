import { z } from "zod";
import type { OfficialPlateauMcpClient } from "../../data/OfficialPlateauMcpClient.js";
import type { AttributionMetadata } from "../../schemas/common.js";
import type { ToolRegistry } from "../../server/ToolRegistry.js";
import type { ToolDefinition } from "../../server/toolEnvelope.js";

const UPSTREAM_ATTRIBUTION: AttributionMetadata = {
  license: "CC BY 4.0",
  datasets: ["plateau-official-mcp"],
  source_urls: ["https://api.plateauview.mlit.go.jp/mcp", "https://www.mlit.go.jp/plateau/"],
  generated_at: "",
  notes: [
    "Data retrieved live from the official Project PLATEAU MCP server. © Project PLATEAU / MLIT (CC BY 4.0).",
  ],
};

function wrap<I, O>(
  name: string,
  description: string,
  schema: z.ZodType<I, z.ZodTypeDef, unknown>,
  call: (input: I, client: OfficialPlateauMcpClient) => Promise<O>,
  client: OfficialPlateauMcpClient,
): ToolDefinition<I, O> {
  return {
    name: name as ToolDefinition<I, O>["name"],
    description,
    schema,
    handler: async (input) => {
      const result = await call(input, client);
      return { result, attribution: UPSTREAM_ATTRIBUTION };
    },
  };
}

const strOpt = z.string().min(1).max(256).optional();
const arrStrOpt = z.array(z.string().min(1).max(128)).max(64).optional();

const searchAreasSchema = z
  .object({
    parent_code: strOpt,
    dataset_types: arrStrOpt,
    categories: arrStrOpt,
    area_types: arrStrOpt,
    search_text: strOpt,
    include_parents: z.boolean().optional(),
    include_empty: z.boolean().optional(),
    deep: z.boolean().optional(),
  })
  .strict();

const searchDatasetsSchema = z
  .object({
    area_codes: arrStrOpt,
    dataset_types: arrStrOpt,
    categories: arrStrOpt,
    plateau_spec: strOpt,
    year: z.number().int().min(2014).max(2100).optional(),
    registration_year: z.number().int().min(2014).max(2100).optional(),
    search_text: strOpt,
    shallow: z.boolean().optional(),
  })
  .strict();

const listDatasetTypesSchema = z
  .object({
    category: strOpt,
    plateau_spec: strOpt,
    year: z.number().int().min(2014).max(2100).optional(),
  })
  .strict();

const specOutlineSchema = z
  .object({
    document_type: strOpt,
    depth: z.number().int().min(1).max(8).optional(),
    chapter: strOpt,
    format: z.enum(["markdown", "json"]).optional(),
  })
  .strict();

const specReadSchema = z
  .object({
    path: z.string().min(1).max(512),
    document_type: strOpt,
    single_page: z.boolean().optional(),
    include_images: z.boolean().optional(),
  })
  .strict();

const citygmlGetAttributesSchema = z
  .object({
    url: z.string().url().max(2048),
    building_ids: z.array(z.string().min(1).max(256)).min(1).max(5000),
    skip_code_list: z.boolean().optional(),
  })
  .strict();

const citygmlGetFeaturesSchema = z
  .object({
    url: z.string().url().max(2048),
    spatial_ids: z.array(z.string().min(1).max(128)).min(1).max(1000),
  })
  .strict();

const citygmlGetGeoidHeightSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

const getCityGmlFilesSchema = z
  .object({
    condition: z.string().min(1).max(256),
    feature_types: arrStrOpt,
  })
  .strict();

const getAreaSchema = z.object({ code: z.string().min(1).max(32) }).strict();
const getDatasetSchema = z.object({ id: z.string().min(1).max(128) }).strict();
const emptySchema = z.object({}).strict();

export const UPSTREAM_TOOL_NAMES = [
  "plateau_spec_outline",
  "plateau_spec_read",
  "plateau_get_metadata",
  "plateau_search_areas",
  "plateau_get_area",
  "plateau_search_datasets",
  "plateau_get_dataset",
  "plateau_list_dataset_types",
  "plateau_citygml_get_attributes",
  "plateau_citygml_get_features",
  "plateau_citygml_get_geoid_height",
  "plateau_get_citygml_files",
  "plateau_explain_spatial_id",
] as const;

export function registerUpstreamPlateauTools(
  registry: ToolRegistry,
  client: OfficialPlateauMcpClient,
): readonly string[] {
  const defs: Array<ToolDefinition<unknown, unknown>> = [
    wrap(
      "plateau_spec_outline",
      "Official PLATEAU spec: fetch hierarchical chapter outline with paths for content retrieval.",
      specOutlineSchema,
      (i, c) => c.specOutline(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_spec_read",
      "Official PLATEAU spec: read a specific path; may be truncated with sub-section suggestions.",
      specReadSchema,
      (i, c) => c.specRead(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_get_metadata",
      "Official PLATEAU catalog: top-level statistics (available years, specs, area / dataset counts).",
      emptySchema,
      (_i, c) => c.getMetadata(),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_search_areas",
      "Official PLATEAU catalog: search prefectures / municipalities by parent code, dataset type, free text.",
      searchAreasSchema,
      (i, c) => c.searchAreas(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_get_area",
      "Official PLATEAU catalog: fetch detailed metadata for a single area (by JIS code).",
      getAreaSchema,
      (i, c) => c.getArea(i.code),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_search_datasets",
      "Official PLATEAU catalog: search datasets by area, dataset type, year, plateau spec version.",
      searchDatasetsSchema,
      (i, c) => c.searchDatasets(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_get_dataset",
      "Official PLATEAU catalog: full dataset details including item formats and download URLs.",
      getDatasetSchema,
      (i, c) => c.getDataset(i.id),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_list_dataset_types",
      "Official PLATEAU catalog: list available feature type codes (bldg, tran, luse, dem, fld, ...) with counts.",
      listDatasetTypesSchema,
      (i, c) => c.listDatasetTypes(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_citygml_get_attributes",
      "Official PLATEAU CityGML: fetch attribute records (height, storeys, usage, bbox) for given building IDs.",
      citygmlGetAttributesSchema,
      (i, c) => c.citygmlGetAttributes(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_citygml_get_features",
      "Official PLATEAU CityGML: list feature/building IDs within given spatial IDs.",
      citygmlGetFeaturesSchema,
      (i, c) => c.citygmlGetFeatures(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_citygml_get_geoid_height",
      "Official PLATEAU CityGML: geoid height (m) at a lat/lon for ellipsoidal-to-orthometric conversion.",
      citygmlGetGeoidHeightSchema,
      (i, c) => c.citygmlGetGeoidHeight(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_get_citygml_files",
      "Official PLATEAU CityGML: find CityGML file URLs matching a mesh code / spatial ID / rectangle.",
      getCityGmlFilesSchema,
      (i, c) => c.getCityGmlFiles(i),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
    wrap(
      "plateau_explain_spatial_id",
      "Official PLATEAU helper: documentation for the spatial ID format (zoom levels, calculations).",
      emptySchema,
      (_i, c) => c.explainSpatialId(),
      client,
    ) as unknown as ToolDefinition<unknown, unknown>,
  ];
  for (const def of defs) registry.registerTool(def);
  return UPSTREAM_TOOL_NAMES;
}
