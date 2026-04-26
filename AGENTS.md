# PPT Composer Agent Guide

## Project Shape

This repository publishes the `PPT Composer` Codex plugin.

The public user-facing entry point is one skill:

```text
ppt-composer:image-first-ppt
```

Keep workflow complexity inside the plugin, protocol files, scripts, and MCP
tools. Do not add extra public skills unless the product direction changes.

## Build and Test

Most code lives under `plugins/ppt-composer`.

For normal verification, run:

```bash
cd plugins/ppt-composer
npm install
npm run test:enhancement
```

For CI or clean environments, prefer:

```bash
cd plugins/ppt-composer
npm ci
npm run test:enhancement
```

## Release Rules

- Keep `.agents/plugins/marketplace.json` tracked; it is the Codex plugin
  marketplace entry.
- Keep `plugins/ppt-composer/.codex-plugin/plugin.json` as the plugin manifest.
- Keep `plugins/ppt-composer/.mcp.json` portable. Do not hardcode local absolute
  paths such as `/home/...`.
- The plugin must remain installable through Codex plugin marketplace flow:
  `codex plugin marketplace add YSAA1/PPT-Plugin`, then `/plugins`.
- `plan_next.md`, `.omx/`, `.codex`, `node_modules/`, generated decks, and
  runtime outputs should remain untracked unless explicitly promoted to release
  examples.

## Review Guidelines

- Treat Codex plugin installation failures as high-priority issues.
- Treat MCP startup failures as high-priority issues.
- Verify that image-first PPTX assembly still requires a complete PNG manifest.
- Verify every final image-first PPTX slide remains one full-slide PNG, with no
  later PowerPoint text overlays.
- In `strict_embed` flows, do not alter referenced numbers, curves, table
  headers, logos, or captions.
- Prefer small, reversible changes over broad rewrites.

## Documentation Rules

- Keep `README.md` and `README.zh-CN.md` aligned when changing user-facing
  install, usage, or release instructions.
- Use release-user language in README files, not internal migration notes.
- If setup or install behavior changes, update both README files and this
  guide.
