# Manifest And Visual QA Reference

## Contents

- PNG manifest gate
- Manifest requirements
- Backfill rules
- Deterministic QA
- Visual QA activation
- Page states
- Five-dimension review rubric
- Visual review prompt template

## Manifest And QA

`imagegen-jobs.json` stores execution state only. MUST NOT move content truth out of `deck-protocol.json`.

PNG manifest is the gate for assembly.

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

Visual QA activation:

- Default: do not enable manual visual review. Deterministic `visual-qa` still checks PNG existence, format, dimensions, placeholder markers, and `strict_embed` reference binding.
- Enable visual review only when the user asks for visual QA, strict review, consistency checking, or protocol-execution checking.
- Once visual review is enabled, set `visualReview.enabled=true`; generated pages MUST NOT go directly to manifest.
- When visual review is enabled, `png-manifest.json` MUST wait until every page status is `accepted`.
- Without visual review, `png-manifest.json` may use `generated` or `accepted` jobs after deterministic QA passes.
- Manual override may only bypass overrideable review findings. It MUST NOT bypass missing PNG, non-PNG, placeholder PNG, tiny PNG, missing `strict_embed` references, or `strict_embed` `reference_fidelity=fail`.

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
- `reference_fidelity`: preserves assigned source figures, tables, values, curves, headers, logos, and captions, especially for `strict_embed`.
- `text_legibility`: keeps all rendered slide text readable at presentation scale.
- `artifact_quality`: avoids obvious generated-image defects such as broken layout, warped tables/logos, blank regions, watermarks, or background-only output.

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
3. reference_fidelity: Are referenced figures, tables, numbers, curves, headers, logos, and captions preserved?
4. text_legibility: Is all visible slide text readable at presentation scale?
5. artifact_quality: Are there obvious generated-image defects, broken layout, warped tables/logos, blank regions, watermarks, or background-only output?

Return one compact JSON object:
{
  "pages": [
    {
      "page": 1,
      "verdict": "pass|warn|fail",
      "consistency": "pass|warn|fail",
      "protocol_alignment": "pass|warn|fail",
      "reference_fidelity": "pass|warn|fail",
      "text_legibility": "pass|warn|fail",
      "artifact_quality": "pass|warn|fail",
      "note": "short concrete reason",
      "revision_suggestion": "only when warn/fail; describe the protocol/prompt/layout change needed"
    }
  ]
}

Verdict rules:
- `pass`: consistent, protocol-aligned, and no material image defects.
- `warn`: usable but has minor consistency/protocol/image-quality issues worth recording.
- `fail`: must be regenerated because it drifts from protocol, breaks deck consistency, or has material image defects.
- `fail` requires one specific reason and one revision suggestion.
- In `strict_embed`, changed numbers, curves, table headers, logos, or captions are `reference_fidelity=fail` and block assembly.
```
