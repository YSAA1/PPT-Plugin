---
name: image-first-ppt
description: "Generate image-first PowerPoint decks. Hard workflow: intake brief/reference files, write a human-editable deck-protocol.json, wait for user confirmation on that protocol, then dispatch bounded subagents to directly generate final full-slide PNGs, then assemble a PPTX only from a complete PNG manifest. Use when Codex needs a PPTX where every slide is exactly one complete generated PNG image."
---

# Image-First PPT

Create a low-editability PPTX where each slide is exactly one finished full-slide PNG. This skill has hard gates. Do not skip gates. Do not create editable/native/hybrid decks. Do not create a background/base draft for later PPT text overlay. Do not treat prompts, prompt sheets, SVG, HTML, deterministic renderer output, protocol JSON, or placeholders as completed slides. A prompt sheet is not a completed deck.

`deck-protocol.json` is the single source of truth before image generation. It is a pretty-printed, human-editable, machine-readable planning file. Optional `deck-protocol.review.md` may be created for readability, but it is not authoritative.

## Non-Negotiable Outcome

The final PPTX must contain exactly one full-slide PNG image per slide.

Hard constraints:
- Every slide's title, claim, labels, diagrams, and visible text must be inside the generated PNG.
- No later PPT text overlay is allowed.
- No editable/native/hybrid route is allowed.
- No "generate a background then add PowerPoint text" route is allowed.
- Every generated page is a finished full-slide image, not a blank background, not a base draft.
- No placeholder, SVG, HTML, prompt sheet, or prompt-only artifact can count as a generated slide.
- No HTML/CSS/canvas/headless Chrome screenshot or deterministic local renderer output can replace image generation unless the user explicitly changes the task away from Codex image generation.
- The deck cannot be assembled until every planned page has a real `.png` file.

## Hard Workflow Gates

### Gate 1: Clarification Gate

Before planning, ask the user for any missing deck requirements. Ask concise questions, but do not proceed to image generation yet.

Required fields:
- language
- deck type, such as academic report, product pitch, class presentation, business proposal, paper summary, or teaching deck
- target audience
- page-count range or exact page count
- visual style
- aspect ratio, defaulting to 16:9 only if the user does not care
- output directory and final PPTX filename
- optional reference file paths or uploaded files
- any required wording, logo, color, or exclusion constraints

If no uploaded file or explicit reference path exists:
- Do not scan or analyze the current project.
- Continue only from the user brief and clarifying answers.

If reference paths exist:
- Run reference intake before visual planning.
- Read only PPT-relevant information: topic, key claims, structure, constraints, visual references, required wording, and exclusions.
- Do not do unrelated long analysis.

### Gate 2: Reference Intake And Protocol Gate

Create `deck-protocol.json` before any image generation.

Protocol modes:
- `brief_mode`: no reference file exists; the protocol is built from user brief and clarifying answers.
- `reference_grounded_mode`: one or more reference files exist; page content must bind to extracted evidence unless a page explicitly sets `free_generation: true`.

Reference intake rules:
- PDF: prefer MinerU Precision when available; capture Markdown, `image_paths`, figures, tables, formulas, and relevant structure.
- Markdown: parse directly; extract headings, body text, Markdown tables, and linked/local images. Do not send Markdown through MinerU.
- DOCX: parse OOXML directly; extract body text, `word/media/*` images, and tables. Legacy `.doc` should use MinerU or fail clearly.
- TXT: extract title-like lines, paragraphs, constraints, and keywords. Do not expect images.
- Images: register as `source_images`, `template_images`, or `logos` according to user/agent labeling.
- CSV/table text: convert to structured table data and render a table PNG reference.

Protocol asset model:
- `template_images`: style templates or reference layout images.
- `logos`: school, company, project, or sponsor marks.
- `source_images`: images extracted from references or directly supplied by the user.
- `source_tables`: structured tables plus table PNG previews and key-value summaries.
- `text_evidence`: summaries, claims, original snippets, constraints, or required wording.

Every page in `deck-protocol.json` must include:
- `title`
- `claim`
- `content_inputs`
- `reference_asset_ids`
- `final_image_prompt`
- `negative_prompt`
- `fidelity`: `free`, `light_redraw`, or `strict_embed`
- `output_png`

Protocol file skeleton:

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

### Gate 3: Protocol Confirmation Gate

Before creating any image, present the protocol summary and wait for explicit user confirmation. If useful, create `deck-protocol.review.md` for reading, but keep `deck-protocol.json` as the source of truth.

The planning package must include:
- final deck title
- page count and aspect ratio
- global visual specification
- full page-by-page outline
- per-page title and single main claim
- per-page evidence bindings or `free_generation: true`
- per-page fidelity mode
- per-page final image prompt
- per-page negative prompt
- planned PNG output filename for every page

