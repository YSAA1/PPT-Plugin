# PPT Composer

<p align="center">
  <img src="assets/ppt-composer-logo.svg" alt="PPT Composer" width="118">
</p>

<p align="center">
  <strong>Generate presentation-ready PowerPoint decks with one finished image per slide.</strong>
</p>

<p align="center">
  <a href="#中文">中文</a> ·
  <a href="#english">English</a>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-release%20ready-2563EB">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-339933">
  <img alt="codex plugin" src="https://img.shields.io/badge/Codex-plugin-7C3AED">
  <img alt="slides" src="https://img.shields.io/badge/slides-one%20PNG%20per%20page-111827">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-black">
</p>

PPT Composer is a Codex plugin for making polished PowerPoint decks from a brief, paper, report, image, table, or other reference files. It plans the deck first, lets you review and edit the plan, generates each slide as a complete full-slide image, then assembles those images into a `.pptx`.

It is built for users who want a clean final deck, not a folder of prompts, placeholders, or half-finished slide backgrounds.

---

## 中文

### 它适合谁

PPT Composer 适合这些场景：

- 用论文、PDF、报告、Markdown、图片或表格生成汇报 PPT。
- 需要风格统一、视觉完整的科研/项目/产品/咨询风格 deck。
- 希望先确认大纲和每页内容，再开始生成图片。
- 希望最终 PPTX 可以直接打开、展示、转发。

当前公开入口只有一个：

```text
ppt-composer:image-first-ppt
```

### 它如何工作

PPT Composer 使用一个明确的协议文件来控制整套生成流程：

```text
需求和参考资料
  -> deck-protocol.json
  -> 你确认或修改
  -> 每页生成一张完整 PNG
  -> 组装成 PPTX
```

最终 PPTX 的每一页都只有一张完整的全页 PNG。标题、文字、图表、logo、标签和视觉结构都已经在图片里，不会再叠加 PowerPoint 文本框。

### 什么是 deck-protocol.json

`deck-protocol.json` 是生图前的主计划文件。它回答四个问题：

1. 这套 PPT 是什么主题、语言、受众和风格？
2. 可以使用哪些参考资料？
3. 每一页讲什么、引用哪些证据？
4. 每一页最终应该生成到哪个 PNG 文件？

一个简化例子：

```json
{
  "kind": "ppt-composer-deck-protocol",
  "version": "0.1",
  "mode": "reference_grounded_mode",
  "deck": {
    "title": "Research Report",
    "language": "zh",
    "audience": "research group",
    "page_count": 8,
    "aspect_ratio": "16:9"
  },
  "style": {
    "description": "高端学术汇报风格，白底，深紫和科技蓝强调色",
    "template_image_ids": [],
    "logo_ids": ["logo-1"],
    "palette": ["#4B2E83", "#2563EB", "#F8FAFC"],
    "typography": "Microsoft YaHei"
  },
  "assets": [
    {
      "id": "fig-1",
      "type": "source_image",
      "path": "reference-assets/fig-1.png",
      "source": "paper.pdf",
      "caption": "Main result figure",
      "usage": "evidence"
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
      "final_image_prompt": "Create a complete full-slide result page and embed fig-1 as the evidence block.",
      "negative_prompt": "Do not alter curves, labels, numbers, or captions.",
      "output_png": "dist/slides/slide-03.png"
    }
  ]
}
```

关键规则：

- `assets` 存放真实资料：文字证据、图片、logo、表格和模板图。
- `pages[].content_inputs` 只引用 asset id，不直接写图片路径。
- `reference_asset_ids` 表示这一页生成时必须查看的参考资产。
- `fidelity` 控制保真程度：
  - `free`: 按主题和风格自由生成。
  - `light_redraw`: 可以统一风格和重排，但必须保留事实和关键数值。
  - `strict_embed`: 图表、logo、表格尽量作为证据块嵌入，不能改数字、曲线、表头和图注。

你可以直接修改这个 JSON。确认后，Codex 才会开始生成图片。

### 支持的参考资料

