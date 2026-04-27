import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function buildPluginEnv({ pluginRoot, baseEnv = process.env } = {}) {
  if (!pluginRoot) throw new Error("buildPluginEnv requires pluginRoot");
  const candidates = envFileCandidates(pluginRoot, baseEnv);
  const fileEnv = {};
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    Object.assign(fileEnv, parseEnvFile(readFileSync(filePath, "utf8")));
  }
  return { ...fileEnv, ...baseEnv };
}

export function envFileCandidates(pluginRoot, env = process.env) {
  const candidates = [
    path.join(pluginRoot, ".env"),
    path.resolve(pluginRoot, "..", "..", ".env"),
  ];
  if (env.PPT_COMPOSER_ENV_FILE) candidates.push(path.resolve(env.PPT_COMPOSER_ENV_FILE));
  return [...new Set(candidates)];
}

export function parseEnvFile(source) {
  const env = {};
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const index = normalized.indexOf("=");
    if (index <= 0) continue;
    const key = normalized.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = unquoteEnvValue(normalized.slice(index + 1).trim());
  }
  return env;
}

function unquoteEnvValue(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    const inner = value.slice(1, -1);
    return value.startsWith("\"")
      ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"")
      : inner;
  }
  const commentIndex = value.search(/\s+#/);
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}
