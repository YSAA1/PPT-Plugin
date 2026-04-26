import path from "node:path";
import pptxgen from "pptxgenjs";
import { ensureParent, cleanHex, toNumber, arrayify, exists, resolvePath } from "./lib.mjs";
import { resolveTemplate } from "./templates.mjs";

const SIZE = {
  "16:9": { layout: "LAYOUT_WIDE", w: 13.333, h: 7.5 },
  "4:3": { layout: "LAYOUT_4X3", w: 10, h: 7.5 },
};

const DEFAULT_POS = { x: 0.7, y: 1.25, w: 11.9, h: 4.9 };

export async function renderPptx(spec, { specPath, outPath }) {
  validateSpec(spec);
  const pptx = new pptxgen();
  const deckFormat = spec.deck?.format || "16:9";
  const size = SIZE[deckFormat] || SIZE["16:9"];
  pptx.layout = size.layout;
  pptx.author = spec.deck?.author || "ppt-composer";
  pptx.subject = spec.deck?.audience || "";
  pptx.title = spec.deck?.title || "Presentation";
  pptx.company = "ppt-composer";
  pptx.lang = spec.deck?.language || "en-US";
  pptx.theme = {
    headFontFace: spec.theme?.fonts?.heading || "Aptos Display",
    bodyFontFace: spec.theme?.fonts?.body || "Aptos",
    lang: spec.deck?.language || "en-US",
  };

  const context = {
    specDir: specPath ? path.dirname(specPath) : process.cwd(),
    assets: new Map((spec.assets || []).map((asset) => [asset.id, asset])),
    theme: buildTheme(spec),
    size,
    pptx,
    rasterized: [],
    missingAssets: [],
    slideCount: spec.slides.length,
  };

  for (const [index, slideSpec] of spec.slides.entries()) {
    await renderSlide(pptx, slideSpec, context, index);
  }

  await ensureParent(outPath);
  await pptx.writeFile({ fileName: outPath, compression: true });

  return {
    pptx: outPath,
    slides: spec.slides.length,
    editability: spec.deck?.editability || "native-first",
    rasterizedObjects: context.rasterized,
    missingAssets: context.missingAssets,
  };
}

function validateSpec(spec) {
  if (!spec || typeof spec !== "object") throw new Error("Slide spec must be a JSON object");
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) {
    throw new Error("Slide spec requires a non-empty slides array");
  }
}

function buildTheme(spec) {
  const templatePreset = resolveTemplate(spec);
  const palette = spec.theme?.palette || templatePreset.palette || ["#111827", "#2563EB", "#F8FAFC", "#E5E7EB"];
  const fonts = { ...templatePreset.fonts, ...spec.theme?.fonts };
  const template = spec.theme?.templateId || spec.theme?.template || templatePreset.id;
  return {
    template,
    templateId: template,
    text: cleanHex(palette[0], "111827"),
    accent: cleanHex(palette[1], "2563EB"),
    background: cleanHex(palette[2], "F8FAFC"),
    muted: cleanHex(palette[3], "E5E7EB"),
    soft: cleanHex(palette[4], palette[3] || "DBEAFE"),
    headingFont: fonts.heading || "Aptos Display",
    bodyFont: fonts.body || "Aptos",
  };
}

async function renderSlide(pptx, slideSpec, context, slideIndex) {
  const slide = pptx.addSlide();
  slide.background = { color: cleanHex(slideSpec.background || context.theme.background, context.theme.background) };

  if (slideSpec.layout === "full-slide-image") {
    for (const object of slideSpec.objects || []) {
      if (object.type === "image") await renderImage(slide, object, context);
    }
    if (slideSpec.notes && typeof slide.addNotes === "function") {
      slide.addNotes(String(slideSpec.notes));
    }
    return;
  }

  applyTemplateChrome(slide, slideSpec, context, slideIndex);

  if (slideSpec.title) {
    slide.addText(slideSpec.title, {
      x: 0.55,
      y: 0.32,
      w: context.size.w - 1.1,
      h: 0.52,
      fontFace: context.theme.headingFont,
      fontSize: 24,
      bold: true,
      color: titleColor(context),
      margin: 0.02,
      breakLine: false,
      fit: "shrink",
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 0.55,
      y: 0.95,
      w: context.size.w - 1.1,
      h: 0,
      line: { color: context.theme.accent, width: 1.2, transparency: 18 },
    });
  }

  for (const object of slideSpec.objects || []) {
    await renderObject(slide, object, context);
  }

  if (slideSpec.notes && typeof slide.addNotes === "function") {
    slide.addNotes(String(slideSpec.notes));
  }
}

