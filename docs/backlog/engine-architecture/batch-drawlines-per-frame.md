---
summary: every `drawLines` call on an MSAA context is a full render pass with its own resolve; the cost premise is currently dead — no consumer runs MSAA plus multiple line batches — but the one-pass fix shape stands
---

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

**Re-priced at T5 (2026-08-11) — the cost premise above is currently dead, the fix
shape is not.** The paragraph prices the whole case in editor MSAA resolves, and
the editor no longer pays them: foundations T4c fixed its context at
`sampleCount: 1` and stated it rather than defaulting it
(`packages/editor/src/field-host/field-host.ts`, `requestContext(canvas, { sampleCount: 1 })`).
At `sampleCount: 1` there is no resolve, so the editor's ~3–7 line passes per frame
cost pass overhead only. Nor does the cost live anywhere else today: the dungeon
runs `sampleCount: 4` (`packages/dungeon/src/main.ts`) but calls `drawLines`
nowhere, and the one remaining MSAA-capable consumer —
`packages/hello-world/src/demos/bowling/scene.ts`, whose `sampleCount` is a
user-toggled `1 | 4` — issues a single collider overlay call that `drawLines`
**skips outright** under MSAA + a post chain (the documented warn-once SKIP, since
the resolve would clobber post output).

The fix shape stands unchanged and is still worth doing when it fires: one pass
with one resolve for all line batches is strictly better than N, and it is the
prerequisite for a `sampleCount > 1` context ever carrying multiple per-frame
overlays at all.

**Trigger to revisit:** *(re-stated with the above)* a consumer running
`sampleCount > 1` that issues more than one `drawLines` batch per frame — which is
what would make the resolve cost real again — or a measured frame-cost regression
from line-pass overhead alone in an overlay-heavy editor scene (the user's F2b
gate feel-check reported none, and that was still under MSAA).

**Reference:** `packages/core/src/frame/render-lines.ts`;
`packages/editor/src/field-host/field-render.ts` (renderScene overlay draws — now there).
