# Tools And Failure Conditions Reference

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

MinerU document parsing is optional. If `mineru-open-mcp` returns `setup_required: true`, treat only MinerU parsing as blocked: install `uv/uvx`, run `npm run prewarm:mineru` from the installed plugin root, restart Codex, and continue using `ppt-render-mcp` for manifest validation, PPTX assembly, and QA while parsing is unavailable.

## Failure Conditions

Stop and report the blocker when:

- protocol is unconfirmed;
- a generated page is missing;
- a page output is not PNG;
- visual QA has hard-blocker failures;
- visual QA has overrideable failures without a manual override note;
- `strict_embed` evidence was altered;
- final PPTX QA does not show one picture per slide and zero text overlays.

Manual override MUST NOT bypass missing PNG, non-PNG, placeholder PNG, tiny PNG, missing `strict_embed` references, or `strict_embed` `reference_fidelity=fail`.