function applyTemplateChrome(slide, slideSpec, context, slideIndex) {
  if (context.theme.template !== "consulting-research") return;

  slide.addShape(context.pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: context.size.w,
    h: 0.16,
    line: { color: context.theme.accent, transparency: 100 },
    fill: { color: context.theme.accent },
  });

  slide.addShape(context.pptx.ShapeType.rect, {
    x: 0,
    y: context.size.h - 0.22,
    w: context.size.w,
    h: 0.22,
    line: { color: context.theme.muted, transparency: 100 },
    fill: { color: context.theme.soft, transparency: 16 },
  });

  slide.addText(`${String(slideIndex + 1).padStart(2, "0")} / ${String(context.slideCount).padStart(2, "0")}`, {
    x: context.size.w - 1.15,
    y: context.size.h - 0.18,
    w: 0.8,
    h: 0.12,
    fontFace: context.theme.bodyFont,
    fontSize: 8,
    color: context.theme.text,
    align: "right",
    margin: 0,
  });

  if (slideSpec.layout === "consulting-hero") {
    slide.addShape(context.pptx.ShapeType.roundRect, {
      x: 8.2,
      y: 1.18,
      w: 4.45,
      h: 4.95,
      rectRadius: 0.08,
      fill: { color: context.theme.soft, transparency: 8 },
      line: { color: context.theme.accent, transparency: 72, width: 1 },
    });
  }
}

function titleColor(context) {
  return context.theme.template === "infographic-immersive" ? "F8FAFC" : context.theme.text;
}

async function renderObject(slide, object, context) {
  const type = object.type || "text";
  if (type === "text") return renderText(slide, object, context);
  if (type === "table") return renderTable(slide, object, context);
  if (type === "chart") return renderChart(slide, object, context);
  if (type === "shape") return renderShape(slide, object, context);
  if (type === "image") return renderImage(slide, object, context);
  if (type === "formula") return renderFormula(slide, object, context);
  if (type === "component") return renderComponent(slide, object, context);
  return renderText(slide, { ...object, text: `[Unsupported object: ${type}]` }, context);
}

function objectPos(object, fallback = DEFAULT_POS) {
  const pos = object.position || object.pos || object;
  return {
    x: toNumber(pos.x, fallback.x),
    y: toNumber(pos.y, fallback.y),
    w: toNumber(pos.w, fallback.w),
    h: toNumber(pos.h, fallback.h),
  };
}

function renderText(slide, object, context) {
  const pos = objectPos(object);
  const text = object.text ?? (Array.isArray(object.bullets) ? object.bullets.map((b) => `• ${b}`).join("\n") : "");
  slide.addText(String(text), {
    ...pos,
    fontFace: object.fontFace || context.theme.bodyFont,
    fontSize: toNumber(object.fontSize, object.role === "headline" ? 28 : 16),
    bold: Boolean(object.bold || object.role === "headline"),
    italic: Boolean(object.italic),
    color: cleanHex(object.color, context.theme.template === "infographic-immersive" ? "F8FAFC" : context.theme.text),
    valign: object.valign || "mid",
    align: object.align || "left",
    margin: toNumber(object.margin, 0.08),
    fit: object.fit || "shrink",
    breakLine: false,
    fill: object.fill ? { color: cleanHex(object.fill) } : undefined,
    line: object.line ? normalizeLine(object.line, context) : undefined,
    shape: object.shape ? shapeType(context.pptx, object.shape) : undefined,
  });
}

function renderTable(slide, object, context) {
  const pos = objectPos(object);
  const rows = normalizeTableRows(object);
  slide.addTable(rows, {
    ...pos,
    border: { type: "solid", color: cleanHex(object.borderColor, "CBD5E1"), pt: 0.75 },
    color: cleanHex(object.color, context.theme.text),
    fontFace: object.fontFace || context.theme.bodyFont,
    fontSize: toNumber(object.fontSize, 10),
    margin: toNumber(object.margin, 0.05),
    fill: object.fill ? { color: cleanHex(object.fill) } : undefined,
    valign: "mid",
  });
}

function normalizeTableRows(object) {
  const rows = object.rows || object.data || [];
  return rows.map((row, rowIndex) =>
    row.map((cell) => {
      if (cell && typeof cell === "object" && !Array.isArray(cell)) return cell;
      const text = String(cell ?? "");
      if (rowIndex === 0 && object.header !== false) {
        return { text, options: { bold: true, fill: { color: "E0F2FE" } } };
      }
      return text;
    }),
  );
}

