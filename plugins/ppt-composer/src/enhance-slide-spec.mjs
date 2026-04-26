import path from "node:path";
import { slugify } from "./lib.mjs";

export function enhanceSlideSpec(spec, { specPath, outputPath = null, assetManifest = null, template = "consulting-research", visualPolicy = "native-only", visualSlideFallback = false } = {}) {
  const enhanced = JSON.parse(JSON.stringify(spec));
  const resolvedVisualPolicy = normalizeVisualPolicy(visualPolicy || enhanced.deck?.visualPolicy || "native-only");
  enhanced.theme = buildEnhancedTheme(enhanced.theme || {}, template);
  enhanced.deck = {
    ...enhanced.deck,
    editability: enhanced.deck?.editability || "native-first",
    visualPolicy: resolvedVisualPolicy,
  };

  const manifestItems = (assetManifest?.items || []).filter((item) => item.status === "generated" && item.path);
  const slideAssetMap = new Map(manifestItems.map((item) => [item.slideId, item]));
  const existingAssets = new Map((enhanced.assets || []).map((asset) => [asset.id, asset]));

  enhanced.assets ||= [];
  rebaseExistingAssetPaths(enhanced.assets, specPath, outputPath);
  enhanced.assetRequests = normalizeAssetRequests(enhanced.assetRequests, assetManifest, resolvedVisualPolicy);

  const outputSlides = [];
  for (const [index, slide] of (enhanced.slides || []).entries()) {
    slide.layout = classifyLayout(slide, index);
    slide.background = slide.background || slideBackground(slide.layout, template);
    slide.objects ||= [];

    injectTemplateComponents(slide, index, template, enhanced.deck);

    const manifestItem = slideAssetMap.get(slide.id || `s${index + 1}`);
    if (manifestItem) {
      const assetPolicy = classifyGeneratedAssetUse(slide, manifestItem, resolvedVisualPolicy);
      if (!assetPolicy.allowed) {
        slide.visualEnhancement = {
          status: "ignored",
          assetId: manifestItem.assetId,
          reason: assetPolicy.reason,
          visualPolicy: resolvedVisualPolicy,
        };
        outputSlides.push(slide);
        continue;
      }
      const assetId = manifestItem.assetId || slugify(`${slide.id || `s${index + 1}`}-generated`);
      if (!existingAssets.has(assetId)) {
        const asset = {
          id: assetId,
          type: "image",
          path: toSpecRelative(outputPath || specPath, manifestItem.path),
          source: sourceForManifestItem(manifestItem),
          purpose: manifestItem.purpose || manifestItem.role || "supporting visual",
          prompt: manifestItem.prompt,
          model: assetManifest?.model || manifestItem.model,
          usage: assetPolicy.usage,
          editableTextPolicy: resolvedVisualPolicy === "image-first" ? "image-first" : "supporting-only",
          caption: slide.title || assetId,
        };
        enhanced.assets.push(asset);
        existingAssets.set(assetId, asset);
      }
      const attached = attachSupportingImage(slide, assetId, index, manifestItem);
      outputSlides.push(slide);
      if (!attached && visualSlideFallback) {
        outputSlides.push(buildGeneratedVisualSlide(slide, assetId, index));
      }
      continue;
    }
    outputSlides.push(slide);
  }
  enhanced.slides = outputSlides;

  return enhanced;
}

function buildEnhancedTheme(theme, template) {
  if (template !== "consulting-research") {
    return { ...theme, template, templateId: template };
  }
  return {
    ...theme,
    template,
    templateId: template,
    palette: theme.palette || ["#0F172A", "#2563EB", "#F8FAFC", "#DBEAFE", "#E2E8F0"],
    fonts: {
      heading: theme.fonts?.heading || "Aptos Display",
      body: theme.fonts?.body || "Aptos",
    },
  };
}

