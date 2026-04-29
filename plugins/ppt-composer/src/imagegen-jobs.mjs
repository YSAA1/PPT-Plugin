import path from "node:path";
import { inspectPng } from "./png-utils.mjs";
import { readJson, writeJson } from "./lib.mjs";
import { speakerNotesFromPage } from "./deck-protocol.mjs";

const DONE_STATES = new Set(["generated", "accepted"]);
const BACKFILL_STATES = new Set(["generated", "accepted", "needs_review"]);
const REVIEW_VERDICTS = new Set(["pass", "warn", "fail"]);
const REVIEW_DIMENSIONS = [
  "consistency",
  "protocol_alignment",
  "reference_fidelity",
  "text_legibility",
  "artifact_quality",
];
const SEVERITY = { pass: 0, warn: 1, fail: 2 };

export function createImagegenJobs(protocol, { protocolPath = null, outPath = null } = {}) {
  const pages = protocol.pages || [];
  const styleLock = buildStyleLock(protocol);
  const workerDispatch = buildWorkerDispatch(pages);
  return {
    kind: "ppt-composer-imagegen-jobs",
    version: "0.1",
    createdAt: new Date().toISOString(),
    protocol: protocolPath || protocol.source?.protocolPath || null,
    style_lock: styleLock,
    worker_dispatch: workerDispatch,
    visualReview: {
      enabled: false,
      dimensions: REVIEW_DIMENSIONS,
      maxAutoRevisions: 2,
    },
    pages: pages.map((page) => ({
      page: Number(page.page),
      title: page.title,
      slideId: `p${String(page.page).padStart(2, "0")}`,
      status: "pending",
      output_png: page.output_png,
      fidelity: page.fidelity,
      prompt: page.final_image_prompt,
      negative_prompt: page.negative_prompt,
      speaker_notes: speakerNotesFromPage(page),
      updatedAt: null,
      note: "",
      attempts: [],
      currentAttempt: null,
      execution_summary: null,
      review: null,
      revision: null,
      accepted_png: null,
      superseded_pngs: [],
      worker_context: {
        style_lock_id: styleLock.id,
        source: "style_lock + protocol page slice",
        default_spawn: "context_packet_low_reasoning",
        prompt_contract: "Use the same style_lock for every page; forked chat history is supplemental only.",
        packet_contract: [
          "verbatim style_lock",
          "assigned page protocol slice",
          "relevant reference assets",
          "output_png path",
          "execution checklist",
        ],
      },
    })),
    outPath,
  };
}

function buildWorkerDispatch(pages) {
  const pageCount = pages.length;
  const required = pageCount >= 7;
  const assignments = required ? splitWorkerAssignments(pages) : [];
  return {
    required,
    reason: required
      ? "7+ confirmed pages require bounded image-generation subagent dispatch before direct generation fallback"
      : "leader generation or a small worker batch is allowed for 1-6 pages",
    max_concurrency: required ? Math.min(6, assignments.length) : Math.min(2, pageCount),
    default_reasoning_effort: "low",
    medium_escalation_rule: "strict_embed, dense table/scientific evidence, multiple reference assets, prior failure, or explicit user extra-care request",
    assignments,
    fallback_requires_recorded_spawn_blocker: required,
  };
}

function splitWorkerAssignments(pages) {
  const pageCount = pages.length;
  const workerCount = pageCount <= 12 ? Math.min(6, Math.max(5, Math.ceil(pageCount / 2))) : 6;
  const assignments = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const start = Math.floor((workerIndex * pageCount) / workerCount);
    const end = Math.floor(((workerIndex + 1) * pageCount) / workerCount);
    const slice = pages.slice(start, end);
    if (!slice.length) continue;
    const pageNumbers = slice.map((page) => Number(page.page));
    const mediumReasons = slice.flatMap((page) => mediumReasonsForPage(page).map((reason) => `p${page.page}:${reason}`));
    assignments.push({
      id: `image-worker-${String(assignments.length + 1).padStart(2, "0")}`,
      pages: pageNumbers,
      page_range: pageNumbers.length === 1 ? String(pageNumbers[0]) : `${pageNumbers[0]}-${pageNumbers.at(-1)}`,
      reasoning_effort: mediumReasons.length ? "medium" : "low",
      medium_reason: mediumReasons.join("; "),
      status: "planned",
      spawn_attempt: null,
    });
  }
  return assignments;
}

