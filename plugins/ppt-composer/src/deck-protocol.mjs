import path from "node:path";
import { existsSync } from "node:fs";
import { isFile, slugify } from "./lib.mjs";

const FIDELITY_VALUES = new Set(["free", "light_redraw", "strict_embed"]);
const SPEAKER_NOTE_KEYS = ["speaker_notes", "speakerNotes", "notes", "remarks", "presenter_notes", "备注"];
const DEFAULT_PAGE_NUMBER_POLICY = "no visible page numbers by default; add page numbers only when the confirmed initial user requirement explicitly requests them; if enabled, use one identical style, position, format, size, and color on every non-exempt slide";

export function createDeckProtocol({ mode = "brief_mode", deck = {}, style = {}, assets = [], pages = [], source = null } = {}) {
  return {
    kind: "ppt-composer-deck-protocol",
    version: "0.1",
    mode,
    source,
    deck: {
      title: deck.title || "Image-first deck",
      language: deck.language || "zh",
      audience: deck.audience || "",
      page_count: Number(deck.page_count || pages.length || 1),
      aspect_ratio: deck.aspect_ratio || "16:9",
    },
    style: {
      description: style.description || "polished scientific-consulting slide visual, clean hierarchy, generous whitespace",
      template_image_ids: style.template_image_ids || [],
      logo_ids: style.logo_ids || [],
      palette: style.palette || [],
      typography: style.typography || "",
      page_number_policy: style.page_number_policy || style.pageNumberPolicy || DEFAULT_PAGE_NUMBER_POLICY,
      footer_policy: style.footer_policy || style.footerPolicy || "consistent: use the same footer treatment on every slide, or omit footers everywhere",
      logo_policy: style.logo_policy || style.logoPolicy || logoPolicyFromIds(style.logo_ids || []),
      logo_color_policy: style.logo_color_policy || style.logoColorPolicy || "do not recolor, tint, gradient-shift, restyle, or redraw referenced logos; preserve original logo colors exactly",
      template_element_policy: style.template_element_policy || style.templateElementPolicy || "template-controlled logos, page numbers, footers, section markers, and recurring decorations must be identical across pages except documented cover/section exemptions",
      template_exemptions: style.template_exemptions || style.templateExemptions || [],
      visible_text_policy: style.visible_text_policy || style.visibleTextPolicy || "do not render asset ids, filenames, file paths, source labels, or protocol metadata as visible slide text",
    },
    assets,
    pages,
  };
}

export function buildTemplateContract(style = {}) {
  const logoIds = style.logo_ids || style.logoIds || [];
  return {
    logo_policy: style.logo_policy || style.logoPolicy || logoPolicyFromIds(logoIds),
    logo_color_policy: style.logo_color_policy || style.logoColorPolicy || "do not recolor, tint, gradient-shift, restyle, or redraw referenced logos; preserve original logo colors exactly",
    logo_ids: logoIds,
    page_number_policy: style.page_number_policy || style.pageNumberPolicy || DEFAULT_PAGE_NUMBER_POLICY,
    footer_policy: style.footer_policy || style.footerPolicy || "consistent: use the same footer treatment on every slide, or omit footers everywhere",
    template_element_policy: style.template_element_policy || style.templateElementPolicy || "template-controlled logos, page numbers, footers, section markers, and recurring decorations must be identical across pages except documented cover/section exemptions",
    template_exemptions: style.template_exemptions || style.templateExemptions || [],
  };
}

function logoPolicyFromIds(logoIds = []) {
  return logoIds.length
    ? "use the exact referenced logo asset(s) with the same placement, size, original colors, and frequency across all non-exempt slides"
    : "no deck logo unless the user explicitly provides or requests one; do not invent per-page logos";
}

