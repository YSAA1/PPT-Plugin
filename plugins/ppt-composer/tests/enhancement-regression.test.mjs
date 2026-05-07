import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readZipText } from '../src/zip-utils.mjs';
import { buildPluginEnv, parseEnvFile } from '../scripts/env-loader.mjs';

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(testDir, '..');
const repoRoot = path.resolve(pluginRoot, '../..');
const cliPath = path.join(pluginRoot, 'src/cli.mjs');
const renderPath = path.join(pluginRoot, 'src/render-pptx.mjs');
const mcpPath = path.join(pluginRoot, 'src/ppt-render-mcp.mjs');
const mineruWrapperPath = path.join(pluginRoot, 'scripts/run-mineru-open-mcp.mjs');

async function runCli(args, { expectJson = true } = {}) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: pluginRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(stderr, '');
  if (!expectJson) return stdout;
  return JSON.parse(stdout);
}

async function withMcpClient({ command, args, cwd, env }, fn) {
  const client = new Client({ name: 'ppt-composer-test', version: '0.0.0' });
  const transport = new StdioClientTransport({ command, args, cwd, env });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function writeTinyPng(filePath) {
  await writeFile(
    filePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
}

async function unzipRead(pptxPath, entry) {
  return readZipText(pptxPath, entry);
}

async function writeSlidePng(filePath, width = 640, height = 360) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = (x * 3 + y) % 255;
      rgba[i + 1] = (x + y * 5) % 255;
      rgba[i + 2] = (x + y) % 255;
      rgba[i + 3] = 255;
    }
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  await writeFile(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

async function listSkillFiles(dir = path.join(pluginRoot, 'skills'), prefix = 'skills') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listSkillFiles(full, rel));
    else if (entry.name === 'SKILL.md') files.push(rel);
  }
  return files.sort();
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('markdown -> render -> qa smoke stays green', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-md-'));
  const specPath = path.join(outDir, 'outline.spec.json');
  const pptxPath = path.join(outDir, 'outline.pptx');
  const qaPath = path.join(outDir, 'outline.qa.json');

  const specResult = await runCli(['from-markdown', '--input', './examples/outline.md', '--out', specPath]);
  assert.ok(specResult.slides > 0);

  const renderResult = await runCli(['render', '--spec', specPath, '--out', pptxPath]);
  assert.equal(renderResult.pptx, pptxPath);

  const qaResult = await runCli(['qa', '--pptx', pptxPath, '--spec', specPath, '--out', qaPath]);
  assert.equal(qaResult.status, 'pass');
  assert.equal(qaResult.summary.errors, 0);
});

test('renderer keeps native text/table/chart/shape objects editable', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-native-'));
  const specPath = path.join(outDir, 'native.spec.json');
  const pptxPath = path.join(outDir, 'native.pptx');

  const spec = {
    version: '0.1',
    deck: {
      title: 'Native Objects',
      audience: 'team',
      language: 'en',
      format: '16:9',
      editability: 'native-first',
    },
    theme: {
      template: 'consulting-research',
      palette: ['#111827', '#2563EB', '#F8FAFC', '#E5E7EB'],
      fonts: { heading: 'Aptos Display', body: 'Aptos' },
    },
    slides: [
      {
        id: 's1',
        title: 'Native Objects',
        objects: [
          { type: 'text', text: 'Editable headline', position: { x: 0.8, y: 1.2, w: 4.2, h: 0.7 } },
          { type: 'shape', shape: 'rect', fill: '#DBEAFE', position: { x: 0.8, y: 2.0, w: 1.4, h: 0.8 } },
          {
            type: 'table',
            position: { x: 2.5, y: 2.0, w: 3.8, h: 1.4 },
            rows: [['Metric', 'Value'], ['Coverage', 'Lane B']],
          },
          {
            type: 'chart',
            chartType: 'bar',
            labels: ['Editable'],
            series: [{ name: 'Objects', values: [3] }],
            position: { x: 6.7, y: 1.8, w: 3.2, h: 2.4 },
          },
        ],
      },
    ],
  };

  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  await runCli(['render', '--spec', specPath, '--out', pptxPath]);
  const qaResult = await runCli(['qa', '--pptx', pptxPath, '--spec', specPath]);

  assert.equal(qaResult.status, 'pass');
  assert.ok(qaResult.summary.textShapes >= 1);
  assert.ok(qaResult.summary.tables >= 1);
  assert.ok(qaResult.summary.charts >= 1);
});

test('image-first decks still emit editability warning', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-img-'));
  const specPath = path.join(outDir, 'image.spec.json');
  const pptxPath = path.join(outDir, 'image.pptx');

  const specResult = await runCli([
    'from-images',
    '--out',
    specPath,
    '--images',
    './examples/sample-visual.svg',
  ]);
  assert.ok(specResult.slides >= 1);

  await runCli(['render', '--spec', specPath, '--out', pptxPath]);
  const qaResult = await runCli(['qa', '--pptx', pptxPath, '--spec', specPath]);
  assert.equal(qaResult.status, 'pass');
  assert.ok(qaResult.findings.some((finding) => finding.code === 'image_first'));
  assert.ok(qaResult.summary.pictures >= 1);
  assert.equal(qaResult.summary.textShapes, 0);
});