function mediumReasonsForPage(page = {}) {
  const reasons = [];
  if (page.fidelity === "strict_embed") reasons.push("strict_embed");
  const tableCount = page.content_inputs?.tables?.length || 0;
  const imageCount = page.content_inputs?.images?.length || 0;
  const referenceCount = page.reference_asset_ids?.length || 0;
  if (tableCount) reasons.push("table_evidence");
  if (imageCount + referenceCount > 1) reasons.push("multiple_reference_assets");
  return reasons;
}

export function summarizeJobs(jobs, { requireAccepted = null } = {}) {
  const visualReviewEnabled = Boolean(jobs.visualReview?.enabled);
  const acceptedOnly = requireAccepted ?? visualReviewEnabled;
  const summary = {
    total: 0,
    pending: 0,
    generated: 0,
    needsReview: 0,
    accepted: 0,
    revisionRequested: 0,
    rejected: 0,
    superseded: 0,
    failed: 0,
    attempts: 0,
    visualReviewEnabled,
    readyForManifest: false,
  };
  for (const page of jobs.pages || []) {
    summary.total += 1;
    summary.attempts += (page.attempts || []).length;
    if (page.status === "generated") summary.generated += 1;
    else if (page.status === "needs_review") summary.needsReview += 1;
    else if (page.status === "accepted") summary.accepted += 1;
    else if (page.status === "revision_requested") summary.revisionRequested += 1;
    else if (page.status === "rejected") summary.rejected += 1;
    else if (page.status === "superseded") summary.superseded += 1;
    else if (page.status === "failed") summary.failed += 1;
    else summary.pending += 1;
  }
  summary.readyForManifest = summary.total > 0 && (jobs.pages || []).every((page) => (
    acceptedOnly ? page.status === "accepted" : DONE_STATES.has(page.status)
  ));
  return summary;
}

export async function backfillImagegenJob(jobs, {
  page,
  pngPath,
  status = "generated",
  note = "",
  executionSummary = null,
  baseDir = process.cwd(),
} = {}) {
  const target = (jobs.pages || []).find((item) => Number(item.page) === Number(page));
  if (!target) throw new Error(`Unknown imagegen job page: ${page}`);
  if (!BACKFILL_STATES.has(status)) throw new Error(`Invalid backfill status: ${status}`);
  if (!pngPath || !/\.png$/i.test(pngPath)) throw new Error(`Backfill path must be a .png file: ${pngPath}`);
  const resolved = path.isAbsolute(pngPath) ? pngPath : path.resolve(baseDir, pngPath);
  const png = await inspectPng(resolved);
  if (!png.exists || !png.isPng) throw new Error(`Backfill path is not a readable PNG: ${resolved}`);
  if (png.hasPlaceholderMarker) throw new Error(`Backfill path appears to be a placeholder PNG: ${resolved}`);
  ensurePageShape(target);
  if (status === "needs_review") ensureVisualReview(jobs);
  supersedeCurrentAttemptIfNeeded(target, resolved, note || "Superseded by a newer backfill");
  const review = status === "needs_review"
    ? {
        status: "needs_review",
        verdict: null,
        note,
        reviewer: "",
        requestedAt: new Date().toISOString(),
        categories: null,
      }
    : null;
  const attempt = {
    attempt: (target.attempts || []).length + 1,
    status,
    path: resolved,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    note,
    png: { width: png.width, height: png.height, size: png.size },
    execution_summary: normalizeExecutionSummary(executionSummary),
    review,
  };
  target.attempts.push(attempt);
  target.currentAttempt = attempt.attempt;
  target.status = status;
  target.path = resolved;
  target.updatedAt = new Date().toISOString();
  target.note = note;
  target.png = { width: png.width, height: png.height, size: png.size };
  target.execution_summary = attempt.execution_summary;
  target.review = review;
  target.revision = null;
  if (status === "accepted") target.accepted_png = resolved;
  else target.accepted_png = null;
  return jobs;
}