export function validateDeckProtocol(protocol, { requireGeneratedPng = false, baseDir = process.cwd() } = {}) {
  const errors = [];
  if (!protocol || typeof protocol !== "object") errors.push("deck protocol must be a JSON object");
  if (protocol?.kind !== "ppt-composer-deck-protocol") errors.push("kind must be ppt-composer-deck-protocol");
  if (protocol?.version !== "0.1") errors.push("version must be 0.1");
  if (!["brief_mode", "reference_grounded_mode"].includes(protocol?.mode)) {
    errors.push("mode must be brief_mode or reference_grounded_mode");
  }
  if (!protocol?.deck?.title) errors.push("deck.title is required");
  if (!Number.isFinite(Number(protocol?.deck?.page_count)) || Number(protocol?.deck?.page_count) <= 0) {
    errors.push("deck.page_count must be a positive number");
  }

  const assetIds = new Set((protocol?.assets || []).map((asset) => asset.id).filter(Boolean));
  const textIds = new Set((protocol?.assets || [])
    .filter((asset) => asset.type === "text_evidence")
    .map((asset) => asset.id)
    .filter(Boolean));
  const tableIds = new Set((protocol?.assets || [])
    .filter((asset) => asset.type === "source_table")
    .map((asset) => asset.id)
    .filter(Boolean));
  const imageIds = new Set((protocol?.assets || [])
    .filter((asset) => /image|logo/.test(asset.type || ""))
    .map((asset) => asset.id)
    .filter(Boolean));
  for (const id of protocol?.style?.logo_ids || []) {
    if (!imageIds.has(id)) errors.push(`style.logo_ids includes unknown image/logo id: ${id}`);
  }

  const pages = protocol?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push("pages must be a non-empty array");
  }

  const hasReferenceInputs = Boolean(protocol?.source?.inputs?.length);
  if (protocol?.mode === "reference_grounded_mode" && hasReferenceInputs && assetIds.size === 0) {
    errors.push("reference_grounded_mode with source inputs must include localized assets; run reference-intake or record an intake blocker before confirmation");
  }
  let pagesWithBoundEvidence = 0;

  for (const [index, page] of (pages || []).entries()) {
    const label = `pages[${index}]`;
    if (!Number.isFinite(Number(page.page))) errors.push(`${label}.page is required`);
    if (!page.title) errors.push(`${label}.title is required`);
    if (!page.claim) errors.push(`${label}.claim is required`);
    if (!page.content_inputs || typeof page.content_inputs !== "object") errors.push(`${label}.content_inputs is required`);
    if (!Array.isArray(page.reference_asset_ids)) errors.push(`${label}.reference_asset_ids must be an array`);
    if (!page.final_image_prompt) errors.push(`${label}.final_image_prompt is required`);
    if (!page.negative_prompt) errors.push(`${label}.negative_prompt is required`);
    if (!FIDELITY_VALUES.has(page.fidelity)) errors.push(`${label}.fidelity must be free, light_redraw, or strict_embed`);
    if (!page.output_png) errors.push(`${label}.output_png is required`);
    if (page.output_png && !/\.png$/i.test(page.output_png)) errors.push(`${label}.output_png must end with .png`);
    const invalidNoteKey = SPEAKER_NOTE_KEYS.find((key) => page[key] !== undefined && !isValidSpeakerNotesValue(page[key]));
    if (invalidNoteKey) {
      errors.push(`${label}.${invalidNoteKey} must be a string or an array of strings`);
    }

    for (const assetId of page.reference_asset_ids || []) {
      if (!assetIds.has(assetId)) errors.push(`${label}.reference_asset_ids includes unknown asset id: ${assetId}`);
    }

    const textInputs = page.content_inputs?.text || [];
    const tableInputs = page.content_inputs?.tables || [];
    const imageInputs = page.content_inputs?.images || [];
    for (const id of textInputs) {
      if (!textIds.has(id)) errors.push(`${label}.content_inputs.text includes unknown text evidence id: ${id}`);
    }
    for (const id of tableInputs) {
      if (!tableIds.has(id)) errors.push(`${label}.content_inputs.tables includes unknown source table id: ${id}`);
    }
    for (const id of imageInputs) {
      if (!imageIds.has(id)) errors.push(`${label}.content_inputs.images includes unknown image/logo id: ${id}`);
    }

    const hasEvidence = Boolean(
      (page.reference_asset_ids || []).length ||
      textInputs.length ||
      tableInputs.length ||
      imageInputs.length ||
      page.free_generation === true,
    );
    if (protocol.mode === "reference_grounded_mode" && !hasEvidence) {
      errors.push(`${label} in reference_grounded_mode must bind to evidence or set free_generation=true`);
    }
    if ((page.reference_asset_ids || []).length || textInputs.length || tableInputs.length || imageInputs.length) {
      pagesWithBoundEvidence += 1;
    }

    if (requireGeneratedPng && page.output_png) {
      const resolved = path.isAbsolute(page.output_png) ? page.output_png : path.resolve(baseDir, page.output_png);
      if (!existsSync(resolved)) {
        errors.push(`${label}.output_png does not exist: ${resolved}`);
      }
    }
  }

  if (protocol?.mode === "reference_grounded_mode" && hasReferenceInputs && assetIds.size > 0 && pagesWithBoundEvidence === 0) {
    errors.push("reference_grounded_mode with source inputs must bind at least one page to localized assets; free_generation cannot be used as a global intake bypass");
  }

  return {
    ok: errors.length === 0,
    errors,
    pages: pages?.length || 0,
    assets: protocol?.assets?.length || 0,
  };
}

