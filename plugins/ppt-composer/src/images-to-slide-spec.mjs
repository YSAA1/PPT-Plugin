import path from "node:path";
import { isFile } from "./lib.mjs";

export async function imagesToSlideSpec(images, { title = "Image deck" } = {}) {
  const assets = [];
  const slides = [];

  for (const [index, imageInput] of images.entries()) {
    const imagePath = typeof imageInput === "string" ? imageInput : imageInput.path;
    if (!(await isFile(imagePath))) {
      throw new Error(`Image not found: ${imagePath}`);
    }
    const id = `img${index + 1}`;
    assets.push({
      id,
      type: "image",
      path: imagePath,
      source: "user_provided",
      usage: "full-slide",
      caption: path.basename(imagePath),
    });
    slides.push({
      id: `s${index + 1}`,
      layout: "full-slide-image",
      title: path.basename(imagePath, path.extname(imagePath)),
      objects: [
        {
          type: "image",
          assetId: id,
          position: { x: 0, y: 0, w: 13.333, h: 7.5 },
        },
      ],
      notes: noteFromImageInput(imageInput) || "Image-first slide. Main content may not be deeply editable.",
    });
  }

  return {
    version: "0.1",
    deck: {
      title,
      audience: "general",
      language: "en",
      format: "16:9",
      editability: "image-first",
      visualPolicy: "image-first",
    },
    theme: {
      template: "image-gallery",
      palette: ["#111827", "#2563EB", "#F8FAFC", "#E5E7EB"],
      fonts: { heading: "Aptos Display", body: "Aptos" },
    },
    assets,
    slides,
  };
}

export async function pngManifestToSlideSpec(manifest, { manifestPath, title = "Image-first PPT" } = {}) {
  const items = normalizePngManifest(manifest);
  const baseDir = manifestPath ? path.dirname(manifestPath) : process.cwd();
  const images = [];

  for (const [index, item] of items.entries()) {
    const page = item.page ?? item.pageNumber ?? item.slide ?? item.slideNumber ?? index + 1;
    const imagePath = item.path || item.png || item.file || item.output;
    if (!imagePath) {
      throw new Error(`PNG manifest item for page ${page} is missing path`);
    }
    if (item.status && item.status !== "generated") {
      throw new Error(`PNG manifest item for page ${page} is not generated: ${item.status}`);
    }
    if (item.provider === "placeholder" || item.source === "placeholder" || item.placeholder === true) {
      throw new Error(`PNG manifest item for page ${page} is a placeholder, not a final generated PNG`);
    }
    if (!/\.png$/i.test(imagePath)) {
      throw new Error(`PNG manifest item for page ${page} must point to a PNG file: ${imagePath}`);
    }
    const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(baseDir, imagePath);
    if (!(await isFile(resolved))) {
      throw new Error(`PNG manifest item for page ${page} does not exist: ${resolved}`);
    }
    images.push({ ...item, page: Number(page), path: resolved, notes: speakerNotesFromManifestItem(item) });
  }

  images.sort((a, b) => a.page - b.page);
  if (!images.length) {
    throw new Error("PNG manifest requires at least one generated PNG item");
  }

  return imagesToSlideSpec(images, { title });
}

function normalizePngManifest(manifest) {
  if (Array.isArray(manifest)) return manifest;
  if (Array.isArray(manifest?.items)) return manifest.items;
  if (Array.isArray(manifest?.pages)) return manifest.pages;
  if (Array.isArray(manifest?.slides)) return manifest.slides;
  throw new Error("PNG manifest must be an array or contain items/pages/slides");
}

function noteFromImageInput(imageInput) {
  if (!imageInput || typeof imageInput === "string") return "";
  return speakerNotesFromManifestItem(imageInput);
}

function speakerNotesFromManifestItem(item = {}) {
  const value = item.speaker_notes ?? item.speakerNotes ?? item.notes ?? item.remarks ?? item.presenter_notes ?? item["备注"];
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean).join("\n");
  return String(value).trim();
}
