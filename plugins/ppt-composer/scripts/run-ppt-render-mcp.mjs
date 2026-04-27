#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { buildPluginEnv } from "./env-loader.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const env = buildPluginEnv({ pluginRoot });

const requiredDeps = [
  "node_modules/@modelcontextprotocol/sdk",
  "node_modules/pptxgenjs",
  "node_modules/jszip"
];

const missingDeps = requiredDeps.filter((dep) => !existsSync(join(pluginRoot, dep)));

if (missingDeps.length > 0) {
  if (process.env.PPT_COMPOSER_DISABLE_AUTO_INSTALL === "1") {
    failMissingDeps(missingDeps);
  }

  installMissingDeps(missingDeps);
}

const remainingMissingDeps = requiredDeps.filter((dep) => !existsSync(join(pluginRoot, dep)));

if (remainingMissingDeps.length > 0) {
  failMissingDeps(remainingMissingDeps);
}

const child = spawn(process.execPath, ["./src/ppt-render-mcp.mjs"], {
  cwd: pluginRoot,
  stdio: "inherit",
  env,
  windowsHide: true
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});

function installMissingDeps(missingDeps) {
  console.error([
    "PPT Composer runtime dependencies are missing; installing them once before MCP startup.",
    `Plugin root: ${pluginRoot}`,
    `Missing: ${missingDeps.join(", ")}`,
    "If this is slow on your machine, run `npm run prewarm` from the plugin root before starting Codex."
  ].join("\n"));

  const install = spawnSync(
    npmCommand,
    ["install", "--no-audit", "--no-fund", "--omit=dev"],
    {
      cwd: pluginRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      windowsHide: true
    }
  );

  if (install.stdout) process.stderr.write(install.stdout);
  if (install.stderr) process.stderr.write(install.stderr);

  if (install.error?.code === "ENOENT") {
    console.error("npm was not found. Install Node.js/npm, then restart Codex or run `npm run prewarm` manually.");
    process.exit(1);
  }

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

function failMissingDeps(missingDeps) {
  console.error([
    "PPT Composer runtime dependencies are missing.",
    `Plugin root: ${pluginRoot}`,
    `Missing: ${missingDeps.join(", ")}`,
    "",
    "Run this once after installing or updating the plugin:",
    `  cd ${JSON.stringify(pluginRoot)}`,
    "  npm run prewarm",
    "",
    "Then restart Codex so the MCP server starts from a warm dependency cache."
  ].join("\n"));
  process.exit(1);
}