export async function validateDeckProtocolAsync(protocol, { requireGeneratedPng = false, baseDir = process.cwd() } = {}) {
  const report = validateDeckProtocol(protocol, { requireGeneratedPng: false, baseDir });
  if (requireGeneratedPng) {
    for (const [index, page] of (protocol.pages || []).entries()) {
      if (!page.output_png) continue;
      const resolved = path.isAbsolute(page.output_png) ? page.output_png : path.resolve(baseDir, page.output_png);
      if (!(await isFile(resolved))) {
        report.errors.push(`pages[${index}].output_png does not exist: ${resolved}`);
      }
    }
    report.ok = report.errors.length === 0;
  }
  return report;
}

export function visualPlanFromDeckProtocol(protocol, { outputPath = null, defaults = {} } = {}) {
  const validation = validateDeckProtocol(protocol);
  if (!validation.ok) {
    throw new Error(`Invalid deck protocol:\n${validation.errors.join("\n")}`);
  }

  const size = defaults.size || "1536x864";
  const quality = defaults.quality || "medium";
  const provider = defaults.provider || "codex";
  const model = defaults.model || "gpt-image-2";
  const sourceSpecDir = outputPath ? path.dirname(outputPath) : process.cwd();
  const assetsById = new Map((protocol.assets || []).map((asset) => [asset.id, asset]));
  const pages = [];
  const requests = [];

  for (const [index, protocolPage] of protocol.pages.entries()) {
    const page = visualPageFromProtocolPage(protocolPage, protocol, assetsById, index);
    pages.push(page);
    requests.push({
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
      output: protocolPage.output_png,
      speakerNotes: page.speakerNotes,
      size,
      quality,
      provider,
      background: "opaque",
      fidelity: protocolPage.fidelity,
      protocolPage: protocolPageSlice(protocolPage, page.referenceAssets),
      referenceAssets: page.referenceAssets,
      placement: { x: 0, y: 0, w: 13.333, h: 7.5, mode: "full-slide" },
      editabilityImpact: "low-editability full-slide raster",
      notes: [
        "Use the protocol page slice as the source of truth.",
        "If reference assets include images or table PNGs, inspect/use them before image generation.",
        "Strict fidelity forbids fabricated numbers, curves, labels, logos, or captions.",
      ],
    });
  }

  return {
    version: "0.1",
    kind: "ppt-visual-plan",
    sourceKind: "deck-protocol",
    createdAt: new Date().toISOString(),
    source: {
      protocol: protocol.source?.protocolPath || null,
      mode: protocol.mode,
    },
    deck: {
      title: protocol.deck.title,
      audience: protocol.deck.audience || "general",
      language: protocol.deck.language || "zh",
      editability: "image-first",
      visualPolicy: "image-first",
      warning: "Image-first decks are low-editability: each slide is a full-slide raster visual.",
    },
    style: protocol.style,
    defaults: {
      model,
      provider,
      mode: "full-slide",
      size,
      quality,
      background: defaults.background || "opaque",
      outputDir: defaults.outputDir || "generated-assets",
      sourceSpecDir,
    },
    protocol,
    pages,
    requests,
    assetRequests: requests,
  };
}

