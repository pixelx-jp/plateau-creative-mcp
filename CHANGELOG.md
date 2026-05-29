# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

First public release.

### Added

- **10 MCP tools**: `download_area`, `load_area`, `filter_buildings`,
  `delete_buildings`, `extrude_buildings`, `compose_scene`, `export_glb`,
  `link_buildings_to_pois`, `get_attribution`, `render_via_blender`.
- **Lazy artifact download** — `download_area` resolves a city slug against the
  public [`plateau-bridge`](https://github.com/pixelx-jp/plateau-bridge) cache
  index, downloads the prebuilt `.tar.zst` bundle, verifies its sha256, and
  extracts `buildings.parquet` + `manifest.json` into a local cache. Works with
  no configuration; set `PLATEAU_AUTO_DOWNLOAD=true` to have `load_area`
  auto-fetch a missing city. No data-pipeline clone required.
- **Geometry export** — `single_glb` (polygon footprint extrusion via DuckDB
  `spatial`, with a box fallback, mesh merging, and a sidecar identity index;
  ~40% gltf-transform compression) bounded to ≤ 1 km² and ≤ 5000 buildings, and
  a `scene_manifest` mode that references 3D Tiles for larger areas. Downloaded
  cities ship without 3D Tiles, so `scene_manifest` returns a tile-less manifest
  (edits + bbox + attribution) plus a `tileset_note` guiding the user.
- **Three data-access modes** — TS + duckdb artifact reader, Python subprocess
  helper, and an upstream MCP-over-JSON-RPC client.
- **Upstream proxy** — `PLATEAU_UPSTREAM_ENABLED=true` registers 13 `plateau_*`
  tools from the official Project PLATEAU MCP (combined 23-tool catalog).
- **Overpass POI linking** via `link_buildings_to_pois` (`OSM_OVERPASS_URL`).
- **Cross-MCP bridge** — `render_via_blender` can hand off to a
  BlenderMCP-compatible HTTP MCP server (allowlist-gated; dry-run returns the
  suggested call sequence).
- Attribution is wrapped at the executor level — every tool result carries
  `attribution_metadata`, and `export_glb` writes attribution into the GLB and a
  sibling `LICENSE.txt`.

[0.1.0]: https://github.com/pixelx-jp/plateau-creative-mcp/releases/tag/v0.1.0
