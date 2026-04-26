# Slide Spec v0

Slide spec is the shared interchange format for `slide-plan`, `ppt-render`, and optional QA. It is intentionally independent from paper parsing, image generation, or any single workflow.

## Top-level shape

```json
{
  "version": "0.1",
  "deck": {
    "title": "Deck title",
    "audience": "research lab meeting",
    "language": "en",
    "format": "16:9",
    "editability": "native-first",
    "visualPolicy": "native-only"
  },
  "theme": {
    "template": "academic-clean",
    "palette": ["#111827", "#2563EB", "#F8FAFC"],
    "fonts": {
      "heading": "Aptos Display",
      "body": "Aptos"
    }
  },
  "assets": [
    {
      "id": "fig1",
      "type": "image",
      "path": "artifacts/figures/fig1.png",
      "source": "paper_extract",
      "caption": "Original paper figure"
    },
    {
      "id": "hero1",
      "type": "image",
      "usage": "hero",
      "path": "artifacts/generated/hero1.png",
      "source": "generated",
      "provider": "codex",
      "status": "prompt-only",
      "prompt": "Clean consulting-style hero visual without embedded body text",
      "editableTextPolicy": "supporting-only"
    }
  ],
  "slides": [
    {
      "id": "s1",
      "layout": "title",
      "title": "Main claim",
      "objects": [
        {
          "type": "text",
          "role": "headline",
          "text": "The core result in one sentence"
        }
      ],
      "notes": "Speaker notes or citation reminders."
    }
  ]
}
```

## Object types

- `text`: native text box. Use for titles, bullets, labels, callouts, and speaker-visible content.
- `table`: native PowerPoint table. Use structured rows and columns instead of screenshots when possible.
- `chart`: native chart object when the source data is available.
- `shape`: native line, arrow, box, connector, or emphasis marker.
- `image`: linked or embedded bitmap asset. Use for extracted paper figures, generated illustrations, background art, and image-only decks.
- `formula`: LaTeX string plus optional rendered image path. Prefer editable source retention even when the first renderer uses SVG/PNG.

## Editability levels

- `native-first`: core information is native text/table/chart/shape. Images do not carry primary text.
- `mixed`: some content is native, but key visual panels may be raster images.
- `image-first`: slides are mostly images or generated composites. This is useful for fast visual drafts but should be reported as low-editability.

## Visual policies

- `native-only`: default. Core slides stay editable and generated images are ignored on content slides. Use paper extracts and user-provided figures only.
- `image-first`: every slide is a finished full-slide raster visual. This is low-editability by design and should be produced through `visual-plan -> generate-assets -> generate-image-deck`. The default generated path is `codex` `$imagegen` prompts that must be run and backfilled, or `openai` API-backed PNGs; `placeholder` is only for smoke tests. Prompt sheets and `manual_required` manifest entries are incomplete handoff artifacts, not finished image-first decks. Do not split this into a generated base image plus native PPT text overlays unless the deck is explicitly `hybrid` or `mixed`.
- `hybrid`: generated images are allowed only on cover, section-divider, or explicitly image-first slides. Do not use hybrid as the default for research content pages.

## Template presets

Current template names expected by the renderer/docs:

- `academic-clean`: default research deck template.
- `consulting-research`: richer native consulting/research layout family for high-end editable decks.
- `image-gallery`: image-first or image-heavy decks from existing visuals.
- `infographic-immersive`: dark, image-first infographic decks with native labels/callouts.

## Asset planning fields (optional)

When a slide spec is enhanced with an asset-planning pass, asset entries may include:

- `usage`: intended role such as `full-slide`, `paper_extract`, `hero`, `background`, `panel`, or `icon-strip`.
- `provider`: `codex`, `openai`, explicit `placeholder`, `paper_extract`, or `user`.
- `status`: `planned`, `prompt-only`, `generated`, `provided`, or `missing`.
- `prompt`: the generation prompt or prompt summary.
- `editableTextPolicy`: `supporting-only` for hybrid section visuals; `image-first` only for explicitly image-first flows.
- `variants`: optional list of alternate asset candidates.

These fields are optional metadata. The renderer should ignore what it does not need, while planning/generation/QA steps can use them for coordination.

## Slide-level enhancement hints (optional)

Enhancement passes may add lightweight metadata such as:

- `visualBrief`: short description of the intended supporting visual.
- `templateVariant`: preferred layout family within the selected theme/template.
- `assetRefs`: ordered asset ids that the slide expects.

These fields help `visual-plan`, `generate-assets`, `generate-image-deck`, `enhance-spec`, and image-first infographic workflows coordinate without forcing any one pipeline.

## Visual plan fields

`visual-plan` produces a `kind: "ppt-visual-plan"` JSON document. Its `pages[]` entries include:

- `slideId`: matching source slide id.
- `claim`: one-sentence slide claim.
- `sourceEvidence`: source snippets or figure/table references the prompt must respect.
- `layoutIntent`: intended full-slide composition.
- `prompt`: full `$imagegen`/API-ready prompt body.
- `negativePrompt`: things the generated slide must avoid.
- `textPolicy`: guidance for sparse, readable in-image text.
- `acceptanceChecks`: QA expectations for the generated full-slide image.

## Deck protocol fields

`deck-protocol.json` is the image-first workflow's source of truth before image generation. It is not a renderer format; it is a confirmed planning and evidence-binding protocol that can later be converted into a visual plan.

Top-level fields:

- `kind`: must be `ppt-composer-deck-protocol`.
- `version`: currently `0.1`.
- `mode`: `brief_mode` or `reference_grounded_mode`.
- `deck`: title, language, audience, `page_count`, and `aspect_ratio`.
- `style`: global style description, template image ids, logo ids, palette, and typography notes.
- `assets`: reference assets extracted from inputs.
- `pages`: page-level protocol entries.

Asset types:

- `template_image`: style template or reference layout image.
- `logo`: identity mark that must not be fabricated or redrawn loosely.
- `source_image`: figure/photo/diagram supplied by the user or extracted from a reference.
- `source_table`: structured table plus a table PNG preview and key-value summary.
- `text_evidence`: source claim, excerpt, summary, required wording, or constraint.

Every page entry must include:

- `title`
- `claim`
- `content_inputs`: `{ text: [], tables: [], images: [] }` asset-id lists.
- `reference_asset_ids`: assets that should be used visually.
- `final_image_prompt`
- `negative_prompt`
- `fidelity`: `free`, `light_redraw`, or `strict_embed`.
- `output_png`

`reference_grounded_mode` pages must bind to evidence via `content_inputs` / `reference_asset_ids`, unless the page explicitly sets `free_generation: true`.

`visual-plan --protocol <deck-protocol.json>` preserves each page's protocol slice in downstream asset requests. Image workers should receive only their assigned page slice, not the full deck plan.

## Renderer defaults

The default renderer target is PptxGenJS. The renderer should accept slide spec generated from any source: paper parsing, user outlines, manual JSON, generated assets, or existing project notes.
