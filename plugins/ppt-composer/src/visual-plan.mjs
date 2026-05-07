import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { markdownToSlideSpec } from "./markdown-to-slide-spec.mjs";
import { visualPlanFromDeckProtocol } from "./deck-protocol.mjs";
import { isFile, slugify } from "./lib.mjs";

export async function buildVisualPlan({ spec = null, markdown = null, parseBundle = null, protocol = null, sourcePath = null, outputPath = null, defaults = {} } = {}) {
  if (protocol) {
    return visualPlanFromDeckProtocol(protocol, { outputPath, defaults });
  }

  const baseSpec = spec || await specFromMarkdownOrBundle({ markdown, parseBundle });
  const deckTitle = baseSpec.deck?.title || defaults.title || "Image-first deck";
  const size = defaults.size || "1536x864";
  const quality = defaults.quality || "medium";
  const provider = defaults.provider || "codex";
  const model = defaults.model || "gpt-image-2";
  const pages = [];
  const requests = [];

  for (const [index, slide] of (baseSpec.slides || []).entries()) {
    const page = buildVisualPage({ slide, index, deckTitle, sourcePath, parseBundle });
    pages.push(page);
    requests.push(buildRequest({ page, index, size, quality, provider }));
  }

  return {
    version: "0.1",
    kind: "ppt-visual-plan",
    createdAt: new Date().toISOString(),
    source: {
      spec: sourcePath || null,
      parseBundle: parseBundle?.input || parseBundle?.markdown || null,
    },
    deck: {
      title: deckTitle,
      editability: "image-first",
      visualPolicy: "image-first",
      warning: "Image-first decks are low-editability: each slide is a full-slide raster visual.",
    },
    defaults: {
      model,
      provider,
      mode: "full-slide",
      size,
      quality,
      background: defaults.background || "opaque",
      outputDir: defaults.outputDir || "generated-assets",
      sourceSpecDir: outputPath ? path.dirname(outputPath) : process.cwd(),
    },
    pages,
    requests,
    assetRequests: requests,
  };
}

export async function imageDeckSpecFromVisualPlan(visualPlan, { assetManifest = null, outputPath = null } = {}) {
  const manifestItems = new Map();
  for (const item of assetManifest?.items || []) {
    if (item.status !== "generated" || !item.path) continue;
    manifestItems.set(item.slideId, item);
    if (item.assetId) manifestItems.set(item.assetId, item);
    if (item.requestId) manifestItems.set(item.requestId, item);
  }

  const assets = [];
  const slides = [];

  for (const [index, page] of (visualPlan.pages || []).entries()) {
    const request = (visualPlan.requests || []).find((item) => item.slideId === page.slideId || item.assetId === page.assetId);
    const manifestItem = manifestItems.get(page.slideId) || manifestItems.get(page.assetId) || manifestItems.get(request?.id);
    const assetId = manifestItem?.assetId || request?.assetId || page.assetId || slugify(`${page.slideId}-full-slide`);
    if (!manifestItem?.path) {
      throw new Error(
        `Image-first slide ${page.slideId || index + 1} is missing a generated full-slide image. ` +
        "Prompt sheets are not final output. Run the Codex $imagegen prompts and backfill the manifest with PNG paths before assembly.",
      );
    }
    if (manifestItem.provider === "placeholder" || manifestItem.source === "placeholder") {
      throw new Error(
        `Image-first slide ${page.slideId || index + 1} uses a placeholder asset. ` +
        "Placeholders are not final output; generate a real PNG before assembly.",
      );
    }
    if (!isPngPath(manifestItem.path)) {
      throw new Error(
        `Image-first slide ${page.slideId || index + 1} must use a generated PNG path for final output. ` +
        "Use PNG assets from Codex $imagegen unless the user explicitly approved an API image-generation fallback; SVG, HTML, prompt sheets, screenshots, local renderers, and non-PNG paths are not accepted.",
      );
    }
    if (manifestItem?.path) {
      assets.push({
        id: assetId,
        type: "image",
        path: toSpecRelative(outputPath, manifestItem.path),
        source: sourceForManifestItem(manifestItem),
        provider: manifestItem.provider,
        usage: "full-slide",
        caption: page.title || page.claim || assetId,
        prompt: page.prompt,
        editableTextPolicy: "image-first",
      });
    }
    slides.push({
      id: page.slideId || `s${index + 1}`,
      title: page.title || page.claim || `Slide ${index + 1}`,
      layout: "full-slide-image",
      visualPolicy: "image-first",
      objects: [
        {
          id: `full-slide-image-${index + 1}`,
          type: "image",
          assetId,
          position: { x: 0, y: 0, w: 13.333, h: 7.5 },
        },
      ],
      notes: [
        "Image-first slide. Core content is intentionally low-editability.",
        page.claim ? `Claim: ${page.claim}` : null,
        page.sourceEvidence?.length ? `Evidence: ${page.sourceEvidence.join("; ")}` : null,
      ].filter(Boolean).join(" "),
    });
  }

  return {
    version: "0.1",
    deck: {
      title: visualPlan.deck?.title || "Image-first deck",
      audience: visualPlan.deck?.audience || "general",
      language: visualPlan.deck?.language || "en",
      format: "16:9",
      editability: "image-first",
      visualPolicy: "image-first",
      warning: "Low-editability image-first deck: every slide is a full-slide raster visual.",
    },
    theme: {
      template: "image-first-generated",
      palette: ["#0F172A", "#2563EB", "#F8FAFC", "#E5E7EB"],
      fonts: { heading: "Aptos Display", body: "Aptos" },
    },
    assets,
    visualPlan: {
      sourcePlan: visualPlan.source || null,
      pages: visualPlan.pages || [],
    },
    slides,
  };
}