function renderChart(slide, object, context) {
  const pos = objectPos(object);
  const chartType = context.pptx.ChartType[object.chartType || object.kind || "bar"] || context.pptx.ChartType.bar;
  const data = object.data || normalizeSeriesChart(object);
  slide.addChart(chartType, data, {
    ...pos,
    showLegend: object.showLegend ?? true,
    legendPos: object.legendPos || "b",
    showTitle: Boolean(object.title),
    title: object.title,
    chartColors: object.colors?.map((c) => cleanHex(c)) || [context.theme.accent, "10B981", "F59E0B", "EF4444"],
    catAxisLabelFontFace: context.theme.bodyFont,
    valAxisLabelFontFace: context.theme.bodyFont,
    showValue: object.showValue ?? false,
  });
}

function normalizeSeriesChart(object) {
  const labels = object.labels || [];
  return arrayify(object.series).map((series, index) => ({
    name: series.name || `Series ${index + 1}`,
    labels,
    values: series.values || [],
  }));
}

function renderShape(slide, object, context) {
  const pos = objectPos(object);
  slide.addShape(shapeType(context.pptx, object.shape || object.kind || "rect"), {
    ...pos,
    fill: object.fill ? { color: cleanHex(object.fill), transparency: toNumber(object.fillTransparency, 0) } : undefined,
    line: normalizeLine(object.line || { color: object.color || context.theme.accent, width: object.width || 1 }, context),
    rotate: toNumber(object.rotate, 0),
  });
}

async function renderImage(slide, object, context) {
  const pos = objectPos(object);
  const imagePath = await resolveImagePath(object, context);
  if (!imagePath) return;
  slide.addImage({
    path: imagePath,
    ...pos,
    transparency: toNumber(object.transparency, 0),
    rounding: Boolean(object.rounding),
  });
}

async function renderFormula(slide, object, context) {
  if (object.path || object.assetId) {
    context.rasterized.push({ type: "formula", id: object.id, reason: "formula rendered as image" });
    return renderImage(slide, { ...object, type: "image" }, context);
  }
  return renderText(slide, {
    ...object,
    text: object.latex || object.text || "",
    fontFace: object.fontFace || "Cambria Math",
    fontSize: object.fontSize || 18,
  }, context);
}

async function renderComponent(slide, object, context) {
  const kind = object.kind || "stat-card";
  if (kind === "label-chip") return renderLabelChip(slide, object, context);
  if (kind === "stat-card") return renderStatCard(slide, object, context);
  if (kind === "quote-panel") return renderQuotePanel(slide, object, context);
  if (kind === "timeline") return renderTimeline(slide, object, context);
  return renderText(slide, { ...object, text: `[Unsupported component: ${kind}]` }, context);
}

function renderLabelChip(slide, object, context) {
  const pos = objectPos(object, { x: 0.8, y: 0.4, w: 1.6, h: 0.3 });
  slide.addShape(context.pptx.ShapeType.roundRect, {
    ...pos,
    rectRadius: 0.08,
    fill: { color: cleanHex(object.fill, context.theme.soft), transparency: toNumber(object.fillTransparency, 0) },
    line: { color: cleanHex(object.line?.color, context.theme.accent), transparency: 100 },
  });
  slide.addText(String(object.text || "label"), {
    ...pos,
    fontFace: object.fontFace || context.theme.bodyFont,
    fontSize: toNumber(object.fontSize, 9),
    bold: true,
    align: "center",
    valign: "mid",
    color: cleanHex(object.color, context.theme.accent),
    margin: 0.02,
  });
}

function renderStatCard(slide, object, context) {
  const pos = objectPos(object, { x: 8.8, y: 1.35, w: 3.8, h: 1.5 });
  slide.addShape(context.pptx.ShapeType.roundRect, {
    ...pos,
    rectRadius: 0.08,
    fill: { color: cleanHex(object.fill, "FFFFFF"), transparency: toNumber(object.fillTransparency, 0) },
    line: { color: cleanHex(object.accentColor, context.theme.accent), transparency: 40, width: 1.1 },
  });
  slide.addText(String(object.value || "Value"), {
    x: pos.x + 0.18,
    y: pos.y + 0.16,
    w: pos.w - 0.36,
    h: 0.56,
    fontFace: context.theme.headingFont,
    fontSize: toNumber(object.valueFontSize, 22),
    bold: true,
    color: cleanHex(object.color, context.theme.text),
    margin: 0,
  });
  slide.addText(String(object.label || ""), {
    x: pos.x + 0.18,
    y: pos.y + 0.82,
    w: pos.w - 0.36,
    h: 0.42,
    fontFace: context.theme.bodyFont,
    fontSize: toNumber(object.labelFontSize, 11),
    color: cleanHex(object.labelColor, context.theme.text),
    margin: 0,
  });
}

