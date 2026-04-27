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
6. After confirmation, generate final full-slide PNGs directly with Codex image generation. Treat confirmation as authorization to use bounded image-generation subagents for the confirmed pages only when parallelism is worth the local startup cost.
   - In Codex App/plain Codex sessions, subagents may initialize the same plugin MCP servers as the leader. Do not spawn many image workers if that would multiply `ppt-render-mcp`, `mineru-open-mcp`, `uvx`, or Python startup.
   - For multi-page decks, prefer the leader or a small bounded worker batch when local MCP startup is expensive. Record the reason when choosing direct generation over subagents.
   - The leader MUST NOT silently ignore failed subagent spawning; if fallback is used, record whether it was due to runtime rejection, MCP startup cost, or imagegen failure.
7. Track page status in `imagegen-jobs.json`.
8. Run deterministic `visual-qa` to check whether the generated PNG files are structurally assembleable.
9. Run the internal visual review loop for each page when image quality is in scope:
   - Review only these dimensions: deck-level visual consistency, protocol/page-prompt alignment, and basic generated-image defects.
   - Record `pass`, `warn`, or `fail` through `imagegen-jobs-review`; `warn` is accepted with a warning, `fail` blocks assembly.
   - For failed pages, patch `deck-protocol.json` first when the prompt, negative prompt, layout intent, or fidelity binding must change, then run `imagegen-jobs-revise`, regenerate only that page, and backfill the new PNG.
   - Default automatic retry budget is 2 regeneration attempts per failed page. If still failing, stop and report the exact page, reason, and suggested protocol change.
10. Create `png-manifest.json` only from complete accepted/generated jobs. If visual review is enabled, every page MUST be `accepted`.
11. Assemble with `assemble-image-ppt` / MCP `assemble_image_ppt`.
12. Run final `qa_pptx`.

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

## Image Generation

Primary path: Codex built-in image generation via the installed `imagegen` skill, `$imagegen`, or `image_gen`.

- MUST NOT check `OPENAI_API_KEY` before trying Codex built-in image generation.
- Missing `OPENAI_API_KEY` MUST NOT be treated as evidence that built-in `image_gen` is unavailable.
- A missing `OPENAI_API_KEY` does not mean built-in `image_gen` is unavailable.
- `generate-assets --provider codex` is only a prompt-sheet handoff, not image generation.
- `generate-assets --provider openai` is an explicit API fallback.
- If imagegen workers fail or return prompt-only output, retry or generate directly. MUST NOT assemble placeholders.

Leader must split work as follows:

- 1 page: the leader may generate directly.
- 2-6 pages: use the leader directly or at most 2 concurrent subagents unless the user explicitly prioritizes speed over local resource use.
- 7+ pages: use at most 6 concurrent subagents by default; use fewer when local MCP/startup load is already high.
- Each page still requires an independent PNG file.

Subagent runtime and model rules:

- Image generation is slow. Default budget is 2 minutes per image unless the user gives a different budget.
- Estimate each subagent's runtime as `assigned_page_count * per_image_budget`.
- Add a practical buffer when waiting for image workers. If the expected image time is 2 minutes, wait at least 3 minutes for a one-page worker; for multi-page workers, wait at least `assigned_page_count * 2 minutes + 1 minute`.
- If a page range would exceed the maximum wait time, split the range into smaller subagent tasks.
- Prefer more parallel one-page workers over long sequential multi-page workers when the deck has 2-6 pages.
- For 7+ pages, keep at most 6 concurrent subagents, but size each consecutive range so the range fits inside the wait budget.
- Image workers SHOULD use low reasoning when the spawn API shape allows it. The worker is executing a fixed image prompt, not planning the deck.
- When `fork_context: true` is used, DO NOT set `reasoning_effort`; the current runtime can reject full-history fork calls that also set reasoning effort.
- The leader may use stronger reasoning for planning, but worker prompts MUST stay narrow and execution-focused.

Shared context rules:

- Before spawning workers, the leader MUST create one shared deck generation context from the confirmed protocol: deck title, audience, aspect ratio, global style, palette, typography, logo/template asset ids, page list, global negative rules, QA acceptance rules, and asset index.
- `imagegen-jobs.json` MUST contain a `style_lock` object. Treat that object as the canonical shared visual contract for all image-generation and visual-review workers.
- Every worker MUST receive the exact same `style_lock` plus only its assigned page protocol slice and relevant reference asset paths.
- MUST NOT rely on inherited chat history as the only consistency mechanism.
- Forked chat history is supplemental only. If fork history fails, is unavailable, or differs between workers, consistency MUST still come from the explicit `style_lock`.
- A worker prompt that does not include the `style_lock` is invalid, even if `fork_context: true` was used.
- Every subagent task MUST be a hard-bounded image-generation task. Subagent output is PNG.

