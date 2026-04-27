---
name: image-first-ppt
description: "Generate image-first PowerPoint decks. Hard workflow: intake brief/reference files, write a human-editable deck-protocol.json, wait for user confirmation on that protocol, then dispatch bounded subagents to directly generate final full-slide PNGs, then assemble a PPTX only from a complete PNG manifest. Use when Codex needs a PPTX where every slide is exactly one complete generated PNG image."
---

# Image-First PPT

Create a low-editability PPTX where every slide is exactly one finished full-slide PNG. Do not create editable/native/hybrid decks, prompt-only deliverables, SVG placeholders, HTML screenshots, or a background/base draft for later PPT text overlay.

## Outcome Gate

MUST satisfy all rules:

- The final PPTX MUST have exactly one full-slide PNG per slide.
- All visible title, claim, label, diagram, logo, and text MUST be rendered inside the PNG.
- Later PPT text overlays are FORBIDDEN.
- no later PPT text overlay.
- Placeholder, SVG, HTML, prompt sheet, screenshot, and deterministic renderer output are FORBIDDEN as finished slides.
- A prompt sheet is not a finished slide and cannot be reported as progress beyond "awaiting image generation".
- The PNG manifest is the only assembly gate. Do not assemble until every planned page has a real `.png`.
- PNG manifest is the gate for assembly.

## Workflow

Execute in this exact order. Do not skip forward.

1. Clarify missing requirements.
2. Create `deck-protocol.json`.
3. Validate `deck-protocol.json`.
4. Patch revisions only through protocol patch tools when possible.
5. Present the protocol summary and wait for explicit confirmation. This is the Protocol Confirmation Gate.
6. After confirmation, generate final full-slide PNGs directly with Codex image generation. Treat confirmation as authorization to use bounded image-generation subagents for the confirmed pages.
   - For multi-page decks, MUST dispatch bounded image-generation subagents before generating directly in the leader.
   - The leader MUST NOT silently do all confirmed pages alone unless subagent spawning is unavailable or has already failed.
7. Track page status in `imagegen-jobs.json`.
8. Run `visual-qa`.
9. Create `png-manifest.json` only from complete accepted/generated jobs.
10. Assemble with `assemble-image-ppt` / MCP `assemble_image_ppt`.
11. Run final `qa_pptx`.

Hard stop conditions:

- If protocol is not confirmed, STOP before image generation.
- If any page lacks a real PNG, STOP before manifest creation.
- If `visual-qa` status is `fail`, STOP before assembly unless a manual override note exists.
- If final PPTX QA does not show one picture per slide and zero text overlays, STOP and report failure.

## Clarification Fields

Collect these before drafting a protocol. Ask only for missing items. Do not infer hard constraints such as logo, required wording, page count, or strict evidence from unrelated files.

- language
- deck type, such as academic report, product pitch, class presentation, business proposal, paper summary, or teaching deck
- target audience
- page-count range or exact page count
- visual style
- aspect ratio, defaulting to 16:9 only if the user does not care
- output directory and final PPTX filename
- reference file paths or uploaded files
- required wording, logo, color, data, citation, or exclusion constraints

If no uploaded file or explicit reference path exists, MUST NOT scan the current project. Continue from the user brief.

## Protocol

`deck-protocol.json` is the source of truth before generation. It MUST keep:

- deck metadata and style;
- localized reference assets by id;
- one page record per slide;
- `content_inputs`, `reference_asset_ids`, `fidelity`, `final_image_prompt`, `negative_prompt`, and `output_png`.

Use only these fidelity modes:

- `free`: approved brief/style only.
- `light_redraw`: preserve facts, trends, key numbers, labels, and meaning while restyling.
- `strict_embed`: preserve referenced figures, tables, headers, values, logos, and captions.

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
- `free_generation: true` only when a reference-grounded page intentionally has no evidence binding

Protocol patch rules:

- MUST use `protocol-add-asset` for new assets when a protocol file already exists.
- MUST use `protocol-bind-asset` to bind references to pages.
- MUST use `protocol-update-page` to change a page claim, prompt, negative prompt, output path, or content inputs.
- MUST use `protocol-set-fidelity` to change fidelity.
- MUST reject duplicate asset ids, unknown page numbers, unknown asset ids, and illegal fidelity values.
- MUST pretty-print JSON after patching.
- MUST preserve `version: "0.1"` and additive compatibility.

Before asking for confirmation, present the title, page count, aspect ratio, global visual style, page-by-page claims, evidence bindings, fidelity modes, prompts, negative prompts, and output filenames. Then stop until the user explicitly confirms.

## Image Generation

Primary path: Codex built-in image generation via the installed `imagegen` skill, `$imagegen`, or `image_gen`.

- MUST NOT check `OPENAI_API_KEY` before trying Codex built-in image generation.
- Missing `OPENAI_API_KEY` MUST NOT be treated as evidence that built-in `image_gen` is unavailable.
- A missing `OPENAI_API_KEY` does not mean built-in `image_gen` is unavailable.
- `generate-assets --provider codex` is only a prompt-sheet handoff, not image generation.
- `generate-assets --provider openai` is an explicit API fallback.
- If imagegen workers fail or return prompt-only output, retry or generate directly. MUST NOT assemble placeholders.

Subagent split rules:

