import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function resolvePath(filePath, baseDir = process.cwd()) {
  if (!filePath) return filePath;
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(filePath, payload) {
  await ensureParent(filePath);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureParent(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function cleanHex(color, fallback = "111827") {
  if (!color || typeof color !== "string") return fallback;
  return color.replace(/^#/, "").toUpperCase();
}

export function toNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export function arrayify(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function stripXml(xml) {
  return String(xml || "").replace(/<[^>]+>/g, "");
}

export function slugify(value, fallback = "item") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}
