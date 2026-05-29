import {
  JsonRpcMcpClient,
  type JsonRpcMcpClientOptions,
  type RemoteTool,
} from "./JsonRpcMcpClient.js";

/**
 * Typed wrapper around the official PLATEAU MCP server (HTTP / JSON-RPC).
 *
 * Hosted endpoint: https://api.plateauview.mlit.go.jp/mcp
 * Tool surface mirrored from
 * https://github.com/Project-PLATEAU/plateau-streaming-tutorial/blob/main/mcp/plateau-mcp.md
 *
 * Response shapes are loosely typed — the upstream spec is still evolving.
 * Callers that want strict shapes should validate the returned objects
 * with their own Zod schemas at the call site.
 */

export const OFFICIAL_PLATEAU_MCP_URL = "https://api.plateauview.mlit.go.jp/mcp";

export interface PlateauMetadata {
  available_years?: number[];
  plateau_specs?: Array<{ version: string; [k: string]: unknown }>;
  total_areas?: number;
  total_datasets?: number;
  [k: string]: unknown;
}

export interface PlateauArea {
  code: string;
  name: string;
  type?: string;
  parent?: string | null;
  children?: string[];
  crs?: string;
  [k: string]: unknown;
}

export interface PlateauDataset {
  id: string;
  name?: string;
  items?: Array<{ format?: string; url?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export interface PlateauDatasetType {
  code: string;
  name?: string;
  category?: string;
  dataset_count?: number;
  [k: string]: unknown;
}

export interface PlateauCityGmlAttribute {
  building_id: string;
  measured_height?: number;
  storeys_above?: number;
  storeys_below?: number;
  usage?: string;
  bbox?: [number, number, number, number];
  [k: string]: unknown;
}

export interface SearchAreasInput {
  parent_code?: string;
  dataset_types?: string[];
  categories?: string[];
  area_types?: string[];
  search_text?: string;
  include_parents?: boolean;
  include_empty?: boolean;
  deep?: boolean;
}

export interface SearchDatasetsInput {
  area_codes?: string[];
  dataset_types?: string[];
  categories?: string[];
  plateau_spec?: string;
  year?: number;
  registration_year?: number;
  search_text?: string;
  shallow?: boolean;
}

export interface ListDatasetTypesInput {
  category?: string;
  plateau_spec?: string;
  year?: number;
}

export interface SpecOutlineInput {
  document_type?: string;
  depth?: number;
  chapter?: string;
  format?: "markdown" | "json";
}

export interface SpecReadInput {
  path: string;
  document_type?: string;
  single_page?: boolean;
  include_images?: boolean;
}

export interface CityGmlGetAttributesInput {
  url: string;
  building_ids: string[];
  skip_code_list?: boolean;
}

export interface CityGmlGetFeaturesInput {
  url: string;
  spatial_ids: string[];
}

export interface CityGmlGetGeoidHeightInput {
  latitude: number;
  longitude: number;
}

export interface GetCityGmlFilesInput {
  condition: string;
  feature_types?: string[];
}

export interface SearchResult<T> {
  metadata?: { total?: number; returned?: number; suggestions?: unknown };
  [k: string]: unknown;
  items?: T[];
}

export class OfficialPlateauMcpClient extends JsonRpcMcpClient {
  constructor(options: Partial<Omit<JsonRpcMcpClientOptions, "errorCode">> = {}) {
    super({
      url: options.url ?? OFFICIAL_PLATEAU_MCP_URL,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      headers: options.headers,
      errorCode: "UPSTREAM_PLATEAU_ERROR",
    });
  }

  async listTools(): Promise<RemoteTool[]> {
    return super.listTools();
  }

  // --- Specification ---

  async specOutline(input: SpecOutlineInput = {}): Promise<unknown> {
    return this.callTool("plateau_spec_outline", input as Record<string, unknown>);
  }

  async specRead(input: SpecReadInput): Promise<unknown> {
    return this.callTool("plateau_spec_read", input as unknown as Record<string, unknown>);
  }

  // --- Catalog ---

  async getMetadata(): Promise<PlateauMetadata> {
    return this.callTool<PlateauMetadata>("plateau_get_metadata", {});
  }

  async searchAreas(
    input: SearchAreasInput = {},
  ): Promise<{ areas: PlateauArea[]; metadata?: unknown }> {
    return this.callTool("plateau_search_areas", input as Record<string, unknown>);
  }

  async getArea(code: string): Promise<PlateauArea> {
    return this.callTool<PlateauArea>("plateau_get_area", { code });
  }

  async searchDatasets(
    input: SearchDatasetsInput = {},
  ): Promise<{ datasets: PlateauDataset[]; metadata?: unknown }> {
    return this.callTool("plateau_search_datasets", input as Record<string, unknown>);
  }

  async getDataset(id: string): Promise<PlateauDataset> {
    return this.callTool<PlateauDataset>("plateau_get_dataset", { id });
  }

  async listDatasetTypes(
    input: ListDatasetTypesInput = {},
  ): Promise<{ dataset_types: PlateauDatasetType[] }> {
    return this.callTool("plateau_list_dataset_types", input as Record<string, unknown>);
  }

  // --- CityGML ---

  async citygmlGetAttributes(
    input: CityGmlGetAttributesInput,
  ): Promise<{ attributes: PlateauCityGmlAttribute[] }> {
    return this.callTool(
      "plateau_citygml_get_attributes",
      input as unknown as Record<string, unknown>,
    );
  }

  async citygmlGetFeatures(input: CityGmlGetFeaturesInput): Promise<{ feature_ids: string[] }> {
    return this.callTool(
      "plateau_citygml_get_features",
      input as unknown as Record<string, unknown>,
    );
  }

  async citygmlGetGeoidHeight(
    input: CityGmlGetGeoidHeightInput,
  ): Promise<{ height_m: number; [k: string]: unknown }> {
    return this.callTool(
      "plateau_citygml_get_geoid_height",
      input as unknown as Record<string, unknown>,
    );
  }

  async getCityGmlFiles(
    input: GetCityGmlFilesInput,
  ): Promise<{ cities: Array<Record<string, unknown>>; featureTypes?: unknown }> {
    return this.callTool("plateau_get_citygml_files", input as unknown as Record<string, unknown>);
  }

  // --- Helper ---

  async explainSpatialId(): Promise<string> {
    return this.callTool<string>("plateau_explain_spatial_id", {});
  }
}
