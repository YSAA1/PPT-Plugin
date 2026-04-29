---
name: image-first-ppt
description: "Generate image-first PowerPoint decks. Hard workflow: intake brief/reference files, write a human-editable deck-protocol.json, wait for user confirmation on that protocol, then dispatch bounded subagents to directly generate final full-slide PNGs, then assemble a PPTX only from a complete PNG manifest. Use when Codex needs a PPTX where every slide is exactly one complete generated PNG image."
---

# Image-First PPT

Create a low-editability PPTX where every slide is exactly one finished full-slide PNG. Do not create editable/native/hybrid decks, prompt-only deliverables, SVG placeholders, HTML screenshots, or a background/base draft for later PPT text overlay.

## Progressive Loading

Load only the reference file needed for the current stage:

- Protocol drafting, fidelity modes, speaker notes, patch rules, or existing-PPT preservation boundaries: read [references/protocol.md](references/protocol.md).
- Image generation, subagent splitting, `style_lock`, spawn rules, and worker prompts: read [references/image-generation-workers.md](references/image-generation-workers.md).
- Job states, PNG manifest, deterministic QA, visual review rubric, and review prompt: read [references/manifest-visual-qa.md](references/manifest-visual-qa.md).
- MCP/CLI tool names and terminal failure conditions: read [references/tools-and-failures.md](references/tools-and-failures.md).

Do not rely on this entry file as the only source when implementing a stage covered by a reference.

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

1. Requirement Gate: before creating `deck-protocol.json`, all required fields below MUST be known or explicitly marked "user does not care"; if any required field is missing, ask only for the missing fields and STOP.
2. Reference Asset Gate: if reference files exist, first parse PDF/Office/image documents with `mineru-open-mcp.parse_documents` when they need OCR or document extraction, saving Markdown plus `image_paths` under the work directory. Full MinerU token mode returns extracted figures; Flash mode MUST still return local image assets for PDFs/images when possible through page-image/input-image fallback. Then run `reference_intake` / CLI `reference-intake` on the produced Markdown/images (or `pptx_reference_intake` for PPTX references) before drafting or confirming the protocol. The resulting `reference-assets/asset-index.json` and localized protocol `assets` are mandatory. If there are no references, record brief-only mode explicitly.
3. Create or update `deck-protocol.json` from the intake output. Read [references/protocol.md](references/protocol.md).
4. Validate `deck-protocol.json`. In reference-grounded mode, `assets: []` or pages that never bind localized assets are blockers, not acceptable review drafts.
5. Patch revisions only through protocol patch tools. If patch tools are unavailable, record the reason, edit the protocol directly, and immediately rerun `validate-deck-protocol`.
6. Generate `deck-protocol.review.md` with `protocol_review` / CLI `protocol-review`, then present that review artifact plus a short protocol summary and wait for explicit protocol confirmation. This is the Protocol Confirmation Gate.
7. After confirmation, create `imagegen-jobs.json`, count confirmed pages, and use `jobs.worker_dispatch.assignments` as the worker plan. For 7+ confirmed pages, automatic bounded subagent dispatch is REQUIRED before direct generation fallback. Read [references/image-generation-workers.md](references/image-generation-workers.md).
8. Track page status in `imagegen-jobs.json`.
9. Run deterministic `visual-qa` to check whether the generated PNG files are structurally assembleable. Read [references/manifest-visual-qa.md](references/manifest-visual-qa.md).
10. Run the internal visual review loop only when the user explicitly asks for visual QA, strict review, consistency checking, or protocol-execution checking.
11. Create `png-manifest.json` only from complete accepted/generated jobs. If visual review is enabled, every page MUST be `accepted`.
12. Assemble with `assemble-image-ppt` / MCP `assemble_image_ppt`.
13. Run final `qa_pptx`.

Hard stop conditions:

- If protocol is not confirmed, STOP before image generation.
- If references exist but `assets` is empty, `reference-assets/asset-index.json` is missing, or no page binds extracted assets, STOP before confirmation.
- If `deck-protocol.review.md` is missing, STOP before asking for protocol confirmation.
- If 7+ confirmed pages exist and no worker dispatch/spawn attempt has been made, STOP before direct generation.
- If any page lacks a real PNG, STOP before manifest creation.
- If `visual-qa` status is `fail`, STOP before assembly. Manual override is allowed only for overrideable review findings, never for missing/non-PNG/placeholder/tiny/strict_embed fidelity failures.
- If final PPTX QA does not show one picture per slide and zero text overlays, STOP and report failure.

## Requirement Gate

Collect these before drafting a protocol. Ask only for missing items. Do not infer hard constraints such as logo, required wording, page count, or strict evidence from unrelated files.

- Required: language.
- Required: deck type, such as academic report, product pitch, class presentation, business proposal, paper summary, or teaching deck.
- Required: target audience.
- Required: page-count range or exact page count.
- Required: visual style.
- Required: aspect ratio; use 16:9 only when the user says they do not care.
- Required: output directory and final PPTX filename.
- Required: reference file paths/uploaded files OR an explicit "no references, generate from brief only" confirmation.
- Required: required wording, logo, color, data, citation, and exclusion constraints OR explicit "none".

Go condition: every required item is known or explicitly waived.
Stop condition: any required item is unknown. Do not create `deck-protocol.json`.
Protocol confirmation condition: only an explicit approval such as "确认协议", "按此 protocol 生成", "开始生图", or equivalent clear approval authorizes image generation. Ambiguous replies such as "继续", "ok", or "不错" do not authorize image generation unless they clearly refer to the protocol summary.

If no uploaded file or explicit reference path exists, MUST NOT scan the current project. Continue from the user brief.

## Stage Notes

- Protocol content truth lives in `deck-protocol.json`, not in `imagegen-jobs.json`.
- Existing-PPT hard-preservation requests are a different product lane; read [references/protocol.md](references/protocol.md) before responding.
- Codex built-in image generation is the primary image path; missing `OPENAI_API_KEY` is not evidence that built-in `image_gen` is unavailable.
- `generate-assets --provider codex` is only a prompt-sheet handoff, not image generation.
- `style_lock` in `imagegen-jobs.json` is the canonical visual consistency contract across workers.
- `deck-protocol.review.md` is the human review version; chat summary alone is not enough for protocol confirmation.
- `imagegen-jobs.json.worker_dispatch` is the canonical subagent dispatch plan for 7+ page decks.
- Generated protocols add `speaker_notes` by default. Notes are presenter talk tracks customized to the audience, not one-sentence labels and not visible slide text.
- A consistent page-number/footer policy and a visible-metadata ban are part of the visual contract. Do not let only some generated pages show page numbers, and never render asset ids, filenames, paths, `source:` labels, or parser/protocol metadata inside slide images.
- 7+ confirmed pages do not require separate subagent wording from the user; protocol confirmation is enough authorization for bounded image workers.
- Default subagent strategy is a lightweight context packet. Default subagent reasoning is `low`; escalate to `medium` only for complex evidence/fidelity pages. Forked context is optional and must not be combined with reasoning effort.
- Visual review is explicit opt-in. Deterministic `visual-qa` still runs before assembly.

## Internal Tools

Prefer MCP as the internal tool layer when available. Keep MCP as the internal tool layer, not a separate public skill surface. Read [references/tools-and-failures.md](references/tools-and-failures.md) for the complete tool list and failure conditions.
