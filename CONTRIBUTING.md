# Contributing

Thanks for your interest in `@yodolabs/plateau-creative-mcp`. This server exposes Project
PLATEAU 3D city data as scene-editing and glTF export tools over the Model
Context Protocol.

## Development setup

Requires Node.js ≥ 20.

```bash
git clone https://github.com/pixelx-jp/plateau-creative-mcp
cd plateau-creative-mcp
npm install
npm run build
```

To run the server against real city data without an MCP client, either let it
download a city on demand (default) or point at a local checkout:

```bash
# Zero-setup: download_area / PLATEAU_AUTO_DOWNLOAD fetch from the public index.
npx tsx scripts/smoke-load-area.ts

# Or use your own plateau-bridge outputs:
PLATEAU_ARTIFACT_DIR=../plateau-bridge npx tsx scripts/smoke-load-area.ts
```

## Checks (run before opening a PR)

```bash
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest
```

All three must pass. `npm run lint:fix` and `npm run format` apply Biome's
autofixes. CI runs the same gates.

## Conventions

- **TypeScript, ESM.** Match the style of the surrounding code; Biome enforces
  formatting and lint rules (`biome.json`).
- **Tools** live in `src/tools/`, each with a Zod schema in `src/schemas/` and a
  name registered in `src/server/toolNames.ts`. The executor
  (`src/server/toolEnvelope.ts`) wraps every result with attribution and rate
  limiting — handlers return `{ result, attribution }` and never bypass it.
- **`scene_id`** is the only shared state; **`building_uid`** is the single
  canonical building reference (no `gml_id` / batch-index alternates).
- **Data layout** is owned by [`plateau-bridge`](https://github.com/pixelx-jp/plateau-bridge),
  the producer of `out_<city>/`. This repo only *consumes* artifacts — packaging
  and release of city bundles happen there, not here.
- Add or update tests under `tests/` for any behavior change. Prefer fast unit
  tests with stubbed I/O (see `tests/unit/artifactDownloader.test.ts` for the
  fetch-stub pattern).

## Attribution & licensing

The code is MIT. PLATEAU data is © Project PLATEAU / MLIT under CC BY 4.0; OSM
POIs are ODbL 1.0. Keep attribution intact in any change that touches export or
the attribution layer — exports must always carry it.

## Reporting issues

Open a GitHub issue with the tool name, the input you sent, the full error
payload (it includes a stable error code), and your environment (`node -v`,
data mode). Security-sensitive reports: please disclose privately first.
