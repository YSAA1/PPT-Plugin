import { readFile, stat } from "node:fs/promises";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function inspectPng(filePath) {
  const result = {
    path: filePath,
    exists: false,
    isPng: false,
    width: null,
    height: null,
    size: 0,
    hasPlaceholderMarker: false,
    errors: [],
  };

  let info;
  try {
    info = await stat(filePath);
  } catch {
    result.errors.push(`missing file: ${filePath}`);
    return result;
  }
  result.exists = info.isFile();
  result.size = info.size;
  if (!result.exists) {
    result.errors.push(`not a file: ${filePath}`);
    return result;
  }

  const buffer = await readFile(filePath);
  result.isPng = buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_MAGIC);
  if (!result.isPng) {
    result.errors.push(`not a PNG file: ${filePath}`);
    return result;
  }

  result.width = buffer.readUInt32BE(16);
  result.height = buffer.readUInt32BE(20);
  result.hasPlaceholderMarker = /placeholder|PPT Composer Placeholder Asset/i.test(buffer.toString("latin1"));
  return result;
}

export function isLikelyTinyPng(info, { minBytes = 1024, minWidth = 64, minHeight = 64 } = {}) {
  return info.size < minBytes || Number(info.width || 0) < minWidth || Number(info.height || 0) < minHeight;
}
