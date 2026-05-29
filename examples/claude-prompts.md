# Claude Desktop prompts

Drop the lines below into Claude as user messages. Each block assumes the server is registered as `plateau-creative` (see `claude-desktop-config.jsonc`).

## 1. Skyline edit ("Tokyo without skyscrapers")

```
Use the plateau-creative MCP server.

Step 1. load_area
  city: "shibuya"
  bbox: [139.6975, 35.6555, 139.7045, 35.6605]
  lod: 2

Step 2. With the scene_id from step 1:
  filter_buildings with filter {height_min: 100}
  delete_buildings with the building_uids returned

Step 3. export_glb mode "single_glb" with options {compress: true, output_name: "shibuya_no_skyscrapers"}.

Report the file_path and the attribution_metadata verbatim.
```

## 2. Flood-prone block survey

```
Use plateau-creative. I want to inspect Shibuya buildings that sit in flood-prone zones.

1. load_area city="shibuya" bbox=[139.6975, 35.6555, 139.7045, 35.6605] lod=2
2. filter_buildings with filter {flood_depth_min: 0.5} limit 200
3. get_attribution for the scene

Summarise the count, the highest flood depth in that result set, and the dataset list from the attribution. Do not invent numbers — only report what the tools returned.
```

## 3. Counterfactual office tower draft (cross-MCP)

```
Use plateau-creative and sketchup-mcp.

a. plateau-creative.load_area
   city: "shibuya"
   bbox: [139.6975, 35.6555, 139.7045, 35.6605]
   lod: 2
b. plateau-creative.filter_buildings
   filter: {zoning_use: ["commercial"], far_max_min: 400}
c. plateau-creative.delete_buildings with the building_uids from step b
d. plateau-creative.export_glb mode "single_glb" options {compress: true}
e. sketchup-mcp.import the resulting .glb, then sketch a single 200 m tower at the parcel centroid.

After each plateau-creative call, print the {scene_id, version, count_or_status} so I can follow along.
```

## House rules to put at the top of your system prompt

```
- plateau-creative tools always return {result, attribution_metadata}; never strip the attribution_metadata when relaying results to the user.
- A single_glb export is hard-capped at 1 km² bbox and 5000 buildings. If you see EXPORT_LIMIT_EXCEEDED, switch to mode "scene_manifest" instead of asking the user to retry.
- Building references must use building_uid as returned by filter_buildings. Never invent uids from prompt text.
- Every scene_id has a version. After delete/extrude/compose, propagate the new version into any subsequent expected_version field if the user asks for reproducible re-exports.
- The license is CC BY 4.0 (PLATEAU) and ODbL (OSM POIs). Remind the user to keep the attribution if they ship the .glb.
```