test('plugin exposes only the image-first-ppt skill', async () => {
  const skillFiles = await listSkillFiles();
  assert.deepEqual(skillFiles, ['skills/image-first-ppt/SKILL.md']);

  const skillSource = await readFile(path.join(pluginRoot, 'skills/image-first-ppt/SKILL.md'), 'utf8');
  const protocolReference = await readFile(path.join(pluginRoot, 'skills/image-first-ppt/references/protocol.md'), 'utf8');
  const workerReference = await readFile(path.join(pluginRoot, 'skills/image-first-ppt/references/image-generation-workers.md'), 'utf8');
  const qaReference = await readFile(path.join(pluginRoot, 'skills/image-first-ppt/references/manifest-visual-qa.md'), 'utf8');
  const toolsReference = await readFile(path.join(pluginRoot, 'skills/image-first-ppt/references/tools-and-failures.md'), 'utf8');
  const fullSkillReference = [skillSource, protocolReference, workerReference, qaReference, toolsReference].join('\n');
  assert.ok(skillSource.split('\n').length < 140);
  assert.match(skillSource, /Progressive Loading/i);
  assert.match(skillSource, /references\/protocol\.md/i);
  assert.match(skillSource, /references\/image-generation-workers\.md/i);
  assert.match(skillSource, /references\/manifest-visual-qa\.md/i);
  assert.match(skillSource, /references\/tools-and-failures\.md/i);
  assert.match(skillSource, /deck-protocol\.json/i);
  assert.match(skillSource, /Requirement Gate/i);
  assert.match(skillSource, /Reference Asset Gate/i);
  assert.match(skillSource, /deck-protocol\.review\.md/i);
  assert.match(skillSource, /worker_dispatch\.assignments/i);
  assert.match(skillSource, /speaker_notes.*by default/i);
  assert.match(skillSource, /page-number\/footer policy/i);
  assert.match(skillSource, /template invariants/i);
  assert.match(skillSource, /asset ids, filenames, paths, `source:` labels/i);
  assert.match(skillSource, /ask only for the missing fields and STOP/i);
  assert.match(skillSource, /Stop condition: any required item is unknown/i);
  assert.match(skillSource, /Protocol Confirmation Gate/i);
  assert.match(skillSource, /Ambiguous replies such as "继续", "ok", or "不错" do not authorize image generation/i);
  assert.match(protocolReference, /Ambiguous replies such as "继续", "ok", or "不错" do not authorize image generation/i);
  assert.match(skillSource, /Patch revisions only through protocol patch tools/i);
  assert.match(protocolReference, /direct JSON edits are allowed only after recording the tool blocker/i);
  assert.match(workerReference, /parallelism is worth the local startup cost/i);
  assert.match(workerReference, /subagents may initialize the same plugin MCP servers as the leader/i);
  assert.match(workerReference, /Do not spawn many image workers/i);
  assert.match(workerReference, /2-6 pages: use the leader directly or at most 2 concurrent subagents/i);
  assert.match(workerReference, /7\+ pages: MUST dispatch image-generation subagents/i);
  assert.match(workerReference, /7-12 pages: use 5-6 concurrent workers by default/i);
  assert.match(workerReference, /10 pages -> `2\+2\+2\+2\+1\+1` or `2\+2\+2\+2\+2`/i);
  assert.match(workerReference, /MUST NOT reduce it to zero for 7\+ pages/i);
  assert.match(workerReference, /Estimate each subagent's runtime as `assigned_page_count \* per_image_budget`/i);
  assert.match(workerReference, /wait at least 3 minutes for a one-page worker/i);
  assert.match(workerReference, /If a page range would exceed the maximum wait time, split the range/i);
  assert.match(workerReference, /When `fork_context: true` is used, DO NOT set `reasoning_effort`/i);
  assert.match(protocolReference, /Current image-first generation may restyle or redraw evidence/i);
  assert.match(protocolReference, /structured PPTX inventory\/reflow lane/i);
  assert.match(workerReference, /leader MUST create one shared deck generation context/i);
  assert.match(skillSource, /style_lock/i);
  assert.match(workerReference, /worker_dispatch\.assignments/i);
  assert.match(workerReference, /Use the reasoning value from `worker_dispatch\.assignments\[\]\.reasoning_effort`/i);
  assert.match(skillSource, /7\+ confirmed pages.*do not require.*subagent/i);
  assert.match(workerReference, /Forked chat history is supplemental only/i);
  assert.match(workerReference, /A worker prompt that does not include the `style_lock` is invalid/i);
  assert.match(workerReference, /Every worker MUST receive the exact same `style_lock`/i);
  assert.match(workerReference, /`style_lock` MUST include stable visual fields/i);
  assert.match(workerReference, /MUST NOT rely on inherited chat history as the only consistency mechanism/i);
  assert.match(workerReference, /MUST NOT call `spawn_agent` with `fork_context: true` when also setting `agent_type`/i);
  assert.match(workerReference, /Default shape is the lightweight context packet/i);
  assert.match(workerReference, /Protocol confirmation is the explicit user authorization.*bounded image-generation subagents/i);
  assert.match(workerReference, /Do not ask for separate subagent permission/i);
  assert.match(workerReference, /Before generating any page, count the confirmed protocol pages/i);
  assert.match(workerReference, /If there are 7\+ confirmed pages and no spawn attempt has been made, STOP/i);
  assert.match(workerReference, /10 pages is not a leader-only deck/i);
  assert.match(workerReference, /Default reasoning_effort is `low`/i);
  assert.match(workerReference, /Use `medium` only when/i);
  assert.match(workerReference, /strict_embed/i);
  assert.match(workerReference, /dense scientific\/table evidence/i);
  assert.match(workerReference, /Do not use `high` or `xhigh`/i);
  assert.match(workerReference, /reasoning_effort: "medium"/i);
  assert.match(skillSource, /Default subagent reasoning is `low`; escalate to `medium` only/i);
  assert.match(workerReference, /If role-less forked spawn fails, or if a role\/reasoning override is required by the runtime, MUST omit `fork_context`/i);
  assert.match(workerReference, /Forking is optional only when the runtime benefits from extra history/i);
  assert.match(workerReference, /Each default worker packet contains only: verbatim `style_lock`/i);
  assert.match(workerReference, /fork_context: true,\r?\n  reasoning_effort: "low"/i);
  assert.match(workerReference, /Shared deck generation context:/i);
  assert.match(workerReference, /Do not edit prompts for other pages/i);
  assert.match(workerReference, /Save or return the real generated PNG artifact for each page/i);
  assert.match(workerReference, /Leader MUST NOT treat a subagent response as successful unless it includes a real generated PNG path/i);
  assert.match(workerReference, /Silent fallback is FORBIDDEN/i);
  assert.match(workerReference, /fallback to zero workers is allowed only after a concrete spawn unavailable\/blocked\/failed condition is observed/i);
  assert.match(workerReference, /MUST wait for subagent results or failure status before creating `png-manifest\.json`/i);
  assert.match(workerReference, /assigned page protocol slice/i);
  assert.match(protocolReference, /`speaker_notes`: default speaker\/presenter talk track/i);
  assert.match(protocolReference, /Generated protocols SHOULD include `speaker_notes` by default/i);
  assert.match(protocolReference, /audience-specific talk tracks/i);
  assert.match(protocolReference, /Visual consistency and metadata rules/i);
  assert.match(protocolReference, /logo policy, page-number policy, footer policy/i);
  assert.match(protocolReference, /Do not allow page numbers to appear randomly/i);
  assert.match(protocolReference, /asset ids, filenames, file paths, `source:`/i);
  assert.match(protocolReference, /Speaker notes MUST NOT be rendered inside the PNG/i);
  assert.match(protocolReference, /protocol -> `imagegen-jobs\.json` -> `png-manifest\.json` -> PPT speaker notes/i);
  assert.match(workerReference, /Directly call Codex built-in image generation/i);
  assert.match(workerReference, /page-number\/footer policy/i);
  assert.match(workerReference, /style_lock\.template_contract/i);
  assert.match(workerReference, /Do not render internal metadata/i);
  assert.match(workerReference, /missing `OPENAI_API_KEY` does not mean built-in `image_gen` is unavailable/i);
  assert.match(workerReference, /generate-assets --provider codex.*prompt-sheet handoff/i);
  assert.match(skillSource, /prompt sheet.*finished slide/i);
  assert.match(qaReference, /PNG manifest is the gate for assembly/i);
  assert.match(skillSource, /background\/base draft/i);
  assert.match(skillSource, /no later PPT text overlay/i);
  assert.match(skillSource, /MCP as the internal tool layer/i);
  assert.match(toolsReference, /asset-index-create/i);
  assert.match(toolsReference, /protocol-review/i);
  assert.match(protocolReference, /Asset gate:/i);
  assert.match(protocolReference, /Review artifact:/i);
  assert.match(protocolReference, /reference-grounded protocol with `assets: \[\]` is invalid/i);
  assert.match(toolsReference, /imagegen-jobs-create/i);
  assert.match(skillSource, /visual-qa/i);
  assert.match(qaReference, /Visual review prompt template/i);
  assert.match(qaReference, /template_invariants/i);
  assert.match(qaReference, /consistency: Does this PNG match the confirmed deck visual system/i);
  assert.match(qaReference, /protocol_alignment: Does this PNG follow the page claim/i);
  assert.match(qaReference, /reference_fidelity: Are referenced figures/i);
  assert.match(qaReference, /text_legibility: Is all visible slide text readable/i);
  assert.match(qaReference, /artifact_quality: Are there obvious generated-image defects/i);
  assert.match(qaReference, /The leader owns deterministic QA, manifest gating/i);
  assert.match(qaReference, /Once visual review is enabled, set `visualReview\.enabled=true`/i);
  assert.match(qaReference, /Manual override may only bypass overrideable review findings/i);
  assert.match(toolsReference, /Manual override MUST NOT bypass missing PNG, non-PNG, placeholder PNG, tiny PNG/i);
  assert.match(toolsReference, /pptx_reference_intake/i);
  assert.match(toolsReference, /parse_paper_local/i);
  assert.match(toolsReference, /assemble_image_ppt/i);
  assert.match(toolsReference, /setup_required: true/i);
  assert.match(fullSkillReference, /structured PPTX inventory\/reflow lane/i);

  const pluginManifest = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(pluginManifest.skills, './skills/');
  assert.equal(pluginManifest.mcpServers, './.mcp.json');

  const mcpConfig = JSON.parse(await readFile(path.join(pluginRoot, '.mcp.json'), 'utf8'));
  assert.ok(mcpConfig.mcpServers['mineru-open-mcp']);
  assert.ok(mcpConfig.mcpServers['ppt-render-mcp']);
  assert.ok(mcpConfig.mcpServers['mineru-open-mcp'].args.includes('./scripts/run-mineru-open-mcp.mjs'));
  assert.ok(mcpConfig.mcpServers['ppt-render-mcp'].args.includes('./scripts/run-ppt-render-mcp.mjs'));
  assert.equal(mcpConfig.mcpServers['mineru-open-mcp'].cwd, '.');
  assert.equal(mcpConfig.mcpServers['ppt-render-mcp'].cwd, '.');
  assert.equal(mcpConfig.mcpServers['mineru-open-mcp'].startup_timeout_sec, 120);
  assert.equal(mcpConfig.mcpServers['mineru-open-mcp'].tool_timeout_sec, 900);
  assert.equal(mcpConfig.mcpServers['ppt-render-mcp'].tool_timeout_sec, 300);

  const packageJson = JSON.parse(await readFile(path.join(pluginRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.prewarm, 'node ./scripts/prewarm-deps.mjs');
  assert.equal(packageJson.scripts.doctor, 'node ./src/cli.mjs doctor');
  assert.equal(packageJson.scripts['prewarm:mineru'], 'node ./scripts/prewarm-deps.mjs --include-mineru');
  assert.equal(packageJson.dependencies.jszip, '^3.10.1');

  const mineruWrapper = await readFile(
    path.join(pluginRoot, 'scripts/mineru-open-mcp-with-images.py'),
    'utf8',
  );
  assert.match(mineruWrapper, /image_paths/);
  assert.match(mineruWrapper, /zip_url/);
  assert.match(mineruWrapper, /md_path\.write_text/);
  assert.match(mineruWrapper, /image_dir\.mkdir\(parents=True, exist_ok=True\)/);
  assert.match(mineruWrapper, /image_error/);
  assert.match(mineruWrapper, /Keep the document parse successful/);
  assert.match(mineruWrapper, /pdf_page_render_fallback/);
  assert.match(mineruWrapper, /input_image/);
  assert.match(mineruWrapper, /extract_mod\.extract_sources = _extract_sources_with_source_tracking/);
  assert.match(mineruWrapper, /tools_mod\.extract_sources = _extract_sources_with_source_tracking/);

  const nodeMineruWrapper = await readFile(
    path.join(pluginRoot, 'scripts/run-mineru-open-mcp.mjs'),
    'utf8',
  );
  assert.match(nodeMineruWrapper, /mineru-open-mcp-with-images\.py/);
  assert.match(nodeMineruWrapper, /prewarm:mineru/);
  assert.match(nodeMineruWrapper, /buildPluginEnv/);
  assert.match(nodeMineruWrapper, /socksio/);

  const nodeRenderWrapper = await readFile(
    path.join(pluginRoot, 'scripts/run-ppt-render-mcp.mjs'),
    'utf8',
  );
  assert.match(nodeRenderWrapper, /ppt-render-mcp\.mjs/);
  assert.match(nodeRenderWrapper, /npm run prewarm/);
  assert.match(nodeRenderWrapper, /npmCommand/);
  assert.match(nodeRenderWrapper, /spawnSync/);
  assert.match(nodeRenderWrapper, /PPT_COMPOSER_DISABLE_AUTO_INSTALL/);
  assert.match(nodeRenderWrapper, /process\.stderr\.write/);
  assert.match(nodeRenderWrapper, /buildPluginEnv/);

  const prewarmScript = await readFile(
    path.join(pluginRoot, 'scripts/prewarm-deps.mjs'),
    'utf8',
  );
  assert.match(prewarmScript, /--include-mineru/);
  assert.match(prewarmScript, /mineru-open-mcp/);
  assert.match(prewarmScript, /socksio/);
  assert.match(prewarmScript, /npmCommand/);
});

test('MCP wrappers load .env files without overriding shell environment', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-env-'));
  const repoRoot = outDir;
  const pluginDir = path.join(repoRoot, 'plugins/ppt-composer');
  const explicitEnv = path.join(outDir, 'explicit.env');
  await mkdir(pluginDir, { recursive: true });
  await writeFile(path.join(pluginDir, '.env'), [
    'MINERU_API_TOKEN=plugin-token',
    'OPENAI_API_KEY=plugin-key',
    'QUOTED_VALUE="hello world"',
    'INLINE_COMMENT=kept # comment',
  ].join('\n'));
  await writeFile(path.join(repoRoot, '.env'), [
    'MINERU_API_TOKEN=repo-token',
    'REPO_ONLY=repo-value',
  ].join('\n'));
  await writeFile(explicitEnv, [
    'OPENAI_API_KEY=explicit-key',
    'EXPLICIT_ONLY=1',
  ].join('\n'));

  assert.deepEqual(parseEnvFile('export A=1\nB="two words"\nBAD-NAME=x\n'), { A: '1', B: 'two words' });

  const env = buildPluginEnv({
    pluginRoot: pluginDir,
    baseEnv: {
      MINERU_API_TOKEN: 'shell-token',
      PPT_COMPOSER_ENV_FILE: explicitEnv,
    },
  });
  assert.equal(env.MINERU_API_TOKEN, 'shell-token');
  assert.equal(env.OPENAI_API_KEY, 'explicit-key');
  assert.equal(env.REPO_ONLY, 'repo-value');
  assert.equal(env.EXPLICIT_ONLY, '1');
  assert.equal(env.QUOTED_VALUE, 'hello world');
  assert.equal(env.INLINE_COMMENT, 'kept');
});

test('MinerU MCP wrapper stays discoverable when uvx is unavailable', async () => {
  const nodeOnlyPath = path.dirname(process.execPath);
  await withMcpClient({
    command: process.execPath,
    args: [mineruWrapperPath],
    cwd: pluginRoot,
    env: {
      ...process.env,
      PATH: nodeOnlyPath,
    },
  }, async (client) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, ['get_ocr_languages', 'parse_documents']);

    const result = await client.callTool({ name: 'get_ocr_languages', arguments: {} });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.setup_required, true);
    assert.match(payload.message, /uvx/i);
    assert.ok(payload.languages.includes('en'));
  });
});

