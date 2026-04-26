#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const requiredDeps = [
  "node_modules/@modelcontextprotocol/sdk",
  "node_modules/pptxgenjs"
];

if (!requiredDeps.every((dep) => existsSync(join(pluginRoot, dep)))) {
  const install = spawnSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--omit=dev"],
    {
      cwd: pluginRoot,
      stdio: "inherit"
    }
  );

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

const child = spawn(process.execPath, ["./src/ppt-render-mcp.mjs"], {
  cwd: pluginRoot,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 0);
});