function visualPageFromProtocolPage(protocolPage, protocol, assetsById, index) {
  const slideId = `p${String(protocolPage.page || index + 1).padStart(2, "0")}`;
  const referenceAssets = [
    ...(protocolPage.reference_asset_ids || []),
    ...(protocolPage.content_inputs?.tables || []),
    ...(protocolPage.content_inputs?.images || []),
  ]
    .filter((id, idIndex, ids) => id && ids.indexOf(id) === idIndex)
    .map((id) => assetsById.get(id))
    .filter(Boolean);
  const textEvidence = (protocolPage.content_inputs?.text || [])
    .map((id) => assetsById.get(id))
    .filter(Boolean)
    .map((asset) => asset.text || asset.summary || asset.caption || asset.id);
  const tableEvidence = (protocolPage.content_inputs?.tables || [])
    .map((id) => assetsById.get(id))
    .filter(Boolean)
    .map((asset) => asset.summary || asset.caption || "table evidence");
  const imageEvidence = referenceAssets
    .filter((asset) => /image|logo/.test(asset.type || ""))
    .map((asset) => asset.caption || asset.summary || "visual evidence");
  const evidence = [...textEvidence, ...tableEvidence, ...imageEvidence].filter(Boolean).slice(0, 8);
  const pageNumberPolicy = protocol.style?.page_number_policy || protocol.style?.pageNumberPolicy || DEFAULT_PAGE_NUMBER_POLICY;
  const logoPolicy = protocol.style?.logo_policy || protocol.style?.logoPolicy || logoPolicyFromIds(protocol.style?.logo_ids || []);
  const logoColorPolicy = protocol.style?.logo_color_policy || protocol.style?.logoColorPolicy || "Do not recolor referenced logos.";
  const visibleTextPolicy = protocol.style?.visible_text_policy || protocol.style?.visibleTextPolicy || "Never render asset ids, filenames, source labels, or protocol metadata as visible slide text.";
  const prompt = [
    "Use case: productivity-visual",
    "Asset type: finished full-slide 16:9 PowerPoint page image",
    `Primary request: ${protocolPage.final_image_prompt}`,
    `Deck title: \"${protocol.deck.title}\".`,
    `Slide title: \"${protocolPage.title}\".`,
    `Main claim: ${protocolPage.claim}`,
    `Fidelity mode: ${protocolPage.fidelity}.`,
    protocol.style?.description ? `Style lock: ${protocol.style.description}` : null,
    evidence.length ? `Grounding evidence: ${evidence.join("; ")}.` : "Grounding evidence: no external evidence; use only the approved brief.",
    `Logo policy: ${logoPolicy}`,
    `Logo color policy: ${logoColorPolicy}`,
    `Page numbering policy: ${pageNumberPolicy}`,
    `Visible text policy: ${visibleTextPolicy}`,
    "Text policy: no later PPT text overlay; all required visible text must be rendered inside this PNG.",
    "Do not render internal evidence labels such as asset ids, filenames, file paths, 'source:', 'source table', 'reference asset', or protocol field names.",
    "If a referenced table PNG or source image is available, use it as visual evidence instead of inventing replacement data.",
    `Avoid: ${protocolPage.negative_prompt}`,
  ].filter(Boolean).join("\n");

  return {
    slideId,
    slideIndex: index,
    assetId: slugify(`${slideId}-full-slide`),
    title: protocolPage.title,
    claim: protocolPage.claim,
    sourceEvidence: evidence,
    referenceAssets,
    protocolPage,
    speakerNotes: speakerNotesFromPage(protocolPage),
    sourcePath: protocol.source?.inputs || null,
    layoutIntent: protocolPage.layout_intent || "protocol-defined finished full-slide image",
    visualType: "protocol-page",
    prompt,
    negativePrompt: protocolPage.negative_prompt,
    fidelity: protocolPage.fidelity,
    textPolicy: "finished-slide-image; include sparse large title/claim/labels inside the image; no separate PPT text overlay; no dense body copy; no fake citations or fabricated metrics",
    acceptanceChecks: [
      "full 16:9 slide composition",
      "page follows deck-protocol.json",
      "one clear main claim",
      "referenced evidence is respected",
      "referenced logos keep exact original colors and proportions",
      "no invented numeric results",
      "no tiny unreadable text",
      "no watermarks or UI chrome",
    ],
  };
}

function protocolPageSlice(page, referenceAssets) {
  return {
    page: page.page,
    title: page.title,
    claim: page.claim,
    content_inputs: page.content_inputs,
    reference_asset_ids: page.reference_asset_ids,
    fidelity: page.fidelity,
    final_image_prompt: page.final_image_prompt,
    negative_prompt: page.negative_prompt,
    speaker_notes: speakerNotesFromPage(page),
    output_png: page.output_png,
    reference_assets: referenceAssets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      path: asset.path || null,
      caption: asset.caption || asset.summary || "",
      usage: asset.usage || "",
    })),
  };
}

export function speakerNotesFromPage(page = {}) {
  for (const key of SPEAKER_NOTE_KEYS) {
    if (page[key] !== undefined) return normalizeSpeakerNotes(page[key]);
  }
  return "";
}

export function normalizeSpeakerNotes(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join("\n");
  return String(value).trim();
}

function isValidSpeakerNotesValue(value) {
  return typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}