After presenting the planning package, ask the user to confirm or revise. Do not call image generation, `$imagegen`, `spawn_agent`, MCP assembly, or the PPT assembler until the user clearly confirms `deck-protocol.json`.

Acceptable confirmation examples:
- "确认"
- "可以生成"
- "按这个来"
- "生成"
- "go"

If the user asks for changes, revise the planning package and ask for confirmation again.

### Gate 4: Codex Native Image Gate

Only after Gate 3 confirmation, dispatch Codex native subagents for image generation. Treat the user's protocol confirmation as authorization to use bounded image-generation subagents for the confirmed pages; do not reinterpret confirmation as permission to use a non-imagegen fallback.

Codex built-in image generation is the primary path:
- Use the installed `imagegen` skill / `$imagegen` / built-in `image_gen` tool first.
- Do not check `OPENAI_API_KEY` before trying built-in Codex image generation. A missing `OPENAI_API_KEY` does not mean built-in `image_gen` is unavailable.
- `OPENAI_API_KEY` only matters for the optional OpenAI API provider or a CLI/API fallback explicitly chosen by the user.
- `generate-assets --provider codex` is only a blocking prompt-sheet handoff for `$imagegen`; it does not generate images by itself and cannot be counted as completion.
- `generate-assets --provider openai` is an API-backed fallback, not the default Codex-native path.
- Do not switch to HTML/CSS/canvas/headless Chrome screenshots, local browser rendering, SVG generation, or other deterministic rendering to make PNG files.
- If subagents cannot access image generation, the leader must generate the pages directly with built-in Codex image generation or stop and report the runtime limitation. Do not silently change generation method.

Leader must split work as follows:
- 1-6 pages: at most one subagent per page.
- 7+ pages: at most 6 subagents, each assigned a consecutive page range.
- Each page still requires an independent PNG file.

Subagent runtime and model rules:
- Image generation is slow. Default budget is 2 minutes per image unless the user gives a different budget.
- Estimate each subagent's runtime as `assigned_page_count * per_image_budget`.
- The estimated runtime for a subagent must not exceed that subagent's maximum wait time.
- Add a practical buffer when waiting for image workers. If the expected image time is 2 minutes, wait at least 3 minutes for a one-page worker; for multi-page workers, wait at least `assigned_page_count * 2 minutes + 1 minute`.
- If a page range would exceed the maximum wait time, split the range into smaller subagent tasks.
- Prefer more parallel one-page workers over long sequential multi-page workers when the deck has 1-6 pages.
- For 7+ pages, keep at most 6 concurrent subagents, but size each consecutive range so the range fits inside the wait budget.
- Image-generation subagents should use low or medium reasoning effort. Do not use high or xhigh reasoning for image workers unless the user explicitly asks, because the worker is executing a fixed prompt, not planning the deck.
- The leader may use stronger reasoning for planning, but worker prompts must stay narrow and execution-focused.

Every subagent task must be a hard-bounded image-generation task. Subagent input is the assigned page protocol slice plus reference assets; subagent output is PNG.

Required subagent input template:

```text
You are an image-generation worker for image-first PPT.

Scope:
- Generate only the assigned page(s).
- Do not redesign the deck.
- Do not change the outline.
- Do not edit prompts for other pages.
- Do not create PPTX, SVG, HTML, markdown, placeholder art, or prompt-only artifacts.
- Use low or medium reasoning only; focus on direct image generation, not analysis.

For each assigned page:
- Page: <page-number>
- Size: <width>x<height>, 16:9 unless specified otherwise
- Output PNG path: <absolute-or-workspace-relative-path>.png
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
1. Inspect/use the assigned reference images and table PNGs when present.
2. Directly call Codex built-in image generation via the installed `imagegen` skill, `$imagegen`, or `image_gen` for each assigned page.
3. Save or return the real generated PNG artifact for each page.
4. Stay within the assigned page budget; if generation is still running, keep working until the wait budget is reached.
5. Return only:
   - page number
   - generated PNG path
   - status: generated or failed
   - one-line failure reason if failed

Failure conditions:
- Returning only a prompt is failure.
- Returning SVG/HTML/placeholder is failure.
- Returning an HTML/CSS/canvas/headless Chrome screenshot or local deterministic renderer PNG is failure.
- Returning a background-only image is failure.
- Suggesting later PPT text overlay is failure.
- Treating missing `OPENAI_API_KEY` as proof that Codex built-in image generation is unavailable is failure.
- In `strict_embed`, changing numbers, curves, table headers, logos, or figure captions is failure.
```

Leader must not treat a subagent response as successful unless it includes a real generated PNG path for each assigned page.

If any subagent fails or returns prompt-only output:
- Retry or generate that page directly with image generation.
- Do not assemble the PPTX with placeholders.
- If built-in Codex image generation and any user-approved fallback are unavailable, stop and report that the deck cannot be completed because final PNGs were not generated.