function normalizeAssetRequests(existingRequests, assetManifest, visualPolicy = "native-only") {
  if (Array.isArray(existingRequests) && existingRequests.length > 0) return existingRequests;
  if (visualPolicy === "native-only") return [];
  return (assetManifest?.items || []).map((item) => ({
    id: item.requestId || `${item.assetId}-request`,
    slideId: item.slideId,
    purpose: item.purpose || item.role || "supporting visual",
    prompt: item.prompt,
    size: item.size,
    quality: item.quality,
    provider: item.provider,
    placement: item.placement,
    editabilityImpact: item.editabilityImpact,
    status: item.status,
    assetId: item.assetId,
  }));
}

function normalizeVisualPolicy(value) {
  if (value === "image-first" || value === "hybrid" || value === "native-only") return value;
  if (value === "full-slide") return "image-first";
  return "native-only";
}

function classifyGeneratedAssetUse(slide, manifestItem, visualPolicy) {
  const fullSlide = manifestItem.placement?.mode === "full-slide" || manifestItem.usage === "full-slide";
  if (visualPolicy === "image-first") {
    return fullSlide
      ? { allowed: true, usage: "full-slide" }
      : { allowed: false, reason: "image-first decks only accept full-slide generated assets" };
  }
  if (visualPolicy === "hybrid") {
    return isGeneratedAssetSlide(slide)
      ? { allowed: true, usage: fullSlide ? "full-slide" : "section-visual" }
      : { allowed: false, reason: "hybrid policy only allows generated assets on cover, section-divider, or image-first slides" };
  }
  return { allowed: false, reason: "native-only policy ignores generated assets in editable content slides" };
}

function isGeneratedAssetSlide(slide) {
  const layout = String(slide.layout || "").toLowerCase();
  const id = String(slide.id || "").toLowerCase();
  const role = String(slide.role || "").toLowerCase();
  return [
    layout,
    id,
    role,
  ].some((value) => /cover|section-divider|section|image-first|full-slide-image|consulting-hero/.test(value));
}

function sourceForManifestItem(item) {
  if (item.provider === "placeholder") return "placeholder";
  if (item.provider === "openai" || item.provider === "codex") return "generated";
  return item.provider || "generated";
}

function rebaseExistingAssetPaths(assets, specPath, outputPath) {
  if (!specPath || !outputPath) return;
  const sourceDir = path.dirname(specPath);
  const outputDir = path.dirname(outputPath);
  for (const asset of assets || []) {
    if (!asset?.path || path.isAbsolute(asset.path)) continue;
    const absolutePath = path.resolve(sourceDir, asset.path);
    asset.path = path.relative(outputDir, absolutePath);
  }
}

function classifyLayout(slide, index) {
  if (slide.layout && slide.layout !== "content") return slide.layout;
  const objects = slide.objects || [];
  const hasChart = objects.some((object) => object.type === "chart");
  const hasTable = objects.some((object) => object.type === "table");
  const textCount = objects.filter((object) => object.type === "text").length;
  if (index === 0 || /title/i.test(slide.id || "")) return "consulting-hero";
  if (hasChart) return "data-callout";
  if (hasTable) return "comparison-board";
  if (textCount >= 2) return "insight-grid";
  return "content";
}

function slideBackground(layout, template) {
  if (template !== "consulting-research") return undefined;
  if (layout === "consulting-hero") return "#F8FAFC";
  if (layout === "data-callout") return "#F8FAFC";
  return "#FFFFFF";
}

function injectTemplateComponents(slide, index, template, deck) {
  if (template !== "consulting-research") return;
  const markerId = `template-chip-${index + 1}`;
  if ((slide.objects || []).some((object) => object.id === markerId)) return;

  slide.objects.unshift({
    id: markerId,
    type: "component",
    kind: "label-chip",
    text: deck.audience || deck.editability || "consulting-research",
    position: { x: 10.65, y: 0.36, w: 2.05, h: 0.36 },
    fill: "#DBEAFE",
    color: "#1D4ED8",
  });

  if (slide.layout === "consulting-hero") {
    slide.objects.push({
      id: `template-hero-card-${index + 1}`,
      type: "component",
      kind: "stat-card",
      value: `${(deck.title || "Deck").split(/\s+/).slice(0, 2).join(" ")}`,
      label: deck.editability || "native-first",
      position: { x: 8.7, y: 1.45, w: 3.8, h: 1.55 },
      accentColor: "#2563EB",
      fill: "#EFF6FF",
    });
  }
}

