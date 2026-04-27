# Protocol Reference

## Contents

- Protocol source of truth
- Fidelity modes
- Existing-PPT hard-preservation boundary
- Protocol skeleton
- Page fields
- Speaker notes
- Protocol patch rules
- Confirmation summary

## Protocol

`deck-protocol.json` is the source of truth before generation. It MUST keep:

- deck metadata and style;
- localized reference assets by id;
- one page record per slide;
- `content_inputs`, `reference_asset_ids`, `fidelity`, `final_image_prompt`, `negative_prompt`, `output_png`, and optional `speaker_notes`.

Use only these fidelity modes:

- `free`: approved brief/style only.
- `light_redraw`: preserve facts, trends, key numbers, labels, and meaning while restyling.
- `strict_embed`: preserve referenced figures, tables, headers, values, logos, and captions.

Existing-PPT hard-preservation requests are a different product lane:

- If the user asks to optimize an existing PPT while every original page's text, figures, charts, tables, logos, and images must be fully preserved, DO NOT treat image generation as a faithful page editor.
- Current image-first generation may restyle or redraw evidence; it cannot guarantee exact text/table/chart reproduction from an existing PPT.
- Supported conservative fallback: embed each original full-slide screenshot as locked evidence, then only add external framing if the user accepts that the internal page layout will not be reflowed.
- Otherwise stop before generation and explain that the missing capability is a structured PPTX inventory/reflow lane: parse each page's text, images, charts, tables, positions, z-order, and styles; optimize layout using those locked objects; then run exactness QA.

Use `asset-index-create` or `reference-intake` to keep `reference-assets/asset-index.json` synchronized. Page content MUST reference stable asset ids, not raw paths.

Protocol skeleton:

```json
{
  "kind": "ppt-composer-deck-protocol",
  "version": "0.1",
  "mode": "reference_grounded_mode",
  "deck": {
    "title": "",
    "language": "zh",
    "audience": "",
    "page_count": 8,
    "aspect_ratio": "16:9"
  },
  "style": {
    "description": "",
    "template_image_ids": [],
    "logo_ids": [],
    "palette": [],
    "typography": ""
  },
  "assets": [],
  "pages": []
}
```

Each page MUST include exactly these required fields:

- `page`, `title`, `claim`
- `content_inputs`: `{ "text": [], "tables": [], "images": [] }`
- `reference_asset_ids`
- `fidelity`
- `final_image_prompt`
- `negative_prompt`
- `output_png`
- optional `speaker_notes`: speaker/presenter notes written to PPT notes, not visible slide text
- `free_generation: true` only when a reference-grounded page intentionally has no evidence binding

Speaker notes rules:

- Use `speaker_notes` as the canonical protocol key.
- Accept legacy aliases `notes`, `remarks`, `presenter_notes`, and `备注` when user-authored protocols already contain them.
- Speaker notes MUST NOT be rendered inside the PNG unless the user explicitly says they are visible slide text.
- Assembly MUST carry speaker notes from protocol -> `imagegen-jobs.json` -> `png-manifest.json` -> PPT speaker notes.

Protocol patch rules:

- MUST use `protocol-add-asset` for new assets when a protocol file already exists.
- MUST use `protocol-bind-asset` to bind references to pages.
- MUST use `protocol-update-page` to change a page claim, prompt, negative prompt, output path, or content inputs.
- MUST use `protocol-set-fidelity` to change fidelity.
- MUST reject duplicate asset ids, unknown page numbers, unknown asset ids, and illegal fidelity values.
- MUST pretty-print JSON after patching.
- MUST preserve `version: "0.1"` and additive compatibility.

Before asking for confirmation, present the title, page count, aspect ratio, global visual style, page-by-page claims, evidence bindings, fidelity modes, prompts, negative prompts, and output filenames. Then stop until the user explicitly confirms.
