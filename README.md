# PPT Composer

<p align="center">
  <img src="assets/ppt-composer-logo.svg" alt="PPT Composer" width="118">
</p>

<p align="center">
  <strong>Generate presentation-ready PowerPoint decks with one finished image per slide.</strong>
</p>

<p align="center">
  English | <a href="README.zh-CN.md">中文</a>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-release%20ready-2563EB">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-339933">
  <img alt="codex plugin" src="https://img.shields.io/badge/Codex-plugin-7C3AED">
  <img alt="slides" src="https://img.shields.io/badge/slides-one%20PNG%20per%20page-111827">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-black">
</p>

PPT Composer is a Codex plugin that turns briefs and reference files into polished PowerPoint decks. It creates a reviewable protocol first, generates one complete image per slide, and assembles those images into a `.pptx`.

It is built for users who want a clean final deck, not a folder of prompts, placeholders, or half-finished slide backgrounds.

<p align="center">
  <img src="assets/ppt-composer-system-overview.png" alt="PPT Composer system overview">
</p>

## New User Guide

If the protocol and QA rules feel abstract, start here:

- [Chinese user guide](docs/user_guid/README.md) explains the rules with diagrams.
- [Current use cases](docs/user_guid/current-use-cases.zh-CN.md) shows practical prompts for papers, reports, reference images, strict figure pages, and page-by-page revision.

<p align="center">
  <img src="docs/user_guid/images/workflow-overview.png" alt="PPT Composer user workflow">
</p>

## Who It Is For

Use PPT Composer when you want to:

- turn a paper, PDF, report, Markdown file, image, or table into a presentation;
- make a visually consistent research, project, product, or consulting-style deck;
- review the deck plan before image generation starts;
- export a PowerPoint file that is ready to open, present, and share.

The public entry point is:

```text
ppt-composer:image-first-ppt
```

## How It Works

```text
brief and references
  -> reference-assets/asset-index.json
  -> deck-protocol.json
  -> deck-protocol.review.md
  -> protocol patch tools
  -> imagegen job manifest
  -> deterministic QA and visual review
  -> complete PNG manifest
  -> PPTX
```

The final PPTX contains one full-slide PNG per page. Slide text, titles, charts, labels, logos, and layout are all inside that image. PPT Composer does not generate a background first and add PowerPoint text later.

## The Protocol File

`deck-protocol.json` is the source of truth before generation. It defines:

- deck title, language, audience, page count, and aspect ratio;
- global visual style;
- reference assets;
- page titles and claims;
- evidence bindings;
- per-page image prompts;
- default presenter notes;
- output PNG paths.

Pages reference assets by id:

```json
{
  "assets": [
    {
      "id": "fig-1",
      "type": "source_image",
      "path": "reference-assets/fig-1.png",
      "caption": "Main result figure"
    }
  ],
  "pages": [
    {
      "page": 3,
      "title": "Main Result",
      "claim": "The method improves sim-to-real transfer under heavy load.",
      "content_inputs": {
        "text": ["txt-2"],
        "tables": [],
        "images": ["fig-1"]
      },
      "reference_asset_ids": ["fig-1"],
      "fidelity": "strict_embed",
      "speaker_notes": "Explain the transfer result and call out the heavy-load condition.",
      "output_png": "dist/slides/slide-03.png"
    }
  ]
}
```

Do not put raw image paths in `content_inputs`. Put files in `assets`, then reference their ids from pages.
If reference files were provided, the protocol is not ready for confirmation until extracted/localized assets appear in `assets` and at least one reference-grounded page binds those asset ids.
Use `speaker_notes` for presenter notes. Generated protocols include presenter notes by default: they should be audience-specific talk tracks for how to explain the page, not one-line labels. Notes are carried into PowerPoint speaker notes and are not rendered as visible slide text. Existing protocols using `notes`, `remarks`, `presenter_notes`, or `备注` are accepted as aliases.

Deck visuals also use one consistent page-number/footer policy. Internal metadata such as asset ids, filenames, file paths, `source:` labels, and protocol/parser field names must not appear as visible slide text.

PPT Composer keeps protocol edits and generation state in internal files:

| File | Purpose |
| --- | --- |
| `reference-assets/asset-index.json` | Localized reference files and URLs with stable ids, hash, MIME, size, caption, and usage. |
| `deck-protocol.review.md` | Human-readable review copy of the protocol: validation status, source inputs, assets, page claims, bindings, fidelity modes, and output paths. |
| `imagegen-jobs.json` | Per-page generation state. `deck-protocol.json` remains the content source of truth. |
| `visual-qa.json` | PNG checks plus visual review findings. It records missing/tiny/placeholder PNGs, consistency issues, protocol drift, and basic generated-image problems. |
| `png-manifest.json` | Final assembly gate. It exists only after every planned page has a real generated PNG. |