test('installation docs explain new-thread startup and uvx MinerU fallback', async () => {
  const englishReadme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
  const chineseReadme = await readFile(path.join(repoRoot, 'README.zh-CN.md'), 'utf8');

  assert.match(englishReadme, /start a new Codex thread/i);
  assert.match(englishReadme, /uv\/uvx/i);
  assert.match(englishReadme, /setup_required/i);
  assert.match(englishReadme, /ppt-render-mcp/i);
  assert.match(englishReadme, /mineru-open-mcp/i);
  assert.match(englishReadme, /doctor/i);
  assert.match(englishReadme, /MINERU_API_TOKEN/i);

  assert.match(chineseReadme, /新开.*Codex.*线程/);
  assert.match(chineseReadme, /uv\/uvx/i);
  assert.match(chineseReadme, /setup_required/i);
  assert.match(chineseReadme, /ppt-render-mcp/i);
  assert.match(chineseReadme, /mineru-open-mcp/i);
  assert.match(chineseReadme, /doctor/i);
  assert.match(chineseReadme, /MINERU_API_TOKEN/i);
});

test('assemble-image-ppt builds one full-slide PNG per slide', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-png-manifest-'));
  const imageOne = path.join(outDir, 'slide-01.png');
  const imageTwo = path.join(outDir, 'slide-02.png');
  const manifestPath = path.join(outDir, 'png-manifest.json');
  const specPath = path.join(outDir, 'image-first.spec.json');
  const pptxPath = path.join(outDir, 'image-first.pptx');

  await writeTinyPng(imageOne);
  await writeTinyPng(imageTwo);
  await writeFile(manifestPath, `${JSON.stringify({
    kind: 'image-first-ppt-png-manifest',
    items: [
      { page: 1, status: 'generated', path: imageOne },
      { page: 2, status: 'generated', path: imageTwo },
    ],
  }, null, 2)}\n`);

  const result = await runCli([
    'assemble-image-ppt',
    '--manifest',
    manifestPath,
    '--out',
    pptxPath,
    '--spec-out',
    specPath,
    '--title',
    'PNG Manifest Deck',
  ]);
  assert.equal(result.pptx, pptxPath);
  assert.equal(result.slideSpec, specPath);
  assert.equal(result.slides, 2);

  const qaResult = await runCli(['qa', '--pptx', pptxPath, '--spec', specPath]);
  assert.equal(qaResult.status, 'pass');
  assert.equal(qaResult.summary.slides, 2);
  assert.equal(qaResult.summary.pictures, 2);
  assert.equal(qaResult.summary.textShapes, 0);

  for (const slideName of ['slide1.xml', 'slide2.xml']) {
    const xml = await unzipRead(pptxPath, `ppt/slides/${slideName}`);
    assert.equal((xml.match(/<p:pic\b/g) || []).length, 1);
    assert.equal((xml.match(/<p:sp\b/g) || []).length, 0);
  }
});

