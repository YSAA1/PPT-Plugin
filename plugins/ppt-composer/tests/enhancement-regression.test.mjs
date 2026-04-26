import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(testDir, '..');
const cliPath = path.join(pluginRoot, 'src/cli.mjs');
const renderPath = path.join(pluginRoot, 'src/render-pptx.mjs');
const mcpPath = path.join(pluginRoot, 'src/ppt-render-mcp.mjs');

async function runCli(args, { expectJson = true } = {}) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: pluginRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(stderr, '');
  if (!expectJson) return stdout;
  return JSON.parse(stdout);
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
  const { stdout } = await execFileAsync('unzip', ['-p', pptxPath, entry], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
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
  const { stdout } = await execFileAsync('find', ['skills', '-name', 'SKILL.md', '-print'], {
    cwd: pluginRoot,
  });
  const skillFiles = stdout.trim().split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(skillFiles, ['skills/image-first-ppt/SKILL.md']);

  const skillSource = await readFile(path.join(pluginRoot, 'skills/image-first-ppt/SKILL.md'), 'utf8');
  assert.match(skillSource, /deck-protocol\.json/i);
  assert.match(skillSource, /Protocol Confirmation Gate/i);
  assert.match(skillSource, /confirmation as authorization to use bounded image-generation subagents/i);
  assert.match(skillSource, /subagent input is the assigned page protocol slice/i);
  assert.match(skillSource, /Directly call Codex built-in image generation/i);
  assert.match(skillSource, /missing `OPENAI_API_KEY` does not mean built-in `image_gen` is unavailable/i);
  assert.match(skillSource, /generate-assets --provider codex.*prompt-sheet handoff/i);
  assert.match(skillSource, /headless Chrome screenshot/i);
  assert.match(skillSource, /prompt sheet.*completed deck/i);
  assert.match(skillSource, /PNG manifest is the gate for assembly/i);
  assert.match(skillSource, /not a blank background, not a base draft/i);
  assert.match(skillSource, /no later PPT text overlay/i);
  assert.match(skillSource, /MCP as the internal tool layer/i);
  assert.match(skillSource, /parse_paper_local/i);
  assert.match(skillSource, /assemble_image_ppt/i);

  const pluginManifest = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(pluginManifest.skills, './skills/');
  assert.equal(pluginManifest.mcpServers, './.mcp.json');

  const mcpConfig = JSON.parse(await readFile(path.join(pluginRoot, '.mcp.json'), 'utf8'));
  assert.ok(mcpConfig.mcpServers['mineru-open-mcp']);
  assert.ok(mcpConfig.mcpServers['ppt-render-mcp']);
  assert.ok(mcpConfig.mcpServers['mineru-open-mcp'].args.includes('./scripts/mineru-open-mcp-with-images.py'));

  const mineruWrapper = await readFile(
    path.join(pluginRoot, 'scripts/mineru-open-mcp-with-images.py'),
    'utf8',
  );
  assert.match(mineruWrapper, /image_paths/);
  assert.match(mineruWrapper, /zip_url/);
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
  for (const command of ['reference-intake', 'validate-deck-protocol', 'asset-plan', 'visual-plan', 'generate-assets', 'generate-image-deck', 'enhance-spec', 'infographic-deck']) {
    assert.match(help, new RegExp(`\\b${command}\\b`), `missing command ${command} in help output`);
  }
});

test('MCP server registers enhancement tools', async () => {
  const source = await readFile(mcpPath, 'utf8');
  for (const toolName of ['parse_paper_local', 'reference_intake', 'validate_deck_protocol', 'assemble_image_ppt', 'plan_assets', 'visual_plan', 'generate_assets', 'generate_image_deck_spec', 'enhance_slide_spec', 'infographic_deck_spec']) {
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
    '--pages',
    '3',
  ]);
  assert.equal(result.protocol, protocolPath);
  assert.equal(result.pages, 3);
  assert.equal(result.warnings.length, 0);

  const protocol = JSON.parse(await readFile(protocolPath, 'utf8'));
  assert.equal(protocol.kind, 'ppt-composer-deck-protocol');
  assert.equal(protocol.mode, 'reference_grounded_mode');
  assert.equal(protocol.deck.title, 'Protocol Demo');
  assert.equal(protocol.deck.page_count, 3);
  assert.ok(protocol.assets.some((asset) => asset.type === 'text_evidence'));
  assert.ok(protocol.assets.some((asset) => asset.type === 'source_image'));
  assert.ok(protocol.assets.some((asset) => asset.type === 'source_table' && asset.path.endsWith('.png')));
  assert.ok(protocol.pages.every((page) => page.final_image_prompt && page.negative_prompt && page.output_png.endsWith('.png')));

  const validation = await runCli(['validate-deck-protocol', '--protocol', protocolPath]);
  assert.equal(validation.ok, true);
  assert.equal(validation.pages, 3);
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