- 1 page: the leader may generate directly.
- 2-6 pages: MUST dispatch one subagent per page.
- 7+ pages: MUST dispatch 3-6 subagents, each assigned a consecutive page range.
- Default wait budget MUST be at least 2 minutes per image plus buffer.
- Image workers MUST use `reasoning_effort: "low"` unless the user explicitly asks for deeper reasoning.
- Before spawning workers, the leader MUST create one shared deck generation context from the confirmed protocol: deck title, audience, aspect ratio, global style, palette, typography, logo/template asset ids, page list, global negative rules, QA acceptance rules, and asset index.
- Every worker MUST receive the exact same shared deck generation context plus only its assigned page protocol slice and relevant reference asset paths.
- MUST NOT rely on inherited chat history as the only consistency mechanism.
- MUST NOT call `spawn_agent` with `fork_context: true` when also setting `agent_type` / role.
- Consistency-first spawn shape is: omit `agent_type`, set `fork_context: true`, set `reasoning_effort: "low"`, and still include the shared deck generation context in the worker prompt.
- Context-packet spawn shape is: omit `agent_type`, set `fork_context: false` or omit it, set `reasoning_effort: "low"`, and put the shared deck generation context plus assigned page context in the worker prompt.
- If a role is required by the runtime, MUST omit `fork_context`; write the shared deck generation context and complete task context into `message` or `items`.
- If subagent spawning is unavailable, blocked, or fails, the leader MAY fall back to direct generation, but MUST record the reason in `imagegen-jobs.json` notes or the final handoff. Silent fallback is FORBIDDEN.
- The leader MUST wait for subagent results or failure status before creating `png-manifest.json`.

Spawn call guardrail:

```text
Allowed:
spawn_agent({
  reasoning_effort: "low",
  fork_context: true,
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Also allowed:
spawn_agent({
  reasoning_effort: "low",
  fork_context: false,
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Forbidden:
spawn_agent({
  agent_type: "<any role>",
  fork_context: true,
  ...
})
```

Worker prompt template:

```text
You are an image-generation worker for image-first PPT.

Scope:
- Generate only the assigned page(s).
- Do not redesign the deck.
- Do not change the outline.
- Do not create PPTX, SVG, HTML, markdown, placeholder art, or prompt-only artifacts.
- Follow the shared deck generation context exactly so pages are visually consistent with other workers.

Shared deck generation context:
- Deck title: <title>
- Audience: <audience>
- Aspect ratio and size: <16:9 / width x height>
- Global style: <style description>
- Palette: <colors>
- Typography: <fonts and text style>
- Logos/template assets: <ids and paths>
- Full page list: <page numbers and titles/claims>
- Global negative rules: <rules shared by all pages>
- QA acceptance rules: <one full-slide PNG, all text inside image, no placeholder, no PPT overlay>
- Asset index: <stable ids, captions, usage, localized paths>

For each assigned page:
- Page: <page-number>
- Size: <width>x<height>, 16:9 unless specified otherwise
- Output PNG path: <path>.png
- Fidelity: <free|light_redraw|strict_embed>
- Protocol page slice:
  <JSON for only this page>
- Reference assets to inspect first:
  <paths to source images, table PNGs, logos, or template images relevant to this page>
- Final image prompt:
  <one complete final full-slide image prompt>
- Negative prompt:
  <negative prompt>

Required behavior:
1. Inspect/use assigned reference images and table PNGs when present.
2. Directly call Codex built-in image generation.
3. Return page number, generated PNG path, status, and one-line failure reason if failed.

Failure: prompt-only, SVG, HTML, placeholder, local screenshot, background-only image, later PPT text overlay, or changed strict_embed evidence.
```

## Manifest And QA

`imagegen-jobs.json` stores execution state only. MUST NOT move content truth out of `deck-protocol.json`.

Create `png-manifest.json` only after all pages are `generated` or `accepted`:

```json
{
  "kind": "image-first-ppt-png-manifest",
  "items": [
    { "page": 1, "status": "generated", "path": "output/slide-01.png" }
  ]
}
```

Manifest requirements:

- one item per planned slide;
- every item has `status: "generated"`;
- every path points to a real `.png`;
- no prompt sheet, SVG, HTML, screenshot of a prompt, or placeholder image.

Backfill rules:

- MUST validate file existence.
- MUST validate `.png` extension.
- MUST validate PNG magic bytes.
- MUST reject placeholder markers.
- MUST reject tiny files as final slides.
- MUST preserve page order by `page`.

Run `visual-qa` before assembly. Level 1 checks file existence, PNG magic bytes, dimensions, tiny files, and one image per page. Level 2 checks placeholder markers and missing required references.

## Internal Tools

Prefer MCP as the internal tool layer when available. Keep MCP as the internal tool layer, not a separate public skill surface.

- `reference_intake`, `pptx_reference_intake`, `validate_deck_protocol`
- `protocol_patch`
- `asset_index_create`
- `visual_plan`, `generate_assets`
- `imagegen_jobs_create`, `imagegen_jobs_backfill`, `imagegen_jobs_status`, `imagegen_jobs_to_manifest`
- `visual_qa`
- `assemble_image_ppt`, `qa_pptx`
- `parse_paper_local`

CLI equivalents live under `node plugins/ppt-composer/src/cli.mjs`.
CLI job tools include `imagegen-jobs-create`, `imagegen-jobs-backfill`, `imagegen-jobs-status`, `imagegen-jobs-to-manifest`, `visual-qa`, and `asset-index-create`.

## Failure Conditions

Stop and report the blocker when:

- protocol is unconfirmed;
- a generated page is missing;
- a page output is not PNG;
- visual QA fails without manual override note;
- `strict_embed` evidence was altered;
- final PPTX QA does not show one picture per slide and zero text overlays.
