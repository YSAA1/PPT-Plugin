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
  -> deck-protocol.json
  -> user review
  -> one PNG per slide
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
      "output_png": "dist/slides/slide-03.png"
    }
  ]
}
```

Do not put raw image paths in `content_inputs`. Put files in `assets`, then reference their ids from pages.

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

## Installation

Requirements:

- Node.js 20+
- Codex with plugin support
- Optional MinerU token for higher-quality document parsing

Install dependencies:

```bash
cd plugins/ppt-composer
npm install
```

Register `plugins/ppt-composer` in your Codex plugin directory or marketplace configuration.

Plugin manifest:

```text
plugins/ppt-composer/.codex-plugin/plugin.json
```

MCP config:

```text
plugins/ppt-composer/.mcp.json
```

## Optional Environment

```bash
cp plugins/ppt-composer/.env.example plugins/ppt-composer/.env
```

```bash
MINERU_API_TOKEN=
OPENAI_API_KEY=
```

Notes:

- `MINERU_API_TOKEN` enables MinerU Precision parsing.
- `OPENAI_API_KEY` is only needed for an explicit OpenAI Images API fallback.
- Codex built-in `$imagegen` does not require a local `OPENAI_API_KEY`.
- Never commit `.env`, real tokens, or private wrappers.

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
3. `deck-protocol.json` is created.
4. You confirm or edit the protocol.
5. Codex generates one PNG per page.
6. The PPTX is assembled after all PNGs exist.

## Quality Rules

PPT Composer rejects:

- prompt-only output;
- background-only images;
- SVG or HTML screenshots as final slides;
- placeholders;
- PPTX assembly before every PNG exists;
- altered figures, numbers, logos, or table headers in `strict_embed` pages.

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
├── assets/
│   └── ppt-composer-logo.svg
└── plugins/
    └── ppt-composer/
        ├── .codex-plugin/plugin.json
        ├── .mcp.json
        ├── package.json
        ├── scripts/
        ├── skills/image-first-ppt/
        ├── src/
        └── tests/
```
