import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureParent, slugify, writeJson } from "./lib.mjs";

export async function createAssetIndex({
  sources = [],
  outDir,
  indexPath = null,
  caption = "",
  usage = "evidence",
} = {}) {
  if (!outDir) throw new Error("createAssetIndex requires outDir");
  const assetDir = path.resolve(outDir, "reference-assets");
  await mkdir(assetDir, { recursive: true });

  const byHash = new Map();
  const assets = [];
  const duplicates = [];

  for (const source of sources) {
    const record = await localizeSource(source, { assetDir, caption, usage });
    const existing = byHash.get(record.sha256);
    if (existing) {
      existing.originals = [...new Set([...(existing.originals || [existing.original]), record.original])];
      duplicates.push({ original: record.original, asset_id: existing.id, sha256: record.sha256 });
      continue;
    }
    byHash.set(record.sha256, record);
    assets.push(record);
  }

  const index = {
    kind: "ppt-composer-asset-index",
    version: "0.1",
    createdAt: new Date().toISOString(),
    assetDir,
    assets,
    duplicates,
  };
  if (indexPath) await writeJson(indexPath, index);
  return index;
}

export async function writeAssetIndexForProtocolAssets({ assets = [], assetDir, indexPath } = {}) {
  const indexed = [];
  const warnings = [];
  const byHash = new Map();

  for (const asset of assets) {
    if (!asset.path || /^https?:\/\//i.test(asset.path)) continue;
    try {
      const buffer = await readFile(asset.path);
      const sha256 = hashBuffer(buffer);
      const info = await stat(asset.path);
      const existing = byHash.get(sha256);
      if (existing) {
        existing.protocol_asset_ids.push(asset.id);
        continue;
      }
      const record = {
        id: asset.id || stableAssetId(asset.path, sha256),
        original: asset.source || asset.path,
        path: asset.path,
        sha256,
        mime: mimeFromPath(asset.path, buffer),
        size: info.size,
        caption: asset.caption || "",
        usage: asset.usage || "evidence",
        type: asset.type || "source_asset",
        protocol_asset_ids: [asset.id].filter(Boolean),
      };
      byHash.set(sha256, record);
      indexed.push(record);
    } catch (error) {
      warnings.push(`Unable to index asset ${asset.id || asset.path}: ${error.message}`);
    }
  }

  const index = {
    kind: "ppt-composer-asset-index",
    version: "0.1",
    createdAt: new Date().toISOString(),
    assetDir,
    assets: indexed,
    warnings,
  };
  if (indexPath) await writeJson(indexPath, index);
  return index;
}

async function localizeSource(source, { assetDir, caption, usage }) {
  const original = source;
  let buffer;
  let sourceName;
  let contentType = "";

  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to download asset ${source}: ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
    contentType = response.headers.get("content-type") || "";
    sourceName = path.basename(new URL(source).pathname) || "remote-asset";
  } else {
    const resolved = path.resolve(source);
    buffer = await readFile(resolved);
    sourceName = path.basename(resolved);
  }

  const sha256 = hashBuffer(buffer);
  const mime = contentType.split(";")[0] || mimeFromPath(sourceName, buffer);
  const ext = extensionForAsset(sourceName, mime);
  const id = stableAssetId(sourceName, sha256);
  const dest = path.join(assetDir, `${id}${ext}`);
  await ensureParent(dest);
  if (/^https?:\/\//i.test(source)) {
    await writeFile(dest, buffer);
  } else {
    await copyFile(path.resolve(source), dest);
  }

  return {
    id,
    original,
    path: dest,
    sha256,
    mime,
    size: buffer.length,
    caption: caption || path.basename(sourceName, path.extname(sourceName)),
    usage,
  };
}

function stableAssetId(sourceName, sha256) {
  return `${slugify(path.basename(sourceName, path.extname(sourceName)), "asset")}-${sha256.slice(0, 10)}`;
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function extensionForAsset(sourceName, mime) {
  const ext = path.extname(sourceName).toLowerCase();
  if (ext) return ext;
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/svg+xml") return ".svg";
  if (mime === "text/csv") return ".csv";
  if (mime === "text/plain") return ".txt";
  return ".bin";
}

function mimeFromPath(filePath, buffer = null) {
  if (buffer?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".csv") return "text/csv";
  if (ext === ".tsv") return "text/tab-separated-values";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}
