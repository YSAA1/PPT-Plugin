#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { buildPluginEnv } from "./env-loader.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const uvxCommand = process.platform === "win32" ? "uvx.cmd" : "uvx";
const env = buildPluginEnv({ pluginRoot });

const fallbackDeps = [
  "node_modules/@modelcontextprotocol/sdk",
  "node_modules/zod"
];

const child = spawn(
  uvxCommand,
  [
    "--from",
    "mineru-open-mcp",
    "python",
    "./scripts/mineru-open-mcp-with-images.py",
    "--transport",
    "stdio",
    "--output-dir",
    "./dist/mineru-open-mcp"
  ],
  {
    cwd: pluginRoot,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...env,
      FASTMCP_CHECK_FOR_UPDATES: "off",
      FASTMCP_SHOW_SERVER_BANNER: "false"
    }
  }
);

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    void startSetupHelpMcp().catch((fallbackError) => {
      console.error(`Failed to start mineru-open-mcp setup helper: ${fallbackError.message}`);
      process.exit(1);
    });
    return;
  }

  console.error(`Failed to start mineru-open-mcp: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});

async function startSetupHelpMcp() {
  console.error([
    "PPT Composer could not start mineru-open-mcp because uvx was not found.",
    "Starting a setup-help MCP server so Codex can still discover the plugin tools.",
    "",
    "Install uv/uvx, then run this once from the plugin root:",
    "  npm run prewarm:mineru",
    "",
    "If MinerU parsing is not needed, you can keep using ppt-render-mcp for PPT assembly and QA."
  ].join("\n"));

  ensureFallbackDeps();

  const [{ McpServer }, { StdioServerTransport }, z] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("zod/v4")
  ]);

  const setup = setupPayload();
  const server = new McpServer({
    name: "mineru-open-mcp-setup-required",
    version: "0.1.0",
  });

  server.registerTool(
    "get_ocr_languages",
    {
      title: "Get OCR Languages",
      description: "Return OCR language setup guidance when uvx is unavailable.",
      inputSchema: {},
    },
    async () => jsonToolResult({
      ...setup,
      languages: ["ch", "en", "japan", "korean", "latin", "arabic", "cyrillic", "devanagari"],
    }),
  );

  server.registerTool(
    "parse_documents",
    {
      title: "Parse Documents",
      description: "Explain how to enable MinerU document parsing when uvx is unavailable.",
      inputSchema: {
        file_sources: z.array(z.union([
          z.string(),
          z.object({
            source: z.string(),
            pages: z.string().optional(),
          }),
        ])).min(1).describe("Files or URLs to parse after MinerU is enabled."),
        language: z.string().optional().describe("OCR language code."),
        enable_ocr: z.boolean().nullable().optional().describe("OCR mode."),
        model: z.string().nullable().optional().describe("Parsing model."),
        output_dir: z.string().nullable().optional().describe("Output directory."),
      },
    },
    async () => ({
      ...jsonToolResult(setup),
      isError: true,
    }),
  );

  await server.connect(new StdioServerTransport());
}

function ensureFallbackDeps() {
  const missingDeps = fallbackDeps.filter((dep) => !existsSync(join(pluginRoot, dep)));
  if (missingDeps.length === 0) return;

  console.error([
    "PPT Composer setup-help MCP dependencies are missing; installing Node runtime dependencies once.",
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
    throw new Error("npm was not found. Install Node.js/npm, then restart Codex or run `npm run prewarm` manually.");
  }

  if (install.status !== 0) {
    throw new Error(`npm install failed with exit code ${install.status ?? 1}`);
  }
}

function setupPayload() {
  return {
    setup_required: true,
    missing_dependency: "uvx",
    message: [
      "MinerU document parsing is not available because uvx is not installed or not on PATH.",
      "Install uv/uvx, run `npm run prewarm:mineru` from the PPT Composer plugin root, then restart Codex.",
      "PPT assembly, image manifest validation, and QA remain available through ppt-render-mcp."
    ].join(" "),
    plugin_root: pluginRoot,
    commands: [
      "npm run prewarm",
      "npm run prewarm:mineru"
    ],
  };
}

function jsonToolResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}
