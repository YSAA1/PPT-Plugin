#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderPptx } from "./render-pptx.mjs";
import { runQa } from "./qa-pptx.mjs";
import { markdownToSlideSpec } from "./markdown-to-slide-spec.mjs";
import { imagesToSlideSpec, pngManifestToSlideSpec } from "./images-to-slide-spec.mjs";
import { parsePaper } from "./paper-parse.mjs";
import { planAssets } from "./asset-plan.mjs";
import { generateAssets } from "./generate-assets.mjs";
import { enhanceSlideSpec } from "./enhance-slide-spec.mjs";
import { infographicDeckSpec } from "./infographic-deck.mjs";
import { buildVisualPlan, imageDeckSpecFromVisualPlan, writePromptSheet } from "./visual-plan.mjs";
import { referenceIntake } from "./reference-intake.mjs";
import { validateDeckProtocolAsync } from "./deck-protocol.mjs";
import { patchProtocolFile } from "./protocol-patch.mjs";
import { createAssetIndex } from "./asset-index.mjs";
import { createJobsFile, backfillJobsFile, reviewJobsFile, reviseJobsFile, jobsToManifestFile, summarizeJobs } from "./imagegen-jobs.mjs";
import { runVisualQaFile } from "./visual-qa.mjs";
import { pptxReferenceIntake } from "./pptx-reference-intake.mjs";
import { readJson, resolvePath, writeJson } from "./lib.mjs";

