# The action GATE could leave `lib/actions.ts`

`frontend/lib/actions.ts` is ~1225 lines and holds two things that only meet at the bottom
of the file: the **action TABLE** (the ~36 declared actions, their labels, hints, keys and
`run`s — the part everyone edits) and the **GATE** (the rules deciding whether a matched
action may proceed at all).

The gate is `ActionGate`, `GateEnv`, `GateVerdict`, `gateAction`, `clickGate`,
`sessionRefusal`, `controlVerdict` and `matchAction` — roughly 90 lines, pure, and acyclic
with respect to the table: it takes an `ActionDef` and answers about it, and imports nothing
the table does not already import. A `lib/action-gate.ts` beside `lib/actions.ts` would take
it whole.

## Context

The tell that the seam is real is that the TEST suite already splits along it: the gate's
cases and the table's cases are separate concerns in separate places, and reviewers have
described the file by these two halves more than once.

Not done when it was noticed because every task that noticed it was carrying a behavioural
change at the same time, and a whole-file move under a behavioural diff is the shape that
makes a review round unreadable. It is a pure move — no behaviour, no new API — so it wants
a commit of its own where the diff being a rename is the entire claim.

## Trigger to revisit

`actions.ts` crossing ~1400 lines, or the first change to the gate's RULES rather than to
the table — the `session.confirm` ⏎ decision
(`session-confirm-claims-enter-for-every-plain-button.md`) is exactly that change, and doing
it inside the current file means editing gate logic in the middle of the action table.

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — the gate lives at `:139-157` (the types)
  and `:1143-1225` (the functions); everything between is the table.
- `packages/editor/src/frontend/hooks/useGlobalKeybindings.ts` — the one caller of
  `matchAction` + `gateAction`, which is what makes the seam observable.
