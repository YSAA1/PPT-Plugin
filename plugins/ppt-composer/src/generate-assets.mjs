import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { ensureParent, resolvePath, slugify, writeJson } from "./lib.mjs";

export async function generateAssets(plan, { planPath, outDir, provider = "codex", model, apiKey } = {}) {
  const resolvedOutDir = outDir
    ? resolvePath(outDir)
    : resolvePath(plan.defaults?.outputDir || "generated-assets", planPath ? path.dirname(planPath) : process.cwd());
  await mkdir(resolvedOutDir, { recursive: true });

  const manifest = {
    version: "0.1",
    kind: "ppt-asset-manifest",
    provider,
    model: model || plan.defaults?.model || "gpt-image-2",
    generatedAt: new Date().toISOString(),
    sourcePlan: planPath || null,
    outDir: resolvedOutDir,
    items: [],
  };

  for (const request of plan.requests || []) {
    if (provider === "placeholder") {
      manifest.items.push(await writePlaceholder(request, resolvedOutDir));
      continue;
    }
    if (provider === "codex") {
      manifest.items.push(await writeCodexPrompt(request, resolvedOutDir));
      continue;
    }
    if (provider === "openai") {
      manifest.items.push(await generateViaOpenAI(request, resolvedOutDir, {
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        model: model || plan.defaults?.model || "gpt-image-2",
      }));
      continue;
    }
    throw new Error(`Unsupported asset provider: ${provider}`);
  }

  if (provider === "codex") {
    manifest.promptSheet = await writeCodexPromptSheet(plan.requests || [], resolvedOutDir);
  }
  manifest.summary = summarizeManifest(manifest.items);
  manifest.readyForImageDeck = manifest.items.length > 0
    && manifest.items.every((item) => item.status === "generated" && item.path);
  manifest.completionStatus = manifest.readyForImageDeck ? "ready_for_image_deck" : "requires_image_generation";
  manifest.nextAction = manifest.readyForImageDeck
    ? "Run generate-image-deck, render, and QA."
    : "Run the $imagegen prompts, save generated PNGs, then backfill asset-manifest.json with status=generated and path before final assembly.";
  return manifest;
}

async function writePlaceholder(request, outDir) {
  const filePath = path.join(outDir, replaceExt(request.output || `${request.assetId}.png`, ".svg"));
  const title = escapeXml(request.slideTitle || request.assetId);
  const prompt = escapeXml(request.prompt || "Placeholder asset");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864" viewBox="0 0 1536 864" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#EFF6FF"/>
      <stop offset="100%" stop-color="#E2E8F0"/>
    </linearGradient>
  </defs>
  <rect width="1536" height="864" fill="url(#bg)" rx="36"/>
  <rect x="88" y="88" width="1360" height="688" rx="28" fill="#FFFFFF" stroke="#93C5FD" stroke-width="8"/>
  <circle cx="280" cy="260" r="84" fill="#DBEAFE" stroke="#2563EB" stroke-width="8"/>
  <rect x="420" y="178" width="820" height="40" rx="20" fill="#BFDBFE"/>
  <rect x="420" y="248" width="660" height="28" rx="14" fill="#DBEAFE"/>
  <rect x="160" y="420" width="1216" height="220" rx="28" fill="#F8FAFC" stroke="#CBD5E1" stroke-dasharray="16 12" stroke-width="6"/>
  <text x="160" y="132" font-family="Aptos, Arial, sans-serif" font-size="28" fill="#1D4ED8">PPT Composer Placeholder Asset</text>
  <text x="160" y="356" font-family="Aptos Display, Arial, sans-serif" font-size="54" font-weight="700" fill="#0F172A">${title}</text>
  <foreignObject x="160" y="450" width="1180" height="160">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Aptos,Arial,sans-serif;font-size:28px;line-height:1.45;color:#334155;white-space:normal;word-break:break-word;">
      ${prompt}
    </div>
  </foreignObject>
</svg>`;
  await ensureParent(filePath);
  await writeFile(filePath, svg, "utf8");
  return {
    requestId: request.id,
    assetId: request.assetId,
    slideId: request.slideId,
    status: "generated",
    provider: "placeholder",
    path: filePath,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    format: "svg",
  };
}

async function writeCodexPrompt(request, outDir) {
  const promptPath = path.join(outDir, `${slugify(request.assetId)}.prompt.md`);
  const body = [
    `# Codex $imagegen generation for ${request.assetId}`,
    "",
    "Use Codex built-in image generation for the final PNG. Do not satisfy this request with SVG, HTML, canvas, Python/PPT rendering, screenshots, or local compositing.",
    "",
    request.protocolPage ? "Protocol page slice:" : null,
    request.protocolPage ? "```json" : null,
    request.protocolPage ? JSON.stringify(request.protocolPage, null, 2) : null,
    request.protocolPage ? "```" : null,
    request.referenceAssets?.length ? "" : null,
    request.referenceAssets?.length ? "Reference assets to inspect before generation:" : null,
    ...(request.referenceAssets || []).map((asset) => `- ${asset.id} (${asset.type}): ${asset.path || asset.caption || ""}`),
    request.templateAssets?.length ? "" : null,
    request.templateAssets?.length ? "Global template assets to inspect before generation:" : null,
    ...(request.templateAssets || []).map((asset) => `- ${asset.id} (${asset.type}): ${asset.path || asset.caption || ""}`),
    request.protocolPage ? "" : null,
    request.codexPrompt,
    "",
    "Expected output filename:",
    request.output || `${request.assetId}.png`,
    "",
    "Notes:",
    ...(request.notes || []).map((note) => `- ${note}`),
  ].filter((line) => line !== null).join("\n");
  await ensureParent(promptPath);
  await writeFile(promptPath, `${body}\n`, "utf8");
  return {
    requestId: request.id,
    assetId: request.assetId,
    slideId: request.slideId,
    status: "manual_required",
    provider: "codex",
    readyForImageDeck: false,
    blocking: true,
    completionStatus: "requires_image_generation",
    nextAction: "Run this with Codex $imagegen, save the generated PNG, then set status=generated and path in asset-manifest.json.",
    promptPath,
    expectedOutput: path.join(outDir, request.output || `${request.assetId}.png`),
    prompt: request.prompt,
    codexPrompt: request.codexPrompt,
    protocolPage: request.protocolPage || undefined,
    referenceAssets: request.referenceAssets || undefined,
    templateAssets: request.templateAssets || undefined,
    fidelity: request.fidelity || undefined,
    size: request.size,
    quality: request.quality,
  };
}

