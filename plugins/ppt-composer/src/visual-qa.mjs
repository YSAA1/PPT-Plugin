import path from "node:path";
import { inspectPng, isLikelyTinyPng } from "./png-utils.mjs";
import { readJson, writeJson } from "./lib.mjs";

const PNG_READY_STATES = new Set(["generated", "accepted", "needs_review"]);
const VISUAL_REVIEW_DIMENSIONS = [
  "consistency",
  "template_invariants",
  "protocol_alignment",
  "reference_fidelity",
  "text_legibility",
  "artifact_quality",
];
const HARD_BLOCKER_CODES = new Set([
  "missing_job",
  "job_not_ready",
  "missing_png_path",
  "missing_png",
  "non_png",
  "tiny_png",
  "placeholder_png",
  "template_contract_missing",
  "strict_embed_missing_reference",
  "strict_embed_reference_fidelity_failed",
]);

export async function runVisualQa({ protocol, jobs, baseDir = process.cwd(), manualOverrideNote = "" } = {}) {
  if (!protocol) throw new Error("visual QA requires protocol");
  if (!jobs) throw new Error("visual QA requires jobs");

  const deterministicFindings = [];
  const visualFindings = [];
  const visualReviewPages = [];
  const visualReviewEnabled = Boolean(jobs.visualReview?.enabled);
  deterministicFindings.push(...templateContractFindings(jobs));
  const jobByPage = new Map((jobs.pages || []).map((job) => [Number(job.page), job]));
  for (const page of protocol.pages || []) {
    const job = jobByPage.get(Number(page.page));
    if (!job) {
      deterministicFindings.push(fail(page.page, "missing_job", "No imagegen job exists for this protocol page"));
      visualReviewPages.push(visualReviewSummary(page, null));
      continue;
    }
    visualReviewPages.push(visualReviewSummary(page, job));
    if (!PNG_READY_STATES.has(job.status)) {
      if (visualReviewEnabled && ["rejected", "revision_requested"].includes(job.status)) {
        addVisualGateFinding(visualFindings, page, job, visualReviewEnabled);
        continue;
      }
      deterministicFindings.push(fail(
        page.page,
        "job_not_ready",
        `Imagegen job status is not ready for assembly: ${job.status || "unknown"}`,
      ));
      addVisualGateFinding(visualFindings, page, job, visualReviewEnabled);
      continue;
    }
    const pngPath = job.path || job.output_png || page.output_png;
    if (!pngPath) {
      deterministicFindings.push(fail(page.page, "missing_png_path", "Job has no PNG path"));
      addVisualGateFinding(visualFindings, page, job, visualReviewEnabled);
      continue;
    }
    const resolved = path.isAbsolute(pngPath) ? pngPath : path.resolve(baseDir, pngPath);
    const info = await inspectPng(resolved);
    if (!info.exists) deterministicFindings.push(fail(page.page, "missing_png", `PNG file does not exist: ${resolved}`));
    else if (!info.isPng) deterministicFindings.push(fail(page.page, "non_png", `File is not PNG: ${resolved}`));
    else {
      if (isLikelyTinyPng(info)) deterministicFindings.push(fail(page.page, "tiny_png", `PNG is too small for a final slide: ${resolved}`));
      if (info.hasPlaceholderMarker || job.provider === "placeholder" || job.placeholder === true) {
        deterministicFindings.push(fail(page.page, "placeholder_png", `PNG appears to be a placeholder: ${resolved}`));
      }
      if (info.width && info.height) {
        const ratio = info.width / info.height;
        if (Math.abs(ratio - 16 / 9) > 0.08) {
          deterministicFindings.push(warn(page.page, "aspect_ratio", `PNG is not close to 16:9: ${info.width}x${info.height}`));
        }
      }
    }
    if (page.fidelity === "strict_embed" && !(page.reference_asset_ids || []).length) {
      deterministicFindings.push(fail(page.page, "strict_embed_missing_reference", "strict_embed page must bind required reference assets"));
    }
    if (page.fidelity === "strict_embed" && job.review?.categories?.reference_fidelity === "fail") {
      deterministicFindings.push(fail(
        page.page,
        "strict_embed_reference_fidelity_failed",
        "strict_embed page failed reference fidelity review and cannot be assembled",
      ));
    }
    addVisualGateFinding(visualFindings, page, job, visualReviewEnabled);
  }

  const findings = [...deterministicFindings, ...visualFindings];
  if (manualOverrideNote) {
    findings.push({ level: "override", code: "manual_override", page: null, message: manualOverrideNote });
  }

  const hasFail = findings.some((finding) => finding.level === "fail");
  const hardFailures = findings.filter((finding) => finding.level === "fail" && HARD_BLOCKER_CODES.has(finding.code));
  return {
    kind: "ppt-composer-visual-qa",
    version: "0.1",
    status: hardFailures.length || (hasFail && !manualOverrideNote) ? "fail" : "pass",
    checkedAt: new Date().toISOString(),
    summary: {
      pages: (protocol.pages || []).length,
      findings: findings.length,
      failures: findings.filter((finding) => finding.level === "fail").length,
      warnings: findings.filter((finding) => finding.level === "warn").length,
      deterministicFailures: deterministicFindings.filter((finding) => finding.level === "fail").length,
      visualReviewFailures: visualFindings.filter((finding) => finding.level === "fail").length,
      hardFailures: hardFailures.length,
      overrideableFailures: findings.filter((finding) => (
        finding.level === "fail" && !HARD_BLOCKER_CODES.has(finding.code)
      )).length,
    },
    deterministicFindings,
    visualReview: {
      enabled: visualReviewEnabled,
      dimensions: jobs.visualReview?.dimensions || VISUAL_REVIEW_DIMENSIONS,
      pages: visualReviewPages,
      findings: visualFindings,
    },
    manualOverride: manualOverrideNote ? { note: manualOverrideNote } : null,
    findings,
  };
}

