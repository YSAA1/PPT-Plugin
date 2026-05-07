import path from "node:path";
import { buildTemplateContract, validateDeckProtocol } from "./deck-protocol.mjs";

export function createProtocolReview(protocol, { protocolPath = null } = {}) {
  const validation = validateDeckProtocol(protocol, {
    baseDir: protocolPath ? path.dirname(protocolPath) : process.cwd(),
  });
  const sourceInputs = protocol?.source?.inputs || [];
  const assets = protocol?.assets || [];
  const pages = protocol?.pages || [];
  const templateContract = buildTemplateContract(protocol?.style || {});
  const assetRows = assets.length
    ? assets.map((asset) => [
      asset.id || "",
      asset.type || "",
      asset.usage || "",
      asset.caption || asset.summary || asset.source || "",
      asset.path || asset.source || "",
    ])
    : [["-", "-", "-", "No localized assets in protocol.", "-"]];
  const pageRows = pages.length
    ? pages.map((page) => [
      page.page,
      page.title || "",
      page.fidelity || "",
      evidenceSummary(page),
      page.output_png || "",
    ])
    : [["-", "-", "-", "No pages.", "-"]];

  return [
    `# ${protocol?.deck?.title || "Deck Protocol"} Review`,
    "",
    "## Validation",
    "",
    `- Protocol: ${protocolPath || protocol?.source?.protocolPath || "deck-protocol.json"}`,
    `- Status: ${validation.ok ? "OK" : "BLOCKED"}`,
    `- Pages: ${validation.pages}`,
    `- Assets: ${validation.assets}`,
    validation.errors.length ? `- Errors: ${validation.errors.join("; ")}` : "- Errors: none",
    "",
    "## Intake",
    "",
    `- Mode: ${protocol?.mode || ""}`,
    `- Source inputs: ${sourceInputs.length ? sourceInputs.join(", ") : "none"}`,
    `- Warnings: ${(protocol?.source?.warnings || []).length ? protocol.source.warnings.join("; ") : "none"}`,
    "",
    "## Template Invariants",
    "",
    `- Logo policy: ${templateContract.logo_policy}`,
    `- Logo assets: ${templateContract.logo_ids.length ? templateContract.logo_ids.join(", ") : "none"}`,
    `- Page-number policy: ${templateContract.page_number_policy}`,
    `- Footer policy: ${templateContract.footer_policy}`,
    `- Repeated elements: ${templateContract.template_element_policy}`,
    `- Exemptions: ${templateContract.template_exemptions.length ? templateContract.template_exemptions.join("; ") : "none"}`,
    "",
    "## Assets",
    "",
    markdownTable(["id", "type", "usage", "caption/summary", "path/source"], assetRows),
    "",
    "## Pages",
    "",
    markdownTable(["page", "title", "fidelity", "evidence bindings", "output_png"], pageRows),
    "",
    "## Confirmation checklist",
    "",
    "- Check page count, language, audience, aspect ratio, and visual style.",
    "- Check logo, page-number, footer, and recurring template-element policy; these are deck-wide invariants, not per-page suggestions.",
    "- Check every required logo, image, table, number, citation, and exclusion appears as an asset or explicit page instruction.",
    "- Check reference-grounded pages bind assets through `content_inputs` or `reference_asset_ids`.",
    "- Confirm only when this review artifact matches the intended deck.",
    "",
  ].join("\n");
}

function evidenceSummary(page = {}) {
  const text = page.content_inputs?.text || [];
  const tables = page.content_inputs?.tables || [];
  const images = page.content_inputs?.images || [];
  const refs = page.reference_asset_ids || [];
  const parts = [];
  if (text.length) parts.push(`text=${text.join(",")}`);
  if (tables.length) parts.push(`tables=${tables.join(",")}`);
  if (images.length) parts.push(`images=${images.join(",")}`);
  if (refs.length) parts.push(`refs=${refs.join(",")}`);
  if (page.free_generation === true && !parts.length) return "free_generation=true";
  return parts.join("; ") || "none";
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function escapeCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}
