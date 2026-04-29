#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
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
import { createProtocolReview } from "./protocol-review.mjs";
import { readJson, resolvePath } from "./lib.mjs";
import { runComposerDoctor } from "./composer-doctor.mjs";

const server = new McpServer({
  name: "ppt-render-mcp",
  version: "0.1.0",
});


server.registerTool(
  "ppt_composer_doctor",
  {
    title: "PPT Composer Doctor",
    description: "Check PPT Composer installation, MCP timeouts, uvx/MinerU readiness, token mode, and env-file setup guidance.",
    inputSchema: {
      createEnvTemplate: z.boolean().optional().describe("Create a private env template if it does not already exist."),
      envPath: z.string().optional().describe("Optional env template path when createEnvTemplate is true."),
    },
  },
  async ({ createEnvTemplate, envPath }) => {
    const result = await runComposerDoctor({
      createEnvTemplate: Boolean(createEnvTemplate),
      envPath,
    });
    return jsonToolResult(result);
  },
);

server.registerTool(
  "render_pptx",
  {
    title: "Render PPTX",
    description: "Render a slide-spec JSON file into an editable PowerPoint PPTX using PptxGenJS.",
    inputSchema: {
      specPath: z.string().describe("Path to slide-spec JSON."),
      outPath: z.string().describe("Output .pptx path."),
    },
  },
  async ({ specPath, outPath }) => {
    const resolvedSpec = resolvePath(specPath);
    const resolvedOut = resolvePath(outPath);
    const spec = await readJson(resolvedSpec);
    const result = await renderPptx(spec, { specPath: resolvedSpec, outPath: resolvedOut });
    return jsonToolResult(result);
  },
);

server.registerTool(
  "qa_pptx",
  {
    title: "QA PPTX",
    description: "Inspect a PPTX and optional slide-spec for structure, missing assets, and editability warnings.",
    inputSchema: {
      pptxPath: z.string().describe("Path to .pptx file."),
      specPath: z.string().optional().describe("Optional slide-spec JSON path."),
      outPath: z.string().optional().describe("Optional QA JSON output path."),
    },
  },
  async ({ pptxPath, specPath, outPath }) => {
    const resolvedPptx = resolvePath(pptxPath);
    const resolvedSpec = specPath ? resolvePath(specPath) : null;
    const spec = resolvedSpec ? await readJson(resolvedSpec) : null;
    const report = await runQa({ pptxPath: resolvedPptx, spec, specPath: resolvedSpec });
    if (outPath) await writeJson(resolvePath(outPath), report);
    return jsonToolResult(report);
  },
);

server.registerTool(
  "protocol_patch",
  {
    title: "Protocol Patch",
    description: "Patch deck-protocol.json through validated operations instead of hand-editing JSON.",
    inputSchema: {
      protocolPath: z.string().describe("deck-protocol.json path."),
      operation: z.enum(["add-asset", "bind-asset", "update-page", "set-fidelity"]).describe("Patch operation."),
      payload: z.any().describe("Operation payload."),
      auditNote: z.string().optional().describe("Optional audit log note."),
    },
  },
  async ({ protocolPath, operation, payload, auditNote }) => {
    const result = await patchProtocolFile({
      protocolPath: resolvePath(protocolPath),
      op: operation,
      payload,
      auditNote: auditNote || "",
    });
    return jsonToolResult(result);
  },
);

