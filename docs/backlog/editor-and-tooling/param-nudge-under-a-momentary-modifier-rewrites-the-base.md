# Nudging any brush param while ⇧ or ⌃ is held permanently rewrites the base brush

Hold ⇧ (momentary smooth), drag the strength slider, let go: the brush is now **smooth**,
not the dig it was before the key went down. Same for ⌃ (dig↔fill invert) and any param
control — radius is the exception only because it does not ride `FieldTool`.

## The mechanism

`FieldHost.setTool`, when a momentary modifier is held, adopts its argument as the BASE the
release restores to (`momentarySaved = clamped`). That is correct and deliberate for a
deliberate pick — a user choosing Fill under a held ⇧ means "fill is what I want when I let
go".

The trap is that every strip control spreads `ctx.tool` — and `ctx.tool` is what the seam
last pushed, which under a held modifier is the DERIVED tool. So
`ctx.setTool({ ...ctx.tool, smooth: { ...ctx.tool.smooth, strength: 4 } })` sends
`effect: "smooth"` along with the strength the user actually changed, and the base is
rewritten to smooth as a side effect of moving an unrelated slider.

## Pre-existing, and not caused by T3b2 Task 6

Before the tool seam converted, the chrome's `tool` cell was written by the same
`subscribeTool` mirror on every momentary derive, so `ctx.tool` was the derived tool then
too. The conversion changed where the value comes from, not what it holds. Verified against
the parent commit's provider.

## Why it is filed rather than fixed

The fix is a design decision with more than one defensible shape:

- the chrome sends PATCHES rather than whole tools (a real API change on the busiest seam);
- the host distinguishes "adopt as base" from "adjust the base's params" (a second verb, or
  a flag — the single-source-of-truth rule argues against both);
- the host spreads the incoming tool over `momentarySaved` field-by-field, keeping its own
  `effect` — subtle, and it would silently break the deliberate pick the branch exists for.

None belongs in a slice whose licence was the seam conversion.

## What is pinned today, so nobody reads it as covered

`tests/field-host-momentary.gpu.test.ts` canonises "a `setTool` under a held ⇧ becomes the
base the release lands on". That is the DELIBERATE-pick case and it is correct. Its comment
now says explicitly that the same branch is reached by any param nudge and points here.

## Trigger to revisit

A user report of "my brush changed after I let go of shift", or any tranche touching the
momentary overrides, the strip's param plumbing, or `ParamContext`.

## Reference

- `packages/editor/src/field-host/field-host.ts` — `setTool`'s momentary branch,
  `deriveMomentary`
- `packages/editor/src/frontend/components/shell/tool-params.tsx` — every
  `ctx.setTool({ ...ctx.tool, … })` call site
- `packages/editor/tests/field-host-momentary.gpu.test.ts`