### Revising The Protocol

You normally revise the protocol by telling Codex what to change in plain language. You do not need to memorize CLI commands.

Example user requests:

```text
Change page 6 to strict_embed and bind it to fig-3.
```

```text
Rename page 3 to "Core Experiment Result" and make the claim focus on sample efficiency.
```

```text
Use logo-1 on every page, but keep page 2 free_generation.
```

Codex converts those requests into validated protocol patch operations. Internally it uses tools such as:

```bash
ppt-composer protocol-bind-asset --protocol output/deck-protocol.json --page 6 --asset-id fig-3
ppt-composer protocol-set-fidelity --protocol output/deck-protocol.json --page 6 --fidelity strict_embed
ppt-composer protocol-update-page --protocol output/deck-protocol.json --page 3 --patch '{"title":"Core Experiment Result"}'
```

Each patch is checked before it is saved. The tool rejects unknown pages, unknown asset ids, duplicate asset ids, and illegal fidelity values. It also pretty-prints `deck-protocol.json`, keeps the protocol valid, and records an `audit_log`.

Manual JSON editing is possible, but the recommended workflow is: describe the revision to Codex, let Codex patch the protocol, then review the updated protocol summary before image generation.

### Fidelity Modes

| Mode | Meaning |
| --- | --- |
| `free` | Generate from the approved brief and style. |
| `light_redraw` | Redraw and restyle while preserving facts, trends, and key numbers. |
| `strict_embed` | Keep referenced figures, logos, table headers, values, and captions as visual evidence. |

## Supported References

| Input | Use |
| --- | --- |
| PDF | Papers and reports, preferably through MinerU |
| Markdown | Outlines and notes |
| DOCX | Word documents |
| TXT | Plain-text briefs |
| PNG/JPG/WebP | Figures, logos, and style references |
| CSV/TSV | Tables and numeric evidence |

## Examples

The repository includes two generated PowerPoint examples:

| Example | Description |
| --- | --- |
| [halo-academic-tsinghua.pptx](plugins/ppt-composer/examples/decks/halo-academic-tsinghua.pptx) | A Chinese academic research report deck with a Tsinghua-style visual direction. |
| [codex-introduction.pptx](plugins/ppt-composer/examples/decks/codex-introduction.pptx) | A Codex introduction deck generated as an image-first PPTX. |

## Installation

Requirements:

- Node.js 20+
- Codex with plugin support
- `uv/uvx` if you want MinerU-backed PDF, Office, or image parsing
- Optional MinerU token for higher-quality document parsing

### Install from GitHub

```bash
codex plugin marketplace add YSAA1/PPT-Plugin
```

Then open Codex and install the plugin from the plugin browser:

```text
/plugins
```

Choose the `PPT Composer` marketplace entry and select `Install plugin`.

After installing, start a new Codex thread so bundled skills and MCP servers are loaded. If the plugin browser or an older Codex session was already open, restart Codex before testing the plugin.

### Install from a local clone

```bash
git clone https://github.com/YSAA1/PPT-Plugin.git
cd PPT-Plugin
codex plugin marketplace add .
```

Then run:

```text
/plugins
```

Open `PPT Composer` and select `Install plugin`.

After installing, start a new Codex thread so bundled skills and MCP servers are loaded. If the plugin browser or an older Codex session was already open, restart Codex before testing the plugin.

PPT Composer bundles its skill and MCP server configuration as a Codex plugin. On first MCP startup, the Node MCP wrapper automatically installs missing runtime npm dependencies inside the installed plugin cache. Install logs are written to stderr so they do not pollute the MCP stdio protocol channel.

PPT Composer registers two MCP servers:

- `ppt-render-mcp`: core PPT rendering, manifest validation, assembly, and QA. This server requires Node.js and the npm runtime dependencies.
- `mineru-open-mcp`: document parsing through MinerU. This server requires `uv/uvx`. If `uvx` is missing, it stays discoverable as a setup-help MCP server and its tools return `setup_required: true` with the commands to run.

### Dependency Prewarm

Prewarm means preparing the plugin's local runtime dependencies after install or update, before Codex starts the MCP servers. It is optional for most users, because the Node wrapper auto-installs missing npm dependencies once. It is useful when a slow network makes first MCP startup time out, or when you want to warm MinerU's `uvx` environment before using document parsing.

If you are developing from a clone, or if first MCP startup reports missing dependencies, run:

```bash
cd plugins/ppt-composer
npm run prewarm
```

If you installed the plugin through Codex and the MCP error prints an installed plugin path, run the same command in that printed plugin root:

```bash
cd <installed-plugin-root>
npm run prewarm
```

If you will use MinerU parsing, also warm the `uvx` MinerU environment:

```bash
npm run prewarm:mineru
```

After prewarming, restart Codex so it starts MCP servers from the warm dependency cache.

The MCP startup wrappers are cross-platform Node scripts. On Windows they call `npm.cmd` / `uvx.cmd` and the plugin parses DOCX/PPTX with JSZip instead of requiring a system `unzip` command.

If MCP appears unavailable after install:

1. Start a new Codex thread or restart Codex.
2. Check whether `ppt-render-mcp` is available; this is the core server for PPTX assembly and QA.
3. If `mineru-open-mcp` reports `setup_required: true`, install `uv/uvx`, run `npm run prewarm:mineru` from the installed plugin root, then restart Codex.
4. If dependency installation timed out, run `npm run prewarm` from the installed plugin root, then restart Codex.

Plugin manifest:

```text
plugins/ppt-composer/.codex-plugin/plugin.json
```

MCP config:

```text
plugins/ppt-composer/.mcp.json
```

## Optional Environment

Environment variables are optional. They are only needed for higher-quality MinerU parsing or an explicit OpenAI Images API fallback.

Supported configuration methods, from highest to lowest priority:

1. System or shell environment variables inherited by Codex.
2. A custom env file pointed to by `PPT_COMPOSER_ENV_FILE`.
3. `.env` in the local repository root, useful when developing from a clone.
4. `plugins/ppt-composer/.env`, useful inside the plugin package or installed plugin cache.

Existing system or shell variables are never overwritten by `.env` files.

Linux/macOS shell example:

```bash
export MINERU_API_TOKEN="..."
export OPENAI_API_KEY="..."
```

Windows PowerShell example:

```powershell
$env:MINERU_API_TOKEN="..."
$env:OPENAI_API_KEY="..."
```

Plugin-local `.env` example:

```bash
cp plugins/ppt-composer/.env.example plugins/ppt-composer/.env
```

Then edit the new `.env` file:

```bash
MINERU_API_TOKEN=...
OPENAI_API_KEY=...
```

To keep secrets outside the repository, point the plugin at a private env file:

```bash
export PPT_COMPOSER_ENV_FILE="$HOME/.config/ppt-composer/env"
```

Notes:

- `MINERU_API_TOKEN` enables MinerU Precision parsing.
- `OPENAI_API_KEY` is only needed for an explicit OpenAI Images API fallback.
- Codex built-in `$imagegen` does not require a local `OPENAI_API_KEY`.

## Usage

Ask Codex:

```text
Use ppt-composer:image-first-ppt.
Create a 10-page research presentation from reference/paper.pdf and reference/logo.png.
Style: polished academic consulting, 16:9, Chinese main language with bilingual key headings.
Every slide must be one complete PNG. Do not add PowerPoint text overlays.
Output to output/report.pptx.
```

Expected flow:

1. Codex asks for missing requirements.
2. References are parsed.
3. Localized assets are written to `reference-assets/asset-index.json`.
4. `deck-protocol.json` and `deck-protocol.review.md` are created.
5. You review the protocol review file and ask for revisions in plain language if needed.
6. Codex applies validated protocol patches and updates the review file.
7. You explicitly confirm the protocol.
8. Codex creates `imagegen-jobs.json`; 7+ page decks use bounded image-generation subagents before any direct-generation fallback.
9. Codex generates one PNG per page.
10. Deterministic QA and visual review run. Multi-page decks should use a bounded vision/reviewer subagent for review.
11. Failed pages are revised page by page. The protocol is patched first when prompt or fidelity rules need to change.
12. A complete PNG manifest is created only after every required page is generated, or accepted when visual review is enabled.
13. The PPTX is assembled after all PNGs pass the gate.

## Quality Rules

PPT Composer rejects:

- prompt-only output;
- background-only images;
- SVG or HTML screenshots as final slides;
- placeholders;
- PPTX assembly before every PNG exists;
- altered figures, numbers, logos, or table headers in `strict_embed` pages.
- visual-review failures such as inconsistent style, protocol drift, unreadable text, watermarking, malformed tables/logos, blank regions, or background-only output.

When only one page fails, PPT Composer should revise that page instead of regenerating the whole deck.

## Verify

```bash
cd plugins/ppt-composer
npm run test:enhancement
```

## Repository Layout

```text
PPT-Plugin/
├── README.md
├── README.zh-CN.md
├── .agents/plugins/marketplace.json
├── assets/
│   ├── ppt-composer-logo.svg
│   └── ppt-composer-system-overview.png
└── plugins/
    └── ppt-composer/
        ├── .codex-plugin/plugin.json
        ├── .mcp.json
        ├── assets/
        ├── examples/decks/
        ├── package.json
        ├── scripts/
        ├── skills/image-first-ppt/
        ├── src/
        └── tests/
```