export function markImagegenJobNeedsReview(jobs, { page, note = "", reviewer = "" } = {}) {
  const target = findPage(jobs, page);
  ensurePageShape(target);
  if (!target.path) throw new Error(`Page ${page} has no generated PNG to review`);
  ensureVisualReview(jobs);
  target.status = "needs_review";
  target.accepted_png = null;
  target.updatedAt = new Date().toISOString();
  target.review = {
    status: "needs_review",
    verdict: null,
    note,
    reviewer,
    requestedAt: new Date().toISOString(),
    categories: null,
  };
  const attempt = currentAttempt(target);
  if (attempt) {
    attempt.status = "needs_review";
    attempt.review = target.review;
    attempt.updatedAt = target.updatedAt;
  }
  return jobs;
}

export function reviewImagegenJob(jobs, {
  page,
  verdict,
  note = "",
  reviewer = "",
  revisionSuggestion = "",
  consistency = null,
  protocolAlignment = null,
  basicImageQuality = null,
  referenceFidelity = null,
  textLegibility = null,
  artifactQuality = null,
} = {}) {
  if (!verdict) return markImagegenJobNeedsReview(jobs, { page, note, reviewer });
  if (!REVIEW_VERDICTS.has(verdict)) throw new Error(`Invalid visual review verdict: ${verdict}`);
  const target = findPage(jobs, page);
  ensurePageShape(target);
  if (!target.path) throw new Error(`Page ${page} has no generated PNG to review`);
  ensureVisualReview(jobs);

  const categories = normalizeReviewCategories({
    verdict,
    consistency,
    protocolAlignment,
    referenceFidelity,
    textLegibility,
    artifactQuality: artifactQuality || basicImageQuality,
  });
  const finalVerdict = strongestVerdict([verdict, ...Object.values(categories)]);
  if (finalVerdict === "fail" && (!note.trim() || !revisionSuggestion.trim())) {
    throw new Error("Failing visual reviews must include --note and --revision-suggestion");
  }
  const reviewedAt = new Date().toISOString();
  const review = {
    status: "reviewed",
    verdict: finalVerdict,
    note,
    reviewer,
    revision_suggestion: revisionSuggestion,
    reviewedAt,
    categories,
  };
  target.review = review;
  target.updatedAt = reviewedAt;

  const attempt = currentAttempt(target);
  if (attempt) {
    attempt.review = review;
    attempt.updatedAt = reviewedAt;
  }

  if (finalVerdict === "fail") {
    target.status = "rejected";
    target.rejected_png = target.path;
    target.accepted_png = null;
    if (attempt) attempt.status = "rejected";
  } else {
    target.status = "accepted";
    target.accepted_png = target.path;
    if (attempt) attempt.status = "accepted";
  }
  return jobs;
}

export function reviseImagegenJob(jobs, { page, note = "", reviewer = "", revisionSuggestion = "" } = {}) {
  const target = findPage(jobs, page);
  ensurePageShape(target);
  ensureVisualReview(jobs);
  const requestedAt = new Date().toISOString();
  const attempt = currentAttempt(target);
  const oldPath = target.path || attempt?.path || null;
  if (attempt && attempt.path) {
    attempt.status = "superseded";
    attempt.supersededAt = requestedAt;
    attempt.supersededBy = "revision_requested";
    attempt.updatedAt = requestedAt;
    if (!target.superseded_pngs.includes(attempt.path)) target.superseded_pngs.push(attempt.path);
  }
  target.status = "revision_requested";
  target.path = null;
  target.png = null;
  target.accepted_png = null;
  target.updatedAt = requestedAt;
  target.revision = {
    status: "revision_requested",
    requestedAt,
    note,
    reviewer,
    revision_suggestion: revisionSuggestion || target.review?.revision_suggestion || "",
    superseded_path: oldPath,
    superseded_attempt: attempt?.attempt || null,
  };
  return jobs;
}

