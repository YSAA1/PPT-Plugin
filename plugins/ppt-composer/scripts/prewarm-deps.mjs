#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isCommandLaunchError, resolveCommand, resolveNpmCommand } from "./command-resolver.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = resolveNpmCommand({ overrideEnv: "PPT_COMPOSER_NPM" });
const uvxCommand = resolveCommand("uvx", { overrideEnv: "PPT_COMPOSER_UVX" });
const args = new Set(process.argv.slice(2));

const requiredNodeDeps = [
  "node_modules/@modelcontextprotocol/sdk",
  "node_modules/pptxgenjs",
  "node_modules/jszip"
];

if (args.has("--help") || args.has("-h")) {
  console.log([
    "Usage: node ./scripts/prewarm-deps.mjs [--include-mineru]",
    "",
    "Installs Node runtime dependencies before Codex starts PPT Composer MCP servers.",
    "",
    "Options:",
    "  --include-mineru  Also prewarm uvx/mineru-open-mcp for document parsing."
  ].join("\n"));
  process.exit(0);
}

prewarmNodeDeps();

if (args.has("--include-mineru")) {
  prewarmMineruDeps();
}

function prewarmNodeDeps() {
  const missing = requiredNodeDeps.filter((dep) => !existsSync(join(pluginRoot, dep)));

  if (missing.length === 0) {
    console.log("PPT Composer Node dependencies are already prewarmed.");
    return;
  }

  console.log("Installing PPT Composer Node runtime dependencies...");
  console.log(`Plugin root: ${pluginRoot}`);
  console.log(`Missing: ${missing.join(", ")}`);

  const install = spawnSync(
    npmCommand.command,
    [...npmCommand.args, "install", "--no-audit", "--no-fund", "--omit=dev"],
    {
      cwd: pluginRoot,
      stdio: "inherit",
      windowsHide: true
    }
  );

  if (isCommandLaunchError(install.error)) {
    console.error(`npm could not be launched (${npmCommand.command}): ${install.error.message}`);
    process.exit(1);
  }

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }

  console.log("PPT Composer Node dependencies are prewarmed.");
}

function prewarmMineruDeps() {
  console.log("Prewarming mineru-open-mcp through uvx...");

  if (!uvxCommand.resolved) {
    console.error("uvx was not found. Install uv first, or skip prewarm:mineru if MinerU parsing is not needed.");
    process.exit(1);
  }

  const check = spawnSync(
    uvxCommand.command,
    [
      "--from",
      "mineru-open-mcp",
      "--with",
      "socksio",
      "python",
      "-c",
      "import mineru_open_mcp, socksio; print('mineru-open-mcp ready')"
    ],
    {
      cwd: pluginRoot,
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        FASTMCP_CHECK_FOR_UPDATES: "off",
        FASTMCP_SHOW_SERVER_BANNER: "false"
      }
    }
  );

  if (isCommandLaunchError(check.error)) {
    console.error(`uvx could not be launched (${uvxCommand.command}): ${check.error.message}`);
    process.exit(1);
  }

  if (check.status !== 0) {
    process.exit(check.status ?? 1);
  }

  console.log("mineru-open-mcp is prewarmed.");
}