function attachSupportingImage(slide, assetId, index, manifestItem = {}) {
  const requestedPlacement = manifestItem.placement;
  if (requestedPlacement?.mode === "full-slide") {
    slide.objects = [{
      id: `generated-full-slide-${index + 1}`,
      type: "image",
      assetId,
      position: { x: 0, y: 0, w: 13.333, h: 7.5 },
    }];
    slide.layout = "full-slide-image";
    return true;
  }

  const placement = findSafePlacement(slide, requestedPlacement);
  if (!placement) {
    slide.visualEnhancement = {
      status: "skipped",
      assetId,
      reason: "no non-overlapping visual slot found; generated asset kept in spec assets",
    };
    return false;
  }

  slide.objects.push({
    id: `generated-visual-${index + 1}`,
    type: "image",
    assetId,
    position: placement,
    rounding: true,
  });
  return true;
}

function buildGeneratedVisualSlide(sourceSlide, assetId, index) {
  const title = sourceSlide.title || `Slide ${index + 1}`;
  return {
    id: `${sourceSlide.id || `s${index + 1}`}-generated-visual`,
    title: `Visual synthesis: ${title}`,
    layout: "generated-visual-summary",
    background: "#F8FAFC",
    objects: [
      {
        id: `generated-visual-full-${index + 1}`,
        type: "image",
        assetId,
        position: { x: 0.72, y: 1.2, w: 11.9, h: 5.42 },
        rounding: true,
      },
    ],
    notes: `Generated supporting visual for source slide "${title}". Core paper content remains on the adjacent native slide.`,
  };
}

function findSafePlacement(slide, requestedPlacement) {
  const candidates = [
    requestedPlacement,
    { x: 7.35, y: 1.3, w: 5.05, h: 3.35 },
    { x: 7.35, y: 3.85, w: 5.05, h: 2.45 },
    { x: 0.78, y: 4.85, w: 5.65, h: 1.62 },
    { x: 7.8, y: 4.8, w: 4.45, h: 1.55 },
  ].filter(Boolean);
  const occupied = (slide.objects || [])
    .filter((object) => object.type !== "component" || object.kind !== "label-chip")
    .map((object) => object.position)
    .filter(Boolean);

  for (const candidate of candidates) {
    const slot = {
      x: Number(candidate.x),
      y: Number(candidate.y),
      w: Number(candidate.w),
      h: Number(candidate.h),
    };
    if (!Number.isFinite(slot.x + slot.y + slot.w + slot.h)) continue;
    if (slot.y < 1.05 || slot.w <= 0 || slot.h <= 0) continue;
    const collision = occupied.some((rect) => overlapRatio(slot, rect) > 0.03);
    if (!collision) return slot;
  }
  return null;
}

function overlapRatio(a, b) {
  const bx = Number(b.x);
  const by = Number(b.y);
  const bw = Number(b.w);
  const bh = Number(b.h);
  if (!Number.isFinite(bx + by + bw + bh)) return 0;
  const x1 = Math.max(a.x, bx);
  const y1 = Math.max(a.y, by);
  const x2 = Math.min(a.x + a.w, bx + bw);
  const y2 = Math.min(a.y + a.h, by + bh);
  if (x2 <= x1 || y2 <= y1) return 0;
  const overlapArea = (x2 - x1) * (y2 - y1);
  return overlapArea / Math.max(0.01, a.w * a.h);
}

function toSpecRelative(specPath, assetPath) {
  if (!specPath || !assetPath || path.isAbsolute(assetPath) === false) return assetPath;
  return path.relative(path.dirname(specPath), assetPath);
}
