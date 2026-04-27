# MCP Setup

This plugin exposes MCP servers as implementation tools for the single public
`image-first-ppt` skill.

## `mineru-open-mcp`

`mineru-open-mcp` is the official MinerU Open MCP server. It can run in two
modes:

- Flash mode: no token, lower limits, Markdown-only.
- Precision mode: requires `MINERU_API_TOKEN`, supports higher limits and richer
  parsing.

The publishable plugin config uses the Node launcher
`scripts/run-mineru-open-mcp.mjs`, which calls `uvx` and forwards
`MINERU_API_TOKEN` from the user's environment. The launcher then runs
`scripts/mineru-open-mcp-with-images.py`, which keeps the official
`mineru-open-mcp` server but patches the MCP response boundary so extracted
images are saved locally and returned as `image_paths`.

```json
{
  "command": "node",
  "args": [
    "./scripts/run-mineru-open-mcp.mjs"
  ],
  "cwd": ".",
  "env": {
    "FASTMCP_CHECK_FOR_UPDATES": "off",
    "FASTMCP_SHOW_SERVER_BANNER": "false"
  },
  "env_vars": ["MINERU_API_TOKEN"]
}
```

Do not commit real tokens. For local private setup, put the token in a private
shell/env file and make sure Codex inherits it before starting the MCP server.

Why the wrapper exists:

- The MinerU SDK parses result zips into `ExtractResult.images`.
- Upstream `mineru-open-mcp` 1.0.21 writes only Markdown in its MCP result entry.
- Upstream formatting also strips `zip_url` before returning the response.
- This plugin wrapper saves images under `<output_dir>/<stem>/images/`, returns
  `image_paths`, and keeps `zip_url` available for callers that need the full
  MinerU result bundle.

Recommended Precision API defaults for PPT reference parsing:

- `model_version: "vlm"` for PDF, Office, and image documents.
- `enable_formula: true` when formulas matter.
- `enable_table: true` when tables matter.
- `language: "ch"` or `"en"` when known.
- `extra_formats: ["html"]` only when HTML structure is useful downstream.
- Use `page_ranges` when the user only needs part of a document.

Cold `uvx` startup can download or create an environment before the MCP server
is ready. After plugin install or update, run this from the installed plugin
root when MinerU parsing is needed:

```bash
npm run prewarm:mineru
```

## `ppt-render-mcp`

Local MCP server implemented by this plugin:

```json
{
  "command": "node",
  "args": ["./src/ppt-render-mcp.mjs"]
}
```

Core tools:

- `parse_paper_local`
- `visual_plan`
- `assemble_image_ppt`
- `qa_pptx`

Helper tools remain internal. The public workflow is still the
`image-first-ppt` skill.

Node dependencies are automatically installed once if the installed plugin cache
is missing runtime dependencies. The wrapper pipes `npm install` output to
stderr so it does not corrupt the MCP stdio channel. For slow networks or
explicit setup, prewarm them before starting Codex:

```bash
npm run prewarm
```

## Publishing Notes

The repository version of `.mcp.json` must stay generic:

- no absolute user paths
- no wrapper paths under `/home/<user>`
- no real tokens
- no local cache paths

Users can override MCP configuration locally after installation if their client
does not inherit environment variables cleanly.
