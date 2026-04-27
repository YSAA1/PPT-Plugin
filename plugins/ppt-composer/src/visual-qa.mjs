import path from "node:path";
import { inspectPng, isLikelyTinyPng } from "./png-utils.mjs";
import { readJson, writeJson } from "./lib.mjs";

export async function runVisualQa({ protocol, jobs, baseDir = process.cwd(), manualOverrideNote = "" } = {}) {
  if (!protocol) throw new Error("visual QA requires protocol");
  if (!jobs) throw new Error("visual QA requires jobs");

  const findings = [];
  const jobByPage = new Map((jobs.pages || []).map((job) => [Number(job.page), job]));
  for (const page of protocol.pages || []) {
    const job = jobByPage.get(Number(page.page));
    if (!job) {
      findings.push(fail(page.page, "missing_job", "No imagegen job exists for this protocol page"));
      continue;
    }
    const pngPath = job.path || job.output_png || page.output_png;
    if (!pngPath) {
      findings.push(fail(page.page, "missing_png_path", "Job has no PNG path"));
      continue;
    }
    const resolved = path.isAbsolute(pngPath) ? pngPath : path.resolve(baseDir, pngPath);
    const info = await inspectPng(resolved);
    if (!info.exists) findings.push(fail(page.page, "missing_png", `PNG file does not exist: ${resolved}`));
    else if (!info.isPng) findings.push(fail(page.page, "non_png", `File is not PNG: ${resolved}`));
    else {
      if (isLikelyTinyPng(info)) findings.push(fail(page.page, "tiny_png", `PNG is too small for a final slide: ${resolved}`));
      if (info.hasPlaceholderMarker || job.provider === "placeholder" || job.placeholder === true) {
        findings.push(fail(page.page, "placeholder_png", `PNG appears to be a placeholder: ${resolved}`));
      }
      if (info.width && info.height) {
        const ratio = info.width / info.height;
        if (Math.abs(ratio - 16 / 9) > 0.08) {
          findings.push(warn(page.page, "aspect_ratio", `PNG is not close to 16:9: ${info.width}x${info.height}`));
        }
      }
    }
    if (page.fidelity === "strict_embed" && !(page.reference_asset_ids || []).length) {
      findings.push(fail(page.page, "strict_embed_missing_reference", "strict_embed page must bind required reference assets"));
    }
  }

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
    },
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