export async function writePromptSheet(visualPlan, promptSheetPath) {
  const sections = [
    "# Image-first full-slide prompt sheet",
    "",
    "This is a blocking intermediate artifact, not a completed image-first deck.",
    "",
    "Use each prompt with `$imagegen`, save the generated PNG at the expected output path, then update the asset manifest with `status: generated`, `assetId`, `slideId`, and `path`.",
    "",
    "Do not run final assembly or report completion until every slide has a generated bitmap path.",
  ];

  for (const request of visualPlan.requests || []) {
    const page = (visualPlan.pages || []).find((item) => item.slideId === request.slideId) || {};
    sections.push(
      "",
      `## ${request.slideTitle || page.title || request.slideId}`,
      "",
      `Slide ID: ${request.slideId}`,
      `Claim: ${page.claim || ""}`,
      `Expected output: ${request.output}`,
      "",
      "```text",
      request.codexPrompt || `$imagegen ${request.prompt}`,
      "```",
    );
  }

  await writeFile(promptSheetPath, `${sections.join("\n")}\n`, "utf8");
  return promptSheetPath;
}

async function specFromMarkdownOrBundle({ markdown, parseBundle }) {
  if (markdown) return markdownToSlideSpec(markdown, { title: "Image-first deck" });
  if (parseBundle?.markdown && await isFile(parseBundle.markdown)) {
    const sourceMarkdown = await readFile(parseBundle.markdown, "utf8");
    return markdownToSlideSpec(sourceMarkdown, { sourcePath: parseBundle.markdown });
  }
  const title = parseBundle?.input ? path.basename(parseBundle.input, path.extname(parseBundle.input)) : "Image-first deck";
  return {
    version: "0.1",
    deck: { title, editability: "native-first", visualPolicy: "native-only" },
    slides: [{
      id: "s1",
      title,
      objects: [{ type: "text", text: title }],
      notes: parseBundle ? "Visual plan was built from parse-bundle metadata only." : "",
    }],
  };
}

function buildVisualPage({ slide, index, deckTitle, sourcePath, parseBundle }) {
  const slideId = slide.id || `s${index + 1}`;
  const title = slide.title || `Slide ${index + 1}`;
  const evidence = collectEvidence(slide, parseBundle).slice(0, 4);
  const claim = deriveClaim(slide, title, evidence);
  const layoutIntent = chooseLayoutIntent(slide, index);
  const negativePrompt = [
    "Do not invent data, citations, logos, UI chrome, watermarks, fake paper figures, tiny unreadable text, or decorative stock-photo filler.",
    "Do not redraw experimental curves unless they are explicitly described as schematic rather than measured data.",
  ].join(" ");
  const prompt = [
    "Use case: productivity-visual",
    "Asset type: finished full-slide 16:9 PowerPoint page image",
    `Primary request: Create one complete final full-slide research presentation image for the deck \"${deckTitle}\".`,
    "Important: this is not a blank background or base draft. Include the slide title, main claim, sparse labels, and visual hierarchy inside the generated image itself.",
    `Slide title: \"${title}\".`,
    `Main claim: ${claim}`,
    evidence.length ? `Source evidence to respect: ${evidence.join("; ")}.` : "Source evidence: use only the slide claim and source material; do not add unsupported facts.",
    `Layout intent: ${layoutIntent}.`,
    "Style/medium: polished scientific-consulting slide visual, clean hierarchy, generous whitespace, accurate research tone.",
    "Text policy: include only sparse, large, presentation-safe text inside the image; prefer short labels and visual structure over paragraphs.",
    `Avoid: ${negativePrompt}`,
  ].join("\n");

  return {
    slideId,
    slideIndex: index,
    assetId: slugify(`${slideId}-full-slide`),
    title,
    claim,
    sourceEvidence: evidence,
    sourcePath: sourcePath || parseBundle?.markdown || parseBundle?.input || null,
    layoutIntent,
    visualType: layoutIntent,
    prompt,
    negativePrompt,
    textPolicy: "finished-slide-image; include sparse large title/claim/labels inside the image; no separate PPT text overlay; no dense body copy; no fake citations or fabricated metrics",
    acceptanceChecks: [
      "full 16:9 slide composition",
      "not a blank background or base draft",
      "one clear main claim",
      "title and sparse labels are integrated inside the image",
      "no invented numeric results",
      "no tiny unreadable text",
      "no watermarks or UI chrome",
    ],
  };
}