| 输入 | 用途 |
| --- | --- |
| PDF | 论文、报告、说明书，优先通过 MinerU 解析 |
| Markdown | 大纲、笔记、已有文档 |
| DOCX | Word 文档、项目材料 |
| TXT | 纯文本 brief 或约束 |
| PNG/JPG/WebP | 参考图、logo、风格图 |
| CSV/TSV | 数据表，会生成表格参考图 |

### 安装

要求：

- Node.js 20+
- Codex with plugin support
- 可选：MinerU token，用于更高质量的 PDF/Office 解析

安装依赖：

```bash
cd plugins/ppt-composer
npm install
```

把 `plugins/ppt-composer` 注册到你的 Codex 插件目录或 marketplace 配置里。插件入口文件：

```text
plugins/ppt-composer/.codex-plugin/plugin.json
```

MCP 配置文件：

```text
plugins/ppt-composer/.mcp.json
```

### 可选环境变量

```bash
cp plugins/ppt-composer/.env.example plugins/ppt-composer/.env
```

```bash
MINERU_API_TOKEN=
OPENAI_API_KEY=
```

说明：

- `MINERU_API_TOKEN` 用于 MinerU 精准解析。
- `OPENAI_API_KEY` 只用于显式选择 OpenAI Images API fallback。
- Codex 内置 `$imagegen` 不依赖本地 `OPENAI_API_KEY`。

不要提交 `.env` 或任何真实 token。

### 使用方式

在 Codex 里这样说：

```text
使用 ppt-composer:image-first-ppt。
基于 reference/paper.pdf 和 reference/logo.png 生成一份 10 页中文科研汇报 PPT。
风格：高端学术汇报，16:9，中文主语言，中英双语关键标题。
每页必须是完整 PNG，不要可编辑文本框，不要后期叠字。
输出到 output/report.pptx。
```

正常流程：

1. Codex 询问缺失信息。
2. 解析参考资料。
3. 生成 `deck-protocol.json`。
4. 你确认或修改协议。
5. Codex 按页生成 PNG。
6. PNG 齐全后组装 PPTX。

### 质量边界

PPT Composer 会拒绝这些半成品：

- 只生成 prompt sheet。
- 只生成背景图，后面再叠字。
- 用 SVG、HTML 截图或 placeholder 冒充最终页。
- PNG 缺失时提前组装 PPTX。
- `strict_embed` 页改动原始数字、曲线、表头、logo 或图注。

### 验证安装

```bash
cd plugins/ppt-composer
npm run test:enhancement
```

测试会检查公开 skill、协议校验、图片 manifest、PPTX 组装和 MCP 工具注册。

### 项目结构

```text
PPT-Plugin/
├── README.md
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

---

## English

### What is PPT Composer?

PPT Composer is a Codex plugin that turns briefs and reference files into presentation-ready PowerPoint decks. It creates a reviewable protocol first, generates one complete image per slide, and assembles those images into a `.pptx`.

It is designed for final-looking decks, not editable wireframes or placeholder slides.

Public entry point:

```text
ppt-composer:image-first-ppt
```

### How it works

```text
brief and references
  -> deck-protocol.json
  -> user review
  -> one PNG per slide
  -> PPTX
```

The final PPTX contains one full-slide PNG per page. Slide text, title, charts, labels, logos, and layout are all inside that image.

### The protocol file

`deck-protocol.json` is the source of truth before generation. It defines:

- deck title, language, audience, page count, and aspect ratio
- global visual style
- reference assets
- page titles and claims
- evidence bindings
- per-page image prompts
- output PNG paths

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

### Supported references

| Input | Use |
| --- | --- |
| PDF | Papers and reports, preferably through MinerU |
| Markdown | Outlines and notes |
| DOCX | Word documents |
| TXT | Plain-text briefs |
| PNG/JPG/WebP | Figures, logos, and style references |
| CSV/TSV | Tables and numeric evidence |

### Installation

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

### Optional environment

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

### Usage

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

### Quality rules

PPT Composer rejects:

- prompt-only output
- background-only images
- SVG or HTML screenshots as final slides
- placeholders
- PPTX assembly before every PNG exists
- altered figures, numbers, logos, or table headers in `strict_embed` pages

### Verify

```bash
cd plugins/ppt-composer
npm run test:enhancement
```

### Repository layout

```text
PPT-Plugin/
├── README.md
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