Spawn call rules:

- MUST NOT call `spawn_agent` with `fork_context: true` when also setting `agent_type` / role.
- Preferred consistency-first shape is: omit `agent_type`, set `fork_context: true`, omit `reasoning_effort`, and still include the shared deck generation context in the worker prompt.
- If role-less forked spawn fails, or if a role/reasoning override is required by the runtime, MUST omit `fork_context`; write the shared deck generation context and complete task context into `message` or `items`.
- Context-packet fallback shape is: set `fork_context: false` or omit it, set `reasoning_effort: "low"`, and put the shared deck generation context plus assigned page context in the worker prompt.
- The fallback prompt MUST include the same `style_lock` JSON used by forked workers. Do not shorten, paraphrase, or rebuild the style contract per worker.
- If subagent spawning is unavailable, blocked, or fails, the leader MAY fall back to direct generation, but MUST record the reason in `imagegen-jobs.json` notes or the final handoff. Silent fallback is FORBIDDEN.
- The leader MUST wait for subagent results or failure status before creating `png-manifest.json`.

Spawn call guardrail:

```text
Allowed:
spawn_agent({
  fork_context: true,
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Also allowed:
spawn_agent({
  reasoning_effort: "low",
  fork_context: false,
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Also allowed when a role is unavoidable:
spawn_agent({
  agent_type: "<role>",
  reasoning_effort: "low",
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Forbidden:
spawn_agent({
  agent_type: "<any role>",
  fork_context: true,
  ...
})

Also forbidden:
spawn_agent({
  fork_context: true,
  reasoning_effort: "low",
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
- Do not edit prompts for other pages.
- Do not create PPTX, SVG, HTML, markdown, placeholder art, or prompt-only artifacts.
- Follow the shared deck generation context exactly so pages are visually consistent with other workers.
- Treat `speaker_notes` as presenter-only notes; do not render them as visible slide text.
- Use low reasoning only; focus on direct image generation, not analysis.

Shared deck generation context:
- Style lock:
  <verbatim jobs.style_lock JSON; required even when fork_context worked>
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
- Speaker notes: <speaker_notes; presenter-only, not visible text>
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
2. Directly call Codex built-in image generation via the installed `imagegen` skill, `$imagegen`, or `image_gen` for each assigned page.
3. Save or return the real generated PNG artifact for each page.
4. Stay within the assigned page budget; if generation is still running, keep working until the wait budget is reached.
5. Return only:
   - page number
   - generated PNG path
   - status: generated or failed
   - one-line failure reason if failed.

Failure conditions:
- Returning only a prompt is failure.
- Returning SVG/HTML/placeholder is failure.
- Returning an HTML/CSS/canvas/headless Chrome screenshot or local deterministic renderer PNG is failure.
- Returning a background-only image is failure.
- Suggesting later PPT text overlay is failure.
- Treating missing `OPENAI_API_KEY` as proof that Codex built-in image generation is unavailable is failure.
- In `strict_embed`, changing numbers, curves, table headers, logos, or figure captions is failure.
```

Leader MUST NOT treat a subagent response as successful unless it includes a real generated PNG path for each assigned page.

## Manifest And QA

`imagegen-jobs.json` stores execution state only. MUST NOT move content truth out of `deck-protocol.json`.

Create `png-manifest.json` only after all pages are `generated` or `accepted`. When visual review has been enabled for the job file, create the manifest only after every page is `accepted`:

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
- every item has `status: "generated"` in the manifest, with the source job status recorded separately;
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

Visual review state is stored in `imagegen-jobs.json`, not in the protocol. The protocol remains the source of truth for page content, prompts, reference bindings, and fidelity.

Allowed page states include:

- `pending`: no usable PNG yet.
- `generated`: PNG is present and can pass the legacy non-review manifest gate.
- `needs_review`: PNG exists and is waiting for visual review.
- `accepted`: PNG passed visual review or was explicitly accepted.
- `rejected`: visual review failed and the page is blocked.
- `revision_requested`: a failed page is queued for regeneration after protocol patching.
- `superseded`: an old attempt kept for audit after a newer page PNG replaces it.
- `failed`: generation failed before producing a usable PNG.

