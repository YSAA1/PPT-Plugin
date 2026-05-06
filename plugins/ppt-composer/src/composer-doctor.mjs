import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildPluginEnv, envFileCandidates, parseEnvFile } from "../scripts/env-loader.mjs";
import { resolveCommand, resolveNpmCommand } from "../scripts/command-resolver.mjs";
import { readJson } from "./lib.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runComposerDoctor({ createEnvTemplate = false, envPath } = {}) {
  const env = buildPluginEnv({ pluginRoot });
  const mcpConfig = await readJson(path.join(pluginRoot, ".mcp.json")).catch((error) => ({ error: error.message }));
  const envCandidates = envFileCandidates(pluginRoot, env);
  const envFiles = await Promise.all(envCandidates.map(async (candidate) => {
    const parsed = await readEnvFile(candidate);
    return {
      path: candidate,
      exists: parsed.exists,
      keys: parsed.exists ? Object.keys(parsed.values).filter((key) => !secretLike(key)).sort() : [],
      secret_keys: parsed.exists ? Object.keys(parsed.values).filter(secretLike).sort() : [],
    };
  }));

  let template = null;
  if (createEnvTemplate) {
    template = await ensureEnvTemplate(envPath || envCandidates[0] || path.join(pluginRoot, ".env"));
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const uvxCommand = resolveCommand("uvx", { env, overrideEnv: "PPT_COMPOSER_UVX" });
  const npmCommand = resolveNpmCommand({ env, overrideEnv: "PPT_COMPOSER_NPM" });
  const pdftoppmCommand = resolveCommand("pdftoppm", { env });
  const uvx = commandCheck(uvxCommand, ["--version"]);
  const npm = commandCheck(npmCommand, ["--version"]);
  const pdftoppm = commandCheck(pdftoppmCommand, ["-v"]);
  const mineruTokenPresent = Boolean(env.MINERU_API_TOKEN || env.MINERU_TOKEN);
  const mineruServer = mcpConfig?.mcpServers?.["mineru-open-mcp"] || {};
  const renderServer = mcpConfig?.mcpServers?.["ppt-render-mcp"] || {};

  const checks = {
    node: {
      status: nodeMajor >= 20 ? "ok" : "error",
      version: process.versions.node,
      required: "20+",
    },
    npm: {
      status: npm.ok ? "ok" : "error",
      version: npm.stdout || null,
      error: npm.error || null,
    },
    uvx: {
      status: uvx.ok ? "ok" : "error",
      version: uvx.stdout || uvx.stderr || null,
      error: uvx.error || null,
    },
    mineru_token: {
      status: mineruTokenPresent ? "ok" : "warning",
      present: mineruTokenPresent,
      mode: mineruTokenPresent ? "full_api" : "flash_free",
      note: mineruTokenPresent
        ? "MinerU token is available to MCP wrappers."
        : "No token found; MinerU will use Flash/free mode with smaller limits and Markdown-first behavior.",
    },
    pdf_page_image_fallback: {
      status: pdftoppm.ok ? "ok" : "warning",
      available: pdftoppm.ok,
      command: "pdftoppm",
      note: pdftoppm.ok
        ? "PDF page-image fallback is available when Flash mode returns Markdown-only results."
        : "Install poppler-utils to enable local PDF page-image fallback without a MinerU token.",
    },
    mcp_config: {
      status: mcpConfig.error ? "error" : "ok",
      error: mcpConfig.error || null,
      mineru_startup_timeout_sec: mineruServer.startup_timeout_sec ?? null,
      mineru_tool_timeout_sec: mineruServer.tool_timeout_sec ?? null,
      ppt_render_tool_timeout_sec: renderServer.tool_timeout_sec ?? null,
    },
  };

  const recommendations = [];
  if (checks.node.status === "error") recommendations.push("Install Node.js 20+.");
  if (checks.npm.status === "error") recommendations.push("Install npm or ensure it is on PATH.");
  if (checks.uvx.status === "error") recommendations.push("Install uv/uvx, then run `npm run prewarm:mineru` from the PPT Composer plugin root and restart Codex.");
  if (!mineruTokenPresent) {
    recommendations.push("For large PDFs and true figure/image extraction, set MINERU_API_TOKEN in the plugin env file, then restart Codex.");
  }
  if (!pdftoppm.ok) recommendations.push("Optional fallback: install poppler-utils so Flash mode can produce local PDF page images.");
  if ((mineruServer.tool_timeout_sec || 0) < 300) recommendations.push("Set mineru-open-mcp tool_timeout_sec to at least 900 for long PDFs.");

  const status = Object.values(checks).some((check) => check.status === "error")
    ? "error"
    : Object.values(checks).some((check) => check.status === "warning")
      ? "warning"
      : "ok";

  return {
    status,
    plugin_root: pluginRoot,
    mode: mineruTokenPresent ? "full_api" : "flash_free",
    limits: mineruTokenPresent
      ? "MinerU authenticated API limits depend on the user's MinerU plan/account."
      : "Flash/free mode is suitable for small documents and may be limited around 10 MB / 20 pages; it is Markdown-first.",
    env_files: envFiles,
    template,
    checks,
    recommendations,
    setup_commands: [
      `cd ${pluginRoot}`,
      "npm run prewarm",
      "npm run prewarm:mineru",
    ],
    restart_required_after_env_change: true,
  };
}

async function readEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return { exists: true, values: parseEnvFile(raw) };
  } catch {
    return { exists: false, values: {} };
  }
}

async function ensureEnvTemplate(filePath) {
  const resolved = path.resolve(filePath);
  const existed = await canAccess(resolved);
  if (existed) {
    const parsed = await readEnvFile(resolved);
    return {
      path: resolved,
      created: false,
      message: parsed.values.MINERU_API_TOKEN || parsed.values.MINERU_TOKEN
        ? "Env file already exists and contains a MinerU token key."
        : "Env file already exists; fill MINERU_API_TOKEN and restart Codex.",
    };
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, [
    "# Private PPT Composer environment file. Do not commit this file.",
    "# Fill your MinerU token, then restart Codex.",
    "MINERU_API_TOKEN=",
    "MINERU_TOKEN=",
    "",
  ].join("\n"), { mode: 0o600 });
  return { path: resolved, created: true, message: "Created env template; fill MINERU_API_TOKEN and restart Codex." };
}

async function canAccess(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function commandCheck(commandSpec, args) {
  if (!commandSpec.resolved) {
    return { ok: false, error: `${commandSpec.command} was not found` };
  }

  const result = spawnSync(commandSpec.command, [...(commandSpec.args || []), ...args], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) return { ok: false, error: result.error.message };
  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim().split(/\r?\n/)[0] || "",
    stderr: (result.stderr || "").trim().split(/\r?\n/)[0] || "",
    status: result.status,
  };
}

function secretLike(key) {
  return /TOKEN|KEY|SECRET|PASSWORD/i.test(key);
}