function renderQuotePanel(slide, object, context) {
  const pos = objectPos(object, { x: 0.9, y: 4.8, w: 5.2, h: 1.4 });
  slide.addShape(context.pptx.ShapeType.roundRect, {
    ...pos,
    fill: { color: cleanHex(object.fill, context.theme.soft), transparency: 5 },
    line: { color: cleanHex(object.line?.color, context.theme.accent), transparency: 85, width: 1 },
  });
  slide.addText(`“${object.quote || object.text || ""}”`, {
    x: pos.x + 0.2,
    y: pos.y + 0.12,
    w: pos.w - 0.4,
    h: pos.h - 0.4,
    fontFace: context.theme.bodyFont,
    fontSize: toNumber(object.fontSize, 16),
    italic: true,
    color: cleanHex(object.color, context.theme.text),
    margin: 0,
    fit: "shrink",
  });
  if (object.attribution) {
    slide.addText(String(object.attribution), {
      x: pos.x + 0.2,
      y: pos.y + pos.h - 0.28,
      w: pos.w - 0.4,
      h: 0.18,
      fontFace: context.theme.bodyFont,
      fontSize: 9,
      color: cleanHex(object.labelColor, context.theme.accent),
      align: "right",
      margin: 0,
    });
  }
}

function renderTimeline(slide, object, context) {
  const pos = objectPos(object, { x: 0.9, y: 5.4, w: 11.2, h: 0.95 });
  const items = arrayify(object.items).slice(0, 5);
  if (items.length === 0) return;
  const gap = items.length === 1 ? 0 : pos.w / (items.length - 1);
  slide.addShape(context.pptx.ShapeType.line, {
    x: pos.x,
    y: pos.y + 0.2,
    w: pos.w,
    h: 0,
    line: { color: context.theme.accent, width: 1.2, transparency: 20 },
  });
  items.forEach((item, index) => {
    const cx = pos.x + gap * index;
    slide.addShape(context.pptx.ShapeType.ellipse, {
      x: cx - 0.11,
      y: pos.y + 0.08,
      w: 0.22,
      h: 0.22,
      fill: { color: cleanHex(item.fill, context.theme.accent) },
      line: { color: cleanHex(item.lineColor, context.theme.accent), transparency: 100 },
    });
    slide.addText(String(item.title || `Step ${index + 1}`), {
      x: cx - 0.75,
      y: pos.y + 0.36,
      w: 1.5,
      h: 0.22,
      align: "center",
      fontFace: context.theme.bodyFont,
      fontSize: 9,
      bold: true,
      color: cleanHex(item.color, context.theme.text),
      margin: 0,
      fit: "shrink",
    });
    if (item.detail) {
      slide.addText(String(item.detail), {
        x: cx - 0.9,
        y: pos.y + 0.56,
        w: 1.8,
        h: 0.26,
        align: "center",
        fontFace: context.theme.bodyFont,
        fontSize: 8,
        color: cleanHex(item.detailColor, context.theme.text),
        margin: 0,
        fit: "shrink",
      });
    }
  });
}

async function resolveImagePath(object, context) {
  let imagePath = object.path;
  if (object.assetId) {
    const asset = context.assets.get(object.assetId);
    imagePath = asset?.path || imagePath;
  }
  if (!imagePath) {
    context.missingAssets.push({ id: object.id, assetId: object.assetId, reason: "image path not provided" });
    return null;
  }
  const resolved = resolvePath(imagePath, context.specDir);
  if (!(await exists(resolved))) {
    context.missingAssets.push({ id: object.id, path: resolved, reason: "image file missing" });
    return null;
  }
  return resolved;
}

function normalizeLine(line, context) {
  if (line === false) return { color: "FFFFFF", transparency: 100 };
  return {
    color: cleanHex(line?.color, context.theme.accent),
    width: toNumber(line?.width ?? line?.pt, 1),
    transparency: toNumber(line?.transparency, 0),
    dash: line?.dash,
    beginArrowType: line?.beginArrowType,
    endArrowType: line?.endArrowType,
  };
}

function shapeType(pptx, name) {
  const normalized = String(name || "rect");
  return pptx.ShapeType[normalized] || pptx.ShapeType.rect;
}
