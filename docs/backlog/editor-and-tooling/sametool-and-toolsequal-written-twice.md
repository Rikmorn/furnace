---
summary: `sameTool` (host) and `toolsEqual` (chrome) are one predicate written twice because the chrome may take no VALUE edge to `field-host/`; `shared/` can hold it, and the blocker is that nobody is making the `FieldTool` placement decision
---

# `sameTool` and `toolsEqual` are one predicate written twice, and `shared/` can hold it

`field-host/field-tool.ts`'s `sameTool` (`field-host.ts`'s until T3d) and
`frontend/lib/field-host-mirrors.ts`'s
`toolsEqual` are the same function. As of foundations T3b2 Task 6 their `sameMask`/
`masksEqual` halves are byte-identical including the comment, and the two outer functions
differ only in style. Nothing pins that they agree.

## Context

The standing justification is that the chrome may not take a VALUE edge to `field-host.ts`
(the barrel carries core, and a second core in the chrome bundle is what
`tests/frontend-no-engine-leakage.test.ts` exists to prevent). That is true and it is why
the comparator cannot live in `field-host/` — but it answers a narrower question than it
appears to, because it says nothing about the third option.

**`shared/` can hold it.** `FieldTool` is a plain structural type whose only non-inline
member, `BrushEffect`, already lives in `shared/field-brush.ts`. `shared/` is exactly where
Task 5 of this same slice put `HOLLOW_MIN_M`, `RADIUS_MIN` and `RADIUS_MAX`, for exactly
this reason, and the layer arrow (`frontend/ → field-host/ → shared/`) makes it importable
by both sides by construction.

## Why it was not done at T3b2

Second occurrence, so tolerate-until-three applies, and the duplication is the SAFE kind:
both copies carry the destructure `satisfies Record<string, never>` backstop, so a new
`FieldTool` field fails to compile in both places at once. What the backstop does NOT cover
is a comparison someone DELETES from one copy — that is now pinned per-field on the host
side (`tests/field-host-headless.test.ts`, "the value guard lets a change to any ONE
compared field through") and per-field on the chrome side
(`tests/field-host-mirrors.test.ts`), which is the cheaper half of the same protection.

The stakes did rise at T3b2: `sameTool` now gates a PUBLISH, so a weakened host-side compare
means the chrome is never told the brush changed, where before a weakened chrome-side
compare only cost a re-render.

## What moving it would mean

`FieldTool` itself would want to move to `shared/` with it, or the shared module would
type-import it from `field-host/` — which reverses nothing (a type import is erased) but is
worth deciding deliberately rather than by accident. Deleting one copy is the point; keeping
two behind a shared third would be worse than today.

## Trigger to revisit

A third copy appearing, `FieldTool` gaining a field (which is when both backstops fire and
somebody edits both files anyway), or any tranche already moving type surface into `shared/`.

### The third clause FIRED at foundations T3c Task 5 (2026-08-07), and was still declined

The tool registry landed as a NEW floor module (`src/shared/tool-registry.ts`), so a tranche
really did move type surface into `shared/`. Two things kept the comparator where it is:

- **The type surface that moved was not `FieldTool`'s.** The new module declares its own
  four types and type-imports `MaterialTable` and `ParamId`; it neither carries `FieldTool`
  nor makes carrying it any cheaper. The trigger clause was written to catch "someone is
  already in `shared/` deciding where `FieldTool` lives" — nobody was.
- Both backstops still hold and the per-field pins on both sides still hold, so the
  duplication is still the SAFE kind this entry describes.

**A first draft of this note claimed the move needs a test edit. It does not**, and the
correction matters because the false claim would have made the work look more expensive than
it is: `tests/field-host-mirrors.test.ts` imports `toolsEqual` BY NAME from
`frontend/lib/field-host-mirrors.ts`, so `export { toolsEqual } from "../../shared/…"` there
satisfies it with zero test edits and ONE implementation. That is also not what this entry
calls *"worse than today"* — that phrase is about keeping TWO implementations behind a shared
third, and a re-export is one implementation plus an alias. Cost is not the blocker; the
blocker is that nobody was making the `FieldTool` placement decision.

**Sharpened trigger, replacing the third clause:** a tranche that moves `FieldTool` itself
into `shared/`. A new floor module on its own is no longer enough — T3c proved that clause
fires without buying anything.

## Reference

- `packages/editor/src/field-host/field-tool.ts` — `sameMask` / `sameTool` (now there)
- `packages/editor/src/frontend/lib/field-host-mirrors.ts` — `masksEqual` / `toolsEqual`
- `packages/editor/src/shared/field-limits.ts` — the Task 5 precedent
- `docs/reference/editor/tools.md` §"`subscribeTool` is a STATE seam" — the two comparators
