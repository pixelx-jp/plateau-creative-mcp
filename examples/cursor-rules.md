# Cursor `.cursorrules` snippet

Paste the block below into your project's `.cursorrules` so Cursor's agent uses `plateau-creative` correctly.

```text
# When you have access to the `plateau-creative` MCP server, use it like this:

## Mental model
- The server holds an in-memory scene per scene_id. Every mutate or export call must reference that scene_id.
- Building references use `building_uid` (opaque string). NEVER invent a uid from prompt text — only use uids returned by `filter_buildings` or `load_area`.
- Every tool response is `{result, attribution_metadata}`. Always include the attribution_metadata when summarising for the user; it is CC BY 4.0 (PLATEAU) + ODbL (OSM POIs).

## Tool ordering
1. `load_area(city, bbox, lod)` → scene_id + version 1.
2. `filter_buildings(scene_id, filter)` → building_uid[]. Read-only.
3. Optional edits: `delete_buildings`, `extrude_buildings(factor 0.1..10)`, `compose_scene`. Each bumps `version`.
4. `export_glb(scene_id, mode)`. Mode `single_glb` is capped at 1 km² and 5000 buildings; if you hit `EXPORT_LIMIT_EXCEEDED`, switch to `scene_manifest` instead of retrying.
5. `link_buildings_to_pois(scene_id)` requires OSM_OVERPASS_URL to be configured server-side; if it returns an empty links map with a "no POI source configured" note, do not retry — tell the user to set the env var.

## Don'ts
- Don't try to use deleted building uids in subsequent calls.
- Don't ignore `EXPORT_LIMIT_EXCEEDED.details.suggested_mode` — it always tells you the next move.
- Don't send a `factor` outside 0.1..10 to `extrude_buildings`; you'll get `INVALID_INPUT`.
- Don't strip `attribution_metadata` from any response you relay to the user.

## When the user asks "render this in Blender / Unity / Unreal"
- Call `export_glb` on this server first, get the file_path.
- Then hand the file_path to the other MCP server (BlenderMCP / UnityMCP / UnrealMCP). Don't try to do the rendering yourself.

## Sidecar
- A `single_glb` export also writes `<basename>.buildings.json` with `ranges[building_uid] = [{triangle_start, triangle_count}]`. If the user wants to highlight or re-edit individual buildings post-import, that's the file to read.
```