const USAGE = `
Usage:
  ppt-composer render --spec <slide-spec.json> --out <deck.pptx>
  ppt-composer qa --pptx <deck.pptx> [--spec <slide-spec.json>] [--out <qa.json>]
  ppt-composer from-markdown --input <outline.md> --out <slide-spec.json> [--title <title>]
  ppt-composer from-images --out <slide-spec.json> --images <img1> <img2> ...
  ppt-composer assemble-image-ppt --manifest <png-manifest.json> --out <deck.pptx> [--spec-out <slide-spec.json>] [--title <title>]
  ppt-composer parse-paper --input <paper.pdf|paper.md> --out-dir <parse-dir> [--lang en|ch]
  ppt-composer reference-intake --out-dir <work-dir> --protocol-out <deck-protocol.json> [--inputs <ref1> <ref2> ...] [--title <title>] [--pages 8]
  ppt-composer validate-deck-protocol --protocol <deck-protocol.json> [--require-generated-png]
  ppt-composer protocol-add-asset --protocol <deck-protocol.json> --asset <asset-json> [--audit-note <note>]
  ppt-composer protocol-bind-asset --protocol <deck-protocol.json> --page <n> --asset-id <id> [--input-type text|tables|images]
  ppt-composer protocol-update-page --protocol <deck-protocol.json> --page <n> --patch <json>
  ppt-composer protocol-set-fidelity --protocol <deck-protocol.json> --page <n> --fidelity free|light_redraw|strict_embed
  ppt-composer asset-index-create --out-dir <work-dir> --sources <file-or-url> ... [--out <asset-index.json>]
  ppt-composer imagegen-jobs-create --protocol <deck-protocol.json> --out <imagegen-jobs.json>
  ppt-composer imagegen-jobs-status --jobs <imagegen-jobs.json>
  ppt-composer imagegen-jobs-backfill --jobs <imagegen-jobs.json> --page <n> --png <slide.png> [--status generated|needs_review|accepted] [--note <note>] [--execution-summary <json>]
  ppt-composer imagegen-jobs-review --jobs <imagegen-jobs.json> --page <n> [--verdict pass|warn|fail] [--consistency pass|warn|fail] [--protocol-alignment pass|warn|fail] [--reference-fidelity pass|warn|fail] [--text-legibility pass|warn|fail] [--artifact-quality pass|warn|fail] [--note <note>] [--revision-suggestion <note>]
  ppt-composer imagegen-jobs-revise --jobs <imagegen-jobs.json> --page <n> [--note <note>] [--revision-suggestion <note>]
  ppt-composer imagegen-jobs-to-manifest --jobs <imagegen-jobs.json> --out <png-manifest.json> [--require-accepted]
  ppt-composer visual-qa --protocol <deck-protocol.json> --jobs <imagegen-jobs.json> --out <visual-qa.json> [--manual-override-note <note>]
  ppt-composer pptx-reference-intake --input <reference.pptx> --out-dir <work-dir> [--index-out <asset-index.json>] [--protocol <deck-protocol.json>]
  ppt-composer asset-plan --spec <slide-spec.json> --out <asset-plan.json> [--mode supporting|full-slide] [--size 1536x864] [--quality low]  # supporting is deprecated
  ppt-composer visual-plan [--protocol <deck-protocol.json> | --spec <slide-spec.json> | --parse-bundle <parse-bundle.json> | --markdown <outline.md>] --out <visual-plan.json> [--prompt-sheet <prompts.md>]
  ppt-composer generate-assets --plan <asset-plan.json> --out-dir <asset-dir> [--provider codex|openai|placeholder]  # codex writes blocking $imagegen prompts until backfilled
  ppt-composer generate-image-deck --visual-plan <visual-plan.json> --asset-manifest <manifest.json> --out <image-first-spec.json>
  ppt-composer enhance-spec --spec <slide-spec.json> --out <enhanced-spec.json> [--asset-manifest <manifest.json>] [--template consulting-research] [--visual-policy native-only|image-first|hybrid] [--visual-slide-fallback]
  ppt-composer infographic-deck --out <slide-spec.json> [--input <outline.md> | --spec <slide-spec.json> | --images <img1> <img2> ...] [--asset-manifest <manifest.json>] [--full-slide] [--title <title>]
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === "images" || key === "inputs" || key === "sources") {
      const targetKey = key;
      out[targetKey] = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        out[targetKey].push(argv[i + 1]);
        i += 1;
      }
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function requireArg(args, name) {
  if (!args[name]) {
    throw new Error(`Missing required argument --${name}`);
  }
  return args[name];
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!command || command === "help" || args.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (command === "render") {
    const specPath = resolvePath(requireArg(args, "spec"));
    const outPath = resolvePath(requireArg(args, "out"));
    const spec = await readJson(specPath);
    const result = await renderPptx(spec, { specPath, outPath });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "qa") {
    const pptxPath = resolvePath(requireArg(args, "pptx"));
    const specPath = args.spec ? resolvePath(args.spec) : null;
    const spec = specPath ? await readJson(specPath) : null;
    const report = await runQa({ pptxPath, spec, specPath });
    if (args.out) {
      await writeJson(resolvePath(args.out), report);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (command === "from-markdown") {
    const inputPath = resolvePath(requireArg(args, "input"));
    const outPath = resolvePath(requireArg(args, "out"));
    const markdown = await readFile(inputPath, "utf8");
    const spec = markdownToSlideSpec(markdown, {
      title: args.title,
      sourcePath: inputPath,
    });
    await writeJson(outPath, spec);
    process.stdout.write(`${JSON.stringify({ slideSpec: outPath, slides: spec.slides.length }, null, 2)}\n`);
    return;
  }

  if (command === "from-images") {
    const outPath = resolvePath(requireArg(args, "out"));
    const images = args.images || [];
    if (images.length === 0) {
      throw new Error("from-images requires --images <img1> <img2> ...");
    }
    const spec = await imagesToSlideSpec(images.map((imagePath) => resolvePath(imagePath)), {
      title: args.title || "Image deck",
    });
    await writeJson(outPath, spec);
    process.stdout.write(`${JSON.stringify({ slideSpec: outPath, slides: spec.slides.length }, null, 2)}\n`);
    return;
  }

  if (command === "assemble-image-ppt") {
    const manifestPath = resolvePath(requireArg(args, "manifest"));
    const outPath = resolvePath(requireArg(args, "out"));
    const specOutPath = resolvePath(args["spec-out"] || `${outPath}.spec.json`);
    const manifest = await readJson(manifestPath);
    const spec = await pngManifestToSlideSpec(manifest, {
      manifestPath,
      title: args.title || "Image-first PPT",
    });
    await writeJson(specOutPath, spec);
    const result = await renderPptx(spec, { specPath: specOutPath, outPath });
    process.stdout.write(`${JSON.stringify({ ...result, slideSpec: specOutPath }, null, 2)}\n`);
    return;
  }

  if (command === "parse-paper") {
    const inputPath = resolvePath(requireArg(args, "input"));
    const outDir = resolvePath(requireArg(args, "out-dir"));
    const result = await parsePaper({
      inputPath,
      outDir,
      lang: args.lang || "en",
      mode: args.mode || "auto",
      mineruWrapper: args["mineru-wrapper"],
      dryRun: Boolean(args["dry-run"]),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reference-intake") {
    const outDir = resolvePath(requireArg(args, "out-dir"));
    const protocolPath = resolvePath(args["protocol-out"] || path.join(outDir, "deck-protocol.json"));
    const result = await referenceIntake({
      inputs: (args.inputs || []).map((inputPath) => resolvePath(inputPath)),
      outDir,
      protocolPath,
      lang: args.lang || args.language || "zh",
      mode: args.mode,
      imageRole: args["image-role"] || "source_image",
      mineruWrapper: args["mineru-wrapper"],
      dryRun: Boolean(args["dry-run"]),
      deck: {
        title: args.title,
        audience: args.audience,
        language: args.language || args.lang || "zh",
        page_count: args.pages || args["page-count"],
        aspect_ratio: args["aspect-ratio"] || "16:9",
      },
      style: {
        description: args.style,
        typography: args.typography,
      },
    });
    process.stdout.write(`${JSON.stringify({ protocol: protocolPath, assetIndex: result.assetIndexPath, assets: result.assets, pages: result.pages, warnings: result.warnings }, null, 2)}\n`);
    return;
  }

  if (command === "validate-deck-protocol") {
    const protocolPath = resolvePath(requireArg(args, "protocol"));
    const protocol = await readJson(protocolPath);
    const report = await validateDeckProtocolAsync(protocol, {
      baseDir: path.dirname(protocolPath),
      requireGeneratedPng: Boolean(args["require-generated-png"]),
    });
    if (!report.ok) {
      throw new Error(`Invalid deck protocol:\n${report.errors.join("\n")}`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (command === "protocol-add-asset") {
    const result = await patchProtocolFile({
      protocolPath: resolvePath(requireArg(args, "protocol")),
      op: "add-asset",
      payload: { asset: parseJsonArg(requireArg(args, "asset"), "asset") },
      auditNote: args["audit-note"] || "",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "protocol-bind-asset") {
    const result = await patchProtocolFile({
      protocolPath: resolvePath(requireArg(args, "protocol")),
      op: "bind-asset",
      payload: {
        page: requireArg(args, "page"),
        assetId: requireArg(args, "asset-id"),
        inputType: args["input-type"],
      },
      auditNote: args["audit-note"] || "",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "protocol-update-page") {
    const result = await patchProtocolFile({
      protocolPath: resolvePath(requireArg(args, "protocol")),
      op: "update-page",
      payload: {
        page: requireArg(args, "page"),
        patch: parseJsonArg(requireArg(args, "patch"), "patch"),
      },
      auditNote: args["audit-note"] || "",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "protocol-set-fidelity") {
    const result = await patchProtocolFile({
      protocolPath: resolvePath(requireArg(args, "protocol")),
      op: "set-fidelity",
      payload: {
        page: requireArg(args, "page"),
        fidelity: requireArg(args, "fidelity"),
      },
      auditNote: args["audit-note"] || "",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "asset-index-create") {
    const outDir = resolvePath(requireArg(args, "out-dir"));
    const indexPath = resolvePath(args.out || path.join(outDir, "reference-assets/asset-index.json"));
    const index = await createAssetIndex({
      sources: args.sources || [],
      outDir,
      indexPath,
      caption: args.caption || "",
      usage: args.usage || "evidence",
    });
    process.stdout.write(`${JSON.stringify({ assetIndex: indexPath, assets: index.assets.length, duplicates: index.duplicates.length }, null, 2)}\n`);
    return;
  }

  if (command === "imagegen-jobs-create") {
    const protocolPath = resolvePath(requireArg(args, "protocol"));
    const outPath = resolvePath(requireArg(args, "out"));
    const result = await createJobsFile({ protocolPath, outPath });
    process.stdout.write(`${JSON.stringify({ jobs: outPath, summary: result.summary }, null, 2)}\n`);
    return;
  }

  if (command === "imagegen-jobs-status") {
    const jobsPath = resolvePath(requireArg(args, "jobs"));
    const jobs = await readJson(jobsPath);
    process.stdout.write(`${JSON.stringify({ jobs: jobsPath, summary: summarizeJobs(jobs) }, null, 2)}\n`);
    return;
  }

  if (command === "imagegen-jobs-backfill") {
    const jobsPath = resolvePath(requireArg(args, "jobs"));
    const result = await backfillJobsFile({
      jobsPath,
      page: requireArg(args, "page"),
      pngPath: resolvePath(requireArg(args, "png")),
      status: args.status || "generated",
      note: args.note || "",
      executionSummary: args["execution-summary"] ? parseJsonArg(args["execution-summary"], "execution-summary") : null,
    });
    process.stdout.write(`${JSON.stringify({ jobs: jobsPath, summary: result.summary }, null, 2)}\n`);
    return;
  }

  if (command === "imagegen-jobs-review") {
    const jobsPath = resolvePath(requireArg(args, "jobs"));
    const result = await reviewJobsFile({
      jobsPath,
      page: requireArg(args, "page"),
      verdict: args.verdict || null,
      note: args.note || "",
      reviewer: args.reviewer || "",
      revisionSuggestion: args["revision-suggestion"] || "",
      consistency: args.consistency || null,
      protocolAlignment: args["protocol-alignment"] || null,
      basicImageQuality: args["basic-image-quality"] || null,
      referenceFidelity: args["reference-fidelity"] || null,
      textLegibility: args["text-legibility"] || null,
      artifactQuality: args["artifact-quality"] || null,
    });
    process.stdout.write(`${JSON.stringify({ jobs: jobsPath, page: result.page.page, status: result.page.status, review: result.page.review, summary: result.summary }, null, 2)}\n`);
    return;
  }

  if (command === "imagegen-jobs-revise") {
    const jobsPath = resolvePath(requireArg(args, "jobs"));
    const result = await reviseJobsFile({
      jobsPath,
      page: requireArg(args, "page"),
      note: args.note || "",
      reviewer: args.reviewer || "",
      revisionSuggestion: args["revision-suggestion"] || "",
    });
    process.stdout.write(`${JSON.stringify({ jobs: jobsPath, page: result.page.page, status: result.page.status, revision: result.page.revision, summary: result.summary }, null, 2)}\n`);
    return;
  }

  if (command === "imagegen-jobs-to-manifest") {
    const jobsPath = resolvePath(requireArg(args, "jobs"));
    const outPath = resolvePath(requireArg(args, "out"));
    const result = await jobsToManifestFile({
      jobsPath,
      outPath,
      requireAccepted: args["require-accepted"] ? true : null,
    });
    process.stdout.write(`${JSON.stringify({ manifest: outPath, items: result.manifest.items.length, summary: result.summary }, null, 2)}\n`);
    return;
  }

  if (command === "visual-qa") {
    const report = await runVisualQaFile({
      protocolPath: resolvePath(requireArg(args, "protocol")),
      jobsPath: resolvePath(requireArg(args, "jobs")),
      outPath: resolvePath(requireArg(args, "out")),
      manualOverrideNote: args["manual-override-note"] || "",
    });
    if (report.status === "fail") {
      throw new Error(`Visual QA failed:\n${report.findings.map((finding) => `${finding.code}: ${finding.message}`).join("\n")}`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (command === "pptx-reference-intake") {
    const inputPath = resolvePath(requireArg(args, "input"));
    const outDir = resolvePath(requireArg(args, "out-dir"));
    const indexPath = resolvePath(args["index-out"] || path.join(outDir, "reference-assets/asset-index.json"));
    const result = await pptxReferenceIntake({
      inputPath,
      outDir,
      indexPath,
      protocolPath: args.protocol ? resolvePath(args.protocol) : null,
    });
    process.stdout.write(`${JSON.stringify({ assetIndex: indexPath, media: result.media.length, theme: result.theme, thumbnails: result.thumbnails, warnings: result.warnings }, null, 2)}\n`);
    return;
  }

  if (command === "asset-plan") {
    const specPath = resolvePath(requireArg(args, "spec"));
    const outPath = resolvePath(requireArg(args, "out"));
    const spec = await readJson(specPath);
    const plan = planAssets(spec, {
      specPath,
      defaults: {
        size: args.size || "1536x864",
        quality: args.quality || undefined,
        provider: args.provider || "codex",
        model: args.model || "gpt-image-2",
        mode: args.mode || args["asset-mode"],
        visualPolicy: args["visual-policy"] || args.visualPolicy,
        outputDir: args["asset-dir"] || "generated-assets",
      },
    });
    await writeJson(outPath, plan);
    process.stdout.write(`${JSON.stringify({ assetPlan: outPath, requests: plan.requests.length }, null, 2)}\n`);
    return;
  }

  if (command === "visual-plan") {
    const outPath = resolvePath(requireArg(args, "out"));
    const protocolPath = args.protocol ? resolvePath(args.protocol) : null;
    const specPath = args.spec ? resolvePath(args.spec) : null;
    const parseBundlePath = args["parse-bundle"] ? resolvePath(args["parse-bundle"]) : null;
    const markdownPath = args.markdown ? resolvePath(args.markdown) : args.input ? resolvePath(args.input) : null;
    if (!protocolPath && !specPath && !parseBundlePath && !markdownPath) {
      throw new Error("visual-plan requires --protocol, --spec, --parse-bundle, or --markdown");
    }
    const protocol = protocolPath ? await readJson(protocolPath) : null;
    const spec = specPath ? await readJson(specPath) : null;
    const parseBundle = parseBundlePath ? await readJson(parseBundlePath) : null;
    const markdown = markdownPath ? await readFile(markdownPath, "utf8") : null;
    const plan = await buildVisualPlan({
      protocol,
      spec,
      markdown,
      parseBundle,
      sourcePath: protocolPath || specPath || markdownPath || parseBundlePath,
      outputPath: outPath,
      defaults: {
        size: args.size || "1536x864",
        quality: args.quality || "medium",
        provider: args.provider || "codex",
        model: args.model || "gpt-image-2",
        outputDir: args["asset-dir"] || "generated-assets",
      },
    });
    await writeJson(outPath, plan);
    const promptSheetPath = args["prompt-sheet"] ? resolvePath(args["prompt-sheet"]) : null;
    if (promptSheetPath) {
      await mkdir(path.dirname(promptSheetPath), { recursive: true });
      await writePromptSheet(plan, promptSheetPath);
    }
    process.stdout.write(`${JSON.stringify({ visualPlan: outPath, pages: plan.pages.length, promptSheet: promptSheetPath }, null, 2)}\n`);
    return;
  }

  if (command === "generate-assets") {
    const planPath = resolvePath(requireArg(args, "plan"));
    const outDir = resolvePath(requireArg(args, "out-dir"));
    const plan = await readJson(planPath);
    const manifest = await generateAssets(plan, {
      planPath,
      outDir,
      provider: args.provider || plan.defaults?.provider || "codex",
      model: args.model || plan.defaults?.model,
      apiKey: args["api-key"],
    });
    const manifestPath = resolvePath(args.out || path.join(outDir, "asset-manifest.json"));
    await writeJson(manifestPath, manifest);
    process.stdout.write(`${JSON.stringify({ manifest: manifestPath, summary: manifest.summary }, null, 2)}\n`);
    return;
  }

  if (command === "generate-image-deck") {
    const visualPlanPath = resolvePath(requireArg(args, "visual-plan"));
    const assetManifestPath = resolvePath(requireArg(args, "asset-manifest"));
    const outPath = resolvePath(requireArg(args, "out"));
    const visualPlan = await readJson(visualPlanPath);
    const assetManifest = await readJson(assetManifestPath);
    const spec = await imageDeckSpecFromVisualPlan(visualPlan, { assetManifest, outputPath: outPath });
    await writeJson(outPath, spec);
    process.stdout.write(`${JSON.stringify({ slideSpec: outPath, slides: spec.slides.length, editability: spec.deck.editability, visualPolicy: spec.deck.visualPolicy }, null, 2)}\n`);
    return;
  }

  if (command === "enhance-spec") {
    const specPath = resolvePath(requireArg(args, "spec"));
    const outPath = resolvePath(requireArg(args, "out"));
    const spec = await readJson(specPath);
    const assetManifest = args["asset-manifest"] ? await readJson(resolvePath(args["asset-manifest"])) : null;
    const enhanced = enhanceSlideSpec(spec, {
      specPath,
      outputPath: outPath,
      assetManifest,
      template: args.template || "consulting-research",
      visualPolicy: args["visual-policy"] || args.visualPolicy || "native-only",
      visualSlideFallback: Boolean(args["visual-slide-fallback"]),
    });
    await writeJson(outPath, enhanced);
    process.stdout.write(`${JSON.stringify({ slideSpec: outPath, slides: enhanced.slides.length, template: enhanced.theme?.template }, null, 2)}\n`);
    return;
  }

  if (command === "infographic-deck") {
    const outPath = resolvePath(requireArg(args, "out"));
    const images = (args.images || []).map((imagePath) => resolvePath(imagePath));
    const markdown = args.input ? await readFile(resolvePath(args.input), "utf8") : null;
    const baseSpec = args.spec ? await readJson(resolvePath(args.spec)) : null;
    const assetManifest = args["asset-manifest"] ? await readJson(resolvePath(args["asset-manifest"])) : null;
    const spec = await infographicDeckSpec({
      markdown,
      images,
      baseSpec,
      title: args.title,
      sourcePath: args.input ? resolvePath(args.input) : args.spec ? resolvePath(args.spec) : null,
      outputPath: outPath,
      assetManifest,
      fullSlide: Boolean(args["full-slide"] || args["raster-only"]),
    });
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeJson(outPath, spec);
    process.stdout.write(`${JSON.stringify({ slideSpec: outPath, slides: spec.slides.length, editability: spec.deck.editability }, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}\n${USAGE}`);
}

function parseJsonArg(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for --${label}: ${error.message}`);
  }
}

main().catch((error) => {
  process.stderr.write(`ppt-composer: ${error.message}\n`);
  process.exitCode = 1;
});
