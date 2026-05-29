import os from "node:os";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PLATEAU_ARTIFACT_DIR: z.string().optional(),
  PLATEAU_OUTPUT_DIR: z.string().default("./out"),
  PLATEAU_SCENE_DIR: z.string().default("./.scene-store"),
  PLATEAU_PERSIST_SCENES: z.enum(["true", "false"]).default("false"),
  PLATEAU_MAX_SCENES: z.coerce.number().int().positive().default(64),
  PLATEAU_SCENE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000),
  PLATEAU_ARTIFACT_INDEX_URL: z
    .string()
    .url()
    .default(
      "https://raw.githubusercontent.com/pixelx-jp/plateau-bridge/main/distribution/index.json",
    ),
  PLATEAU_ARTIFACT_DOWNLOAD_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .max(30 * 60_000)
    .default(5 * 60_000),
  PLATEAU_AUTO_DOWNLOAD: z.enum(["true", "false"]).default("false"),
  PLATEAU_DATA_MODE: z.enum(["artifact", "subprocess"]).default("artifact"),
  PLATEAU_PYTHON_BIN: z.string().default("python3"),
  PLATEAU_SUBPROCESS_SCRIPT: z.string().optional(),
  PLATEAU_UPSTREAM_ENABLED: z.enum(["true", "false"]).default("false"),
  OFFICIAL_PLATEAU_MCP_URL: z.string().optional(),
  OSM_OVERPASS_URL: z.string().optional(),
  OSM_OVERPASS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(25_000),
});

export type DataMode = "artifact" | "subprocess";

export interface Config {
  artifactDir: string;
  artifactDirExplicit: boolean;
  artifactIndexUrl: string;
  artifactDownloadTimeoutMs: number;
  autoDownload: boolean;
  outputDir: string;
  sceneDir: string;
  persistScenes: boolean;
  maxScenes: number;
  sceneTtlMs: number;
  dataMode: DataMode;
  pythonBin: string;
  subprocessScript: string | undefined;
  officialPlateauMcpUrl: string | undefined;
  upstreamEnabled: boolean;
  osmOverpassUrl: string | undefined;
  osmOverpassTimeoutMs: number;
}

function defaultArtifactDir(): string {
  return path.resolve(os.homedir(), ".cache", "plateau-creative-mcp", "artifacts");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const artifactDirExplicit = !!parsed.PLATEAU_ARTIFACT_DIR;
  return {
    artifactDir: artifactDirExplicit
      ? path.resolve(parsed.PLATEAU_ARTIFACT_DIR!)
      : defaultArtifactDir(),
    artifactDirExplicit,
    artifactIndexUrl: parsed.PLATEAU_ARTIFACT_INDEX_URL,
    artifactDownloadTimeoutMs: parsed.PLATEAU_ARTIFACT_DOWNLOAD_TIMEOUT_MS,
    autoDownload: parsed.PLATEAU_AUTO_DOWNLOAD === "true",
    outputDir: path.resolve(parsed.PLATEAU_OUTPUT_DIR),
    sceneDir: path.resolve(parsed.PLATEAU_SCENE_DIR),
    persistScenes: parsed.PLATEAU_PERSIST_SCENES === "true",
    maxScenes: parsed.PLATEAU_MAX_SCENES,
    sceneTtlMs: parsed.PLATEAU_SCENE_TTL_MS,
    dataMode: parsed.PLATEAU_DATA_MODE,
    pythonBin: parsed.PLATEAU_PYTHON_BIN,
    subprocessScript: parsed.PLATEAU_SUBPROCESS_SCRIPT
      ? path.resolve(parsed.PLATEAU_SUBPROCESS_SCRIPT)
      : undefined,
    officialPlateauMcpUrl: parsed.OFFICIAL_PLATEAU_MCP_URL,
    upstreamEnabled:
      parsed.PLATEAU_UPSTREAM_ENABLED === "true" || !!parsed.OFFICIAL_PLATEAU_MCP_URL,
    osmOverpassUrl: parsed.OSM_OVERPASS_URL,
    osmOverpassTimeoutMs: parsed.OSM_OVERPASS_TIMEOUT_MS,
  };
}
