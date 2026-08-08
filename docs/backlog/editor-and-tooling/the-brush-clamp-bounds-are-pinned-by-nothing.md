# `RADIUS_MIN` / `RADIUS_MAX` / `HOLLOW_MIN_M` are pinned by nothing

The three brush clamps moved to `packages/editor/src/shared/field-limits.ts` in foundations
T3b2 Task 5, so the host's clamp and the strip's control bound are now ONE number. No test
notices when that number changes.

## Context

**Measured, not assumed** (`bun test packages/editor/tests`, 1439 pass / 0 fail at the
committed state of T3b2 Task 5):

| sabotage | result |
| --- | --- |
| `RADIUS_MIN` `0.25` → `0.75` | 1439 pass / 0 fail |
| `RADIUS_MAX` `4` → `9` | 1439 pass / 0 fail |
| `HOLLOW_MIN_M` `0.5` → `1.5` | 1439 pass / 0 fail |

Nothing reddens. `tests/chrome/tool-strip.test.tsx` reaches the radius slider by its
accessible name (`getByLabelText("brush radius")`) and drives it, but never asserts its `min`
or `max`; the hollow field's `min` is likewise unasserted.

**THE MOVE DID NOT MAKE THIS WORSE — it made it strictly better, and an earlier draft of this
entry had that backwards.** Before Task 5 there were TWO unpinned copies of each number, one
in `field-host.ts` (the clamp's home then; `field-tool.ts` since T3d) and one in
`tool-params.tsx`, with nothing comparing them: a drift in
either was both unpinned AND able to put the control out of step with the clamp. There is now
ONE copy. Consolidating **removed** a possible failure (the two disagreeing) and left the
pre-existing one (nobody notices the single number moved) exactly as it was. Do not read this
entry as a regression the task introduced.

What remains is worth guarding anyway: `RADIUS_MAX` is the largest brush the editor offers and
`HOLLOW_MIN_M` is the floor a typed thickness is clamped up to on blur, and both reach a user
as a native control's own bound.

**Why Task 5 did not add the pin.** Not because its brief put the chrome suites off limits —
that brief forbade *reshaping* existing assertions, and adding a new case is not a reshape.
The honest reason is scope: the gap is pre-existing, it is not an instance of the drift class
that task's thesis was about (there is no second copy to drift from), and the task was already
carrying six table conversions plus eight carry-forwards.

The pin belongs beside the existing pair in `tests/chrome/tool-strip.test.tsx`, and should
follow the shape `tests/shared/action-table.test.ts`' three-limits case already documents: a
VALUE assertion in the shared test cannot catch a re-hardcoded literal, so the coupling is
held by a RENDERED assertion — read `min`/`max` off the control and compare against the
literal `0.25` / `4` / `0.5`, deliberately not against the imported constant, since a pin that
reads the constant makes the number agree with itself.

## Trigger to revisit

Any of:

- **The next task that opens `tests/chrome/tool-strip.test.tsx`** for its own reasons — the
  pin is three assertions and belongs in that commit rather than its own.

  > **This clause FIRED at foundations T3c and was consciously not taken (2026-08-07).** T3c
  > Task 1 (commit `d34374d3`) opened that file for a real reason — the material-swatch case became a `toEqual`
  > over a `toMatchObject` when `setTool` widened to a patch, because the ABSENCE of an
  > `effect` field is the claim. The pin was not added with it. The reason is a gate rule
  > rather than a judgement about the pin: the tranche's docs-and-gate task carried a suite
  > count pinned at 2905/1/0 as its own success criterion, and three new assertions move it,
  > so adding them there would have been a silent change to the number the tranche was
  > verified against. The clause stands, and the next opener that is not gate-frozen should
  > take it.
- **Either bound changes**, for any product reason. The change itself is the moment to add
  the guard that would have shown it.
- **A fourth clamp meets `field-limits.ts`' bar** and moves down. The file's header states
  the bar; it does not yet state that a moved limit wants a rendered pin, and the third one
  arriving is when that becomes worth writing.

## Reference

- `packages/editor/src/shared/field-limits.ts` — the three constants and the bar for adding
  one.
- `packages/editor/src/field-host/field-tool.ts` — `clampRadius`, and the `hollow` floor in
  `clampTool` (both now there).
- `packages/editor/src/frontend/components/shell/tool-params.tsx` — the radius range input's
  `min`/`max` and the hollow field's `min`, which are where a user meets them.
- `packages/editor/tests/shared/action-table.test.ts` — *"the three host limits reach the
  chrome as VALUES, not as prose"*, for the value-pin / rendered-pin pairing this should
  follow.