export function jobsToPngManifest(jobs, { outPath = null, requireAccepted = null } = {}) {
  const acceptedOnly = requireAccepted ?? Boolean(jobs.visualReview?.enabled);
  const summary = summarizeJobs(jobs, { requireAccepted: acceptedOnly });
  if (!summary.readyForManifest) {
    const requirement = acceptedOnly ? "accepted" : "generated or accepted";
    throw new Error(`Cannot create PNG manifest until every imagegen job is ${requirement}`);
  }
  for (const page of jobs.pages || []) {
    if (page.fidelity === "strict_embed" && page.review?.categories?.reference_fidelity === "fail") {
      throw new Error(`Cannot create PNG manifest: strict_embed page ${page.page} failed reference fidelity review`);
    }
  }
  return {
    kind: "image-first-ppt-png-manifest",
    version: "0.1",
    createdAt: new Date().toISOString(),
    sourceJobs: jobs.outPath || null,
    items: (jobs.pages || []).map((page) => ({
      page: page.page,
      status: "generated",
      path: acceptedOnly ? (page.accepted_png || page.path) : (page.path || page.output_png),
      sourceStatus: page.status,
      title: page.title,
      fidelity: page.fidelity,
      speaker_notes: page.speaker_notes || "",
      visual_review: page.review || null,
    })),
    outPath,
  };
}

export async function createJobsFile({ protocolPath, outPath }) {
  const protocol = await readJson(protocolPath);
  const jobs = createImagegenJobs(protocol, { protocolPath, outPath });
  await writeJson(outPath, jobs);
  return { jobs, summary: summarizeJobs(jobs) };
}

export async function backfillJobsFile({ jobsPath, page, pngPath, status, note, executionSummary = null }) {
  const jobs = await readJson(jobsPath);
  await backfillImagegenJob(jobs, { page, pngPath, status, note, executionSummary, baseDir: path.dirname(jobsPath) });
  await writeJson(jobsPath, jobs);
  return { jobs, summary: summarizeJobs(jobs) };
}

export async function reviewJobsFile(options) {
  const jobs = await readJson(options.jobsPath);
  await reviewImagegenJob(jobs, options);
  await writeJson(options.jobsPath, jobs);
  return { jobs, page: findPage(jobs, options.page), summary: summarizeJobs(jobs) };
}

export async function reviseJobsFile(options) {
  const jobs = await readJson(options.jobsPath);
  await reviseImagegenJob(jobs, options);
  await writeJson(options.jobsPath, jobs);
  return { jobs, page: findPage(jobs, options.page), summary: summarizeJobs(jobs) };
}

export async function jobsToManifestFile({ jobsPath, outPath, requireAccepted = null }) {
  const jobs = await readJson(jobsPath);
  const manifest = jobsToPngManifest(jobs, { outPath, requireAccepted });
  await writeJson(outPath, manifest);
  return { manifest, summary: summarizeJobs(jobs, { requireAccepted }) };
}

function findPage(jobs, page) {
  const target = (jobs.pages || []).find((item) => Number(item.page) === Number(page));
  if (!target) throw new Error(`Unknown imagegen job page: ${page}`);
  return target;
}

function ensureVisualReview(jobs) {
  jobs.visualReview = {
    ...(jobs.visualReview || {}),
    enabled: true,
    dimensions: REVIEW_DIMENSIONS,
    maxAutoRevisions: Number(jobs.visualReview?.maxAutoRevisions || 2),
  };
}

function ensurePageShape(page) {
  page.attempts ||= [];
  page.superseded_pngs ||= [];
  page.currentAttempt ??= null;
  page.review ??= null;
  page.revision ??= null;
  page.accepted_png ??= null;
  page.execution_summary ??= null;
}

function currentAttempt(page) {
  ensurePageShape(page);
  if (page.currentAttempt) {
    const found = page.attempts.find((attempt) => Number(attempt.attempt) === Number(page.currentAttempt));
    if (found) return found;
  }
  return page.attempts[page.attempts.length - 1] || null;
}

function supersedeCurrentAttemptIfNeeded(page, nextPath, note) {
  const attempt = currentAttempt(page);
  if (!attempt || !attempt.path || attempt.path === nextPath || attempt.status === "superseded") return;
  const now = new Date().toISOString();
  attempt.status = "superseded";
  attempt.supersededAt = now;
  attempt.supersededBy = "new_backfill";
  attempt.supersedeNote = note;
  attempt.updatedAt = now;
  if (!page.superseded_pngs.includes(attempt.path)) page.superseded_pngs.push(attempt.path);
}

