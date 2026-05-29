import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PlateauCoreSubprocessClient } from "../../src/data/PlateauCoreSubprocessClient.js";

const artifactRoot = path.resolve(__dirname, "../../../plateau-core");
const scriptPath = path.resolve(__dirname, "../../python/plateau_query.py");
const hasArtifacts = await fs
  .stat(path.join(artifactRoot, "out_shibuya", "buildings.parquet"))
  .then(() => true)
  .catch(() => false);

function pythonAvailable(): string | null {
  for (const bin of ["python3", "python"]) {
    try {
      execSync(`${bin} -c "import duckdb"`, { stdio: "ignore" });
      return bin;
    } catch {}
  }
  return null;
}

const pythonBin = hasArtifacts ? pythonAvailable() : null;
const maybe = pythonBin ? describe : describe.skip;

maybe("PlateauCoreSubprocessClient (gated on python+duckdb available)", () => {
  it("loads an area and queries buildings", async () => {
    const client = new PlateauCoreSubprocessClient({
      artifactRoot,
      pythonBin: pythonBin!,
      scriptPath,
    });
    const loaded = await client.loadArea({
      city: "shibuya",
      bbox: [139.6975, 35.6555, 139.7045, 35.6605],
      lod: 2,
    });
    expect(loaded.building_uids.length).toBeGreaterThan(0);
    expect(loaded.manifest.city_code).toBeDefined();

    const filtered = await client.queryBuildings(
      loaded.artifact_dir,
      [139.6975, 35.6555, 139.7045, 35.6605],
      { height_min: 30 },
    );
    expect(Array.isArray(filtered)).toBe(true);

    const sampleUids = loaded.building_uids.slice(0, 3);
    const rows = await client.getBuildingGeometry(loaded.artifact_dir, sampleUids);
    expect(rows).toHaveLength(sampleUids.length);
    expect(rows[0]!.centroid_lon).toBeGreaterThan(139);
  }, 60_000);

  it("surfaces FileNotFoundError as PLATEAU_CORE_ERROR", async () => {
    const client = new PlateauCoreSubprocessClient({
      artifactRoot: "/tmp/does-not-exist",
      pythonBin: pythonBin!,
      scriptPath,
    });
    await expect(
      client.loadArea({ city: "nowhere", bbox: [139, 35, 140, 36], lod: 2 }),
    ).rejects.toMatchObject({ code: "PLATEAU_CORE_ERROR" });
  });
});