test('assemble-image-ppt rejects missing, placeholder, and non-PNG manifest items', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-png-fail-'));
  const pngPath = path.join(outDir, 'slide-01.png');
  const svgPath = path.join(outDir, 'slide-01.svg');
  await writeTinyPng(pngPath);
  await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');

  const cases = [
    {
      name: 'missing file',
      manifest: { items: [{ page: 1, status: 'generated', path: path.join(outDir, 'missing.png') }] },
      message: /does not exist/,
    },
    {
      name: 'placeholder',
      manifest: { items: [{ page: 1, status: 'generated', provider: 'placeholder', path: pngPath }] },
      message: /placeholder/,
    },
    {
      name: 'svg',
      manifest: { items: [{ page: 1, status: 'generated', path: svgPath }] },
      message: /must point to a PNG/,
    },
  ];

  for (const item of cases) {
    const manifestPath = path.join(outDir, `${item.name.replace(/\s+/g, '-')}.json`);
    await writeFile(manifestPath, `${JSON.stringify(item.manifest, null, 2)}\n`);
    await assert.rejects(
      runCli(['assemble-image-ppt', '--manifest', manifestPath, '--out', path.join(outDir, `${item.name}.pptx`)]),
      item.message,
    );
  }
});

test('renderer source includes consulting-research template support', async () => {
  const source = await readFile(renderPath, 'utf8');
  assert.match(source, /consulting-research/, 'missing consulting-research template hook in renderer');
});


test('CLI help advertises enhancement commands', async () => {
  const help = await runCli(['help'], { expectJson: false });
  for (const command of [
    'doctor',
    'reference-intake',
    'validate-deck-protocol',
    'protocol-review',
    'protocol-add-asset',
    'protocol-bind-asset',
    'protocol-update-page',
    'protocol-set-fidelity',
    'asset-index-create',
    'imagegen-jobs-create',
    'imagegen-jobs-status',
    'imagegen-jobs-backfill',
    'imagegen-jobs-review',
    'imagegen-jobs-revise',
    'imagegen-jobs-to-manifest',
    'visual-qa',
    'pptx-reference-intake',
    'asset-plan',
    'visual-plan',
    'generate-assets',
    'generate-image-deck',
    'enhance-spec',
    'infographic-deck',
  ]) {
    assert.match(help, new RegExp(`\\b${command}\\b`), `missing command ${command} in help output`);
  }
});

test('MCP server registers enhancement tools', async () => {
  const source = await readFile(mcpPath, 'utf8');
  for (const toolName of [
    'ppt_composer_doctor',
    'parse_paper_local',
    'reference_intake',
    'validate_deck_protocol',
    'protocol_review',
    'protocol_patch',
    'asset_index_create',
    'imagegen_jobs_create',
    'imagegen_jobs_status',
    'imagegen_jobs_backfill',
    'imagegen_jobs_review',
    'imagegen_jobs_revise',
    'imagegen_jobs_to_manifest',
    'visual_qa',
    'pptx_reference_intake',
    'assemble_image_ppt',
    'plan_assets',
    'visual_plan',
    'generate_assets',
    'generate_image_deck_spec',
    'enhance_slide_spec',
    'infographic_deck_spec',
  ]) {
    assert.match(source, new RegExp(`['\"]${toolName}['\"]`), `missing MCP tool ${toolName}`);
  }
});

test('reference-intake writes deck protocol from mixed local references', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-reference-intake-'));
  const refDir = path.join(outDir, 'refs');
  const imagePath = path.join(refDir, 'figure.png');
  const markdownPath = path.join(refDir, 'outline.md');
  const txtPath = path.join(refDir, 'notes.txt');
  const csvPath = path.join(refDir, 'metrics.csv');
  const protocolPath = path.join(outDir, 'deck-protocol.json');
  await mkdir(refDir, { recursive: true });
  await writeFile(markdownPath, [
    '# Reference Deck',
    '',
    'FlashSAC reduces wall-clock training cost under simulator-heavy workloads.',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    '| Speedup | 2.4x |',
    '',
    '![Main result](figure.png)',
  ].join('\n'));
  await writeFile(txtPath, 'Keep the deck concise.\n\nDo not invent benchmark numbers.\n');
  await writeFile(csvPath, 'Method,Score\nA,1\nB,2\n');
  await writeTinyPng(imagePath);

  const result = await runCli([
    'reference-intake',
    '--inputs',
    markdownPath,
    txtPath,
    csvPath,
    imagePath,
    '--out-dir',
    outDir,
    '--protocol-out',
    protocolPath,
    '--title',
    'Protocol Demo',
    '--audience',
    'lab reviewers',
    '--pages',
    '3',
  ]);
  assert.equal(result.protocol, protocolPath);
  assert.equal(result.assetIndex, path.join(outDir, 'reference-assets/asset-index.json'));
  assert.equal(result.pages, 3);
  assert.equal(result.warnings.length, 0);
  const assetIndex = JSON.parse(await readFile(result.assetIndex, 'utf8'));
  assert.equal(assetIndex.kind, 'ppt-composer-asset-index');
  assert.ok(assetIndex.assets.length >= 2);

  const protocol = JSON.parse(await readFile(protocolPath, 'utf8'));
  assert.equal(protocol.kind, 'ppt-composer-deck-protocol');
  assert.equal(protocol.mode, 'reference_grounded_mode');
  assert.equal(protocol.deck.title, 'Protocol Demo');
  assert.equal(protocol.deck.page_count, 3);
  assert.ok(protocol.assets.some((asset) => asset.type === 'text_evidence'));
  assert.ok(protocol.assets.some((asset) => asset.type === 'source_image'));
  assert.ok(protocol.assets.some((asset) => asset.type === 'source_table' && asset.path.endsWith('.png')));
  assert.ok(protocol.pages.every((page) => page.final_image_prompt && page.negative_prompt && page.output_png.endsWith('.png')));
  assert.ok(protocol.pages.every((page) => page.speaker_notes && page.speaker_notes.length > 120));
  assert.ok(protocol.pages.every((page) => page.speaker_notes.includes('lab reviewers')));
  assert.ok(protocol.pages.every((page) => /asset ids|source labels|protocol metadata/i.test(page.negative_prompt)));

  const validation = await runCli(['validate-deck-protocol', '--protocol', protocolPath]);
  assert.equal(validation.ok, true);
  assert.equal(validation.pages, 3);

  const reviewPath = path.join(outDir, 'deck-protocol.review.md');
  const reviewResult = await runCli(['protocol-review', '--protocol', protocolPath, '--out', reviewPath]);
  assert.equal(reviewResult.review, reviewPath);
  const review = await readFile(reviewPath, 'utf8');
  assert.match(review, /# Protocol Demo Review/);
  assert.match(review, /## Assets/);
  assert.match(review, /## Template Invariants/);
  assert.match(review, /Logo policy/);
  assert.match(review, /Page-number policy/);
  assert.match(review, /source_image/);
  assert.match(review, /## Pages/);
  assert.match(review, /Status: OK/);
});

test('reference-grounded protocol with source inputs cannot bypass empty assets', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-protocol-asset-gate-'));
  const protocolPath = path.join(outDir, 'deck-protocol.json');
  const protocol = {
    kind: 'ppt-composer-deck-protocol',
    version: '0.1',
    mode: 'reference_grounded_mode',
    source: { inputs: [path.join(outDir, 'paper.pdf')] },
    deck: { title: 'Asset Gate Demo', language: 'zh', audience: 'lab', page_count: 1, aspect_ratio: '16:9' },
    style: { description: 'consulting', template_image_ids: [], logo_ids: [], palette: [], typography: '' },
    assets: [],
    pages: [{
      page: 1,
      title: 'Page 1',
      claim: 'Claim from reference.',
      content_inputs: { text: [], tables: [], images: [] },
      reference_asset_ids: [],
      fidelity: 'free',
      final_image_prompt: 'Create a complete full-slide image.',
      negative_prompt: 'No fake numbers.',
      output_png: 'dist/slides/slide-01.png',
      free_generation: true,
    }],
  };
  await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  await assert.rejects(
    runCli(['validate-deck-protocol', '--protocol', protocolPath]),
    /must include localized assets/,
  );
});

test('protocol patch tools update assets, bindings, page fields, and fidelity with validation', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-protocol-patch-'));
  const protocolPath = path.join(outDir, 'deck-protocol.json');
  const protocol = {
    kind: 'ppt-composer-deck-protocol',
    version: '0.1',
    mode: 'reference_grounded_mode',
    deck: { title: 'Patch Demo', language: 'zh', audience: 'lab', page_count: 6, aspect_ratio: '16:9' },
    style: { description: 'consulting', template_image_ids: [], logo_ids: [], palette: [], typography: '' },
    assets: [
      { id: 'txt-1', type: 'text_evidence', source: 'brief', text: 'Baseline claim.', summary: 'Baseline claim.' },
    ],
    pages: Array.from({ length: 6 }, (_, index) => ({
      page: index + 1,
      title: `Page ${index + 1}`,
      claim: 'Baseline claim.',
      content_inputs: { text: ['txt-1'], tables: [], images: [] },
      reference_asset_ids: [],
      fidelity: 'free',
      final_image_prompt: 'Create a complete full-slide image.',
      negative_prompt: 'No fake numbers.',
      output_png: `dist/slides/slide-${String(index + 1).padStart(2, '0')}.png`,
    })),
  };
  await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);

  await runCli([
    'protocol-add-asset',
    '--protocol',
    protocolPath,
    '--asset',
    JSON.stringify({ id: 'fig-1', type: 'source_image', path: 'reference-assets/fig-1.png', caption: 'Figure 1', usage: 'evidence' }),
  ]);
  await runCli(['protocol-bind-asset', '--protocol', protocolPath, '--page', '6', '--asset-id', 'fig-1']);
  await runCli(['protocol-update-page', '--protocol', protocolPath, '--page', '6', '--patch', JSON.stringify({ claim: 'Updated page 6 claim.' })]);
  await runCli(['protocol-set-fidelity', '--protocol', protocolPath, '--page', '6', '--fidelity', 'strict_embed']);

  const updated = JSON.parse(await readFile(protocolPath, 'utf8'));
  assert.equal(updated.pages[5].claim, 'Updated page 6 claim.');
  assert.deepEqual(updated.pages[5].reference_asset_ids, ['fig-1']);
  assert.deepEqual(updated.pages[5].content_inputs.images, ['fig-1']);
  assert.equal(updated.pages[5].fidelity, 'strict_embed');
  assert.equal(updated.audit_log.length, 4);

  await assert.rejects(
    runCli(['protocol-add-asset', '--protocol', protocolPath, '--asset', JSON.stringify({ id: 'fig-1', type: 'source_image' })]),
    /Duplicate asset id/,
  );
  await assert.rejects(
    runCli(['protocol-bind-asset', '--protocol', protocolPath, '--page', '999', '--asset-id', 'fig-1']),
    /Unknown page/,
  );
  await assert.rejects(
    runCli(['protocol-bind-asset', '--protocol', protocolPath, '--page', '6', '--asset-id', 'missing']),
    /Unknown asset id/,
  );
  await assert.rejects(
    runCli(['protocol-set-fidelity', '--protocol', protocolPath, '--page', '6', '--fidelity', 'exact']),
    /Invalid fidelity/,
  );
});

