import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexTileset } from "../../src/export/TilesetIndexer.js";

const D2R = Math.PI / 180;

function radRegion(w: number, s: number, e: number, n: number, minH = 0, maxH = 50): number[] {
  return [w * D2R, s * D2R, e * D2R, n * D2R, minH, maxH];
}

describe("indexTileset", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tileset-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns null when tileset.json does not exist", async () => {
    expect(await indexTileset(path.join(dir, "missing.json"), [0, 0, 1, 1])).toBeNull();
  });

  it("walks children and returns only tiles intersecting the scene bbox", async () => {
    const tileset = {
      root: {
        boundingVolume: { region: radRegion(0, 0, 10, 10) },
        children: [
          {
            boundingVolume: { region: radRegion(0, 0, 2, 2) },
            content: { uri: "L0/inside.b3dm" },
          },
          {
            boundingVolume: { region: radRegion(8, 8, 10, 10) },
            content: { uri: "L0/outside.b3dm" },
          },
          {
            boundingVolume: { region: radRegion(0, 0, 1, 1) },
            children: [
              {
                boundingVolume: { region: radRegion(0.5, 0.5, 1, 1) },
                content: { uri: "L1/nested.b3dm" },
              },
            ],
          },
        ],
      },
    };
    const fp = path.join(dir, "tileset.json");
    await fs.writeFile(fp, JSON.stringify(tileset));

    const idx = await indexTileset(fp, [0, 0, 3, 3]);
    expect(idx).not.toBeNull();
    const uris = idx!.tiles.map((t) => t.uri).sort();
    expect(uris).toEqual(["L0/inside.b3dm", "L1/nested.b3dm"]);
    expect(idx!.bbox).toEqual([0, 0, 10, 10]);
  });
});
