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

<p align="center">
  <img src="assets/ppt-composer-system-overview.png" alt="PPT Composer 系统流程图">
</p>

## 新用户先看这里

如果你觉得协议、QA、返工规则有点抽象，先看这两份图文说明：

- [用户指南](docs/user_guid/README.md)：用图解释整体流程、协议文件、视觉复审和按页返工。
- [当前使用案例说明](docs/user_guid/current-use-cases.zh-CN.md)：给出论文汇报、纯需求生成、参考图定制、严格保留图表、按页返工等实际提示词。

<p align="center">
  <img src="docs/user_guid/images/workflow-overview.png" alt="PPT Composer 使用流程">
</p>

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
  -> reference-assets/asset-index.json
  -> deck-protocol.json
  -> deck-protocol.review.md
  -> 协议补丁工具
  -> 生图任务清单
  -> 确定性 QA 与视觉复审
  -> 完整 PNG manifest
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
- 默认生成的演讲者备注；
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
      "speaker_notes": "讲解迁移结果，并强调 heavy-load 条件。",
      "output_png": "dist/slides/slide-03.png"
    }
  ]
}
```

不要把原始图片路径直接写进 `content_inputs`。真实文件路径应该放在 `assets`，页面里只引用对应的 asset id。
如果用户提供了参考文件，协议必须先把解析/本地化后的资料写进 `assets`，并且至少有一页通过 asset id 绑定这些资料，否则还不能进入确认协议和生图阶段。
使用 `speaker_notes` 写演讲者备注；生成协议时默认会为每页添加备注。备注应该是面向目标听众的讲稿提示，说明这一页该怎么讲、为什么重要、如何解释证据和如何过渡，而不是一句很短的标签。它会进入 PowerPoint 备注页，不会渲染成页面可见文字。已有协议里的 `notes`、`remarks`、`presenter_notes` 或 `备注` 会作为兼容别名读取。

整套 deck 还会使用统一的页码/页脚策略。asset id、文件名、文件路径、`source:` 标签、协议字段名、解析器元数据等内部信息不能出现在图片里的可见文字中。

PPT Composer 会把协议修改和生成状态保存在内部文件里：

| 文件 | 用途 |
| --- | --- |
| `reference-assets/asset-index.json` | 本地化后的参考文件和 URL，包含稳定 id、hash、MIME、大小、说明和用途。 |
| `deck-protocol.review.md` | 给用户审阅的协议版本，包含校验状态、来源文件、资产列表、页面观点、证据绑定、保真模式和输出路径。 |
| `imagegen-jobs.json` | 每页生图任务状态；`deck-protocol.json` 仍然是内容真相。 |
| `visual-qa.json` | PNG 检查和视觉复审报告；记录缺失、过小、placeholder、一致性问题、协议偏离和基本图像问题。 |
| `png-manifest.json` | 最终组装门禁；只有每页都有真实生成 PNG 后才创建。 |

### 如何修改协议

正常使用时，你用自然语言告诉 Codex 想改什么，不需要自己记 CLI 参数。

例如你可以说：

```text
第 6 页改成 strict_embed，并绑定 fig-3。
```

```text
第 3 页标题改成“核心实验结果”，claim 聚焦 sample efficiency。
```

```text
每页都使用 logo-1，但第 2 页保持 free_generation。
```

Codex 会把这些自然语言修改转换成可验证的协议补丁操作。内部会调用类似这样的工具：

```bash
ppt-composer protocol-bind-asset --protocol output/deck-protocol.json --page 6 --asset-id fig-3
ppt-composer protocol-set-fidelity --protocol output/deck-protocol.json --page 6 --fidelity strict_embed
ppt-composer protocol-update-page --protocol output/deck-protocol.json --page 3 --patch '{"title":"核心实验结果"}'
```

每次 patch 保存前都会校验。工具会拒绝不存在的页码、不存在的 asset id、重复 asset id、非法 fidelity，并自动格式化 `deck-protocol.json`，保持协议有效，同时写入 `audit_log`。

你也可以直接手改 JSON，但推荐流程是：用自然语言描述修改，让 Codex 调用协议补丁工具修改，然后再看更新后的协议摘要。确认后才开始生图。

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

## 示例

仓库中包含两份已生成的 PowerPoint 示例：

| 示例 | 说明 |
| --- | --- |
| [halo-academic-tsinghua.pptx](plugins/ppt-composer/examples/decks/halo-academic-tsinghua.pptx) | 中文学术科研汇报示例，清华风格视觉方向。 |
| [codex-introduction.pptx](plugins/ppt-composer/examples/decks/codex-introduction.pptx) | Codex 介绍示例，image-first PPTX。 |

## 安装

要求：

- Node.js 20+
- 支持插件的 Codex
- 如果要用 MinerU 解析 PDF、Office 或图片资料，需要 `uv/uvx`
- 可选：MinerU token，用于更高质量的文档解析

### 从 GitHub 安装

```bash
codex plugin marketplace add YSAA1/PPT-Plugin
```

然后打开 Codex 插件列表：

```text
/plugins
```

选择 `PPT Composer`，点击 `Install plugin`。

安装后请新开一个 Codex 线程，让内置 skill 和 MCP server 被加载。如果插件列表或旧 Codex 会话已经打开过，测试前先重启 Codex。

### 从本地 clone 安装

```bash
git clone https://github.com/YSAA1/PPT-Plugin.git
cd PPT-Plugin
codex plugin marketplace add .
```

然后运行：

```text
/plugins
```

打开 `PPT Composer`，点击 `Install plugin`。

安装后请新开一个 Codex 线程，让内置 skill 和 MCP server 被加载。如果插件列表或旧 Codex 会话已经打开过，测试前先重启 Codex。

PPT Composer 会把 skill 和 MCP server 配置一起打包成 Codex 插件。第一次启动 MCP 时，Node MCP 启动器会在已安装插件 cache 内自动安装缺失的运行依赖。安装日志会写到 stderr，不会污染 MCP 的 stdio 协议通道。

PPT Composer 会注册两个 MCP server：

- `ppt-render-mcp`：负责 PPT 渲染、manifest 校验、组装和 QA。这是核心 server，需要 Node.js 和 npm 运行依赖。
- `mineru-open-mcp`：负责通过 MinerU 解析文档，需要 `uv/uvx`。如果缺少 `uvx`，它不会直接消失，而是降级成 setup-help MCP；工具会返回 `setup_required: true`，并提示需要运行的命令。

### 依赖预热

“预热依赖”的意思是：插件安装或更新后，先把本地运行依赖准备好，再让 Codex 启动 MCP server。对大多数用户这是可选的，因为 Node 依赖缺失时会自动安装一次；它主要用于网络很慢导致首次 MCP 启动超时，或者你想提前准备 MinerU 的 `uvx` 环境。

如果你是在 clone 仓库里开发，或者首次 MCP 启动提示依赖缺失，运行：

```bash
cd plugins/ppt-composer
npm run prewarm
```

如果你是通过 Codex 安装插件，并且 MCP 报错里打印了已安装插件路径，就进入那个插件根目录运行同一条命令：

```bash
cd <installed-plugin-root>
npm run prewarm
```

如果需要用 MinerU 解析 PDF / Office / 图片参考资料，再运行：

```bash
npm run prewarm:mineru
```

预热后重启 Codex，让 MCP server 从已经准备好的依赖缓存启动。

MCP 启动器是跨平台 Node 脚本。在 Windows 上会调用 `npm.cmd` / `uvx.cmd`，并且插件使用 JSZip 解析 DOCX/PPTX，不依赖系统自带 `unzip` 命令。

如果安装后看起来 MCP 不可用：

1. 先新开一个 Codex 线程，或者重启 Codex。
2. 先确认 `ppt-render-mcp` 是否可用；它是 PPTX 组装和 QA 的核心 server。
3. 如果 `mineru-open-mcp` 返回 `setup_required: true`，说明缺少 `uv/uvx`；安装后在已安装插件根目录运行 `npm run prewarm:mineru`，再重启 Codex。
4. 如果是依赖安装超时，在已安装插件根目录运行 `npm run prewarm`，再重启 Codex。

插件入口文件：

```text
plugins/ppt-composer/.codex-plugin/plugin.json
```

MCP 配置文件：

```text
plugins/ppt-composer/.mcp.json
```

## 可选环境变量

环境变量是可选的，只在需要更高质量的 MinerU 解析，或显式使用 OpenAI Images API fallback 时才需要。

支持这些配置方式，优先级从高到低：

1. Codex 启动时继承的系统环境变量或 shell 环境变量。
2. `PPT_COMPOSER_ENV_FILE` 指向的自定义 env 文件。
3. 本地 clone 仓库根目录的 `.env`，适合开发调试。
4. `plugins/ppt-composer/.env`，适合插件包或已安装插件 cache 内使用。

已经存在的系统或 shell 环境变量不会被 `.env` 文件覆盖。

Linux/macOS shell 示例：

```bash
export MINERU_API_TOKEN="..."
export OPENAI_API_KEY="..."
```

Windows PowerShell 示例：

```powershell
$env:MINERU_API_TOKEN="..."
$env:OPENAI_API_KEY="..."
```

插件目录 `.env` 示例：

```bash
cp plugins/ppt-composer/.env.example plugins/ppt-composer/.env
```

然后编辑新建的 `.env` 文件：

```bash
MINERU_API_TOKEN=...
OPENAI_API_KEY=...
```

如果你不想把私密 env 文件放进仓库，可以指定私有文件路径：

```bash
export PPT_COMPOSER_ENV_FILE="$HOME/.config/ppt-composer/env"
```

说明：

- `MINERU_API_TOKEN` 用于 MinerU 精准解析。
- `OPENAI_API_KEY` 只用于显式选择 OpenAI Images API fallback。
- Codex 内置 `$imagegen` 不依赖本地 `OPENAI_API_KEY`。

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
3. 把解析/本地化后的资料写入 `reference-assets/asset-index.json`。
4. 生成 `deck-protocol.json` 和 `deck-protocol.review.md`。
5. 你审阅 review 协议，需要修改时直接用自然语言提出。
6. Codex 用协议补丁工具修改，并同步更新 review 文件。
7. 你明确确认协议。
8. Codex 创建 `imagegen-jobs.json`；7 页及以上 deck 先按 worker dispatch 计划派生图 subagent，只有派发失败或不可用才回退到 leader 直接生成。
9. Codex 按页生成 PNG。
10. 运行确定性 QA 和视觉复审；多页 deck 优先用 bounded vision/reviewer subagent 逐页检查。
11. 失败页按页返工；如果需要改 prompt 或保真规则，先 patch `deck-protocol.json`。
12. 每页都生成完成后创建 PNG manifest；如果启用了视觉复审，则必须每页都是 accepted。
13. PNG 通过门禁后组装 PPTX。

## 质量边界

PPT Composer 会拒绝这些半成品：

- 只生成 prompt。
- 只生成背景图。
- 用 SVG 或 HTML 截图冒充最终页。
- 使用 placeholder。
- PNG 缺失时提前组装 PPTX。
- `strict_embed` 页改动原始数字、曲线、表头、logo 或图注。
- 视觉复审失败的问题，例如风格不一致、偏离协议、文字不可读、水印、表格或 logo 变形、空白区域、只生成背景图。

如果只有某一页失败，PPT Composer 应该只返工这一页，而不是重做整份 PPT。

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