Fidelity policy:
- `free`: use only approved brief/style; no evidence lock.
- `light_redraw`: default for reference-grounded pages; unify style and layout but preserve facts, trends, key numbers, labels, and source meaning.
- `strict_embed`: embed or closely preserve the referenced figure/table/logo as a visual evidence block. Do not fabricate or redraw measured data.

### Gate 5: PNG Manifest Gate

Create a PNG manifest only after image generation succeeds for every page.

Manifest shape:

```json
{
  "kind": "image-first-ppt-png-manifest",
  "items": [
    { "page": 1, "status": "generated", "path": "output/slide-01.png" }
  ]
}
```

Manifest requirements:
- One item per planned slide.
- Every item must have `status: "generated"`.
- Every item must point to a real `.png` file.
- Missing files, prompt sheets, SVG, HTML, screenshots of prompts, or placeholder images are failures.
- The PNG manifest is the only assembly gate.
- PNG manifest is the gate for assembly; do not assemble the PPTX before this complete manifest exists.

### Gate 6: Assembly Gate

Assemble the PPTX only after the PNG manifest is complete.

Use the internal runtime:

```bash
node plugins/ppt-composer/src/cli.mjs assemble-image-ppt \
  --manifest <png-manifest.json> \
  --out <deck.pptx> \
  --spec-out <image-first.spec.json>
```

Equivalent MCP tool: `assemble_image_ppt`.

The assembled deck must have one full-slide PNG per slide. Do not add PPT text boxes, shapes, charts, native tables, or overlays.

## MCP Tool Boundary

Keep MCP as the internal tool layer. The public plugin entry is this one skill, but parsing and assembly can use the plugin MCP/runtime tools when available.

- For explicit PDF/image reference paths, use `mineru-open-mcp` or `ppt-render-mcp`/`parse_paper_local` to extract only PPT-relevant content.
- When using MinerU for PDF, Office, or image references, prefer the Precision API path when `MINERU_API_TOKEN` is available. Use `model_version: "vlm"` by default, set `enable_formula: true` when formulas matter, set `enable_table: true` when tables matter, set `language` when known, and use `page_ranges` when the user only needs part of the file.
- When MinerU returns extracted figures, use returned `image_paths` as reference assets during planning. The plugin's MinerU launcher saves SDK `result.images` under `<output_dir>/<stem>/images/`; do not assume Markdown-only output when `image_paths` are present.
- If `MINERU_API_TOKEN` is missing, explain that Precision parsing is unavailable and either use the lower-capability agent/flash parser or ask the user to provide the token through their private environment. Never ask the user to paste the token into the deck prompt.
- For Markdown or parse bundles, `ppt-render-mcp` may help prepare planning material, but MCP prompt sheets are not final output.
- Internal protocol helpers include `reference_intake`, `validate_deck_protocol`, and `visual_plan` with `protocolPath`.
- `visual_plan` and `generate_assets` may create prompt sheets or API-backed assets, but they do not override Gate 4. Codex-native image-first execution still requires real generated PNGs from `$imagegen` / `image_gen` unless the user explicitly selects the OpenAI API provider.
- For final assembly, use `assemble_image_ppt` or the equivalent CLI command.
- Do not use MCP to scan the current project when the user did not upload a file or provide a reference path.
- Do not expose parser/render/QA helper tools as separate public skills; they are implementation tools under this image-first workflow.

## Per-Page Prompt Contract

Every per-page prompt must explicitly describe a finished full-slide image:

```text
Asset type: finished full-slide 16:9 PowerPoint page image
Primary request: create one complete final slide image, including title, main claim, sparse labels, visual hierarchy, and all visible text inside the image.
Style lock: <global visual specification>
Layout: full-bleed slide composition, presentation-ready, no external overlays needed.
Text policy: no later PPT text overlay; all text that belongs on the slide must be rendered inside this PNG.
Content: <page-specific content and visual metaphor/data/diagram>
Output: PNG file at <page-output-path>
```

Every negative prompt must forbid:
- separate PPT text overlay
- background-only or base-draft art
- blank template
- placeholder art
- SVG
- HTML
- vector stand-ins
- prompt sheet
- fake data not requested by the user
- watermark
- illegible tiny text
- unrelated decorative filler

## Leader Checklist

Before final response, verify:
- `deck-protocol.json` existed and was confirmed before image generation.
- Subagent tasks received only assigned page protocol slices, reference assets, prompts, and output paths.
- Every subagent directly generated PNGs.
- The PNG manifest has one generated `.png` per slide.
- The PPTX was assembled only after manifest completion.
- No placeholder, SVG, HTML, prompt sheet, or background-only image was used.
