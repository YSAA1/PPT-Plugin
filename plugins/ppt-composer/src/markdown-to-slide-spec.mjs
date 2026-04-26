import path from "node:path";

export function markdownToSlideSpec(markdown, { title, sourcePath } = {}) {
  const lines = markdown.split(/\r?\n/);
  const deckTitle = title || firstHeading(lines) || "Markdown deck";
  const slides = [];
  let current = null;
  let tableBuffer = [];

  const flushTable = () => {
    if (!current || tableBuffer.length === 0) return;
    const rows = parseMarkdownTable(tableBuffer);
    if (rows.length > 0) {
      current.objects.push({
        type: "table",
        position: defaultObjectPosition(current.objects.length),
        rows,
      });
    }
    tableBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      flushTable();
      current = {
        id: `s${slides.length + 1}`,
        layout: "content",
        title: h2[1],
        objects: [],
        notes: sourcePath ? `Source: ${path.basename(sourcePath)}` : "",
      };
      slides.push(current);
      continue;
    }

    if (!current) continue;

    if (/^\|.+\|$/.test(line)) {
      tableBuffer.push(line);
      continue;
    }
    flushTable();

    const image = rawLine.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (image) {
      current.objects.push({
        type: "image",
        position: defaultObjectPosition(current.objects.length),
        path: image[2],
        alt: image[1],
      });
      continue;
    }

    const bullet = rawLine.match(/^\s*[-*]\s+(.+)/);
    if (bullet) {
      const previous = current.objects[current.objects.length - 1];
      if (previous?.type === "text" && previous.role === "bullets") {
        previous.text += `\n• ${bullet[1]}`;
      } else {
        current.objects.push({
          type: "text",
          role: "bullets",
          position: defaultObjectPosition(current.objects.length),
          text: `• ${bullet[1]}`,
          fontSize: 16,
        });
      }
      continue;
    }

    if (line && !line.startsWith("#")) {
      current.objects.push({
        type: "text",
        role: "body",
        position: defaultObjectPosition(current.objects.length),
        text: line,
        fontSize: 16,
      });
    }
  }
  flushTable();

  if (slides.length === 0) {
    slides.push({
      id: "s1",
      layout: "content",
      title: deckTitle,
      objects: [{ type: "text", role: "body", position: { x: 0.8, y: 1.3, w: 11.7, h: 4.8 }, text: markdown.trim() }],
    });
  }

  return {
    version: "0.1",
    deck: {
      title: deckTitle,
      audience: "general",
      language: "en",
      format: "16:9",
      editability: "native-first",
      visualPolicy: "native-only",
    },
    theme: {
      template: "academic-clean",
      palette: ["#111827", "#2563EB", "#F8FAFC", "#E5E7EB"],
      fonts: { heading: "Aptos Display", body: "Aptos" },
    },
    assets: [],
    slides,
  };
}

function firstHeading(lines) {
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)/);
    if (match) return match[1];
  }
  return null;
}

function parseMarkdownTable(lines) {
  const rows = lines
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
  return rows.filter((row) => row.some(Boolean));
}

function defaultObjectPosition(index) {
  if (index === 0) return { x: 0.75, y: 1.25, w: 11.8, h: 4.8 };
  if (index === 1) return { x: 0.75, y: 3.9, w: 11.8, h: 2.25 };
  return { x: 0.75, y: 1.25 + index * 0.55, w: 11.8, h: 1.0 };
}
