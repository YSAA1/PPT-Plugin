# Image Generation And Worker Reference

## Contents

- Primary image generation path
- Page splitting
- Subagent runtime and model rules
- Shared context rules
- Spawn call rules
- Worker prompt template
- Worker failure conditions

## Image Generation

Primary path: Codex built-in image generation via the installed `imagegen` skill, `$imagegen`, or `image_gen`.

- MUST NOT check `OPENAI_API_KEY` before trying Codex built-in image generation.
- Missing `OPENAI_API_KEY` MUST NOT be treated as evidence that built-in `image_gen` is unavailable.
- A missing `OPENAI_API_KEY` does not mean built-in `image_gen` is unavailable.
- `generate-assets --provider codex` is only a prompt-sheet handoff, not image generation.
- `generate-assets --provider openai` is an explicit API fallback.
- If imagegen workers fail or return prompt-only output, retry or generate directly. MUST NOT assemble placeholders.
- Protocol confirmation is the explicit user authorization to use bounded image-generation subagents for the confirmed pages. Do not ask for separate subagent permission, and do not wait for the user to say "subagent", "worker", or "parallel".
- In Codex App/plain Codex sessions, subagents may initialize the same plugin MCP servers as the leader. Do not spawn many image workers if that would multiply `ppt-render-mcp`, `mineru-open-mcp`, `uvx`, or Python startup.
- For 2-6 page decks, prefer the leader or a small bounded worker batch when local MCP startup is expensive. Record the reason when choosing direct generation over subagents.
- For 7+ page decks, parallelism is worth the local startup cost by default; reduce worker count only for a concrete spawn/runtime blocker.
- The leader MUST NOT silently ignore failed subagent spawning; if fallback is used, record whether it was due to runtime rejection, MCP startup cost, or imagegen failure.

Worker dispatch decision gate:

- Before generating any page, count the confirmed protocol pages.
- If there are 7+ confirmed pages and no spawn attempt has been made, STOP before direct generation and attempt worker dispatch first.
- 10 pages is not a leader-only deck; it is in the 7-12 page lane and MUST use the default worker split unless spawn is unavailable, blocked, or a concrete spawn attempt fails.

Leader must split work as follows:

- 1 page: the leader may generate directly.
- 2-6 pages: use the leader directly or at most 2 concurrent subagents unless the user explicitly prioritizes speed over local resource use.
- 7+ pages: MUST dispatch image-generation subagents unless spawn is unavailable, blocked, or a spawn attempt fails.
- 7-12 pages: use 5-6 concurrent workers by default; assign 1-2 consecutive pages per worker, for example 10 pages -> `2+2+2+2+1+1` or `2+2+2+2+2`.
- 13+ pages: use at most 6 concurrent workers; assign consecutive ranges that fit the wait budget.
- Local MCP/startup load may reduce worker count but MUST NOT reduce it to zero for 7+ pages unless spawn is unavailable, blocked, or a spawn attempt fails.
- Each page still requires an independent PNG file.

Subagent runtime and model rules:

- Image generation is slow. Default budget is 2 minutes per image unless the user gives a different budget.
- Estimate each subagent's runtime as `assigned_page_count * per_image_budget`.
- Add a practical buffer when waiting for image workers. If the expected image time is 2 minutes, wait at least 3 minutes for a one-page worker; for multi-page workers, wait at least `assigned_page_count * 2 minutes + 1 minute`.
- If a page range would exceed the maximum wait time, split the range into smaller subagent tasks.
- Prefer more parallel one-page workers over long sequential multi-page workers when the deck has 2-6 pages.
- For 7+ pages, keep at most 6 concurrent subagents, but size each consecutive range so the range fits inside the wait budget.
- Default reasoning_effort is `low`. The worker is executing a fixed image prompt, not planning the deck.
- Use `medium` only when the assigned page has `strict_embed` fidelity, dense scientific/table evidence, multiple reference assets that must be reconciled, a prior generation failure/revision, or an explicit user request for extra care on that page.
- Do not use `high` or `xhigh` for image workers unless the user explicitly asks for deep reasoning; high reasoning is usually wasted and increases the chance that a worker redesigns the page instead of executing the confirmed protocol.
- When `fork_context: true` is used, DO NOT set `reasoning_effort`; the current runtime can reject full-history fork calls that also set reasoning effort.
- The leader may use stronger reasoning for planning, but worker prompts MUST stay narrow and execution-focused.