server.registerTool(
  "asset_index_create",
  {
    title: "Asset Index Create",
    description: "Localize reference files or URLs and write reference-assets/asset-index.json with hashes, MIME, size, caption, and usage.",
    inputSchema: {
      sources: z.array(z.string()).min(1).describe("Local files or remote URLs."),
      outDir: z.string().describe("Working directory."),
      indexPath: z.string().optional().describe("Output asset-index.json path."),
      caption: z.string().optional().describe("Default caption."),
      usage: z.string().optional().describe("Default usage."),
    },
  },
  async ({ sources, outDir, indexPath, caption, usage }) => {
    const resolvedOut = resolvePath(outDir);
    const resolvedIndex = resolvePath(indexPath || path.join(resolvedOut, "reference-assets/asset-index.json"));
    const index = await createAssetIndex({
      sources: sources.map((source) => /^https?:\/\//i.test(source) ? source : resolvePath(source)),
      outDir: resolvedOut,
      indexPath: resolvedIndex,
      caption: caption || "",
      usage: usage || "evidence",
    });
    return jsonToolResult({ assetIndex: resolvedIndex, assets: index.assets.length, duplicates: index.duplicates.length });
  },
);

server.registerTool(
  "imagegen_jobs_create",
  {
    title: "Imagegen Jobs Create",
    description: "Create imagegen-jobs.json from deck-protocol.json without changing protocol content.",
    inputSchema: {
      protocolPath: z.string().describe("deck-protocol.json path."),
      outPath: z.string().describe("Output imagegen-jobs.json path."),
    },
  },
  async ({ protocolPath, outPath }) => {
    const resolvedProtocol = resolvePath(protocolPath);
    const resolvedOut = resolvePath(outPath);
    const result = await createJobsFile({ protocolPath: resolvedProtocol, outPath: resolvedOut });
    return jsonToolResult({ jobs: resolvedOut, summary: result.summary });
  },
);

server.registerTool(
  "imagegen_jobs_status",
  {
    title: "Imagegen Jobs Status",
    description: "Summarize imagegen-jobs.json completion state.",
    inputSchema: {
      jobsPath: z.string().describe("imagegen-jobs.json path."),
    },
  },
  async ({ jobsPath }) => {
    const resolvedJobs = resolvePath(jobsPath);
    const jobs = await readJson(resolvedJobs);
    return jsonToolResult({ jobs: resolvedJobs, summary: summarizeJobs(jobs) });
  },
);

server.registerTool(
  "imagegen_jobs_backfill",
  {
    title: "Imagegen Jobs Backfill",
    description: "Backfill one generated PNG into imagegen-jobs.json after validating it is a real PNG and not a placeholder.",
    inputSchema: {
      jobsPath: z.string().describe("imagegen-jobs.json path."),
      page: z.number().describe("Page number."),
      pngPath: z.string().describe("Generated PNG path."),
      status: z.enum(["generated", "needs_review", "accepted"]).optional().describe("Backfilled status."),
      note: z.string().optional().describe("Optional note."),
      executionSummary: z.object({
        claim_followed: z.union([z.boolean(), z.string()]).describe("Whether the generated image follows the page claim."),
        reference_assets_used: z.union([z.boolean(), z.string()]).describe("Whether assigned reference assets were used."),
        fidelity_followed: z.union([z.boolean(), z.string()]).describe("Whether the fidelity mode was followed."),
        negative_prompt_avoided: z.union([z.boolean(), z.string()]).describe("Whether negative prompt constraints were avoided."),
        uncertainties: z.union([z.string(), z.array(z.string())]).optional().describe("Any uncertainty the worker wants the leader/reviewer to know."),
      }).optional().describe("Short worker execution checklist."),
    },
  },
  async ({ jobsPath, page, pngPath, status, note, executionSummary }) => {
    const resolvedJobs = resolvePath(jobsPath);
    const result = await backfillJobsFile({
      jobsPath: resolvedJobs,
      page,
      pngPath: resolvePath(pngPath),
      status: status || "generated",
      note: note || "",
      executionSummary: executionSummary || null,
    });
    return jsonToolResult({ jobs: resolvedJobs, summary: result.summary });
  },
);

server.registerTool(
  "imagegen_jobs_review",
  {
    title: "Imagegen Jobs Review",
    description: "Record a per-page visual review across consistency, protocol alignment, reference fidelity, text legibility, and artifact quality.",
    inputSchema: {
      jobsPath: z.string().describe("imagegen-jobs.json path."),
      page: z.number().describe("Page number."),
      verdict: z.enum(["pass", "warn", "fail"]).optional().describe("Overall review verdict. Omit to mark the page as needing review."),
      consistency: z.enum(["pass", "warn", "fail"]).optional().describe("Whether the page is visually consistent with the confirmed deck style."),
      protocolAlignment: z.enum(["pass", "warn", "fail"]).optional().describe("Whether the generated image follows the page protocol."),
      referenceFidelity: z.enum(["pass", "warn", "fail"]).optional().describe("Whether referenced assets, figures, tables, numbers, logos, and captions are preserved."),
      textLegibility: z.enum(["pass", "warn", "fail"]).optional().describe("Whether visible slide text is readable."),
      artifactQuality: z.enum(["pass", "warn", "fail"]).optional().describe("Whether the generated image avoids obvious artifacts."),
      basicImageQuality: z.enum(["pass", "warn", "fail"]).optional().describe("Deprecated alias for artifactQuality."),
      note: z.string().optional().describe("Review note."),
      revisionSuggestion: z.string().optional().describe("Suggested page revision when verdict is fail or warn."),
      reviewer: z.string().optional().describe("Reviewer identifier."),
    },
  },
  async ({
    jobsPath,
    page,
    verdict,
    consistency,
    protocolAlignment,
    referenceFidelity,
    textLegibility,
    artifactQuality,
    basicImageQuality,
    note,
    revisionSuggestion,
    reviewer,
  }) => {
    const resolvedJobs = resolvePath(jobsPath);
    const result = await reviewJobsFile({
      jobsPath: resolvedJobs,
      page,
      verdict: verdict || null,
      consistency: consistency || null,
      protocolAlignment: protocolAlignment || null,
      referenceFidelity: referenceFidelity || null,
      textLegibility: textLegibility || null,
      artifactQuality: artifactQuality || null,
      basicImageQuality: basicImageQuality || null,
      note: note || "",
      revisionSuggestion: revisionSuggestion || "",
      reviewer: reviewer || "",
    });
    return jsonToolResult({ jobs: resolvedJobs, page: result.page.page, status: result.page.status, review: result.page.review, summary: result.summary });
  },
);

server.registerTool(
  "imagegen_jobs_revise",
  {
    title: "Imagegen Jobs Revise",
    description: "Mark one page for regeneration while preserving its previous PNG as a superseded attempt.",
    inputSchema: {
      jobsPath: z.string().describe("imagegen-jobs.json path."),
      page: z.number().describe("Page number."),
      note: z.string().optional().describe("Revision note."),
      revisionSuggestion: z.string().optional().describe("Prompt/layout changes to apply in deck-protocol.json before regeneration."),
      reviewer: z.string().optional().describe("Reviewer identifier."),
    },
  },
  async ({ jobsPath, page, note, revisionSuggestion, reviewer }) => {
    const resolvedJobs = resolvePath(jobsPath);
    const result = await reviseJobsFile({
      jobsPath: resolvedJobs,
      page,
      note: note || "",
      revisionSuggestion: revisionSuggestion || "",
      reviewer: reviewer || "",
    });
    return jsonToolResult({ jobs: resolvedJobs, page: result.page.page, status: result.page.status, revision: result.page.revision, summary: result.summary });
  },
);

server.registerTool(
  "imagegen_jobs_to_manifest",
  {
    title: "Imagegen Jobs To Manifest",
    description: "Create png-manifest.json only after all imagegen jobs are generated/accepted, or accepted when visual review is enabled.",
    inputSchema: {
      jobsPath: z.string().describe("imagegen-jobs.json path."),
      outPath: z.string().describe("Output png-manifest.json path."),
      requireAccepted: z.boolean().optional().describe("Require every page to be accepted before manifest creation."),
    },
  },
  async ({ jobsPath, outPath, requireAccepted }) => {
    const resolvedJobs = resolvePath(jobsPath);
    const resolvedOut = resolvePath(outPath);
    const result = await jobsToManifestFile({
      jobsPath: resolvedJobs,
      outPath: resolvedOut,
      requireAccepted: requireAccepted === undefined ? null : Boolean(requireAccepted),
    });
    return jsonToolResult({ manifest: resolvedOut, items: result.manifest.items.length, summary: result.summary });
  },
);

server.registerTool(
  "visual_qa",
  {
    title: "Visual QA",
    description: "Run deterministic PNG and image-first visual gate checks before final manifest assembly.",
    inputSchema: {
      protocolPath: z.string().describe("deck-protocol.json path."),
      jobsPath: z.string().describe("imagegen-jobs.json path."),
      outPath: z.string().describe("Output visual QA report path."),
      manualOverrideNote: z.string().optional().describe("Required note for a manual override."),
    },
  },
  async ({ protocolPath, jobsPath, outPath, manualOverrideNote }) => {
    const report = await runVisualQaFile({
      protocolPath: resolvePath(protocolPath),
      jobsPath: resolvePath(jobsPath),
      outPath: resolvePath(outPath),
      manualOverrideNote: manualOverrideNote || "",
    });
    if (report.status === "fail") throw new Error(`Visual QA failed:\n${report.findings.map((finding) => `${finding.code}: ${finding.message}`).join("\n")}`);
    return jsonToolResult(report);
  },
);

server.registerTool(
  "pptx_reference_intake",
  {
    title: "PPTX Reference Intake",
    description: "Extract PPTX OOXML theme, fonts, media, relationships, and optional LibreOffice thumbnails into an asset index.",
    inputSchema: {
      inputPath: z.string().describe("Reference PPTX path."),
      outDir: z.string().describe("Working directory."),
      indexPath: z.string().optional().describe("Output asset-index.json path."),
      protocolPath: z.string().optional().describe("Optional deck-protocol.json to update style/assets."),
    },
  },
  async ({ inputPath, outDir, indexPath, protocolPath }) => {
    const resolvedOut = resolvePath(outDir);
    const resolvedIndex = resolvePath(indexPath || path.join(resolvedOut, "reference-assets/asset-index.json"));
    const result = await pptxReferenceIntake({
      inputPath: resolvePath(inputPath),
      outDir: resolvedOut,
      indexPath: resolvedIndex,
      protocolPath: protocolPath ? resolvePath(protocolPath) : null,
    });
    return jsonToolResult({ assetIndex: resolvedIndex, media: result.media.length, theme: result.theme, thumbnails: result.thumbnails, warnings: result.warnings });
  },
);

server.registerTool(
  "markdown_to_slide_spec",
  {
    title: "Markdown To Slide Spec",
    description: "Convert a Markdown outline into native-first slide-spec JSON.",
    inputSchema: {
      inputPath: z.string().describe("Markdown input path."),
      outPath: z.string().describe("Output slide-spec JSON path."),
      title: z.string().optional().describe("Deck title override."),
    },
  },
  async ({ inputPath, outPath, title }) => {
    const resolvedInput = resolvePath(inputPath);
    const resolvedOut = resolvePath(outPath);
    const markdown = await readFile(resolvedInput, "utf8");
    const spec = markdownToSlideSpec(markdown, { title, sourcePath: resolvedInput });
    await writeJson(resolvedOut, spec);
    return jsonToolResult({ slideSpec: resolvedOut, slides: spec.slides.length });
  },
);

server.registerTool(
  "images_to_slide_spec",
  {
    title: "Images To Slide Spec",
    description: "Convert existing images into an image-first slide-spec JSON.",
    inputSchema: {
      images: z.array(z.string()).min(1).describe("Image file paths."),
      outPath: z.string().describe("Output slide-spec JSON path."),
      title: z.string().optional().describe("Deck title."),
    },
  },
  async ({ images, outPath, title }) => {
    const resolvedOut = resolvePath(outPath);
    const spec = await imagesToSlideSpec(images.map((imagePath) => resolvePath(imagePath)), { title });
    await writeJson(resolvedOut, spec);
    return jsonToolResult({ slideSpec: resolvedOut, slides: spec.slides.length, editability: spec.deck.editability });
  },
);

server.registerTool(
  "assemble_image_ppt",
  {
    title: "Assemble Image PPT",
    description: "Validate a PNG manifest and assemble an image-first PPTX with one full-slide PNG per slide.",
    inputSchema: {
      manifestPath: z.string().describe("PNG manifest with one generated .png path per slide."),
      outPath: z.string().describe("Output .pptx path."),
      specOutPath: z.string().optional().describe("Optional output image-first slide-spec JSON path."),
      title: z.string().optional().describe("Deck title override."),
    },
  },
  async ({ manifestPath, outPath, specOutPath, title }) => {
    const resolvedManifest = resolvePath(manifestPath);
    const resolvedOut = resolvePath(outPath);
    const resolvedSpecOut = resolvePath(specOutPath || `${resolvedOut}.spec.json`);
    const manifest = await readJson(resolvedManifest);
    const spec = await pngManifestToSlideSpec(manifest, {
      manifestPath: resolvedManifest,
      title: title || "Image-first PPT",
    });
    await writeJson(resolvedSpecOut, spec);
    const result = await renderPptx(spec, { specPath: resolvedSpecOut, outPath: resolvedOut });
    return jsonToolResult({ ...result, slideSpec: resolvedSpecOut });
  },
);

server.registerTool(
  "parse_paper_local",
  {
    title: "Parse Paper Local",
    description: "Parse Markdown directly; for PDF/Office/image extraction use mineru-open-mcp.parse_documents first, or use CLI parse-paper with an explicit local MinerU wrapper.",
    inputSchema: {
      inputPath: z.string().describe("Input paper path."),
      outDir: z.string().describe("Output parse-bundle directory."),
      lang: z.string().optional().describe("OCR language, e.g. en or ch."),
      mode: z.string().optional().describe("MinerU mode, e.g. auto, txt, or ocr."),
      dryRun: z.boolean().optional().describe("Validate MinerU command without running conversion."),
    },
  },
  async ({ inputPath, outDir, lang, mode, dryRun }) => {
    const result = await parsePaper({
      inputPath: resolvePath(inputPath),
      outDir: resolvePath(outDir),
      lang: lang || "en",
      mode: mode || "auto",
      dryRun: Boolean(dryRun),
    });
    return jsonToolResult(result);
  },
);

server.registerTool(
  "reference_intake",
  {
    title: "Reference Intake",
    description: "Parse reference files and write a pretty-printed deck-protocol.json before image generation.",
    inputSchema: {
      inputs: z.array(z.string()).optional().describe("Reference files: PDF, Markdown, DOCX, TXT, image, CSV, or TSV."),
      outDir: z.string().describe("Working directory for reference-assets and protocol output."),
      protocolPath: z.string().optional().describe("Output deck-protocol.json path."),
      title: z.string().optional().describe("Deck title."),
      audience: z.string().optional().describe("Target audience."),
      language: z.string().optional().describe("Deck language."),
      pageCount: z.number().optional().describe("Planned page count."),
      aspectRatio: z.string().optional().describe("Aspect ratio, default 16:9."),
      style: z.string().optional().describe("Global visual style."),
      mode: z.enum(["brief_mode", "reference_grounded_mode"]).optional().describe("Protocol mode."),
      imageRole: z.enum(["source_image", "template_image", "logo"]).optional().describe("Role for direct image inputs."),
      dryRun: z.boolean().optional().describe("Reserved for explicit local MinerU wrapper flows; PDF/Office/image extraction should use mineru-open-mcp first."),
    },
  },
  async ({ inputs, outDir, protocolPath, title, audience, language, pageCount, aspectRatio, style, mode, imageRole, dryRun }) => {
    const resolvedOutDir = resolvePath(outDir);
    const resolvedProtocol = resolvePath(protocolPath || path.join(resolvedOutDir, "deck-protocol.json"));
    const result = await referenceIntake({
      inputs: (inputs || []).map((inputPath) => resolvePath(inputPath)),
      outDir: resolvedOutDir,
      protocolPath: resolvedProtocol,
      lang: language || "zh",
      mode,
      imageRole: imageRole || "source_image",
      dryRun: Boolean(dryRun),
      deck: {
        title,
        audience,
        language: language || "zh",
        page_count: pageCount,
        aspect_ratio: aspectRatio || "16:9",
      },
      style: { description: style },
    });
    return jsonToolResult({ protocol: resolvedProtocol, assets: result.assets, pages: result.pages, warnings: result.warnings });
  },
);

server.registerTool(
  "validate_deck_protocol",
  {
    title: "Validate Deck Protocol",
    description: "Validate deck-protocol.json before visual planning or final PNG assembly.",
    inputSchema: {
      protocolPath: z.string().describe("deck-protocol.json path."),
      requireGeneratedPng: z.boolean().optional().describe("Also require each output_png to exist."),
    },
  },
  async ({ protocolPath, requireGeneratedPng }) => {
    const resolvedProtocol = resolvePath(protocolPath);
    const protocol = await readJson(resolvedProtocol);
    const report = await validateDeckProtocolAsync(protocol, {
      baseDir: path.dirname(resolvedProtocol),
      requireGeneratedPng: Boolean(requireGeneratedPng),
    });
    if (!report.ok) throw new Error(`Invalid deck protocol:\n${report.errors.join("\n")}`);
    return jsonToolResult(report);
  },
);

server.registerTool(
  "protocol_review",
  {
    title: "Protocol Review",
    description: "Write a human-readable deck-protocol.review.md before asking for protocol confirmation.",
    inputSchema: {
      protocolPath: z.string().describe("deck-protocol.json path."),
      outPath: z.string().describe("Output deck-protocol.review.md path."),
    },
  },
  async ({ protocolPath, outPath }) => {
    const resolvedProtocol = resolvePath(protocolPath);
    const resolvedOut = resolvePath(outPath);
    const protocol = await readJson(resolvedProtocol);
    const review = createProtocolReview(protocol, { protocolPath: resolvedProtocol });
    await mkdir(path.dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, review, "utf8");
    return jsonToolResult({ review: resolvedOut });
  },
);

server.registerTool(
  "plan_assets",
  {
    title: "Plan Assets",
    description: "Derive an asset generation plan from a slide spec for Codex prompt-sheet, OpenAI image, or explicit placeholder workflows.",
    inputSchema: {
      specPath: z.string().describe("Path to input slide-spec JSON."),
      outPath: z.string().describe("Output asset-plan JSON path."),
      size: z.string().optional().describe("Requested image size, e.g. 1536x864."),
      quality: z.string().optional().describe("Draft/final quality level."),
      provider: z.string().optional().describe("Preferred downstream provider: codex, openai, or explicit placeholder."),
      mode: z.enum(["supporting", "full-slide"]).optional().describe("Asset planning mode. supporting is deprecated for editable decks."),
      visualPolicy: z.enum(["native-only", "image-first", "hybrid"]).optional().describe("Visual policy; native-only produces no generated supporting requests."),
    },
  },
  async ({ specPath, outPath, size, quality, provider, mode, visualPolicy }) => {
    const resolvedSpec = resolvePath(specPath);
    const resolvedOut = resolvePath(outPath);
    const spec = await readJson(resolvedSpec);
    const plan = planAssets(spec, {
      specPath: resolvedSpec,
      defaults: { size, quality, provider, mode, visualPolicy },
    });
    await writeJson(resolvedOut, plan);
    return jsonToolResult({ assetPlan: resolvedOut, requests: plan.requests.length });
  },
);

server.registerTool(
  "visual_plan",
  {
    title: "Visual Plan",
    description: "Create an image-first full-slide visual plan and prompt sheet from a slide spec, Markdown file, or parse bundle.",
    inputSchema: {
      outPath: z.string().describe("Output visual-plan JSON path."),
      protocolPath: z.string().optional().describe("Optional deck-protocol JSON path."),
      specPath: z.string().optional().describe("Optional input slide-spec JSON path."),
      markdownPath: z.string().optional().describe("Optional markdown input path."),
      parseBundlePath: z.string().optional().describe("Optional parse-bundle JSON path."),
      promptSheetPath: z.string().optional().describe("Optional Markdown prompt sheet path."),
      size: z.string().optional().describe("Requested image size, e.g. 1536x864."),
      quality: z.string().optional().describe("Draft/final image quality level."),
      provider: z.string().optional().describe("Preferred downstream provider: codex, openai, or explicit placeholder."),
    },
  },
  async ({ outPath, protocolPath, specPath, markdownPath, parseBundlePath, promptSheetPath, size, quality, provider }) => {
    const resolvedOut = resolvePath(outPath);
    const resolvedProtocol = protocolPath ? resolvePath(protocolPath) : null;
    const resolvedSpec = specPath ? resolvePath(specPath) : null;
    const resolvedMarkdown = markdownPath ? resolvePath(markdownPath) : null;
    const resolvedParseBundle = parseBundlePath ? resolvePath(parseBundlePath) : null;
    if (!resolvedProtocol && !resolvedSpec && !resolvedMarkdown && !resolvedParseBundle) {
      throw new Error("visual_plan requires protocolPath, specPath, markdownPath, or parseBundlePath");
    }
    const protocol = resolvedProtocol ? await readJson(resolvedProtocol) : null;
    const spec = resolvedSpec ? await readJson(resolvedSpec) : null;
    const markdown = resolvedMarkdown ? await readFile(resolvedMarkdown, "utf8") : null;
    const parseBundle = resolvedParseBundle ? await readJson(resolvedParseBundle) : null;
    const plan = await buildVisualPlan({
      protocol,
      spec,
      markdown,
      parseBundle,
      sourcePath: resolvedProtocol || resolvedSpec || resolvedMarkdown || resolvedParseBundle,
      outputPath: resolvedOut,
      defaults: { size, quality, provider },
    });
    await writeJson(resolvedOut, plan);
    const resolvedPromptSheet = promptSheetPath ? resolvePath(promptSheetPath) : null;
    if (resolvedPromptSheet) {
      await mkdir(path.dirname(resolvedPromptSheet), { recursive: true });
      await writePromptSheet(plan, resolvedPromptSheet);
    }
    return jsonToolResult({ visualPlan: resolvedOut, pages: plan.pages.length, promptSheet: resolvedPromptSheet });
  },
);

server.registerTool(
  "generate_assets",
  {
    title: "Generate Assets",
    description: "Materialize an asset plan using blocking Codex $imagegen prompt sheets, the OpenAI Images API, or explicit placeholder SVGs for tests.",
    inputSchema: {
      planPath: z.string().describe("Path to asset-plan JSON."),
      outDir: z.string().describe("Output asset directory."),
      provider: z.string().optional().describe("codex, openai, or explicit placeholder."),
      manifestPath: z.string().optional().describe("Optional explicit output manifest path."),
      model: z.string().optional().describe("Image model, default gpt-image-2."),
    },
  },
  async ({ planPath, outDir, provider, manifestPath, model }) => {
    const resolvedPlan = resolvePath(planPath);
    const resolvedOutDir = resolvePath(outDir);
    const plan = await readJson(resolvedPlan);
    const manifest = await generateAssets(plan, {
      planPath: resolvedPlan,
      outDir: resolvedOutDir,
      provider: provider || plan.defaults?.provider || "codex",
      model,
    });
    const resolvedManifest = resolvePath(manifestPath || path.join(resolvedOutDir, "asset-manifest.json"));
    await writeJson(resolvedManifest, manifest);
    return jsonToolResult({ manifest: resolvedManifest, summary: manifest.summary });
  },
);

server.registerTool(
  "enhance_slide_spec",
  {
    title: "Enhance Slide Spec",
    description: "Upgrade a slide spec with consulting-research template chrome under an explicit visual policy.",
    inputSchema: {
      specPath: z.string().describe("Input slide-spec JSON path."),
      outPath: z.string().describe("Output enhanced slide-spec JSON path."),
      assetManifestPath: z.string().optional().describe("Optional asset manifest with generated image paths."),
      template: z.string().optional().describe("Template name, default consulting-research."),
      visualPolicy: z.enum(["native-only", "image-first", "hybrid"]).optional().describe("Generated image policy. Default native-only ignores generated assets on content slides."),
      visualSlideFallback: z.boolean().optional().describe("Create a separate generated-visual slide when no safe panel slot exists."),
    },
  },
  async ({ specPath, outPath, assetManifestPath, template, visualPolicy, visualSlideFallback }) => {
    const resolvedSpec = resolvePath(specPath);
    const resolvedOut = resolvePath(outPath);
    const spec = await readJson(resolvedSpec);
    const assetManifest = assetManifestPath ? await readJson(resolvePath(assetManifestPath)) : null;
    const enhanced = enhanceSlideSpec(spec, {
      specPath: resolvedSpec,
      outputPath: resolvedOut,
      assetManifest,
      template: template || "consulting-research",
      visualPolicy: visualPolicy || "native-only",
      visualSlideFallback: Boolean(visualSlideFallback),
    });
    await writeJson(resolvedOut, enhanced);
    return jsonToolResult({ slideSpec: resolvedOut, slides: enhanced.slides.length, template: enhanced.theme?.template });
  },
);

server.registerTool(
  "generate_image_deck_spec",
  {
    title: "Generate Image Deck Spec",
    description: "Assemble an image-first slide spec from a full-slide visual plan and a generated/backfilled asset manifest.",
    inputSchema: {
      visualPlanPath: z.string().describe("Input visual-plan JSON path."),
      assetManifestPath: z.string().describe("Asset manifest with generated full-slide image paths."),
      outPath: z.string().describe("Output image-first slide-spec JSON path."),
    },
  },
  async ({ visualPlanPath, assetManifestPath, outPath }) => {
    const resolvedPlan = resolvePath(visualPlanPath);
    const resolvedManifest = resolvePath(assetManifestPath);
    const resolvedOut = resolvePath(outPath);
    const visualPlan = await readJson(resolvedPlan);
    const assetManifest = await readJson(resolvedManifest);
    const spec = await imageDeckSpecFromVisualPlan(visualPlan, { assetManifest, outputPath: resolvedOut });
    await writeJson(resolvedOut, spec);
    return jsonToolResult({ slideSpec: resolvedOut, slides: spec.slides.length, editability: spec.deck.editability, visualPolicy: spec.deck.visualPolicy });
  },
);

server.registerTool(
  "infographic_deck_spec",
  {
    title: "Infographic Deck Spec",
    description: "Create an image-first infographic slide-spec from markdown, images, or an existing slide spec.",
    inputSchema: {
      outPath: z.string().describe("Output slide-spec JSON path."),
      inputPath: z.string().optional().describe("Optional markdown or spec input path."),
      inputType: z.enum(["markdown", "spec"]).optional().describe("Interpret inputPath as markdown or slide spec."),
      images: z.array(z.string()).optional().describe("Optional image file paths."),
      assetManifestPath: z.string().optional().describe("Optional generated asset manifest."),
      title: z.string().optional().describe("Deck title override."),
      fullSlide: z.boolean().optional().describe("Use generated images as full-slide raster pages."),
    },
  },
  async ({ outPath, inputPath, inputType, images, assetManifestPath, title, fullSlide }) => {
    const resolvedOut = resolvePath(outPath);
    const resolvedInput = inputPath ? resolvePath(inputPath) : null;
    const markdown = resolvedInput && inputType !== "spec" ? await readFile(resolvedInput, "utf8") : null;
    const baseSpec = resolvedInput && inputType === "spec" ? await readJson(resolvedInput) : null;
    const assetManifest = assetManifestPath ? await readJson(resolvePath(assetManifestPath)) : null;
    const spec = await infographicDeckSpec({
      markdown,
      images: (images || []).map((imagePath) => resolvePath(imagePath)),
      baseSpec,
      title,
      sourcePath: resolvedInput,
      outputPath: resolvedOut,
      assetManifest,
      fullSlide: Boolean(fullSlide),
    });
    await writeJson(resolvedOut, spec);
    return jsonToolResult({ slideSpec: resolvedOut, slides: spec.slides.length, editability: spec.deck.editability });
  },
);

async function writeJson(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function jsonToolResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("ppt-render-mcp failed:", error);
  process.exit(1);
});
