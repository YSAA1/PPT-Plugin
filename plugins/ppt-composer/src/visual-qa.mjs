import path from "node:path";
import { inspectPng, isLikelyTinyPng } from "./png-utils.mjs";
import { readJson, writeJson } from "./lib.mjs";

const PNG_READY_STATES = new Set(["generated", "accepted", "needs_review"]);

export async function runVisualQa({ protocol, jobs, baseDir = process.cwd(), manualOverrideNote = "" } = {}) {
  if (!protocol) throw new Error("visual QA requires protocol");
  if (!jobs) throw new Error("visual QA requires jobs");

  const deterministicFindings = [];
  const visualFindings = [];
  const visualReviewPages = [];
  const visualReviewEnabled = Boolean(jobs.visualReview?.enabled);
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
    addVisualGateFinding(visualFindings, page, job, visualReviewEnabled);
  }

  const findings = [...deterministicFindings, ...visualFindings];
  if (manualOverrideNote) {
    findings.push({ level: "override", code: "manual_override", page: null, message: manualOverrideNote });
  }

  const hasFail = findings.some((finding) => finding.level === "fail");
  return {
    kind: "ppt-composer-visual-qa",
    version: "0.1",
    status: hasFail && !manualOverrideNote ? "fail" : "pass",
    checkedAt: new Date().toISOString(),
    summary: {
      pages: (protocol.pages || []).length,
      findings: findings.length,
      failures: findings.filter((finding) => finding.level === "fail").length,
      warnings: findings.filter((finding) => finding.level === "warn").length,
      deterministicFailures: deterministicFindings.filter((finding) => finding.level === "fail").length,
      visualReviewFailures: visualFindings.filter((finding) => finding.level === "fail").length,
    },
    deterministicFindings,
    visualReview: {
      enabled: visualReviewEnabled,
      dimensions: jobs.visualReview?.dimensions || ["consistency", "protocol_alignment", "basic_image_quality"],
      pages: visualReviewPages,
      findings: visualFindings,
    },
    manualOverride: manualOverrideNote ? { note: manualOverrideNote } : null,
    findings,
  };
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
      protocol_alignment: "reviewer-verdict",
      basic_image_quality: "deterministic-and-reviewer-verdict",
      fidelity: protocolPage.fidelity,
      reference_asset_ids: protocolPage.reference_asset_ids || [],
    },
    attempts,
  };
}
