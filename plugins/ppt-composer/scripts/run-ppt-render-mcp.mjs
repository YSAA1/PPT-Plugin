#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { buildPluginEnv } from "./env-loader.mjs";
import { isCommandLaunchError, resolveNpmCommand } from "./command-resolver.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = buildPluginEnv({ pluginRoot });
const npmCommand = resolveNpmCommand({ env, overrideEnv: "PPT_COMPOSER_NPM" });

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
    npmCommand.command,
    [...npmCommand.args, "install", "--no-audit", "--no-fund", "--omit=dev"],
    {
      cwd: pluginRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      windowsHide: true
    }
  );

  if (install.stdout) process.stderr.write(install.stdout);
  if (install.stderr) process.stderr.write(install.stderr);

  if (isCommandLaunchError(install.error)) {
    console.error(`npm could not be launched (${npmCommand.command}): ${install.error.message}`);
    console.error("Install Node.js/npm, set PPT_COMPOSER_NPM, then restart Codex or run `npm run prewarm` manually.");
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
