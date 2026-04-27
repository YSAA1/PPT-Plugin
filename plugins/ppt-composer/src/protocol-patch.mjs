import path from "node:path";
import { validateDeckProtocolAsync } from "./deck-protocol.mjs";
import { readJson, writeJson } from "./lib.mjs";

const FIDELITY_VALUES = new Set(["free", "light_redraw", "strict_embed"]);

export async function patchProtocolFile({ protocolPath, op, payload = {}, auditNote = "" } = {}) {
  if (!protocolPath) throw new Error("patchProtocolFile requires protocolPath");
  const protocol = await readJson(protocolPath);
  const updated = patchProtocol(protocol, { op, payload, auditNote });
  const report = await validateDeckProtocolAsync(updated, { baseDir: path.dirname(protocolPath) });
  if (!report.ok) {
    throw new Error(`Patched deck protocol is invalid:\n${report.errors.join("\n")}`);
  }
  await writeJson(protocolPath, updated);
  return { protocol: protocolPath, operation: op, validation: report };
}

export function patchProtocol(protocol, { op, payload = {}, auditNote = "" } = {}) {
  const next = structuredClone(protocol);
  if (op === "add-asset") addAsset(next, payload);
  else if (op === "bind-asset") bindAsset(next, payload);
  else if (op === "update-page") updatePage(next, payload);
  else if (op === "set-fidelity") setFidelity(next, payload);
  else throw new Error(`Unsupported protocol patch operation: ${op}`);
  appendAudit(next, op, payload, auditNote);
  return next;
}

function addAsset(protocol, { asset } = {}) {
  if (!asset || typeof asset !== "object") throw new Error("protocol-add-asset requires an asset object");
  if (!asset.id) throw new Error("asset.id is required");
  protocol.assets = protocol.assets || [];
  if (protocol.assets.some((item) => item.id === asset.id)) {
    throw new Error(`Duplicate asset id: ${asset.id}`);
  }
  protocol.assets.push(asset);
}

function bindAsset(protocol, { page, assetId, inputType = null } = {}) {
  const target = findPage(protocol, page);
  requireAsset(protocol, assetId);
  target.reference_asset_ids = unique([...(target.reference_asset_ids || []), assetId]);
  target.content_inputs = normalizeContentInputs(target.content_inputs);
  const inferred = inputType || inferInputType(protocol, assetId);
  if (inferred) {
    target.content_inputs[inferred] = unique([...(target.content_inputs[inferred] || []), assetId]);
  }
}

function updatePage(protocol, { page, patch } = {}) {
  const target = findPage(protocol, page);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("protocol-update-page requires a patch object");
  }
  if (patch.page !== undefined && Number(patch.page) !== Number(target.page)) {
    throw new Error("protocol-update-page cannot change page number");
  }
  Object.assign(target, patch);
  if (target.content_inputs) target.content_inputs = normalizeContentInputs(target.content_inputs);
}

function setFidelity(protocol, { page, fidelity } = {}) {
  if (!FIDELITY_VALUES.has(fidelity)) {
    throw new Error(`Invalid fidelity: ${fidelity}. Expected free, light_redraw, or strict_embed`);
  }
  const target = findPage(protocol, page);
  target.fidelity = fidelity;
}

function findPage(protocol, page) {
  const number = Number(page);
  const target = (protocol.pages || []).find((item) => Number(item.page) === number);
  if (!target) throw new Error(`Unknown page: ${page}`);
  return target;
}

function requireAsset(protocol, assetId) {
  if (!assetId) throw new Error("assetId is required");
  const asset = (protocol.assets || []).find((item) => item.id === assetId);
  if (!asset) throw new Error(`Unknown asset id: ${assetId}`);
  return asset;
}

function inferInputType(protocol, assetId) {
  const asset = requireAsset(protocol, assetId);
  if (asset.type === "text_evidence") return "text";
  if (asset.type === "source_table") return "tables";
  if (/image|logo/.test(asset.type || "")) return "images";
  return null;
}

function normalizeContentInputs(inputs = {}) {
  return {
    text: Array.isArray(inputs.text) ? inputs.text : [],
    tables: Array.isArray(inputs.tables) ? inputs.tables : [],
    images: Array.isArray(inputs.images) ? inputs.images : [],
  };
}

function appendAudit(protocol, op, payload, note) {
  const entry = {
    at: new Date().toISOString(),
    op,
    note,
    page: payload.page ?? null,
    assetId: payload.assetId || payload.asset?.id || null,
  };
  protocol.audit_log = Array.isArray(protocol.audit_log) ? [...protocol.audit_log, entry] : [entry];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