Visual review dimensions:

- `consistency`: matches the confirmed deck style, typography, palette, and visual rhythm.
- `protocol_alignment`: follows the page claim, content inputs, reference bindings, final image prompt, negative prompt, and fidelity mode.
- `basic_image_quality`: avoids obvious generated-image defects such as unreadable text, broken layout, warped tables/logos, blank regions, watermarks, or background-only output.

Visual review agent rules:

- The leader owns deterministic QA, manifest gating, protocol patches, revision decisions, and final integration.
- For multi-page decks, prefer a bounded `vision` or reviewer subagent for visual review so it can inspect PNGs against the confirmed protocol without taking over orchestration.
- For a single page, or when subagents are unavailable, the leader may run the same review directly.
- The reviewer MUST NOT redesign the deck, edit the protocol, regenerate images, assemble PPTX, or make final release claims.
- The reviewer MUST return only per-page verdict data for the leader to record through `imagegen-jobs-review` / `imagegen-jobs-revise`.

Visual review prompt template:

```text
You are the visual review specialist for an image-first PPT deck.

Scope:
- Review only the assigned generated PNG page(s).
- Do not redesign the deck.
- Do not edit deck-protocol.json, imagegen-jobs.json, prompts, or PPTX files.
- Do not regenerate images.
- Compare each PNG against the confirmed protocol and the shared deck style.

Shared deck context:
- Deck title: <title>
- Audience: <audience>
- Aspect ratio: <aspect_ratio>
- Global style: <style.description>
- Palette: <style.palette>
- Typography: <style.typography>
- Full page list: <page numbers, titles, claims>

For each assigned page:
- Page: <page-number>
- PNG path: <current PNG path>
- Protocol page slice:
  <JSON for this page: title, claim, content_inputs, reference_asset_ids, fidelity, final_image_prompt, negative_prompt, output_png>
- Relevant reference assets:
  <asset ids, captions, paths, and required preservation notes>

Review dimensions:
1. consistency: Does this PNG match the confirmed deck visual system, typography, palette, density, and cross-page rhythm?
2. protocol_alignment: Does this PNG follow the page claim, required content, reference bindings, final_image_prompt, negative_prompt, and fidelity?
3. basic_image_quality: Are there obvious generated-image defects, unreadable text, broken layout, warped tables/logos, blank regions, watermarks, or background-only output?

Return one compact JSON object:
{
  "pages": [
    {
      "page": 1,
      "verdict": "pass|warn|fail",
      "consistency": "pass|warn|fail",
      "protocol_alignment": "pass|warn|fail",
      "basic_image_quality": "pass|warn|fail",
      "note": "short concrete reason",
      "revision_suggestion": "only when warn/fail; describe the protocol/prompt/layout change needed"
    }
  ]
}

Verdict rules:
- `pass`: consistent, protocol-aligned, and no material image defects.
- `warn`: usable but has minor consistency/protocol/image-quality issues worth recording.
- `fail`: must be regenerated because it drifts from protocol, breaks deck consistency, or has material image defects.
- In `strict_embed`, changed numbers, curves, table headers, logos, or captions are `fail`.
```

## Internal Tools

Prefer MCP as the internal tool layer when available. Keep MCP as the internal tool layer, not a separate public skill surface.

- `reference_intake`, `pptx_reference_intake`, `validate_deck_protocol`
- `protocol_patch`
- `asset_index_create`
- `visual_plan`, `generate_assets`
- `imagegen_jobs_create`, `imagegen_jobs_backfill`, `imagegen_jobs_review`, `imagegen_jobs_revise`, `imagegen_jobs_status`, `imagegen_jobs_to_manifest`
- `visual_qa`
- `assemble_image_ppt`, `qa_pptx`
- `parse_paper_local`

CLI equivalents live under `node plugins/ppt-composer/src/cli.mjs`.
CLI job tools include `imagegen-jobs-create`, `imagegen-jobs-backfill`, `imagegen-jobs-review`, `imagegen-jobs-revise`, `imagegen-jobs-status`, `imagegen-jobs-to-manifest`, `visual-qa`, and `asset-index-create`.

## Failure Conditions

Stop and report the blocker when:

- protocol is unconfirmed;
- a generated page is missing;
- a page output is not PNG;
- visual QA fails without manual override note;
- `strict_embed` evidence was altered;
- final PPTX QA does not show one picture per slide and zero text overlays.
