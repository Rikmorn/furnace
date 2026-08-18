---
summary: the Entities section renders `defaultOpen={false}`, inherited from when the list was reference context inside a deleted panel, so the newest row sits behind a disclosure and a viewport pick writes a selection into a list nobody can see
---

# The Entities section starts collapsed, so the newest row is one extra click away

Filed at foundations T5 (2026-08-11), from the task that gave the list its order. The T4c
gate walk's finding was that an agent generated a cave into the shared session and the human
could not find it; T5 answered the *ordering* half — `EntitiesList` sorts newest first and
says so in the section header's tooltip. The remaining click is this: the section renders
with `defaultOpen={false}`, so the row that just landed is behind a disclosure the reader has
to open, and a viewport pick writes a selection into a list nobody can see.

## Context

`packages/editor/src/frontend/components/field/EntitiesList.tsx` passes
`defaultOpen={false}` to `CollapsibleSection`. The comment on it is honest about the state of
the question: the default is INHERITED from when this list was reference context inside the
deleted `FieldPanel`, and D-14 has since made it the LAYERS panel — a layers panel that
starts shut hides the read half of the bidirectional selection sync
(`subscribeEntitySelection`), so picking something in the viewport visibly does nothing.

**Why it is not a one-line fix.** Opening it by default costs vertical space in the controls
column permanently, for every world including an empty one, and the palette is the user's to
size (§18.8). That is a layout decision with a cost, which is the condition
`AGENTS.md`'s inline-fix threshold fails on. The honest options are at least three: open by
default; open when the list is non-empty; or persist the open state per project alongside the
rest of the workspace blob (today it is per-mount, no persistence).

**The deferral had no durable home until now**, which is why this section exists rather than
just the comment. The comment defers to "the palette-layout pass (Task 8)" — F4.5b Task 8,
which shipped 2026-08-01 and did not touch this file. A source comment pointing at a trigger
that has already fired and passed is the exact shape `field-host-prune-tranche.md` was
created to stop.

## Trigger to revisit

The next editor-UX / palette-layout pass, or the first time a second person uses the editor
and cannot find what they just made.

## Reference

- `packages/editor/src/frontend/components/field/EntitiesList.tsx` (`defaultOpen`, and the
  comment that carries the inherited-default argument);
  `packages/editor/src/frontend/components/CollapsibleSection.tsx`.
- `docs/backlog/editor-and-tooling/entity-list-has-no-legible-order.md` — the sibling half of
  the same gate finding, narrowed at T5.
- `docs/reference/editor-architecture.md` §28 (the T5 as-built), §18.8 (palettes the user can
  size — the space this default would spend).