test('asset index localizes files with stable hash ids and deduplicates by sha256', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-asset-index-'));
  const sourceOne = path.join(outDir, 'figure-a.png');
  const sourceTwo = path.join(outDir, 'figure-b.png');
  const indexPath = path.join(outDir, 'reference-assets/asset-index.json');
  await writeSlidePng(sourceOne);
  await writeFile(sourceTwo, await readFile(sourceOne));

  const result = await runCli([
    'asset-index-create',
    '--out-dir',
    outDir,
    '--out',
    indexPath,
    '--sources',
    sourceOne,
    sourceTwo,
    '--caption',
    'Duplicate figure',
    '--usage',
    'evidence',
  ]);
  assert.equal(result.assets, 1);
  assert.equal(result.duplicates, 1);

  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.equal(index.assets.length, 1);
  assert.match(index.assets[0].id, /^figure-a-[a-f0-9]{10}$/);
  assert.equal(index.assets[0].mime, 'image/png');
  assert.ok(index.assets[0].sha256);
  assert.ok(index.assets[0].size > 1024);
  assert.equal(index.assets[0].caption, 'Duplicate figure');
});

test('imagegen jobs gate manifest creation and visual QA blocks bad PNGs', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-jobs-'));
  const protocolPath = path.join(outDir, 'deck-protocol.json');
  const jobsPath = path.join(outDir, 'imagegen-jobs.json');
  const manifestPath = path.join(outDir, 'png-manifest.json');
  const qaPath = path.join(outDir, 'visual-qa.json');
  const protocol = {
    kind: 'ppt-composer-deck-protocol',
    version: '0.1',
    mode: 'brief_mode',
    deck: { title: 'Jobs Demo', language: 'zh', audience: 'team', page_count: 20, aspect_ratio: '16:9' },
    style: { description: 'consulting', template_image_ids: [], logo_ids: [], palette: [], typography: '' },
    assets: [],
    pages: Array.from({ length: 20 }, (_, index) => ({
      page: index + 1,
      title: `Page ${index + 1}`,
      claim: `Claim ${index + 1}`,
      content_inputs: { text: [], tables: [], images: [] },
      reference_asset_ids: [],
      fidelity: 'free',
      final_image_prompt: `Create page ${index + 1}.`,
      negative_prompt: 'No watermark.',
      output_png: `dist/slides/slide-${String(index + 1).padStart(2, '0')}.png`,
      free_generation: true,
      ...(index === 0 ? { speaker_notes: 'Presenter note for page one.' } : {}),
      ...(index === 1 ? { notes: ['Alias note line one.', 'Alias note line two.'] } : {}),
      ...(index === 2 ? { 备注: '中文备注会写入 PPT notes。' } : {}),
    })),
  };
  await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);

  const createResult = await runCli(['imagegen-jobs-create', '--protocol', protocolPath, '--out', jobsPath]);
  assert.equal(createResult.summary.total, 20);
  assert.equal(createResult.summary.pending, 20);
  const jobsAfterCreate = JSON.parse(await readFile(jobsPath, 'utf8'));
  assert.equal(jobsAfterCreate.style_lock.id, 'deck-style-lock-v1');
  assert.equal(jobsAfterCreate.style_lock.deck.title, 'Jobs Demo');
  assert.equal(jobsAfterCreate.style_lock.page_list.length, 20);
  assert.match(jobsAfterCreate.style_lock.worker_rule, /Forked chat history is never the source of truth/);
  assert.equal(jobsAfterCreate.style_lock.style.density, 'medium');
  assert.match(jobsAfterCreate.style_lock.style.font_scale, /readable/);
  assert.match(jobsAfterCreate.style_lock.style.chart_style, /consulting\/research/);
  assert.match(jobsAfterCreate.style_lock.style.margins, /whitespace/);
  assert.match(jobsAfterCreate.style_lock.style.page_number_policy, /consistent/i);
  assert.match(jobsAfterCreate.style_lock.style.footer_policy, /consistent/i);
  assert.match(jobsAfterCreate.style_lock.style.logo_policy, /no deck logo/i);
  assert.match(jobsAfterCreate.style_lock.style.template_element_policy, /template-controlled/i);
  assert.match(jobsAfterCreate.style_lock.template_contract.logo_policy, /no deck logo/i);
  assert.match(jobsAfterCreate.style_lock.template_contract.page_number_policy, /consistent/i);
  assert.match(jobsAfterCreate.style_lock.template_contract.footer_policy, /consistent/i);
  assert.match(jobsAfterCreate.style_lock.template_contract.template_element_policy, /template-controlled/i);
  assert.match(jobsAfterCreate.style_lock.style.visible_text_policy, /asset ids/i);
  assert.match(jobsAfterCreate.style_lock.format_contract.join(' '), /Template invariants are hard requirements/i);
  assert.match(jobsAfterCreate.style_lock.negative_contract.join(' '), /source labels/i);
  assert.equal(jobsAfterCreate.worker_dispatch.required, true);
  assert.equal(jobsAfterCreate.worker_dispatch.default_reasoning_effort, 'low');
  assert.equal(jobsAfterCreate.worker_dispatch.assignments.length, 6);
  assert.deepEqual(
    jobsAfterCreate.worker_dispatch.assignments.flatMap((assignment) => assignment.pages),
    Array.from({ length: 20 }, (_, index) => index + 1),
  );
  assert.deepEqual(jobsAfterCreate.visualReview.dimensions, [
    'consistency',
    'template_invariants',
    'protocol_alignment',
    'reference_fidelity',
    'text_legibility',
    'artifact_quality',
  ]);
  assert.equal(jobsAfterCreate.visualReview.enabled, false);
  assert.equal(jobsAfterCreate.pages[0].worker_context.style_lock_id, 'deck-style-lock-v1');
  assert.equal(jobsAfterCreate.pages[0].worker_context.default_spawn, 'context_packet_low_reasoning');
  assert.equal(jobsAfterCreate.pages[0].speaker_notes, 'Presenter note for page one.');
  assert.equal(jobsAfterCreate.pages[1].speaker_notes, 'Alias note line one.\nAlias note line two.');
  assert.equal(jobsAfterCreate.pages[2].speaker_notes, '中文备注会写入 PPT notes。');

  const firstPng = path.join(outDir, 'slide-01.png');
  await writeSlidePng(firstPng);
  const backfillResult = await runCli([
    'imagegen-jobs-backfill',
    '--jobs',
    jobsPath,
    '--page',
    '1',
    '--png',
    firstPng,
    '--execution-summary',
    JSON.stringify({
      claim_followed: true,
      reference_assets_used: 'none assigned',
      fidelity_followed: true,
      negative_prompt_avoided: true,
      uncertainties: '',
    }),
  ]);
  assert.equal(backfillResult.summary.generated, 1);
  const jobsAfterBackfill = JSON.parse(await readFile(jobsPath, 'utf8'));
  assert.equal(jobsAfterBackfill.pages[0].execution_summary.claim_followed, true);
  assert.equal(jobsAfterBackfill.pages[0].execution_summary.reference_assets_used, 'none assigned');
  await assert.rejects(
    runCli(['imagegen-jobs-to-manifest', '--jobs', jobsPath, '--out', manifestPath]),
    /Cannot create PNG manifest/,
  );

  for (let page = 2; page <= 20; page += 1) {
    const png = path.join(outDir, `slide-${String(page).padStart(2, '0')}.png`);
    await writeSlidePng(png);
    await runCli(['imagegen-jobs-backfill', '--jobs', jobsPath, '--page', String(page), '--png', png]);
  }

  const manifestResult = await runCli(['imagegen-jobs-to-manifest', '--jobs', jobsPath, '--out', manifestPath]);
  assert.equal(manifestResult.items, 20);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.items.length, 20);
  assert.ok(manifest.items.every((item) => item.status === 'generated' && item.path.endsWith('.png')));
  assert.equal(manifest.items[0].speaker_notes, 'Presenter note for page one.');
  assert.equal(manifest.items[1].speaker_notes, 'Alias note line one.\nAlias note line two.');
  assert.equal(manifest.items[2].speaker_notes, '中文备注会写入 PPT notes。');

  const deckPath = path.join(outDir, 'notes-demo.pptx');
  const specPath = path.join(outDir, 'notes-demo.spec.json');
  await runCli(['assemble-image-ppt', '--manifest', manifestPath, '--out', deckPath, '--spec-out', specPath]);
  const imageFirstSpec = JSON.parse(await readFile(specPath, 'utf8'));
  assert.equal(imageFirstSpec.slides[0].notes, 'Presenter note for page one.');
  assert.equal(imageFirstSpec.slides[1].notes, 'Alias note line one.\nAlias note line two.');
  assert.equal(imageFirstSpec.slides[2].notes, '中文备注会写入 PPT notes。');

  const qaResult = await runCli(['visual-qa', '--protocol', protocolPath, '--jobs', jobsPath, '--out', qaPath]);
  assert.equal(qaResult.status, 'pass');

  const missingContractJobsPath = path.join(outDir, 'missing-template-contract-jobs.json');
  const missingContractJobs = JSON.parse(await readFile(jobsPath, 'utf8'));
  delete missingContractJobs.style_lock.template_contract;
  await writeFile(missingContractJobsPath, `${JSON.stringify(missingContractJobs, null, 2)}\n`);
  await assert.rejects(
    runCli(['visual-qa', '--protocol', protocolPath, '--jobs', missingContractJobsPath, '--out', path.join(outDir, 'missing-contract-qa.json')]),
    /template_contract_missing/,
  );

  const badJobsPath = path.join(outDir, 'bad-jobs.json');
  const tinyPath = path.join(outDir, 'tiny.png');
  await writeTinyPng(tinyPath);
  const badJobs = JSON.parse(await readFile(jobsPath, 'utf8'));
  badJobs.pages[0].path = tinyPath;
  await writeFile(badJobsPath, `${JSON.stringify(badJobs, null, 2)}\n`);
  await assert.rejects(
    runCli(['visual-qa', '--protocol', protocolPath, '--jobs', badJobsPath, '--out', path.join(outDir, 'bad-qa.json')]),
    /tiny_png/,
  );
  await assert.rejects(
    runCli([
      'visual-qa',
      '--protocol',
      protocolPath,
      '--jobs',
      badJobsPath,
      '--out',
      path.join(outDir, 'bad-qa-override.json'),
      '--manual-override-note',
      'Do not block draft assembly.',
    ]),
    /tiny_png/,
  );
  const badOverride = JSON.parse(await readFile(path.join(outDir, 'bad-qa-override.json'), 'utf8'));
  assert.equal(badOverride.status, 'fail');
  assert.equal(badOverride.summary.hardFailures, 1);
});

