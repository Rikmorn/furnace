# drawLines: batch per-frame calls to cut MSAA resolve cost

**Context.** The F2b MSAA fix (2026-07-21) made every `drawLines` call on an MSAA
context a real render pass: load the stored MSAA scene color, draw, resolve to the
swapchain. The editor FieldHost issues ~3 per frame steady-state (grid minor/major +
ghost) and 6–7 with a selection + stamp session live — each a full-canvas resolve.
Previously these were free because the passes were invalid and dropped (see
`docs/learnings/2026-07-21-invisible-line-overlays.md`). Not a correctness issue; the
executor flagged it as the known cost of the fix.

**Fix shape:** accept multiple batches in one call (`drawLines(ctx, opts[])`) or an
internal per-frame accumulator that encodes all line draws into ONE pass with one
resolve. Pipeline switches between occlude modes can live inside the single pass.

**Trigger to revisit:** measured frame cost regression in an overlay-heavy editor
scene (the user's F2b gate feel-check reported none), or a third consumer adding
per-frame line overlays.

**Reference:** `packages/core/src/frame/render-lines.ts`;
`packages/editor/src/field-host/field-host.ts` (renderScene overlay draws).
