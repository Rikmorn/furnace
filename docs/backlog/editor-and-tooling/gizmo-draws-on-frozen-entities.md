---
summary: `gizmoVisible` never asks whether the selected entity can actually be moved, so a FROZEN or BAKED entity draws a full translate gizmo whose handles then refuse — a false affordance tangled with whether frozen entities should be selectable at all
---

# The translate gizmo draws on frozen and baked entities

*(A standalone entry until the F4.5 seal, 2026-08-03, which folded it into the field-tool register.)*

**Context.** `field-host.gizmoVisible()` gates the handles on three things: the
`pointer` tool armed, an entity selected, and no session the gizmo did not open.
It does NOT ask whether the selected entity can actually be moved. Selecting a
FROZEN or BAKED entity therefore draws a full translate gizmo on it; pressing a
handle calls `beginMoveSession` → `openEntitySession`, which refuses through
`openBlockedReason` and reports "entity N is frozen — unfreeze it to edit". So it
is a false affordance, not a corruption: nothing moves and the reason is legible.

The fix is a one-line addition to `gizmoVisible` (the record's
`openBlockedReason` must be null), but it is deliberately NOT taken in F4.5b Task
5 because it runs into a question that task does not own: whether a frozen entity
should be SELECTABLE at all. If selection itself were refused the gizmo question
disappears; if selection stays, the emphasis box has the same "you can select it
but not act on it" shape and the two should be answered together.

**Trigger to revisit.** F4.5b Task 8 or 10, whichever settles what a frozen entity
looks like in the palette row and the session card.

**Reference.** `packages/editor/src/field-host/field-entities.ts` —
`gizmoVisible` (now there); `packages/editor/src/field-host/field-machine.ts` —
`beginMoveSession` (now there);
`packages/editor/src/shared/field-entity.ts` — `openBlockedReason`.