test('imagegen visual review gates accepted pages and preserves superseded attempts', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-visual-review-'));
  const protocolPath = path.join(outDir, 'deck-protocol.json');
  const jobsPath = path.join(outDir, 'imagegen-jobs.json');
  const manifestPath = path.join(outDir, 'png-manifest.json');
  const qaPath = path.join(outDir, 'visual-qa.json');
  const protocol = {
    kind: 'ppt-composer-deck-protocol',
    version: '0.1',
    mode: 'brief_mode',
    deck: { title: 'Visual Review Demo', language: 'zh', audience: 'team', page_count: 2, aspect_ratio: '16:9' },
    style: { description: 'consistent research consulting deck', template_image_ids: [], logo_ids: [], palette: [], typography: '' },
    assets: [],
    pages: [1, 2].map((page) => ({
      page,
      title: `Page ${page}`,
      claim: `Claim ${page}`,
      content_inputs: { text: [], tables: [], images: [] },
      reference_asset_ids: [],
      fidelity: 'free',
      final_image_prompt: `Create page ${page} with visible title and claim.`,
      negative_prompt: 'No watermark, no unreadable text.',
      output_png: `slides/slide-${String(page).padStart(2, '0')}.png`,
      free_generation: true,
    })),
  };
  await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  await runCli(['imagegen-jobs-create', '--protocol', protocolPath, '--out', jobsPath]);

  const pageOnePng = path.join(outDir, 'slide-01.png');
  const pageTwoFirstPng = path.join(outDir, 'slide-02-first.png');
  await writeSlidePng(pageOnePng);
  await writeSlidePng(pageTwoFirstPng);
  await runCli(['imagegen-jobs-backfill', '--jobs', jobsPath, '--page', '1', '--png', pageOnePng]);
  await runCli(['imagegen-jobs-backfill', '--jobs', jobsPath, '--page', '2', '--png', pageTwoFirstPng]);

  const needsReview = await runCli(['imagegen-jobs-review', '--jobs', jobsPath, '--page', '1', '--note', 'Ready for visual review.']);
  assert.equal(needsReview.status, 'needs_review');
  assert.equal(needsReview.summary.needsReview, 1);
  assert.equal(needsReview.summary.visualReviewEnabled, true);
  await assert.rejects(
    runCli(['imagegen-jobs-to-manifest', '--jobs', jobsPath, '--out', manifestPath]),
    /accepted/,
  );

  const accepted = await runCli([
    'imagegen-jobs-review',
    '--jobs',
    jobsPath,
    '--page',
    '1',
    '--verdict',
    'pass',
    '--consistency',
    'pass',
    '--protocol-alignment',
    'pass',
    '--reference-fidelity',
    'pass',
    '--text-legibility',
    'pass',
    '--artifact-quality',
    'pass',
    '--note',
    'Consistent with the deck and aligned with the protocol.',
  ]);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.review.categories.template_invariants, 'pass');
  assert.equal(accepted.review.categories.protocol_alignment, 'pass');
  assert.equal(accepted.review.categories.reference_fidelity, 'pass');
  assert.equal(accepted.review.categories.text_legibility, 'pass');
  assert.equal(accepted.review.categories.artifact_quality, 'pass');

  const rejected = await runCli([
    'imagegen-jobs-review',
    '--jobs',
    jobsPath,
    '--page',
    '2',
    '--verdict',
    'fail',
    '--consistency',
    'fail',
    '--protocol-alignment',
    'fail',
    '--reference-fidelity',
    'fail',
    '--text-legibility',
    'warn',
    '--artifact-quality',
    'warn',
    '--note',
    'Style is inconsistent and the slide drifts from the prompt.',
    '--revision-suggestion',
    'Tighten the prompt around the original claim and deck typography.',
  ]);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.review.categories.consistency, 'fail');
  assert.equal(rejected.review.categories.reference_fidelity, 'fail');

  await assert.rejects(
    runCli(['visual-qa', '--protocol', protocolPath, '--jobs', jobsPath, '--out', qaPath]),
    /visual_review_rejected/,
  );
  const visualFail = JSON.parse(await readFile(qaPath, 'utf8'));
  assert.equal(visualFail.status, 'fail');
  assert.equal(visualFail.visualReview.enabled, true);
  assert.deepEqual(visualFail.visualReview.dimensions, [
    'consistency',
    'template_invariants',
    'protocol_alignment',
    'reference_fidelity',
    'text_legibility',
    'artifact_quality',
  ]);
  assert.equal(visualFail.visualReview.pages[1].verdict, 'fail');
  assert.match(visualFail.visualReview.pages[1].revisionSuggestion, /Tighten the prompt/);
  assert.equal(visualFail.visualReview.pages[1].categories.reference_fidelity, 'fail');
  assert.equal(visualFail.visualReview.pages[1].categories.template_invariants, 'fail');

  const override = await runCli([
    'visual-qa',
    '--protocol',
    protocolPath,
    '--jobs',
    jobsPath,
    '--out',
    path.join(outDir, 'visual-qa-override.json'),
    '--manual-override-note',
    'Reviewer accepts risk for an emergency draft.',
  ]);
  assert.equal(override.status, 'pass');
  assert.equal(override.manualOverride.note, 'Reviewer accepts risk for an emergency draft.');

  const revision = await runCli([
    'imagegen-jobs-revise',
    '--jobs',
    jobsPath,
    '--page',
    '2',
    '--note',
    'Regenerate only page 2.',
    '--revision-suggestion',
    'Use the confirmed page claim and consistent visual system.',
  ]);
  assert.equal(revision.status, 'revision_requested');
  assert.equal(revision.revision.superseded_path, pageTwoFirstPng);
  await assert.rejects(
    runCli(['imagegen-jobs-to-manifest', '--jobs', jobsPath, '--out', manifestPath]),
    /accepted/,
  );

  const pageTwoSecondPng = path.join(outDir, 'slide-02-second.png');
  await writeSlidePng(pageTwoSecondPng);
  const regenerated = await runCli(['imagegen-jobs-backfill', '--jobs', jobsPath, '--page', '2', '--png', pageTwoSecondPng]);
  assert.equal(regenerated.summary.generated, 1);
  assert.equal(regenerated.summary.accepted, 1);

  const pageTwoAccepted = await runCli([
    'imagegen-jobs-review',
    '--jobs',
    jobsPath,
    '--page',
    '2',
    '--verdict',
    'warn',
    '--consistency',
    'pass',
    '--protocol-alignment',
    'pass',
    '--reference-fidelity',
    'pass',
    '--text-legibility',
    'pass',
    '--artifact-quality',
    'warn',
    '--note',
    'Regenerated page now matches the protocol, with minor artifact risk recorded.',
  ]);
  assert.equal(pageTwoAccepted.status, 'accepted');
  assert.equal(pageTwoAccepted.review.verdict, 'warn');

  const reviewedJobs = JSON.parse(await readFile(jobsPath, 'utf8'));
  assert.equal(reviewedJobs.pages[1].attempts.length, 2);
  assert.equal(reviewedJobs.pages[1].attempts[0].status, 'superseded');
  assert.equal(reviewedJobs.pages[1].attempts[1].status, 'accepted');
  assert.deepEqual(reviewedJobs.pages[1].superseded_pngs, [pageTwoFirstPng]);
  assert.equal(reviewedJobs.pages[1].accepted_png, pageTwoSecondPng);

  const finalQa = await runCli(['visual-qa', '--protocol', protocolPath, '--jobs', jobsPath, '--out', path.join(outDir, 'visual-qa-final.json')]);
  assert.equal(finalQa.status, 'pass');
  assert.equal(finalQa.summary.visualReviewFailures, 0);
  assert.equal(finalQa.summary.warnings, 1);
  assert.equal(finalQa.visualReview.pages[1].acceptedPng, pageTwoSecondPng);
  assert.deepEqual(finalQa.visualReview.pages[1].supersededPngs, [pageTwoFirstPng]);

  const manifestResult = await runCli(['imagegen-jobs-to-manifest', '--jobs', jobsPath, '--out', manifestPath]);
  assert.equal(manifestResult.summary.readyForManifest, true);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.ok(manifest.items.every((item) => item.sourceStatus === 'accepted'));
  assert.equal(manifest.items[1].path, pageTwoSecondPng);
  assert.equal(manifest.items[1].visual_review.verdict, 'warn');
});

