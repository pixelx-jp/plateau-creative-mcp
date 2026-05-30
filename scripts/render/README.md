# GLB → PNG render tool

Turns a `.glb` exported by this server into a still image — used for the
README hero and docs. It's a dev tool, not part of the published package.

The 3D city hero at the top of the README was produced this way.

## Usage

```bash
npm install                      # pulls in the `playwright` devDependency
npx playwright install chromium  # one-time: fetch the headless browser

# 1. produce a GLB (any of these writes to ./out)
npm run smoke:export             # exports a sample Shibuya scene
# or call download_area + export_glb from an MCP client

# 2. render it
npm run render:glb -- --glb out/<scene>.glb --out docs/assets/hero-shibuya.png
```

## How it works

`scripts/render-glb.ts` starts a throwaway static server (exposing only the
viewer, the local `three` build, and your GLB), opens
[`viewer.html`](./viewer.html) in headless Chromium via Playwright, and
screenshots the canvas. `viewer.html` loads the GLB with three.js, unifies
the building material, frames the bounding sphere from an oblique aerial
angle, and lays down a faint scene grid.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--glb <path>` | — | GLB to render (required) |
| `--out <path>` | — | output PNG (required) |
| `--style <name>` | `tech` | `tech` (dark) or `day` (light) |
| `--width <px>` | `1600` | viewport width (rendered @2x) |
| `--height <px>` | `760` | viewport height |
| `--fit <n>` | `0.56` | framing; `<1` zooms in, `>1` zooms out |
| `--azim <deg>` | `45` | camera azimuth |
| `--elev <deg>` | `33` | camera elevation |

```bash
# a brighter, light-theme variant zoomed out a little
npm run render:glb -- --glb out/scene.glb --out shot.png --style day --fit 0.8 --elev 45
```

The PLATEAU **CC BY 4.0** attribution is burned into the bottom-left of every
render — keep it intact when republishing.
