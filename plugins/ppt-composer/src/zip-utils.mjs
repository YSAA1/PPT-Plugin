import { readFile } from "node:fs/promises";
import JSZip from "jszip";

export async function loadZip(zipPath) {
  const buffer = await readFile(zipPath);
  return JSZip.loadAsync(buffer);
}

export async function listZipEntries(zipPath) {
  const zip = await loadZip(zipPath);
  return Object.keys(zip.files).filter((entry) => !zip.files[entry].dir);
}

export async function readZipText(zipPath, entry) {
  const zip = await loadZip(zipPath);
  const file = zip.file(entry);
  if (!file) throw new Error(`Zip entry not found: ${entry}`);
  return file.async("string");
}

export async function readZipBuffer(zipPath, entry) {
  const zip = await loadZip(zipPath);
  const file = zip.file(entry);
  if (!file) throw new Error(`Zip entry not found: ${entry}`);
  return file.async("nodebuffer");
}

export async function readZipEntries(zipPath, pattern) {
  const zip = await loadZip(zipPath);
  const entries = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (pattern && !pattern.test(name)) continue;
    entries.push({ name, file });
  }
  return { zip, entries };
}