test('pptx reference intake extracts media and theme without requiring LibreOffice thumbnails', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-pptx-intake-'));
  const indexPath = path.join(outDir, 'reference-assets/asset-index.json');
  const result = await runCli([
    'pptx-reference-intake',
    '--input',
    './examples/decks/codex-introduction.pptx',
    '--out-dir',
    outDir,
    '--index-out',
    indexPath,
  ]);

  assert.equal(result.assetIndex, indexPath);
  assert.ok(result.media >= 1);
  assert.ok(Array.isArray(result.theme.colors));
  assert.ok(result.thumbnails.status === 'attempted' || result.thumbnails.status === 'skipped');

  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.equal(index.kind, 'ppt-composer-asset-index');
  assert.ok(index.assets.length >= 1);
});

test('deck protocol validates references and drives visual-plan prompt slices', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-protocol-plan-'));
  const protocolPath = path.join(outDir, 'deck-protocol.json');
  const visualPlanPath = path.join(outDir, 'visual-plan.json');
  const promptAssetDir = path.join(outDir, 'assets');
  const protocol = {
    kind: 'ppt-composer-deck-protocol',
    version: '0.1',
    mode: 'reference_grounded_mode',
    deck: { title: 'Protocol Plan', language: 'zh', audience: 'lab', page_count: 2, aspect_ratio: '16:9' },
    style: { description: 'high-end scientific consulting', template_image_ids: [], logo_ids: [], palette: [], typography: '' },
    assets: [
      { id: 'txt-1', type: 'text_evidence', source: 'brief', text: 'Main result improves sample efficiency.', summary: 'Main result improves sample efficiency.' },
      { id: 'tbl-1', type: 'source_table', path: path.join(outDir, 'table.png'), source: 'brief', summary: 'table with key metric' },
    ],
    pages: [
      {
        page: 1,
        title: 'Main result',
        claim: 'Efficiency improves without changing the benchmark.',
        content_inputs: { text: ['txt-1'], tables: [], images: [] },
        reference_asset_ids: [],
        fidelity: 'light_redraw',
        final_image_prompt: 'Create a complete slide explaining the main result.',
        negative_prompt: 'No fake numbers.',
        output_png: 'dist/slides/slide-01.png',
      },
      {
        page: 2,
        title: 'Metric table',
        claim: 'The table is the evidence block.',
        content_inputs: { text: [], tables: ['tbl-1'], images: [] },
        reference_asset_ids: ['tbl-1'],
        fidelity: 'strict_embed',
        final_image_prompt: 'Create a complete slide embedding the table as evidence.',
        negative_prompt: 'Do not alter table values.',
        output_png: 'dist/slides/slide-02.png',
      },
    ],
  };
  await writeTinyPng(path.join(outDir, 'table.png'));
  await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);

  const visualResult = await runCli([
    'visual-plan',
    '--protocol',
    protocolPath,
    '--out',
    visualPlanPath,
  ]);
  assert.equal(visualResult.pages, 2);

  const visualPlan = JSON.parse(await readFile(visualPlanPath, 'utf8'));
  assert.equal(visualPlan.sourceKind, 'deck-protocol');
  assert.equal(visualPlan.protocol.kind, 'ppt-composer-deck-protocol');
  assert.ok(visualPlan.requests.every((request) => request.protocolPage));
  assert.ok(visualPlan.requests.some((request) => request.fidelity === 'strict_embed'));
  assert.ok(visualPlan.requests.every((request) => /Fidelity mode:/i.test(request.prompt)));
  assert.ok(visualPlan.requests.every((request) => /Page numbering policy:/i.test(request.prompt)));
  assert.ok(visualPlan.requests.every((request) => /Do not render internal evidence labels/i.test(request.prompt)));
  assert.ok(visualPlan.requests.every((request) => !/tbl-1:/i.test(request.prompt)));
  assert.ok(visualPlan.requests.every((request) => !/Grounding evidence:.*source table/i.test(request.prompt)));

  const manifestResult = await runCli([
    'generate-assets',
    '--plan',
    visualPlanPath,
    '--out-dir',
    promptAssetDir,
  ]);
  const manifest = JSON.parse(await readFile(manifestResult.manifest, 'utf8'));
  assert.equal(manifest.summary.manualRequired, 2);
  assert.ok(manifest.items.every((item) => item.protocolPage));
  assert.ok(manifest.items.some((item) => item.fidelity === 'strict_embed'));
  const promptSheet = await readFile(manifest.promptSheet, 'utf8');
  assert.match(promptSheet, /Protocol page slice/);
  assert.match(promptSheet, /strict_embed/);

  const badProtocolPath = path.join(outDir, 'bad-protocol.json');
  await writeFile(badProtocolPath, `${JSON.stringify({
    ...protocol,
    pages: [{ ...protocol.pages[0], reference_asset_ids: ['missing-asset'] }],
  }, null, 2)}\n`);
  await assert.rejects(
    runCli(['validate-deck-protocol', '--protocol', badProtocolPath]),
    /unknown asset id/,
  );
});

