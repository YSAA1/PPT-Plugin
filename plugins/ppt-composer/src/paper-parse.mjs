import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { exists } from "./lib.mjs";

export async function parsePaper({ inputPath, outDir, lang = "en", mode = "auto", mineruWrapper, dryRun = false }) {
  if (!(await exists(inputPath))) {
    throw new Error(`Input not found: ${inputPath}`);
  }
  await mkdir(outDir, { recursive: true });
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    const markdownPath = path.join(outDir, `${path.basename(inputPath, ext)}.md`);
    await copyFile(inputPath, markdownPath);
    const bundle = {
      input: inputPath,
      parser: "markdown-copy",
      markdown: markdownPath,
      figures: [],
      tables: [],
      formulas: [],
      warnings: [],
    };
    const bundlePath = path.join(outDir, "parse-bundle.json");
    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
    return { bundle: bundlePath, ...bundle };
  }

  if (!mineruWrapper) {
    throw new Error([
      "PDF/Office/image parsing should use mineru-open-mcp.parse_documents first, then pass the saved Markdown/images into reference_intake.",
      "For CLI-only local parsing, pass --mineru-wrapper explicitly."
    ].join(" "));
  }

  const wrapper = mineruWrapper;
  if (!(await exists(wrapper))) {
    throw new Error(`MinerU wrapper not found: ${wrapper}`);
  }

  const args = [dryRun ? "--dry-run" : null, inputPath, outDir, "--", "-b", "pipeline", "-m", mode, "-l", lang].filter(Boolean);
  await run(wrapper, args);

  if (dryRun) {
    return { input: inputPath, parser: "mineru", dryRun: true, wrapper, outDir };
  }

  const discovered = await discoverMineruOutputs(outDir);
  const bundle = {
    input: inputPath,
    parser: "mineru",
    wrapper,
    markdown: discovered.markdown,
    figures: discovered.images,
    tables: discovered.contentLists,
    formulas: [],
    warnings: discovered.markdown ? [] : ["MinerU completed but no Markdown file was discovered."],
  };
  const bundlePath = path.join(outDir, "parse-bundle.json");
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return { bundle: bundlePath, ...bundle };
}

async function discoverMineruOutputs(root) {
  const files = await walk(root);
  return {
    markdown: files.find((file) => file.endsWith(".md")) || null,
    images: files.filter((file) => /\.(png|jpe?g|webp)$/i.test(file)),
    contentLists: files.filter((file) => /content_list\.json$/i.test(file)),
    middleJson: files.filter((file) => /middle\.json$/i.test(file)),
  };
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    if (entry.isFile()) files.push(full);
  }
  return files;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
