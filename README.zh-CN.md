# PPT Composer

<p align="center">
  <img src="assets/ppt-composer-logo.svg" alt="PPT Composer" width="118">
</p>

<p align="center">
  <strong>用每页一张完整图片的方式生成可直接展示的 PowerPoint。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-release%20ready-2563EB">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-339933">
  <img alt="codex plugin" src="https://img.shields.io/badge/Codex-plugin-7C3AED">
  <img alt="slides" src="https://img.shields.io/badge/slides-one%20PNG%20per%20page-111827">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-black">
</p>

PPT Composer 是一个 Codex 插件，可以把需求描述、论文、PDF、报告、图片、表格等参考资料生成成风格统一的 PowerPoint。它会先生成可审阅的协议文件，再为每一页生成一张完整图片，最后把这些图片组装成 `.pptx`。

它面向想要“直接能展示的成品 PPT”的用户，而不是只产出 prompt、placeholder 或半成品背景图。

## 适合谁

适合这些场景：

- 用论文、PDF、报告、Markdown、图片或表格生成汇报 PPT。
- 需要风格统一、视觉完整的科研、项目、产品或咨询风格 deck。
- 希望先确认大纲和每页内容，再开始生成图片。
- 希望最终 PPTX 可以直接打开、展示、转发。

当前公开入口只有一个：

```text
ppt-composer:image-first-ppt
```

## 工作方式

```text
需求和参考资料
  -> deck-protocol.json
  -> 用户确认或修改
  -> 每页生成一张 PNG
  -> PPTX
```

最终 PPTX 的每一页都只有一张完整的全页 PNG。标题、文字、图表、logo、标签和视觉结构都已经在图片里，不会再叠加 PowerPoint 文本框。

## 协议文件

`deck-protocol.json` 是生图前的主计划文件。它定义：

- PPT 标题、语言、受众、页数和比例；
- 全局视觉风格；
- 可使用的参考资料；
- 每页标题和核心观点；
- 每页绑定的证据；
- 每页最终生图 prompt；
- 每页输出 PNG 路径。

页面通过 asset id 引用资料：

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

不要把原始图片路径直接写进 `content_inputs`。真实文件路径应该放在 `assets`，页面里只引用对应的 asset id。

### 保真模式

| 模式 | 含义 |
| --- | --- |
| `free` | 只按已确认的主题和风格自由生成。 |
| `light_redraw` | 可以统一风格和重排，但必须保留事实、趋势和关键数值。 |
| `strict_embed` | 图表、logo、表头、数值和图注要作为视觉证据保留。 |

## 支持的参考资料

| 输入 | 用途 |
| --- | --- |
| PDF | 论文、报告，优先通过 MinerU 解析 |
| Markdown | 大纲、笔记、已有文档 |
| DOCX | Word 文档 |
| TXT | 纯文本 brief |
| PNG/JPG/WebP | 参考图、logo、风格图 |
| CSV/TSV | 表格和数值证据 |

## 安装

要求：

- Node.js 20+
- 支持插件的 Codex
- 可选：MinerU token，用于更高质量的文档解析

安装依赖：

```bash
cd plugins/ppt-composer
npm install
```

把 `plugins/ppt-composer` 注册到你的 Codex 插件目录或 marketplace 配置里。

插件入口文件：

```text
plugins/ppt-composer/.codex-plugin/plugin.json
```

MCP 配置文件：

```text
plugins/ppt-composer/.mcp.json
```

## 可选环境变量

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
- 不要提交 `.env` 或任何真实 token。

## 使用方式

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

## 质量边界

PPT Composer 会拒绝这些半成品：

- 只生成 prompt。
- 只生成背景图。
- 用 SVG 或 HTML 截图冒充最终页。
- 使用 placeholder。
- PNG 缺失时提前组装 PPTX。
- `strict_embed` 页改动原始数字、曲线、表头、logo 或图注。

## 验证

```bash
cd plugins/ppt-composer
npm run test:enhancement
```

## 项目结构

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
