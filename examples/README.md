# Examples

End-to-end recipes that show how to drive `@yodolabs/plateau-creative-mcp` from real LLM clients and how to hand its output to other MCP servers.

| File | What it shows |
|---|---|
| [`claude-prompts.md`](./claude-prompts.md) | Copy-paste prompts for Claude Desktop covering the three flagship workflows. |
| [`cursor-rules.md`](./cursor-rules.md) | A `.cursorrules` snippet that teaches Cursor to use this server correctly (and the limits it has to respect). |
| [`cyberpunk-shibuya.md`](./cyberpunk-shibuya.md) | Full reproducible walkthrough of the launch-video workflow: Creative MCP → BlenderMCP. |
| [`blender-mcp-handoff.py`](./blender-mcp-handoff.py) | A Blender Python snippet equivalent to what BlenderMCP runs to import the GLB and recover per-building identity from the sidecar. |
| [`claude-desktop-config.jsonc`](./claude-desktop-config.jsonc) | Minimal Claude Desktop `mcpServers` config registering this server alongside BlenderMCP. |

All examples assume the `@yodolabs/plateau-creative-mcp` server is reachable at the path / npx alias and that `PLATEAU_ARTIFACT_DIR` points at a directory holding `out_<city>/` outputs produced by [`plateau-bridge`](https://github.com/pixelx-jp/plateau-bridge).
