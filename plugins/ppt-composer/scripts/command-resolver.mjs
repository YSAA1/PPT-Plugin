import { existsSync } from "node:fs";
import path from "node:path";

export function resolveNpmCommand({
  env = process.env,
  overrideEnv = "PPT_COMPOSER_NPM",
  nodeExecPath = process.execPath,
} = {}) {
  const override = overrideEnv ? env[overrideEnv] : "";
  if (override) {
    return {
      command: override,
      args: [],
      resolved: hasPathSeparator(override) ? existsSync(override) : true,
      source: overrideEnv,
    };
  }

  for (const candidate of npmCliCandidates({ env, nodeExecPath })) {
    if (existsSync(candidate)) {
      return {
        command: nodeExecPath,
        args: [candidate],
        resolved: true,
        source: "npm-cli",
      };
    }
  }

  return {
    ...resolveCommand("npm", { env }),
    args: [],
  };
}

export function resolveCommand(command, { env = process.env, overrideEnv } = {}) {
  const override = overrideEnv ? env[overrideEnv] : "";
  if (override) {
    return {
      command: override,
      resolved: hasPathSeparator(override) ? existsSync(override) : true,
      source: overrideEnv,
    };
  }

  if (hasPathSeparator(command)) {
    return {
      command,
      resolved: existsSync(command),
      source: "literal",
    };
  }

  for (const dir of pathEntries(env)) {
    for (const name of executableNames(command, env)) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        return {
          command: candidate,
          resolved: true,
          source: "PATH",
        };
      }
    }
  }

  return {
    command,
    resolved: false,
    source: "unresolved",
  };
}

export function isCommandLaunchError(error) {
  return ["ENOENT", "EINVAL"].includes(error?.code);
}

function executableNames(command, env) {
  if (process.platform !== "win32") return [command];
  if (path.win32.extname(command)) return [command];

  const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);

  return [
    command,
    ...extensions.map((ext) => `${command}${ext.toLowerCase()}`),
    ...extensions.map((ext) => `${command}${ext.toUpperCase()}`),
  ];
}

function pathEntries(env) {
  const rawPath = env.PATH || env.Path || env.path || "";
  return rawPath
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function hasPathSeparator(command) {
  return command.includes("/") || command.includes("\\");
}

function npmCliCandidates({ env, nodeExecPath }) {
  const candidates = [];
  if (env.npm_execpath) candidates.push(env.npm_execpath);

  const nodeRoot = path.dirname(nodeExecPath);
  candidates.push(path.join(nodeRoot, "node_modules", "npm", "bin", "npm-cli.js"));

  return candidates;
}
