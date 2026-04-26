export const TEMPLATES = {
  "academic-clean": {
    id: "academic-clean",
    palette: ["#111827", "#2563EB", "#F8FAFC", "#E5E7EB"],
    fonts: { heading: "Aptos Display", body: "Aptos" },
    title: { fontSize: 24, y: 0.32, h: 0.52 },
  },
  "image-editorial": {
    id: "image-editorial",
    palette: ["#0F172A", "#F97316", "#F8FAFC", "#E2E8F0"],
    fonts: { heading: "Aptos Display", body: "Aptos" },
    title: { fontSize: 26, y: 0.3, h: 0.58 },
  },
  "consulting-research": {
    id: "consulting-research",
    palette: ["#111827", "#2563EB", "#F8FAFC", "#CBD5E1", "#10B981", "#F59E0B"],
    fonts: { heading: "Aptos Display", body: "Aptos" },
    title: { fontSize: 22, y: 0.28, h: 0.5 },
    grid: { marginX: 0.6, titleRuleY: 0.92, contentTop: 1.2 },
  },
};

export function resolveTemplate(spec = {}) {
  const id = spec.theme?.templateId || spec.theme?.template || "academic-clean";
  return TEMPLATES[id] || TEMPLATES["academic-clean"];
}
