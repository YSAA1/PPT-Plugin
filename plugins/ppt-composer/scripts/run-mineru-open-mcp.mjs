#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const child = spawn(
  "uvx",
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
    env: {
      ...process.env,
      FASTMCP_CHECK_FOR_UPDATES: "off",
      FASTMCP_SHOW_SERVER_BANNER: "false"
    }
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});
