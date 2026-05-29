export const TOOL_NAMES = [
  "download_area",
  "load_area",
  "filter_buildings",
  "delete_buildings",
  "extrude_buildings",
  "compose_scene",
  "export_glb",
  "link_buildings_to_pois",
  "get_attribution",
  "render_via_blender",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