function normalizeReviewCategories({
  verdict,
  consistency,
  protocolAlignment,
  referenceFidelity,
  textLegibility,
  artifactQuality,
}) {
  return {
    consistency: normalizeVerdict(consistency || verdict, "consistency"),
    protocol_alignment: normalizeVerdict(protocolAlignment || verdict, "protocol_alignment"),
    reference_fidelity: normalizeVerdict(referenceFidelity || verdict, "reference_fidelity"),
    text_legibility: normalizeVerdict(textLegibility || verdict, "text_legibility"),
    artifact_quality: normalizeVerdict(artifactQuality || verdict, "artifact_quality"),
  };
}

function normalizeVerdict(value, label) {
  if (!REVIEW_VERDICTS.has(value)) throw new Error(`Invalid ${label} review value: ${value}`);
  return value;
}

function strongestVerdict(values) {
  return values.reduce((strongest, value) => (SEVERITY[value] > SEVERITY[strongest] ? value : strongest), "pass");
}

function normalizeExecutionSummary(summary) {
  if (!summary) return null;
  const source = typeof summary === "string" ? JSON.parse(summary) : summary;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("execution summary must be a JSON object");
  }
  const normalized = {
    claim_followed: normalizeChecklistAnswer(source.claim_followed, "claim_followed"),
    reference_assets_used: normalizeChecklistAnswer(source.reference_assets_used, "reference_assets_used"),
    fidelity_followed: normalizeChecklistAnswer(source.fidelity_followed, "fidelity_followed"),
    negative_prompt_avoided: normalizeChecklistAnswer(source.negative_prompt_avoided, "negative_prompt_avoided"),
    uncertainties: normalizeUncertainties(source.uncertainties),
  };
  return normalized;
}

function normalizeChecklistAnswer(value, label) {
  if (value === true || value === false) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`execution_summary.${label} must be boolean or a short string`);
}

function normalizeUncertainties(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join("; ");
  if (typeof value === "string") return value.trim();
  throw new Error("execution_summary.uncertainties must be a string or array of strings");
}

function buildStyleLock(protocol = {}) {
  const deck = protocol.deck || {};
  const style = protocol.style || {};
  const pages = (protocol.pages || []).map((page) => ({
    page: Number(page.page),
    title: page.title,
    claim: page.claim,
    fidelity: page.fidelity,
  }));
  return {
    id: "deck-style-lock-v1",
    source: "deck-protocol.json",
    purpose: "Keep all image-generation and visual-review workers aligned even when subagent history forking fails.",
    deck: {
      title: deck.title || "",
      language: deck.language || "zh",
      audience: deck.audience || "",
      page_count: Number(deck.page_count || pages.length || 0),
      aspect_ratio: deck.aspect_ratio || "16:9",
    },
    style: {
      description: style.description || "",
      palette: style.palette || [],
      typography: style.typography || "",
      density: style.density || style.layout_density || "medium",
      font_scale: style.font_scale || style.font_size_tendency || "readable slide-scale titles and labels",
      chart_style: style.chart_style || "clean consulting/research charts with legible labels",
      margins: style.margins || style.whitespace || "consistent margins and controlled whitespace",
      template_image_ids: style.template_image_ids || [],
      logo_ids: style.logo_ids || [],
      forbidden: style.forbidden || [],
    },
    page_list: pages,
    assets: (protocol.assets || []).map((asset) => ({
      id: asset.id,
      type: asset.type,
      caption: asset.caption || asset.summary || "",
      usage: asset.usage || "",
      path: asset.path || "",
    })),
    format_contract: [
      "Every slide is one complete 16:9 full-slide PNG unless the protocol says otherwise.",
      "All visible title, claim, labels, chart text, captions, and logos must be rendered inside the PNG.",
      "Do not create a blank background, prompt-only handoff, SVG, HTML screenshot, or later PowerPoint text overlay.",
      "Use the same visual system, typography, palette, density, margins, and hierarchy across all pages.",
      "Do not invent or alter facts, numbers, curves, table headers, logos, or captions on strict_embed pages.",
    ],
    negative_contract: [
      "No watermark.",
      "No unreadable text.",
      "No inconsistent per-page art direction.",
      "No decorative clutter that breaks the confirmed deck style.",
      "No background-only slide.",
    ],
    worker_rule: "Every worker prompt must include this style_lock verbatim plus only the assigned protocol page slice. Forked chat history is never the source of truth for visual consistency.",
  };
}