test('native-only enhancement ignores generated assets on editable content slides', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-native-policy-'));
  const specPath = path.join(outDir, 'native.spec.json');
  const enhancedPath = path.join(outDir, 'native.enhanced.spec.json');
  const manifestPath = path.join(outDir, 'asset-manifest.json');
  const imagePath = path.join(pluginRoot, 'examples/sample-visual.svg');

  const spec = {
    version: '0.1',
    deck: {
      title: 'Native Policy',
      audience: 'team',
      language: 'en',
      format: '16:9',
      editability: 'native-first',
      visualPolicy: 'native-only',
    },
    assets: [],
    slides: [
      {
        id: 'content',
        title: 'Editable content slide',
        objects: [
          { type: 'text', text: 'Keep this slide fully native.', position: { x: 0.8, y: 1.2, w: 5.4, h: 0.7 } },
          { type: 'shape', shape: 'rect', fill: '#DBEAFE', position: { x: 0.8, y: 2.0, w: 2.2, h: 0.8 } },
        ],
      },
    ],
  };
  const manifest = {
    version: '0.1',
    kind: 'ppt-asset-manifest',
    provider: 'placeholder',
    items: [
      {
        requestId: 'content-full-slide-request',
        assetId: 'content-generated',
        slideId: 'content',
        status: 'generated',
        provider: 'placeholder',
        path: imagePath,
        placement: { x: 7.55, y: 1.45, w: 4.95, h: 3.65, mode: 'supporting-panel' },
      },
    ],
  };

  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await runCli(['enhance-spec', '--spec', specPath, '--asset-manifest', manifestPath, '--out', enhancedPath]);

  const enhanced = JSON.parse(await readFile(enhancedPath, 'utf8'));
  assert.equal(enhanced.deck.visualPolicy, 'native-only');
  assert.equal(enhanced.assets.length, 0);
  assert.equal(enhanced.slides[0].objects.some((object) => object.type === 'image'), false);
  assert.equal(enhanced.slides[0].visualEnhancement.status, 'ignored');
});

test('visual-plan defaults to Codex imagegen prompts instead of SVG placeholders', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-visual-default-'));
  const visualPlanPath = path.join(outDir, 'visual-plan.json');
  const promptAssetDir = path.join(outDir, 'prompt-assets');

  await runCli([
    'visual-plan',
    '--spec',
    './examples/research-demo.spec.json',
    '--out',
    visualPlanPath,
  ]);

  const visualPlan = JSON.parse(await readFile(visualPlanPath, 'utf8'));
  assert.equal(visualPlan.deck.visualPolicy, 'image-first');
  assert.equal(visualPlan.defaults.provider, 'codex');
  assert.ok(visualPlan.requests.every((request) => request.codexPrompt?.startsWith('$imagegen ')));
  assert.ok(visualPlan.requests.every((request) => /not a blank background or base draft/i.test(request.prompt)));
  assert.ok(visualPlan.requests.every((request) => /inside the generated image/i.test(request.prompt)));
  assert.ok(visualPlan.pages.every((page) => /no separate PPT text overlay/i.test(page.textPolicy)));

  const manifestResult = await runCli([
    'generate-assets',
    '--plan',
    visualPlanPath,
    '--out-dir',
    promptAssetDir,
  ]);
  assert.equal(manifestResult.summary.generated, 0);
  assert.equal(manifestResult.summary.manualRequired, visualPlan.requests.length);
  assert.equal(manifestResult.summary.failed, 0);

  const manifest = JSON.parse(await readFile(manifestResult.manifest, 'utf8'));
  assert.equal(manifest.provider, 'codex');
  assert.equal(manifest.readyForImageDeck, false);
  assert.equal(manifest.completionStatus, 'requires_image_generation');
  assert.match(manifest.nextAction, /\$imagegen/);
  assert.ok(manifest.promptSheet.endsWith('imagegen-prompts.md'));
  assert.equal(manifest.items.length, visualPlan.requests.length);
  assert.ok(manifest.items.every((item) => item.status === 'manual_required'));
  assert.ok(manifest.items.every((item) => item.provider === 'codex'));
  assert.ok(manifest.items.every((item) => item.blocking === true));
  assert.ok(manifest.items.every((item) => item.expectedOutput?.endsWith('.png')));
  assert.ok(manifest.items.every((item) => item.promptPath?.endsWith('.prompt.md')));
  assert.ok(manifest.items.every((item) => !item.path));
  assert.equal(manifest.items.some((item) => item.path?.endsWith('.svg')), false);

  const promptSheet = await readFile(manifest.promptSheet, 'utf8');
  assert.match(promptSheet, /blocking intermediate artifact/);
  assert.match(promptSheet, /manual_required` to `generated` and set `path`/);

  const shouldNotRenderPath = path.join(outDir, 'should-not-render.spec.json');
  await assert.rejects(
    runCli([
      'generate-image-deck',
      '--visual-plan',
      visualPlanPath,
      '--asset-manifest',
      manifestResult.manifest,
      '--out',
      shouldNotRenderPath,
    ]),
    /missing a generated full-slide image.*backfill the manifest with PNG paths/s,
  );
  await assert.rejects(readFile(shouldNotRenderPath, 'utf8'), /ENOENT/);
});

test('placeholder assets cannot be assembled as final image-first decks', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'ppt-composer-visual-plan-'));
  const visualPlanPath = path.join(outDir, 'visual-plan.json');
  const promptSheetPath = path.join(outDir, 'prompts.md');
  const assetDir = path.join(outDir, 'assets');
  const imageSpecPath = path.join(outDir, 'image-first.spec.json');

  const visualPlanResult = await runCli([
    'visual-plan',
    '--spec',
    './examples/research-demo.spec.json',
    '--out',
    visualPlanPath,
    '--prompt-sheet',
    promptSheetPath,
  ]);
  assert.ok(visualPlanResult.pages > 0);
  const visualPlan = JSON.parse(await readFile(visualPlanPath, 'utf8'));
  assert.equal(visualPlan.defaults.provider, 'codex');

  const manifestResult = await runCli([
    'generate-assets',
    '--plan',
    visualPlanPath,
    '--out-dir',
    assetDir,
    '--provider',
    'placeholder',
  ]);
  assert.equal(manifestResult.summary.generated, visualPlanResult.pages);
  assert.equal(manifestResult.summary.manualRequired, 0);
  assert.equal(manifestResult.summary.failed, 0);

  const manifest = JSON.parse(await readFile(manifestResult.manifest, 'utf8'));
  assert.equal(manifest.provider, 'placeholder');
  assert.equal(manifest.readyForImageDeck, true);
  assert.equal(manifest.completionStatus, 'ready_for_image_deck');
  assert.equal(manifest.promptSheet, undefined);
  assert.ok(manifest.items.every((item) => item.status === 'generated'));
  assert.ok(manifest.items.every((item) => item.provider === 'placeholder'));
  assert.ok(manifest.items.every((item) => item.format === 'svg'));

  await assert.rejects(
    runCli([
      'generate-image-deck',
      '--visual-plan',
      visualPlanPath,
      '--asset-manifest',
      manifestResult.manifest,
      '--out',
      imageSpecPath,
    ]),
    /placeholder asset/,
  );
  await assert.rejects(readFile(imageSpecPath, 'utf8'), /ENOENT/);
});
