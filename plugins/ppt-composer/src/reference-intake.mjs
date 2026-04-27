import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { parsePaper } from "./paper-parse.mjs";
import { createDeckProtocol } from "./deck-protocol.mjs";
import { ensureParent, exists, slugify } from "./lib.mjs";
import { writeAssetIndexForProtocolAssets } from "./asset-index.mjs";
import { listZipEntries, readZipBuffer, readZipText } from "./zip-utils.mjs";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);
const TEXT_EXTS = new Set([".txt"]);
const TABLE_EXTS = new Set([".csv", ".tsv"]);

export async function referenceIntake({
  inputs = [],
  outDir,
  protocolPath = null,
  deck = {},
  style = {},
  lang = "zh",
  mode = null,
  imageRole = "source_image",
  mineruWrapper = null,
  dryRun = false,
} = {}) {
  if (!outDir) throw new Error("referenceIntake requires outDir");
  const resolvedOutDir = path.resolve(outDir);
  const assetDir = path.join(resolvedOutDir, "reference-assets");
  await mkdir(assetDir, { recursive: true });

  const assets = [];
  const warnings = [];
  const normalizedInputs = inputs.map((input) => path.resolve(input));
  for (const inputPath of normalizedInputs) {
    if (!(await exists(inputPath))) {
      throw new Error(`Reference input not found: ${inputPath}`);
    }
    const ext = path.extname(inputPath).toLowerCase();
    if (MARKDOWN_EXTS.has(ext)) {
      await ingestMarkdown({ inputPath, assetDir, assets, warnings });
    } else if (TEXT_EXTS.has(ext)) {
      await ingestText({ inputPath, assets });
    } else if (TABLE_EXTS.has(ext)) {
      await ingestDelimitedTable({ inputPath, assetDir, assets, delimiter: ext === ".tsv" ? "\t" : "," });
    } else if (IMAGE_EXTS.has(ext)) {
      await ingestImage({ inputPath, assetDir, assets, role: imageRole });
    } else if (ext === ".docx") {
      await ingestDocx({ inputPath, assetDir, assets, warnings });
    } else if (ext === ".doc") {
      warnings.push(`${path.basename(inputPath)} is legacy .doc; direct OOXML parsing is unavailable. Use MinerU or convert to .docx.`);
      await ingestMineruDocument({ inputPath, assetDir, assets, warnings, lang, mineruWrapper, dryRun });
    } else if (ext === ".pdf") {
      await ingestMineruDocument({ inputPath, assetDir, assets, warnings, lang, mineruWrapper, dryRun });
    } else {
      throw new Error(`Unsupported reference input type: ${inputPath}`);
    }
  }

  const protocolMode = mode || (normalizedInputs.length ? "reference_grounded_mode" : "brief_mode");
  const pageCount = Number(deck.page_count || deck.pageCount || Math.max(1, Math.min(8, assets.filter((asset) => asset.type === "text_evidence").length || 1)));
  const protocol = createDeckProtocol({
    mode: protocolMode,
    source: {
      inputs: normalizedInputs,
      warnings,
      protocolPath,
    },
    deck: {
      title: deck.title || titleFromInputs(normalizedInputs) || "Image-first deck",
      language: deck.language || lang,
      audience: deck.audience || "",
      page_count: pageCount,
      aspect_ratio: deck.aspect_ratio || deck.aspectRatio || "16:9",
    },
    style,
    assets,
    pages: buildProtocolPages({ assets, pageCount, deck, protocolMode }),
  });

  if (protocolPath) {
    await ensureParent(protocolPath);
    await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`, "utf8");
  }
  const assetIndexPath = path.join(assetDir, "asset-index.json");
  const assetIndex = await writeAssetIndexForProtocolAssets({ assets, assetDir, indexPath: assetIndexPath });

  return {
    protocol,
    protocolPath,
    outDir: resolvedOutDir,
    assetDir,
    assetIndexPath,
    indexedAssets: assetIndex.assets.length,
    assets: assets.length,
    pages: protocol.pages.length,
    warnings: [...warnings, ...(assetIndex.warnings || [])],
  };
}

async function ingestMarkdown({ inputPath, assetDir, assets, warnings }) {
  const markdown = await readFile(inputPath, "utf8");
  const basename = path.basename(inputPath);
  const textSnippets = extractMarkdownText(markdown);
  addTextAssets({ assets, source: basename, snippets: textSnippets });

  for (const table of extractMarkdownTables(markdown)) {
    await addTableAsset({ assets, assetDir, source: basename, table });
  }

  for (const image of extractMarkdownImages(markdown)) {
    if (/^https?:\/\//i.test(image.path)) {
      assets.push({
        id: nextId(assets, "img"),
        type: "source_image",
        path: image.path,
        source: basename,
        caption: image.alt || image.path,
        usage: "evidence",
        remote: true,
      });
      continue;
    }
    const resolved = path.resolve(path.dirname(inputPath), image.path);
    if (!(await exists(resolved))) {
      warnings.push(`Markdown image not found: ${image.path} in ${basename}`);
      continue;
    }
    await ingestImage({ inputPath: resolved, assetDir, assets, role: "source_image", source: basename, caption: image.alt });
  }
}

async function ingestText({ inputPath, assets }) {
  const text = await readFile(inputPath, "utf8");
  const snippets = text
    .split(/\n{2,}/)
    .map((part) => compact(part))
    .filter(Boolean)
    .slice(0, 20);
  addTextAssets({ assets, source: path.basename(inputPath), snippets });
}

async function ingestDelimitedTable({ inputPath, assetDir, assets, delimiter }) {
  const raw = await readFile(inputPath, "utf8");
  const rows = raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));
  await addTableAsset({
    assets,
    assetDir,
    source: path.basename(inputPath),
    table: { rows, caption: path.basename(inputPath) },
  });
}

async function ingestImage({ inputPath, assetDir, assets, role = "source_image", source = null, caption = null }) {
  const idPrefix = role === "logo" ? "logo" : role === "template_image" ? "tpl" : "fig";
  const id = nextId(assets, idPrefix);
  const dest = path.join(assetDir, `${id}${path.extname(inputPath).toLowerCase()}`);
  await copyFile(inputPath, dest);
  assets.push({
    id,
    type: role,
    path: dest,
    source: source || path.basename(inputPath),
    caption: caption || path.basename(inputPath),
    usage: role === "template_image" ? "style" : role === "logo" ? "identity" : "evidence",
  });
}

async function ingestDocx({ inputPath, assetDir, assets, warnings }) {
  const source = path.basename(inputPath);
  const documentXml = await unzipReadText(inputPath, "word/document.xml");
  const textSnippets = extractDocxParagraphs(documentXml).map(compact).filter(Boolean).slice(0, 24);
  addTextAssets({ assets, source, snippets: textSnippets });

  for (const table of extractDocxTables(documentXml)) {
    await addTableAsset({ assets, assetDir, source, table });
  }

  const fileList = await unzipList(inputPath);
  for (const zipName of fileList.filter((entry) => /^word\/media\//.test(entry))) {
    const id = nextId(assets, "fig");
    const dest = path.join(assetDir, `${id}${path.extname(zipName).toLowerCase() || ".bin"}`);
    const buffer = await unzipReadBuffer(inputPath, zipName);
    await writeFile(dest, buffer);
    assets.push({
      id,
      type: "source_image",
      path: dest,
      source,
      caption: path.basename(zipName),
      usage: "evidence",
    });
  }
  if (!textSnippets.length) warnings.push(`DOCX contained no extractable paragraph text: ${source}`);
}

async function ingestMineruDocument({ inputPath, assetDir, assets, warnings, lang, mineruWrapper, dryRun }) {
  const source = path.basename(inputPath);
  const parseDir = path.join(path.dirname(assetDir), "mineru", slugify(path.basename(inputPath, path.extname(inputPath))));
  const result = await parsePaper({ inputPath, outDir: parseDir, lang, mineruWrapper, dryRun });
  if (result.dryRun) {
    warnings.push(`MinerU dry-run only; no reference assets extracted for ${source}`);
    return;
  }
  if (result.markdown && await exists(result.markdown)) {
    await ingestMarkdown({ inputPath: result.markdown, assetDir, assets, warnings });
  }
  for (const imagePath of result.figures || []) {
    if (await exists(imagePath)) {
      await ingestImage({ inputPath: imagePath, assetDir, assets, role: "source_image", source, caption: path.basename(imagePath) });
    }
  }
}

function addTextAssets({ assets, source, snippets }) {
  for (const snippet of snippets) {
    assets.push({
      id: nextId(assets, "txt"),
      type: "text_evidence",
      source,
      text: snippet,
      summary: snippet,
      usage: "evidence",
    });
  }
}

async function addTableAsset({ assets, assetDir, source, table }) {
  const id = nextId(assets, "tbl");
  const pngPath = path.join(assetDir, `${id}.png`);
  await writeTablePreviewPng(pngPath, table.rows || []);
  assets.push({
    id,
    type: "source_table",
    path: pngPath,
    source,
    caption: table.caption || `Table from ${source}`,
    usage: "evidence",
    rows: table.rows || [],
    summary: summarizeTable(table.rows || []),
  });
}

function buildProtocolPages({ assets, pageCount, deck, protocolMode }) {
  const textAssets = assets.filter((asset) => asset.type === "text_evidence");
  const tableAssets = assets.filter((asset) => asset.type === "source_table");
  const imageAssets = assets.filter((asset) => /image|logo/.test(asset.type || ""));
  const pages = [];
  for (let i = 0; i < pageCount; i += 1) {
    const pageNumber = i + 1;
    const text = textAssets[i % Math.max(1, textAssets.length)];
    const table = tableAssets[i % Math.max(1, tableAssets.length)];
    const image = imageAssets[i % Math.max(1, imageAssets.length)];
    const textIds = text ? [text.id] : [];
    const tableIds = table && i % 3 === 1 ? [table.id] : [];
    const imageIds = image && i % 3 === 2 ? [image.id] : [];
    const referenceIds = [...tableIds, ...imageIds];
    const claim = text?.summary || deck.claim || deck.title || `Page ${pageNumber}`;
    pages.push({
      page: pageNumber,
      title: pageNumber === 1 ? (deck.title || "Image-first deck") : `Page ${pageNumber}`,
      claim,
      content_inputs: {
        text: textIds,
        tables: tableIds,
        images: imageIds,
      },
      reference_asset_ids: referenceIds,
      fidelity: referenceIds.length ? "light_redraw" : "free",
      final_image_prompt: [
        `Create page ${pageNumber} as a complete finished full-slide 16:9 PPT image.`,
        `Main claim: ${claim}`,
        "Use a polished scientific-consulting layout with sparse readable labels.",
      ].join(" "),
      negative_prompt: "No separate PPT text overlay, no fake numbers, no fake logos, no watermark, no tiny unreadable text, no placeholder art.",
      output_png: `dist/slides/slide-${String(pageNumber).padStart(2, "0")}.png`,
      free_generation: protocolMode === "reference_grounded_mode" ? !(textIds.length || tableIds.length || imageIds.length || referenceIds.length) : true,
    });
  }
  return pages;
}

function extractMarkdownText(markdown) {
  const lines = markdown.split(/\r?\n/);
  const snippets = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^!\[/.test(trimmed) || /^\|/.test(trimmed)) continue;
    if (/^#{1,6}\s+/.test(trimmed)) snippets.push(trimmed.replace(/^#{1,6}\s+/, ""));
    else if (!/^[-*+]\s*$/.test(trimmed)) snippets.push(trimmed.replace(/^[-*+]\s+/, ""));
    if (snippets.length >= 20) break;
  }
  return snippets.map(compact).filter(Boolean);
}

function extractMarkdownImages(markdown) {
  const images = [];
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    images.push({ alt: compact(match[1]), path: match[2].replace(/^<|>$/g, "").trim() });
  }
  return images;
}

function extractMarkdownTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const rows = [parseMarkdownTableRow(lines[i])];
    i += 2;
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      rows.push(parseMarkdownTableRow(lines[i]));
      i += 1;
    }
    tables.push({ rows, caption: "Markdown table" });
  }
  return tables;
}

function parseMarkdownTableRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function extractDocxParagraphs(xml) {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((part) => decodeXml(part[1])).join(""))
    .filter(Boolean);
}

function extractDocxTables(xml) {
  return [...xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)].map((tableMatch) => {
    const rows = [...tableMatch[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((rowMatch) =>
      [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cellMatch) =>
        extractDocxParagraphs(cellMatch[0]).join(" ").trim(),
      ),
    );
    return { rows, caption: "DOCX table" };
  }).filter((table) => table.rows.length);
}

async function unzipList(zipPath) {
  try {
    return await listZipEntries(zipPath);
  } catch (error) {
    throw new Error(`Unable to inspect DOCX zip entries: ${error.message}`);
  }
}

async function unzipReadText(zipPath, entry) {
  try {
    return await readZipText(zipPath, entry);
  } catch (error) {
    throw new Error(`Unable to read ${entry} from DOCX: ${error.message}`);
  }
}

async function unzipReadBuffer(zipPath, entry) {
  try {
    return await readZipBuffer(zipPath, entry);
  } catch (error) {
    throw new Error(`Unable to read ${entry} from DOCX: ${error.message}`);
  }
}

async function writeTablePreviewPng(filePath, rows) {
  const width = 960;
  const rowCount = Math.max(2, Math.min(12, rows.length || 2));
  const height = 80 + rowCount * 44;
  const rgba = Buffer.alloc(width * height * 4, 255);
  fillRect(rgba, width, 0, 0, width, height, [248, 250, 252, 255]);
  fillRect(rgba, width, 32, 24, width - 64, 44, [219, 234, 254, 255]);
  for (let row = 0; row <= rowCount; row += 1) {
    fillRect(rgba, width, 32, 68 + row * 44, width - 64, 2, [148, 163, 184, 255]);
  }
  const columnCount = Math.max(2, Math.min(8, Math.max(...rows.map((row) => row.length), 2)));
  for (let col = 0; col <= columnCount; col += 1) {
    const x = 32 + Math.round((width - 64) * col / columnCount);
    fillRect(rgba, width, x, 24, 2, rowCount * 44 + 46, [148, 163, 184, 255]);
  }
  await ensureParent(filePath);
  await writeFile(filePath, encodePng(width, height, rgba));
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fillRect(buffer, imageWidth, x, y, w, h, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(imageWidth, x + w);
  const y1 = Math.min(buffer.length / (imageWidth * 4), y + h);
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      const index = (yy * imageWidth + xx) * 4;
      buffer[index] = color[0];
      buffer[index + 1] = color[1];
      buffer[index + 2] = color[2];
      buffer[index + 3] = color[3];
    }
  }
}

function summarizeTable(rows) {
  const header = rows[0] || [];
  return `table with ${rows.length} rows and ${Math.max(...rows.map((row) => row.length), 0)} columns${header.length ? `; columns: ${header.join(", ")}` : ""}`;
}

function compact(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function titleFromInputs(inputs) {
  if (!inputs.length) return "";
  return path.basename(inputs[0], path.extname(inputs[0]));
}

function nextId(assets, prefix) {
  const count = assets.filter((asset) => String(asset.id || "").startsWith(`${prefix}-`)).length + 1;
  return `${prefix}-${count}`;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
