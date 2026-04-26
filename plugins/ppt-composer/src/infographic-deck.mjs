import path from "node:path";
import { markdownToSlideSpec } from "./markdown-to-slide-spec.mjs";
import { imagesToSlideSpec } from "./images-to-slide-spec.mjs";

export async function infographicDeckSpec({ markdown = null, images = [], baseSpec = null, title = null, sourcePath = null, outputPath = null, assetManifest = null, fullSlide = false } = {}) {
  let spec = baseSpec;
  if (!spec && markdown) {
    spec = markdownToSlideSpec(markdown, { title, sourcePath });
  }
  if (!spec && images.length > 0) {
    spec = await imagesToSlideSpec(images, { title: title || "Infographic deck" });
  }
  if (!spec) {
    throw new Error("infographicDeckSpec requires markdown, images, or a base slide spec");
  }

  const infographic = JSON.parse(JSON.stringify(spec));
  infographic.deck = {
    ...infographic.deck,
    title: title || infographic.deck?.title || "Infographic deck",
    editability: "image-first",
  };
  infographic.theme = {
    ...infographic.theme,
    template: "infographic-immersive",
    palette: ["#0F172A", "#38BDF8", "#020617", "#E2E8F0", "#F8FAFC"],
    fonts: {
      heading: infographic.theme?.fonts?.heading || "Aptos Display",
      body: infographic.theme?.fonts?.body || "Aptos",
    },
  };

  const manifestMap = new Map(
    (assetManifest?.items || [])
      .filter((item) => item.status === "generated" && item.path)
      .map((item) => [item.slideId, item]),
  );

  infographic.assets ||= [];

  for (const [index, slide] of (infographic.slides || []).entries()) {
    const slideId = slide.id || `s${index + 1}`;
    const manifestItem = manifestMap.get(slideId);
    const imageObject = (slide.objects || []).find((object) => object.type === "image");
    const summaryText = summarizeSlide(slide);

    if (fullSlide) {
      slide.layout = "full-slide-image";
      slide.background = "#020617";
      slide.objects = [];
      if (manifestItem?.path) {
        const assetId = manifestItem.assetId || `${slideId}-full-slide`;
        ensureAsset(infographic.assets, assetId, manifestItem.path, slide.title || assetId, outputPath || sourcePath);
        slide.objects.push({
          id: `full-slide-image-${slideId}`,
          type: "image",
          assetId,
          position: { x: 0, y: 0, w: 13.333, h: 7.5 },
        });
        continue;
      }
      if (imageObject?.assetId || imageObject?.path) {
        const assetId = imageObject.assetId || `${slideId}-existing-image`;
        if (imageObject.path) ensureAsset(infographic.assets, assetId, imageObject.path, slide.title || assetId, outputPath || sourcePath);
        slide.objects.push({
          id: `full-slide-image-${slideId}`,
          type: "image",
          assetId,
          path: imageObject.path,
          position: { x: 0, y: 0, w: 13.333, h: 7.5 },
        });
        continue;
      }
      slide.objects.push({
        id: `full-slide-missing-${slideId}`,
        type: "text",
        position: { x: 1.0, y: 3.25, w: 11.3, h: 0.7 },
        text: "Missing full-slide generated image",
        align: "center",
        color: "#F8FAFC",
        fontSize: 24,
        bold: true,
      });
      continue;
    }

    slide.layout = "infographic-highlight";
    slide.background = "#020617";
    slide.objects = [];

    slide.objects.push({
      id: `info-panel-${slideId}`,
      type: "shape",
      shape: "roundRect",
      position: { x: 0.55, y: 1.08, w: 4.15, h: 5.82 },
      fill: "#0F172A",
      line: { color: "#1E3A8A", width: 1.2 },
    });
    slide.objects.push({
      id: `info-title-${slideId}`,
      type: "text",
      role: "headline",
      position: { x: 0.92, y: 1.38, w: 3.45, h: 1.18 },
      text: slide.title || `Slide ${index + 1}`,
      color: "#F8FAFC",
      fontSize: 28,
    });
    slide.objects.push({
      id: `info-body-${slideId}`,
      type: "text",
      position: { x: 0.92, y: 2.68, w: 3.15, h: 2.55 },
      text: summaryText || "Image-first infographic slide.",
      color: "#E2E8F0",
      fontSize: 16,
      margin: 0.04,
    });
    slide.objects.push({
      id: `info-chip-${slideId}`,
      type: "component",
      kind: "label-chip",
      text: "image-first",
      position: { x: 0.92, y: 5.58, w: 1.75, h: 0.34 },
      fill: "#082F49",
      color: "#7DD3FC",
    });

    if (manifestItem?.path) {
      const assetId = manifestItem.assetId || `${slideId}-visual`;
      ensureAsset(infographic.assets, assetId, manifestItem.path, slide.title || assetId, outputPath || sourcePath);
      slide.objects.push({
        id: `info-image-${slideId}`,
        type: "image",
        assetId,
        position: { x: 4.95, y: 1.05, w: 7.82, h: 5.88 },
        rounding: true,
      });
      continue;
    }

    if (imageObject?.assetId || imageObject?.path) {
      const assetId = imageObject.assetId || `${slideId}-existing-image`;
      if (imageObject.path) ensureAsset(infographic.assets, assetId, imageObject.path, slide.title || assetId, outputPath || sourcePath);
      slide.objects.push({
        id: `info-image-${slideId}`,
        type: "image",
        assetId,
        path: imageObject.path,
        position: { x: 4.95, y: 1.05, w: 7.82, h: 5.88 },
        rounding: true,
      });
      continue;
    }

    slide.objects.push({
      id: `info-fallback-${slideId}`,
      type: "shape",
      shape: "roundRect",
      position: { x: 4.95, y: 1.05, w: 7.82, h: 5.88 },
      fill: "#0F172A",
      line: { color: "#38BDF8", width: 1.4, dash: "dash" },
    });
    slide.objects.push({
      id: `info-fallback-text-${slideId}`,
      type: "text",
      position: { x: 5.55, y: 3.2, w: 6.7, h: 0.85 },
      text: "Add full-slide hero art via visual-plan + generate-assets",
      align: "center",
      color: "#7DD3FC",
      fontSize: 20,
      bold: true,
    });
  }

  return infographic;
}

function summarizeSlide(slide) {
  const texts = (slide.objects || [])
    .filter((object) => object.type === "text")
    .map((object) => String(object.text || "").replace(/•/g, "-").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
  return texts.join("\n\n").slice(0, 280);
}

function ensureAsset(assets, id, assetPath, caption, specPath) {
  if (assets.some((asset) => asset.id === id)) return;
  assets.push({
    id,
    type: "image",
    path: specPath && path.isAbsolute(assetPath) ? path.relative(path.dirname(specPath), assetPath) : assetPath,
    source: "generated",
    caption,
  });
}
