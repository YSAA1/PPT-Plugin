import path from "node:path";
import { inspectPng } from "./png-utils.mjs";
import { readJson, writeJson } from "./lib.mjs";
import { speakerNotesFromPage } from "./deck-protocol.mjs";

const DONE_STATES = new Set(["generated", "accepted"]);

export function createImagegenJobs(protocol, { protocolPath = null, outPath = null } = {}) {
  const pages = protocol.pages || [];
  return {
    kind: "ppt-composer-imagegen-jobs",
    version: "0.1",
    createdAt: new Date().toISOString(),
    protocol: protocolPath || protocol.source?.protocolPath || null,
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
    })),
    outPath,
  };
}

export function summarizeJobs(jobs) {
  const summary = { total: 0, pending: 0, generated: 0, accepted: 0, failed: 0, readyForManifest: false };
  for (const page of jobs.pages || []) {
    summary.total += 1;
    if (page.status === "generated") summary.generated += 1;
    else if (page.status === "accepted") summary.accepted += 1;
    else if (page.status === "failed") summary.failed += 1;
    else summary.pending += 1;
  }
  summary.readyForManifest = summary.total > 0 && (jobs.pages || []).every((page) => DONE_STATES.has(page.status));
  return summary;
}

export async function backfillImagegenJob(jobs, { page, pngPath, status = "generated", note = "", baseDir = process.cwd() } = {}) {
  const target = (jobs.pages || []).find((item) => Number(item.page) === Number(page));
  if (!target) throw new Error(`Unknown imagegen job page: ${page}`);
  if (!DONE_STATES.has(status)) throw new Error(`Invalid backfill status: ${status}`);
  if (!pngPath || !/\.png$/i.test(pngPath)) throw new Error(`Backfill path must be a .png file: ${pngPath}`);
  const resolved = path.isAbsolute(pngPath) ? pngPath : path.resolve(baseDir, pngPath);
  const png = await inspectPng(resolved);
  if (!png.exists || !png.isPng) throw new Error(`Backfill path is not a readable PNG: ${resolved}`);
  if (png.hasPlaceholderMarker) throw new Error(`Backfill path appears to be a placeholder PNG: ${resolved}`);
  target.status = status;
  target.path = resolved;
  target.updatedAt = new Date().toISOString();
  target.note = note;
  target.png = { width: png.width, height: png.height, size: png.size };
  return jobs;
}

export function jobsToPngManifest(jobs, { outPath = null } = {}) {
  const summary = summarizeJobs(jobs);
  if (!summary.readyForManifest) {
    throw new Error("Cannot create PNG manifest until every imagegen job is generated or accepted");
  }
  return {
    kind: "image-first-ppt-png-manifest",
    version: "0.1",
    createdAt: new Date().toISOString(),
    sourceJobs: jobs.outPath || null,
    items: (jobs.pages || []).map((page) => ({
      page: page.page,
      status: "generated",
      path: page.path || page.output_png,
      sourceStatus: page.status,
      title: page.title,
      fidelity: page.fidelity,
      speaker_notes: page.speaker_notes || "",
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

export async function backfillJobsFile({ jobsPath, page, pngPath, status, note }) {
  const jobs = await readJson(jobsPath);
  await backfillImagegenJob(jobs, { page, pngPath, status, note, baseDir: path.dirname(jobsPath) });
  await writeJson(jobsPath, jobs);
  return { jobs, summary: summarizeJobs(jobs) };
}

export async function jobsToManifestFile({ jobsPath, outPath }) {
  const jobs = await readJson(jobsPath);
  const manifest = jobsToPngManifest(jobs, { outPath });
  await writeJson(outPath, manifest);
  return { manifest, summary: summarizeJobs(jobs) };
}