Shared context rules:

- Before spawning workers, the leader MUST create one shared deck generation context from the confirmed protocol: deck title, audience, aspect ratio, global style, palette, typography, logo/template asset ids, page list, global negative rules, QA acceptance rules, and asset index.
- `imagegen-jobs.json` MUST contain a `style_lock` object. Treat that object as the canonical shared visual contract for all image-generation and visual-review workers.
- `style_lock` MUST include stable visual fields for layout density, font/size tendency, palette, chart style, margins/whitespace, and forbidden items.
- Every worker MUST receive the exact same `style_lock` plus only its assigned page protocol slice and relevant reference asset paths.
- MUST NOT rely on inherited chat history as the only consistency mechanism.
- Forked chat history is supplemental only. If fork history fails, is unavailable, or differs between workers, consistency MUST still come from the explicit `style_lock`.
- A worker prompt that does not include the `style_lock` is invalid, even if `fork_context: true` was used.
- Every subagent task MUST be a hard-bounded image-generation task. Subagent output is PNG.

Spawn call rules:

- Default shape is the lightweight context packet: omit `fork_context` or set `fork_context: false`, set `reasoning_effort: "low"` for normal pages, and put the shared deck generation context plus assigned page context in the worker prompt.
- For the medium-only escalation cases above, set `reasoning_effort: "medium"` and record the reason in the worker assignment or job note.
- Each default worker packet contains only: verbatim `style_lock`, assigned page protocol slice, relevant reference asset paths, output PNG path, and the execution checklist.
- Forking is optional only when the runtime benefits from extra history. If `fork_context: true` is used, DO NOT set `reasoning_effort`.
- MUST NOT call `spawn_agent` with `fork_context: true` when also setting `agent_type` / role.
- Optional fork shape is: omit `agent_type`, set `fork_context: true`, omit `reasoning_effort`, and still include the shared deck generation context in the worker prompt.
- If role-less forked spawn fails, or if a role/reasoning override is required by the runtime, MUST omit `fork_context`; write the shared deck generation context and complete task context into `message` or `items`.
- The context-packet prompt MUST include the same `style_lock` JSON used by forked workers. Do not shorten, paraphrase, or rebuild the style contract per worker.
- If subagent spawning is unavailable, blocked, or fails, the leader MAY fall back to direct generation, but MUST record the reason in `imagegen-jobs.json` notes or the final handoff. Silent fallback is FORBIDDEN.
- For 7+ pages, fallback to zero workers is allowed only after a concrete spawn unavailable/blocked/failed condition is observed and recorded.
- The leader MUST wait for subagent results or failure status before creating `png-manifest.json`.

Spawn call guardrail:

```text
Default:
spawn_agent({
  reasoning_effort: "low",
  fork_context: false,
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Optional fork:
spawn_agent({
  fork_context: true,
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Also allowed when a role is unavoidable:
spawn_agent({
  agent_type: "<role>",
  reasoning_effort: "low",
  message: "<worker prompt with shared deck generation context, assigned page protocol slice, and reference paths>"
})

Medium escalation for complex evidence/fidelity page:
spawn_agent({
  reasoning_effort: "medium",
  fork_context: false,
  message: "<worker prompt with medium reason: strict_embed / dense table evidence / multiple references / prior generation failure>"
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
- Use low reasoning by default, or medium only when the assignment explicitly states the page meets the escalation rule; focus on direct image generation, not deck planning.

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
   - execution summary with exactly these five fields: `claim_followed`, `reference_assets_used`, `fidelity_followed`, `negative_prompt_avoided`, and `uncertainties`.

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
