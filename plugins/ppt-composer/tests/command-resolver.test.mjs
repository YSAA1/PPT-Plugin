import test from "node:test";
import assert from "node:assert/strict";

import { resolveCommand } from "../scripts/command-resolver.mjs";

test("resolveCommand treats bare override command as PATH-resolved", () => {
  const resolved = resolveCommand("uvx", {
    env: { PPT_COMPOSER_UVX: "uvx" },
    overrideEnv: "PPT_COMPOSER_UVX",
  });

  assert.equal(resolved.command, "uvx");
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.source, "PPT_COMPOSER_UVX");
});

test("resolveCommand validates override paths with separators", () => {
  const resolved = resolveCommand("uvx", {
    env: { PPT_COMPOSER_UVX: "./definitely-missing-uvx" },
    overrideEnv: "PPT_COMPOSER_UVX",
  });

  assert.equal(resolved.command, "./definitely-missing-uvx");
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.source, "PPT_COMPOSER_UVX");
});
