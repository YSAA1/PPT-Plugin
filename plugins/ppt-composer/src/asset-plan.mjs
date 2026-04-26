import path from "node:path";
import { slugify, stripXml } from "./lib.mjs";

export function planAssets(spec, { specPath, defaults = {} } = {}) {
  const deckTitle = spec.deck?.title || "Presentation";
  const template = spec.theme?.templateId || spec.theme?.template || defaults.template || "academic-clean";
  const size = defaults.size || "1536x864";
  const quality = defaults.quality || defaultQualityForDeck(spec.deck?.editability);
  const provider = defaults.provider || "codex";
  const visualPolicy = normalizeVisualPolicy(defaults.visualPolicy || spec.deck?.visualPolicy || (spec.deck?.editability === "image-first" ? "image-first" : "native-only"));
  const mode = normalizeMode(defaults.mode || defaults.assetMode || (visualPolicy === "image-first" ? "full-slide" : "deprecated-supporting"));
  const requests = [];

  if (mode === "full-slide" || visualPolicy === "image-first") {
    for (const [index, slide] of (spec.slides || []).entries()) {
      const request = buildRequest({ slide, spec, index, template, size, quality, provider, mode: "full-slide" });
      if (request) requests.push(request);
    }
  }

  return {
    version: "0.1",
    kind: "ppt-asset-plan",
    createdAt: new Date().toISOString(),
    sourceSpec: specPath || null,
    deck: {
      title: deckTitle,
      editability: spec.deck?.editability || "native-first",
      visualPolicy,
      template,
    },
    defaults: {
      model: defaults.model || "gpt-image-2",
      provider,
      mode,
      size,
      quality,
      background: defaults.background || "opaque",
      outputDir: defaults.outputDir || "generated-assets",
      sourceSpecDir: specPath ? path.dirname(specPath) : process.cwd(),
    },
    warnings: mode === "deprecated-supporting"
      ? ["supporting asset generation is deprecated for editable decks; use visual-plan for image-first full-slide visuals"]
      : [],
    requests,
    assetRequests: requests,
  };
}

function buildRequest({ slide, spec, index, template, size, quality, provider, mode }) {
  const hasResolvedImage = (slide.objects || []).some((object) => object.type === "image" && (object.path || object.assetId));
  const fullSlide = mode === "full-slide" || spec.deck?.editability === "image-first";
  if (!fullSlide && hasResolvedImage && !slide.forceAssetPlan) return null;

  const assetSeed = slide.assetPlan?.id || `${slide.id || `s${index + 1}`}-visual`;
  const assetId = slugify(assetSeed, `slide-${index + 1}`);
  const slideTitle = slide.title || `Slide ${index + 1}`;
  const editability = spec.deck?.editability || "native-first";
  const purpose = fullSlide ? "full-slide infographic" : "supporting illustration";
  const prompt = buildPrompt({ slide, template, purpose, deckTitle: spec.deck?.title, fullSlide });
  const safeName = slugify(slideTitle, `slide-${index + 1}`);

  return {
    id: `${assetId}-request`,
    assetId,
    slideId: slide.id || `s${index + 1}`,
    slideIndex: index,
    slideTitle,
    purpose,
    role: fullSlide ? "core-content-raster" : "supporting-raster",
    prompt,
    codexPrompt: `$imagegen ${prompt}`,
    output: `${safeName}-${assetId}.png`,
    size,
    quality,
    provider,
    background: "opaque",
    placement: fullSlide
      ? { x: 0, y: 0, w: 13.333, h: 7.5, mode: "full-slide" }
      : { x: 7.55, y: 1.45, w: 4.95, h: 3.65, mode: "supporting-panel" },
    editabilityImpact: fullSlide ? "low-editability full-slide raster" : "supporting visual; core content remains native",
    notes: [
      editability === "image-first"
        ? "Image-first slide can use a full-slide hero or infographic visual."
        : "Keep core text outside the generated image; use the visual as support only.",
      "Prefer light or white background; do not include transparent background requests for gpt-image-2.",
    ],
  };
}

function buildPrompt({ slide, template, purpose, deckTitle, fullSlide = false }) {
  const summary = summarizeSlide(slide);
  if (fullSlide) {
    return [
      `Create a complete 16:9 full-slide research infographic image for a PowerPoint deck titled \"${deckTitle || "Presentation"}\".`,
      `Slide title: \"${slide.title || slide.id || "Untitled slide"}\".`,
      summary ? `Core content to visualize: ${summary}.` : "Core content: a concise research presentation slide.",
      "Use a premium scientific-consulting style with clear visual hierarchy, strong whitespace, and a coherent poster-like layout.",
      "The generated image will be used as the entire slide, so compose it as one finished slide image, not as a blank background or base draft.",
      "Include the slide title, main claim, and sparse labels inside the image itself; do not rely on later native PPT text overlays.",
      "Keep any text minimal, large, and presentation-safe; do not invent extra facts, fake citations, fake numbers, or unreadable microtext.",
      "Use polished diagrams, abstract mechanisms, and evidence panels instead of decorative stock imagery.",
      "No logos, no watermarks, no UI chrome, no random labels.",
    ].join(" ");
  }
  return [
    `Create a ${purpose} for a PowerPoint slide in a ${template} template deck titled \"${deckTitle || "Presentation"}\".`,
    `Slide title: \"${slide.title || slide.id || "Untitled slide"}\".`,
    summary ? `Slide context: ${summary}.` : "Slide context: presentation-ready business/research communication.",
    "Use a clean 16:9 landscape composition with strong hierarchy and ample whitespace.",
    "Avoid embedding core text, labels, tables, or chart values inside the image.",
    "Use light or white background and polished consulting/research visual style.",
  ].join(" ");
}

function summarizeSlide(slide) {
  const snippets = [];
  for (const object of slide.objects || []) {
    if (object.type === "text") snippets.push(compactText(object.text));
    if (object.type === "table") snippets.push(`table with ${(object.rows || []).length} rows`);
    if (object.type === "chart") snippets.push(`chart titled ${object.title || object.chartType || object.kind || "chart"}`);
    if (object.type === "formula") snippets.push(`formula ${compactText(object.latex || object.text)}`);
    if (snippets.length >= 4) break;
  }
  return snippets.filter(Boolean).slice(0, 4).join("; ");
}

function compactText(value) {
  return stripXml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function defaultQualityForDeck(editability = "native-first") {
  return editability === "image-first" ? "medium" : "low";
}

function normalizeMode(value) {
  if (value === "full-slide") return "full-slide";
  if (value === "supporting") return "deprecated-supporting";
  return value || "deprecated-supporting";
}

function normalizeVisualPolicy(value) {
  if (value === "image-first" || value === "hybrid" || value === "native-only") return value;
  return "native-only";
}
