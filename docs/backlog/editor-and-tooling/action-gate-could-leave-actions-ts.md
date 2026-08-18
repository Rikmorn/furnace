---
summary: the action GATE is pure and acyclic with respect to the action TABLE it shares `lib/actions.ts` with, and would move whole into a sibling `lib/action-gate.ts` — a rename-only commit that every task noticing it was too busy to make
---

# The action GATE could leave `lib/actions.ts`

`frontend/lib/actions.ts` is 1,586 lines (re-measured at head 2026-08-09; it was 1,299 when
this entry was written and 1,304 at the T4a branch point — Tasks 1 and 2 added the second
funnel and the two gate envs, so the tranche that grew it is the one re-measuring) and holds
two things that only meet at the bottom
of the file: the **action TABLE** (39 actions — since T3b2 their DATA rows live in
`src/action-registry/descriptors.ts` and this file holds the four closures `label`,
`enabled`, `checked` and `run`, joined by id) and the **GATE** (the rules deciding whether a
matched action may proceed at all).

The gate is `GateEnv`, `GateVerdict`, `gateAction`, `clickGate`, `sessionRefusal`,
`controlVerdict` and `matchAction` — pure, and acyclic with respect to the table: it takes an
`ActionDef` and answers about it, and imports nothing the table does not already import. A
`lib/action-gate.ts` beside `lib/actions.ts` would take it whole.

> **Re-measured 2026-08-07 (foundations T3b2).** Three facts moved and the entry is
> re-stated against head rather than left as written: the file grew 1,225 → **1,299** lines
> (T3b2 added `runAction`, `runNamed`, `sayResult` and the `BEHAVIORS` join), the table is
> **39** actions not ~36 (the "~36" was never right — it was 39 at the time too), and
> **`ActionGate` has already left**: it is a type, so it moved down to
> `action-registry/descriptors.ts` with the rows — and `actions.ts` does NOT re-export it
> (no consumer outside the registry), so it is not even a name this file still holds. The
> remaining cluster is the seven names above. **Still open** — T3b2 declined the move for
> the entry's own stated reason (it carried a behavioural change), and `GateEnv` becoming a
> discriminated union on `caller` makes the seam sharper, not weaker.

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
(`session-confirm-claims-enter.md`) is exactly that change, and doing
it inside the current file means editing gate logic in the middle of the action table.

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — the gate lives at `:139-157` (the types)
  and `:1143-1225` (the functions); everything between is the table.
- `packages/editor/src/frontend/hooks/useGlobalKeybindings.ts` — the one caller of
  `matchAction` + `gateAction`, which is what makes the seam observable.
