# Cyberpunk Shibuya — the launch-video workflow

This is the workflow you see in the 60-second demo. It uses two MCP servers: `plateau-creative` for the city data + edits + export, and `blender-mcp` for the shader / render side. Both run as stdio servers from Claude Desktop.

## Prerequisites

- Claude Desktop ≥ 0.7 with both servers registered (see [`claude-desktop-config.jsonc`](./claude-desktop-config.jsonc)).
- `plateau-bridge` has produced `out_shibuya/buildings.parquet` (Gate A→B run).
- Blender 4.2 with the Blender MCP add-on installed and listening (default port).

## The single prompt

Paste this whole block into Claude:

```
You have access to plateau-creative and blender-mcp.

Goal: deliver a 1080p Eevee render of Shibuya at dusk with a cyberpunk neon look — but only show me buildings taller than 30 m.

Use plateau-creative for everything city-related, then hand off to blender-mcp for the shader and render. After each step print one short line so I can follow along.

Recipe:
1. plateau-creative.load_area
   city: "shibuya"
   bbox: [139.6975, 35.6555, 139.7045, 35.6605]
   lod: 2

2. plateau-creative.filter_buildings on the new scene_id
   filter: {height_max: 30}
   (this finds the small buildings)

3. plateau-creative.delete_buildings on the scene_id, passing those building_uids.

4. plateau-creative.compose_scene
   scene_id: <from step 1>
   time: "18:30"
   weather: "rain"

5. plateau-creative.export_glb
   scene_id: <from step 1>
   mode: "single_glb"
   options: {compress: true, output_name: "shibuya_skyline"}

   Surface BOTH file_path AND attribution_metadata to me. Then keep the file_path for step 6.

6. blender-mcp.import the file_path from step 5. Then:
   - apply an emissive Principled BSDF; hue cycles along world Y so taller buildings glow pink → cyan
   - set world background HDR to a dusk Tokyo HDRI, intensity 0.3
   - add volumetric fog density 0.02, anisotropy 0.4
   - place a camera 300 m south of the bbox centroid, height 80 m, looking at origin
   - render Eevee Next, 1920x1080, 32 samples, output ./out/shibuya_cyberpunk.png

7. Tell me where the PNG ended up and remind me of the CC BY 4.0 attribution from step 5.
```

## What to look for in Claude's transcript

- Step 1's response should include `summary.building_count` ~ 4xxx for that bbox and `available_attributes` containing `footprint_polygon` (= DuckDB spatial extension loaded successfully).
- Step 5's response should include `stats.merged: true`, `stats.compressed: true`, a non-zero `pre_compress_bytes`, a path ending in `shibuya_skyline.glb`, **and** a `<...>.buildings.json` sidecar path.
- Step 6 should never re-fetch any city data on its own — every PLATEAU call must go through `plateau-creative`.

## What goes wrong, and what to expect

| Symptom | Cause | Fix |
|---|---|---|
| `EXPORT_LIMIT_EXCEEDED` after deleting | The remaining building set is still > 5000 or bbox > 1 km² | Reduce bbox, or switch to `mode: "scene_manifest"` — the error payload says `suggested_mode: "scene_manifest"` |
| Step 5 stats show `merged: false` | Three.js merge fell back per-building (rare) | Still works, just larger GLB; report and continue |
| `EXPORT_GLTF_FAILED: FileReader is not defined` | Old Node, `nodePolyfills.ts` not loaded | Upgrade Node to 20+ |
| BlenderMCP imports but every building is the same height | You imported the GLB but ignored the sidecar; that's fine for the cinematic shot, but per-building edits won't work without it | Use `<basename>.buildings.json` if you need per-uid selection |

## Why this works as a viral demo

- Two MCP servers, one prompt, one Claude session — the whole "agent orchestrates DCC pipeline" pitch in 60 seconds.
- Real PLATEAU LOD2 geometry, not procedural cubes. Attribution travels end-to-end and is shown to the viewer.
- Cyberpunk is recognisable in 5 seconds; rain + neon + dusk reads instantly.
- Open data + open source + open protocol. Anyone can re-run it tonight.
