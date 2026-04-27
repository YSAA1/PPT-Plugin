import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAssetIndex } from "./asset-index.mjs";
import { ensureParent, slugify, writeJson } from "./lib.mjs";
import { listZipEntries, readZipBuffer, readZipText } from "./zip-utils.mjs";

const execFileAsync = promisify(execFile);

export async function pptxReferenceIntake({ inputPath, outDir, indexPath = null, protocolPath = null } = {}) {
  if (!inputPath) throw new Error("pptxReferenceIntake requires inputPath");
  if (!outDir) throw new Error("pptxReferenceIntake requires outDir");
  const resolvedInput = path.resolve(inputPath);
  const resolvedOut = path.resolve(outDir);
  const assetDir = path.join(resolvedOut, "reference-assets");
  await mkdir(assetDir, { recursive: true });

  const entries = await listZipEntries(resolvedInput);
  const mediaPaths = entries.filter((entry) => /^ppt\/media\//.test(entry));
  const extractedMedia = [];
  for (const entry of mediaPaths) {
    const buffer = await readZipBuffer(resolvedInput, entry);
    const dest = path.join(assetDir, `${slugify(path.basename(entry, path.extname(entry)), "pptx-media")}${path.extname(entry).toLowerCase()}`);
    await ensureParent(dest);
    await writeFile(dest, buffer);
    extractedMedia.push(dest);
  }

  const theme = await extractTheme(resolvedInput, entries);
  const relationships = await extractRelationships(resolvedInput, entries);
  const thumbnails = await optionalLibreOfficeThumbnails({ inputPath: resolvedInput, outDir: path.join(resolvedOut, "pptx-thumbnails") });
  const index = await createAssetIndex({
    sources: extractedMedia,
    outDir: resolvedOut,
    indexPath,
    caption: "PPTX extracted media",
    usage: "template_or_evidence",
  });

  if (protocolPath) {
    await mergeThemeIntoProtocol({ protocolPath, theme, index });
  }

  return {
    kind: "ppt-composer-pptx-reference-intake",
    version: "0.1",
    input: resolvedInput,
    outDir: resolvedOut,
    media: extractedMedia,
    assetIndex: indexPath || null,
    theme,
    relationships,
    thumbnails,
    warnings: thumbnails.warnings,
  };
}

async function extractTheme(pptxPath, entries) {
  const themeEntry = entries.find((entry) => /^ppt\/theme\/theme\d+\.xml$/.test(entry));
  if (!themeEntry) return { colors: [], fonts: {} };
  const xml = await readZipText(pptxPath, themeEntry);
  const colors = [...xml.matchAll(/<a:srgbClr val="([A-Fa-f0-9]{6})"/g)]
    .map((match) => `#${match[1].toUpperCase()}`)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 12);
  const fontMatches = [...xml.matchAll(/<a:(latin|ea|cs) typeface="([^"]*)"/g)];
  const fonts = {};
  for (const [, key, value] of fontMatches) {
    if (value && !fonts[key]) fonts[key] = value;
  }
  return { entry: themeEntry, colors, fonts };
}

async function extractRelationships(pptxPath, entries) {
  const relEntries = entries.filter((entry) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(entry));
  const relationships = [];
  for (const entry of relEntries.slice(0, 20)) {
    const xml = await readZipText(pptxPath, entry);
    for (const match of xml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relationships.push({ entry, id: match[1], type: match[2], target: match[3] });
    }
  }
  return relationships;
}

async function optionalLibreOfficeThumbnails({ inputPath, outDir }) {
  const warnings = [];
  try {
    await mkdir(outDir, { recursive: true });
    await execFileAsync("soffice", ["--headless", "--convert-to", "png", "--outdir", outDir, inputPath], {
      maxBuffer: 20 * 1024 * 1024,
    });
    return { outDir, status: "attempted", warnings };
  } catch (error) {
    warnings.push(`LibreOffice thumbnail export unavailable: ${error.message}`);
    return { outDir, status: "skipped", warnings };
  }
}

async function mergeThemeIntoProtocol({ protocolPath, theme, index }) {
  const { readJson } = await import("./lib.mjs");
  const protocol = await readJson(protocolPath);
  protocol.style = protocol.style || {};
  if (theme.colors?.length) protocol.style.palette = theme.colors;
  if (theme.fonts && Object.keys(theme.fonts).length) protocol.style.typography = Object.values(theme.fonts).filter(Boolean).join(", ");
  protocol.assets = protocol.assets || [];
  for (const asset of index.assets || []) {
    if (protocol.assets.some((item) => item.id === asset.id)) continue;
    protocol.assets.push({
      id: asset.id,
      type: "template_image",
      path: asset.path,
      source: asset.original,
      caption: asset.caption,
      usage: "style",
    });
  }
  await writeJson(protocolPath, protocol);
}
