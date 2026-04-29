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

PPT Composer 是一个用来制作 image-first PowerPoint 的 Codex 插件。你给 Codex 需求、参考文件、受众、风格和页数；插件先规划 deck，让你审阅计划，再为每一页生成一张完整 PNG，最后组装成 `.pptx`。

适合你想要“能直接打开、展示、转发”的成品 PPT。它不是原生可编辑 PPT 生成器：最终每一页都是一张完整的全页图片。

<p align="center">
  <img src="assets/ppt-composer-system-overview.png" alt="PPT Composer 系统流程图">
</p>

## 工作流程

1. **描述需求**：主题、受众、页数、语言、视觉风格、输出目录，以及参考文件。
2. **解析资料**：PDF、图片、表格、Markdown、Word、纯文本都会被转成可用于 PPT 的证据。
3. **审阅协议**：生图前，Codex 会写出 `deck-protocol.json`，同时生成更适合人看的 `deck-protocol.review.md`。
4. **自然语言修改**：你可以直接要求改某页观点、绑定图表、调整保真模式、加强备注、统一页码策略。
5. **确认协议**：只有计划准备好并确认后，才开始生成图片。
6. **生成页面**：每一页生成一张完整 PNG。页数较多时，会在可用情况下派发受控 subagent 分页生图。
7. **组装和 QA**：插件确认每一页都有真实 PNG 后，再生成最终 PPTX。

协议就是生成前的合同：里面记录资产、每页观点、证据绑定、保真模式、演讲者备注和输出路径。只要你提供了参考文件，这些资料就必须先进入 assets，并绑定到相关页面，才能确认协议。

## 日常怎么用

在 Codex 里调用公开 skill：

```text
使用 ppt-composer:image-first-ppt。
基于 <需求/参考文件> 生成 <N> 页 PPT。
受众：<谁来听>。
语言：<中文/英文等>。
风格：<学术 / 咨询 / 产品 / 具体视觉方向>。
重点要求：<必须保留的图表、logo、表格、页码、备注风格>。
输出目录：<路径>。
```

示例：

```text
使用 ppt-composer:image-first-ppt。
基于 ./paper.pdf 和 ./figures/ 生成 10 页中文学术汇报 PPT。
受众：机器人实验室组会。
风格：干净的科研咨询风，深蓝强调色，证据面板清晰。
要求：主结果图必须准确保留；备注写成 5 分钟汇报讲稿；页码保持一致。
输出目录：./out/ppt-composer-demo。
```

常见追问：

- “第 6 页改成 strict_embed，并绑定主结果图。”
- “所有页面都不要出现 source 标签、文件名或内部 asset id。”
- “封面不放页码，其余页面统一放页码。”
- “把备注改成面向基金评审的讲稿，每页都要能真的照着讲，不要一句话。”
- “只重生成第 4 页，因为图表标签不清楚。”

更多说明：

- [用户指南](docs/user_guid/README.md)
- [当前使用案例](docs/user_guid/current-use-cases.zh-CN.md)

## 安装

要求：

- 支持插件的 Codex
- GitHub marketplace 安装需要本机 `PATH` 里能找到 Git
- Node.js 20+
- 可选：如果要用 MinerU 解析 PDF、Office 或图片资料，需要 `uv/uvx`
- 可选：MinerU token，用于更高的文档解析额度

### 从 GitHub 安装

先确认 `git --version` 能正常运行。Windows 用户需要先安装 Git for Windows，并重新打开 PowerShell/Codex，再运行：

```bash
codex plugin marketplace add YSAA1/PPT-Plugin
```

然后在 Codex 里打开：

```text
/plugins
```

选择 **PPT Composer**，点击 **Install plugin**。

安装后请**新开一个 Codex 线程**，让内置 skill 和 MCP server 被加载。如果插件列表或旧 Codex 会话已经打开过，测试前先重启 Codex。

### 从本地 clone 安装

```bash
git clone https://github.com/YSAA1/PPT-Plugin.git
cd PPT-Plugin
codex plugin marketplace add .
```

然后打开 `/plugins`，选择 **PPT Composer**，点击 **Install plugin**。安装后新开一个 Codex 线程。

### 更新已安装插件

`codex plugin marketplace add` 只是登记 marketplace 来源，不会热更新已经加载的 Codex 线程。GitHub marketplace 要先刷新来源：

```bash
codex plugin marketplace upgrade
```

然后重新打开 `/plugins`，需要时从刷新后的来源再次安装 **PPT Composer**。最后新开 Codex 线程或重启 Codex，让 skill 和 MCP server 从新的插件缓存加载。

如果你是从本地 clone 安装，先 `git pull` 更新 clone，再运行 `codex plugin marketplace add .`，然后从 `/plugins` 重新安装。

### 如果出现两个 PPT Composer

Codex 会按 marketplace 来源展示插件。同一个插件如果同时被个人 marketplace 和 GitHub/repo marketplace 暴露，就会显示两份。保留一个来源，删除另一个：

```bash
codex plugin marketplace remove <marketplace-name>
```

然后重启 Codex。已安装插件会放在 `~/.codex/plugins/cache/<marketplace-name>/<plugin-name>/<version>/`，所以不同 marketplace 名称会产生不同缓存目录。

## 输出和质量边界

- 最终 PPTX：每页一张全页 PNG，不再叠加 PowerPoint 文本框。
- 演讲者备注：默认根据受众和页面内容生成，并写入 PowerPoint 备注页。
- 审阅版本：`deck-protocol.review.md` 会把协议整理成人能审的摘要。
- 资产规则：参考图、表格、logo、图表必须先注册为协议资产，再被页面引用。
- 视觉一致性：页码、页脚、风格、元数据是否可见都由协议控制。
- 不显示内部信息：图片里不应出现原始文件名、asset id、`source:` 标签、文件路径或解析器字段名。
- 严格证据模式：`strict_embed` 页面必须保留参考资料里的数字、标签、logo、表头和图注。

## 常见问题

**安装后看不到 skill 或 MCP 工具。**
新开一个 Codex 线程或重启 Codex。插件会注册 `ppt-composer:image-first-ppt` 这个 skill，以及两个 MCP server：`ppt-render-mcp` 用于渲染、组装和 QA；`mineru-open-mcp` 用于文档解析。

**`mineru-open-mcp` 返回 `setup_required: true`。**
先安装 `uv/uvx`，再重启 Codex。即使 MinerU 解析还没准备好，核心的 `ppt-render-mcp` 仍然可以负责 PPTX 组装。

**最终 PPTX 不方便逐字编辑。**
这是 image-first 输出的预期结果。这个插件优先保证视觉一致性和可展示性，而不是原生 PowerPoint 可编辑性。

**协议看起来不对。**
先不要生图。直接用自然语言让 Codex 修改协议，然后重新检查 `deck-protocol.review.md`，确认后再开始生成图片。

## 示例

| 示例 | 说明 |
| --- | --- |
| [halo-academic-tsinghua.pptx](plugins/ppt-composer/examples/decks/halo-academic-tsinghua.pptx) | 中文学术科研汇报示例，清华风格视觉方向。 |
| [codex-introduction.pptx](plugins/ppt-composer/examples/decks/codex-introduction.pptx) | Codex 介绍示例，image-first PPTX。 |

## 许可证

MIT。见 [LICENSE](LICENSE)。
