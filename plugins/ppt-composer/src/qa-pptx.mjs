import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { exists, stripXml } from "./lib.mjs";

const execFileAsync = promisify(execFile);

export async function runQa({ pptxPath, spec, specPath }) {
  if (!(await exists(pptxPath))) {
    throw new Error(`PPTX not found: ${pptxPath}`);
  }

  const report = {
    pptx: pptxPath,
    spec: specPath || null,
    status: "pass",
    summary: {
      slides: 0,
      textShapes: 0,
      pictures: 0,
      charts: 0,
      tables: 0,
      missingAssets: 0,
      warnings: 0,
      errors: 0,
    },
    findings: [],
  };

  const entries = await unzipList(pptxPath);
  const slideEntries = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry)).sort(naturalSort);
  report.summary.slides = slideEntries.length;

  if (slideEntries.length === 0) {
    addFinding(report, "error", "pptx_structure", "No slide XML files found in PPTX.");
  }

  for (const entry of slideEntries) {
    const xml = await unzipRead(pptxPath, entry);
    const text = stripXml(xml).trim();
    report.summary.textShapes += count(xml, /<p:sp\b/g);
    report.summary.pictures += count(xml, /<p:pic\b/g);
    report.summary.charts += count(xml, /<c:chart\b/g);
    report.summary.tables += count(xml, /<a:tbl\b/g);
    const longRuns = findLongTextRuns(text);
    for (const run of longRuns) {
      addFinding(report, "warning", "possible_overflow", `${path.basename(entry)} has a long text run that may need manual layout review.`, { sample: run });
    }
  }

  if (spec) {
    await qaSpec(report, spec, specPath);
    if (spec.slides?.length && spec.slides.length !== slideEntries.length) {
      addFinding(report, "error", "slide_count_mismatch", `Spec has ${spec.slides.length} slides but PPTX has ${slideEntries.length}.`);
    }
  }

  report.summary.warnings = report.findings.filter((finding) => finding.severity === "warning").length;
  report.summary.errors = report.findings.filter((finding) => finding.severity === "error").length;
  report.status = report.summary.errors > 0 ? "fail" : "pass";
  return report;
}

async function qaSpec(report, spec, specPath) {
  const specDir = specPath ? path.dirname(specPath) : process.cwd();
  const assets = new Map((spec.assets || []).map((asset) => [asset.id, asset]));
  const editability = spec.deck?.editability || "native-first";
  const visualPolicy = spec.deck?.visualPolicy || (editability === "image-first" ? "image-first" : "native-only");
  let imageObjects = 0;
  let nativeObjects = 0;
  let generatedContentImages = 0;

  for (const slide of spec.slides || []) {
    let slideHasFullSlideImage = false;
    for (const object of slide.objects || []) {
      if (object.type === "image") imageObjects += 1;
      if (["text", "table", "chart", "shape"].includes(object.type)) nativeObjects += 1;
      if (object.type === "image") {
        const asset = object.assetId ? assets.get(object.assetId) : null;
        if (isFullSlideImage(object, asset)) slideHasFullSlideImage = true;
        if (isGeneratedAsset(asset) && isContentSlide(slide)) {
          generatedContentImages += 1;
          addFinding(report, visualPolicy === "native-only" ? "error" : "warning", "generated_image_on_content_slide", `Generated image asset ${asset.id} appears on content slide ${slide.id || slide.title || "unknown"}.`);
        }
        const imagePath = object.path || asset?.path;
        if (!imagePath) {
          report.summary.missingAssets += 1;
          addFinding(report, "error", "missing_asset", `Image object on slide ${slide.id || slide.title || "unknown"} has no path or resolvable assetId.`);
        } else if (!(await exists(path.resolve(specDir, imagePath)))) {
          report.summary.missingAssets += 1;
          addFinding(report, "error", "missing_asset", `Image asset does not exist: ${path.resolve(specDir, imagePath)}`);
        }
      }
      if (object.type === "text" && String(object.text || "").length > 450) {
        addFinding(report, "warning", "dense_text", `Slide ${slide.id || slide.title || "unknown"} contains a text object longer than 450 characters.`);
      }
    }
    if (editability === "image-first" && !slideHasFullSlideImage) {
      addFinding(report, "error", "image_first_missing_full_slide_image", `Image-first slide ${slide.id || slide.title || "unknown"} does not contain a full-slide image.`);
    }
  }

  report.summary.generatedContentImages = generatedContentImages;

  if (editability === "native-first" && imageObjects > nativeObjects) {
    addFinding(report, "warning", "editability_risk", "Deck is marked native-first but has more image objects than native objects.");
  }

  if (editability === "image-first") {
    addFinding(report, "warning", "image_first", "Deck is image-first; core slide content is intentionally low-editability.");
  }
}

function addFinding(report, severity, code, message, extra = {}) {
  report.findings.push({ severity, code, message, ...extra });
}

function count(text, regex) {
  return (text.match(regex) || []).length;
}

function findLongTextRuns(text) {
  return text
    .split(/\s{2,}|\n+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 320)
    .slice(0, 5);
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

function isGeneratedAsset(asset) {
  if (!asset) return false;
  return ["generated", "placeholder", "openai", "codex"].includes(asset.source) || ["openai", "codex", "placeholder"].includes(asset.provider);
}

function isContentSlide(slide) {
  const value = `${slide.layout || ""} ${slide.id || ""} ${slide.role || ""}`.toLowerCase();
  return !/cover|section-divider|section|full-slide-image|image-first|consulting-hero|title/.test(value);
}

function isFullSlideImage(object, asset) {
  const position = object.position || {};
  const usage = object.usage || asset?.usage;
  return usage === "full-slide"
    || (Number(position.x) <= 0.05
      && Number(position.y) <= 0.05
      && Number(position.w) >= 13.0
      && Number(position.h) >= 7.25);
}

async function unzipList(pptxPath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", pptxPath], { maxBuffer: 20 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function unzipRead(pptxPath, entry) {
  const { stdout } = await execFileAsync("unzip", ["-p", pptxPath, entry], { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}
