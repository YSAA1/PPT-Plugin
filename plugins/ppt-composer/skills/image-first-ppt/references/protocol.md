# Protocol Reference

## Contents

- Protocol source of truth
- Fidelity modes
- Existing-PPT hard-preservation boundary
- Protocol skeleton
- Page fields
- Speaker notes
- Protocol patch rules
- Asset gate
- Review artifact
- Confirmation summary

## Protocol

`deck-protocol.json` is the source of truth before generation. It MUST keep:

- deck metadata and style;
- localized reference assets by id;
- one page record per slide;
- `content_inputs`, `reference_asset_ids`, `fidelity`, `final_image_prompt`, `negative_prompt`, `output_png`, and default `speaker_notes`.

Use only these fidelity modes:

- `free`: approved brief/style only.
- `light_redraw`: preserve facts, trends, key numbers, labels, and meaning while restyling.
- `strict_embed`: preserve referenced figures, tables, headers, values, logos, and captions.

Existing-PPT hard-preservation requests are a different product lane:

- If the user asks to optimize an existing PPT while every original page's text, figures, charts, tables, logos, and images must be fully preserved, DO NOT treat image generation as a faithful page editor.
- Current image-first generation may restyle or redraw evidence; it cannot guarantee exact text/table/chart reproduction from an existing PPT.
- Supported conservative fallback: embed each original full-slide screenshot as locked evidence, then only add external framing if the user accepts that the internal page layout will not be reflowed.
- Otherwise stop before generation and explain that the missing capability is a structured PPTX inventory/reflow lane: parse each page's text, images, charts, tables, positions, z-order, and styles; optimize layout using those locked objects; then run exactness QA.

Run `ppt_composer_doctor` first for PDF/Office/scanned/image references. Then use `mineru-open-mcp.parse_documents` for documents that require extraction, then feed the saved Markdown and returned image assets (`image_paths`, including extracted figures or page-image/input-image fallback) into `reference-intake` / `pptx-reference-intake` before drafting or confirming any reference-grounded protocol. Use `asset-index-create` only for adding standalone local/remote assets after intake. Keep `reference-assets/asset-index.json` synchronized. Page content MUST reference stable asset ids, not raw paths.

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
- `speaker_notes`: default speaker/presenter talk track written to PPT notes, not visible slide text
- `free_generation: true` only when a reference-grounded page intentionally has no evidence binding

Speaker notes rules:

- Use `speaker_notes` as the canonical protocol key.
- Accept legacy aliases `notes`, `remarks`, `presenter_notes`, and `备注` when user-authored protocols already contain them.
- Speaker notes MUST NOT be rendered inside the PNG unless the user explicitly says they are visible slide text.
- Generated protocols SHOULD include `speaker_notes` by default on every page unless the user explicitly opts out.
- Speaker notes should be audience-specific talk tracks, not one-line labels. They should explain the page takeaway, why it matters to the stated audience, how to talk through the bound evidence, and how to transition to the next page.
- Assembly MUST carry speaker notes from protocol -> `imagegen-jobs.json` -> `png-manifest.json` -> PPT speaker notes.

Visual consistency and metadata rules:

- The protocol/style MUST define one footer or page-number policy for the whole deck. Do not allow page numbers to appear randomly on only some pages.
- Unless the user explicitly requests visible page numbers, either omit page numbers everywhere or use the same small bottom-right page/total footer consistently.
- `final_image_prompt` and `negative_prompt` MUST forbid visible internal metadata: asset ids, filenames, file paths, `source:`, `source table`, `reference asset`, protocol field names, or parser labels.
- Evidence ids and paths are for grounding only; they MUST NOT be copied into visible slide text.

Protocol patch rules:

- MUST use `protocol-add-asset` for new assets when a protocol file already exists.
- MUST use `protocol-bind-asset` to bind references to pages.
- MUST use `protocol-update-page` to change a page claim, prompt, negative prompt, output path, or content inputs.
- MUST use `protocol-set-fidelity` to change fidelity.
- If patch tools are unavailable, direct JSON edits are allowed only after recording the tool blocker and MUST be followed immediately by `validate-deck-protocol`.
- MUST reject duplicate asset ids, unknown page numbers, unknown asset ids, and illegal fidelity values.
- MUST pretty-print JSON after patching.
- MUST preserve `version: "0.1"` and additive compatibility.

Asset gate:

- If the user provided reference files, `deck-protocol.json.assets` MUST contain the localized text, table, image, logo, or template assets extracted from those files.
- `reference-assets/asset-index.json` MUST exist for local assets before confirmation.
- A reference-grounded protocol with `assets: []` is invalid unless the agent records a concrete intake blocker and stops before confirmation.
- At least one reference-grounded page MUST bind localized assets through `content_inputs` or `reference_asset_ids`; `free_generation: true` cannot be used as a global bypass after reference parsing fails.
- Direct image/logo/template inputs MUST appear in `assets` and relevant page/style bindings; do not leave images only as raw paths in prose.

Review artifact:

- Before asking for protocol confirmation, write `deck-protocol.review.md` with `protocol_review` / CLI `protocol-review`.
- The review artifact MUST include validation status, source inputs, warnings, asset table, page table, evidence bindings, fidelity modes, and output filenames.
- The chat message may summarize the protocol, but the review artifact is the human review version. Do not rely on chat-only review.

Before asking for confirmation, present the review artifact path plus the title, page count, aspect ratio, global visual style, page-by-page claims, evidence bindings, fidelity modes, prompts, negative prompts, and output filenames. Then stop until the user explicitly confirms.

Explicit confirmation means the user clearly approves the protocol, for example "确认协议", "按此 protocol 生成", "开始生图", or an equivalent clear approval. Ambiguous replies such as "继续", "ok", or "不错" do not authorize image generation unless they clearly refer to the protocol summary.