function buildRequest({ page, index, size, quality, provider }) {
  return {
    id: `${page.assetId}-request`,
    assetId: page.assetId,
    slideId: page.slideId,
    slideIndex: index,
    slideTitle: page.title,
    purpose: "finished full-slide PNG",
    role: "core-content-raster",
    usage: "full-slide",
    prompt: page.prompt,
    negativePrompt: page.negativePrompt,
    codexPrompt: `$imagegen ${page.prompt}`,
    output: `${slugify(page.title, `slide-${index + 1}`)}-${page.assetId}.png`,
    size,
    quality,
    provider,
    background: "opaque",
    placement: { x: 0, y: 0, w: 13.333, h: 7.5, mode: "full-slide" },
    editabilityImpact: "low-editability full-slide raster",
    notes: [
      "Use as the entire finished slide image in an image-first deck.",
      "Do not generate a base/background image for later PPT text overlay.",
      "Do not use this generated image as a supporting insert in a native-first content slide.",
    ],
  };
}

function collectEvidence(slide, parseBundle) {
  const snippets = [];
  for (const object of slide.objects || []) {
    if (object.type === "text") snippets.push(compactText(object.text));
    if (object.type === "table") snippets.push(`native table with ${(object.rows || []).length} rows`);
    if (object.type === "chart") snippets.push(`native chart: ${object.title || object.chartType || object.kind || "chart"}`);
    if (object.type === "image") snippets.push(`source image: ${object.alt || object.assetId || object.path || "figure"}`);
    if (object.type === "formula") snippets.push(`formula: ${compactText(object.latex || object.text)}`);
  }
  for (const figure of parseBundle?.figures || []) {
    const caption = compactText(figure.caption || figure.title || figure.id);
    if (caption) snippets.push(`paper figure: ${caption}`);
    if (snippets.length >= 4) break;
  }
  return snippets.filter(Boolean);
}

function deriveClaim(slide, title, evidence) {
  const textEvidence = evidence.find((item) => item.length > 12 && !/^native table|^native chart|^source image|^paper figure/.test(item));
  return compactText(slide.claim || slide.keyMessage || slide.subtitle || textEvidence || title);
}

function chooseLayoutIntent(slide, index) {
  if (index === 0 || /title|cover/i.test(slide.id || slide.layout || "")) return "cover-style visual thesis with one dominant image region and restrained title text";
  const objects = slide.objects || [];
  if (objects.some((object) => object.type === "chart")) return "evidence dashboard with chart-like panels and callouts, without fabricating exact plotted data";
  if (objects.some((object) => object.type === "table")) return "comparison board with structured blocks and one visual takeaway";
  if (objects.some((object) => object.type === "image")) return "paper-figure interpretation slide that references the source figure without redrawing measured data";
  return "research explainer slide with claim, mechanism diagram, and concise evidence panels";
}

function compactText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function sourceForManifestItem(item) {
  if (item.provider === "placeholder") return "placeholder";
  if (item.provider === "openai" || item.provider === "codex") return "generated";
  return item.provider || "generated";
}

function isPngPath(assetPath) {
  return /\.png$/i.test(String(assetPath || ""));
}

function toSpecRelative(specPath, assetPath) {
  if (!specPath || !assetPath || !path.isAbsolute(assetPath)) return assetPath;
  return path.relative(path.dirname(specPath), assetPath);
}