function templateContractFindings(jobs = {}) {
  const contract = jobs.style_lock?.template_contract;
  if (!contract || typeof contract !== "object") {
    return [fail(null, "template_contract_missing", "imagegen-jobs.json style_lock.template_contract is required for page-number, footer, and recurring template consistency")];
  }
  const required = ["page_number_policy", "footer_policy", "template_element_policy"];
  return required
    .filter((key) => !String(contract[key] || "").trim())
    .map((key) => fail(null, "template_contract_missing", `style_lock.template_contract.${key} is required`));
}

export async function runVisualQaFile({ protocolPath, jobsPath, outPath, manualOverrideNote = "" } = {}) {
  const protocol = await readJson(protocolPath);
  const jobs = await readJson(jobsPath);
  const report = await runVisualQa({
    protocol,
    jobs,
    baseDir: path.dirname(jobsPath),
    manualOverrideNote,
  });
  if (outPath) await writeJson(outPath, report);
  return report;
}

function fail(page, code, message) {
  return { level: "fail", code, page, message };
}

function warn(page, code, message) {
  return { level: "warn", code, page, message };
}

function addVisualGateFinding(findings, page, job, visualReviewEnabled) {
  if (!visualReviewEnabled) return;
  const review = job.review || {};
  if (job.status === "accepted") {
    if (review.verdict === "warn") {
      findings.push(warn(page.page, "visual_review_warning", `Visual review accepted with warnings: ${review.note || "no note"}`));
    }
    return;
  }
  if (job.status === "rejected") {
    findings.push(fail(page.page, "visual_review_rejected", visualFailureMessage(job, "Visual review rejected this page")));
    return;
  }
  if (job.status === "revision_requested") {
    findings.push(fail(page.page, "visual_revision_requested", visualFailureMessage(job, "Page revision has been requested")));
    return;
  }
  if (job.status === "needs_review" || job.status === "generated") {
    findings.push(fail(page.page, "visual_review_pending", "Visual review is enabled; page must be accepted before manifest assembly"));
  }
}

function visualFailureMessage(job, fallback) {
  const suggestion = job.revision?.revision_suggestion || job.review?.revision_suggestion || "";
  const note = job.revision?.note || job.review?.note || "";
  return [fallback, note, suggestion ? `Revision suggestion: ${suggestion}` : ""].filter(Boolean).join(". ");
}

function visualReviewSummary(protocolPage, job) {
  const attempts = (job?.attempts || []).map((attempt) => ({
    attempt: attempt.attempt,
    status: attempt.status,
    path: attempt.path || null,
    png: attempt.png || null,
    review: attempt.review || null,
    supersededAt: attempt.supersededAt || null,
  }));
  return {
    page: Number(protocolPage.page),
    title: protocolPage.title,
    status: job?.status || "missing",
    currentPng: job?.path || null,
    acceptedPng: job?.accepted_png || (job?.status === "accepted" ? job?.path : null) || null,
    supersededPngs: job?.superseded_pngs || attempts.filter((attempt) => attempt.status === "superseded" && attempt.path).map((attempt) => attempt.path),
    verdict: job?.review?.verdict || null,
    reviewStatus: job?.review?.status || (job?.status === "needs_review" ? "needs_review" : null),
    categories: job?.review?.categories || null,
    note: job?.review?.note || "",
    revisionSuggestion: job?.revision?.revision_suggestion || job?.review?.revision_suggestion || "",
    protocolChecks: {
      consistency: "reviewer-verdict",
      template_invariants: "reviewer-verdict",
      protocol_alignment: "reviewer-verdict",
      reference_fidelity: "reviewer-verdict",
      text_legibility: "reviewer-verdict",
      artifact_quality: "deterministic-and-reviewer-verdict",
      fidelity: protocolPage.fidelity,
      reference_asset_ids: protocolPage.reference_asset_ids || [],
    },
    executionSummary: job?.execution_summary || null,
    attempts,
  };
}