async function writeCodexPromptSheet(requests, outDir) {
  const promptSheetPath = path.join(outDir, "imagegen-prompts.md");
  const sections = [
    "# Codex imagegen prompt sheet",
    "",
    "This is a blocking intermediate artifact, not a completed image-first deck.",
    "",
    "Use each prompt with Codex `$imagegen`, save the generated PNG at the expected output path, then update `asset-manifest.json` item status from `manual_required` to `generated` and set `path`.",
    "",
    "Do not replace `$imagegen` with SVG, HTML, canvas, Python/PPT rendering, screenshots, or local compositing.",
    "",
    "Do not run `generate-image-deck` or report completion until every requested slide has a generated bitmap path.",
  ];
  for (const request of requests) {
    sections.push(...[
      "",
      `## ${request.assetId}`,
      "",
      `Slide: ${request.slideTitle || request.slideId}`,
      `Expected output: ${request.output || `${request.assetId}.png`}`,
      request.fidelity ? `Fidelity: ${request.fidelity}` : null,
      request.protocolPage ? "" : null,
      request.protocolPage ? "Protocol page slice:" : null,
      request.protocolPage ? "```json" : null,
      request.protocolPage ? JSON.stringify(request.protocolPage, null, 2) : null,
      request.protocolPage ? "```" : null,
      request.templateAssets?.length ? "" : null,
      request.templateAssets?.length ? "Global template assets to inspect before generation:" : null,
      ...(request.templateAssets || []).map((asset) => `- ${asset.id} (${asset.type}): ${asset.path || asset.caption || ""}`),
      "",
      "```text",
      request.codexPrompt || `$imagegen ${request.prompt}`,
      "```",
    ].filter((line) => line !== null));
  }
  await ensureParent(promptSheetPath);
  await writeFile(promptSheetPath, `${sections.join("\n")}\n`, "utf8");
  return promptSheetPath;
}

async function generateViaOpenAI(request, outDir, { apiKey, model }) {
  if (!apiKey) {
    return {
      requestId: request.id,
      assetId: request.assetId,
      slideId: request.slideId,
      status: "failed",
      provider: "openai",
      error: "OPENAI_API_KEY is not set",
    };
  }

  const filePath = path.join(outDir, replaceExt(request.output || `${request.assetId}.png`, ".png"));
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: request.prompt,
      size: request.size || "1536x864",
      quality: request.quality || "low",
      background: request.background || "opaque",
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    return {
      requestId: request.id,
      assetId: request.assetId,
      slideId: request.slideId,
      status: "failed",
      provider: "openai",
      error: payload?.error?.message || `Image API request failed with status ${response.status}`,
    };
  }

  const b64 = payload?.data?.[0]?.b64_json;
  if (!b64) {
    return {
      requestId: request.id,
      assetId: request.assetId,
      slideId: request.slideId,
      status: "failed",
      provider: "openai",
      error: "Image API response did not include b64_json",
    };
  }

  await ensureParent(filePath);
  await writeFile(filePath, Buffer.from(b64, "base64"));
  return {
    requestId: request.id,
    assetId: request.assetId,
    slideId: request.slideId,
    status: "generated",
    provider: "openai",
    path: filePath,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    format: "png",
    usage: payload?.usage || null,
  };
}

export async function writeAssetManifest(filePath, manifest) {
  await writeJson(filePath, manifest);
}

function summarizeManifest(items) {
  const summary = { total: items.length, generated: 0, manualRequired: 0, failed: 0 };
  for (const item of items) {
    if (item.status === "generated") summary.generated += 1;
    else if (item.status === "manual_required") summary.manualRequired += 1;
    else if (item.status === "failed") summary.failed += 1;
  }
  return summary;
}

function replaceExt(fileName, extension) {
  const ext = path.extname(fileName);
  return `${ext ? fileName.slice(0, -ext.length) : fileName}${extension}`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
