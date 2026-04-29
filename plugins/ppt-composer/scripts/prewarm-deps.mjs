#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const uvxCommand = process.platform === "win32" ? "uvx.cmd" : "uvx";
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
    npmCommand,
    ["install", "--no-audit", "--no-fund", "--omit=dev"],
    {
      cwd: pluginRoot,
      stdio: "inherit",
      windowsHide: true
    }
  );

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }

  console.log("PPT Composer Node dependencies are prewarmed.");
}

function prewarmMineruDeps() {
  console.log("Prewarming mineru-open-mcp through uvx...");

  const check = spawnSync(
    uvxCommand,
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

  if (check.error?.code === "ENOENT") {
    console.error("uvx was not found. Install uv first, or skip prewarm:mineru if MinerU parsing is not needed.");
    process.exit(1);
  }

  if (check.status !== 0) {
    process.exit(check.status ?? 1);
  }

  console.log("mineru-open-mcp is prewarmed.");
}
