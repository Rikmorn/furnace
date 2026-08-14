---
summary: EntitiesPalette's freeze/bake/delete buttons call fieldHostRef directly — no gate, no refusal vocabulary, no agent route, unlike their edit.* neighbours
---

# EntitiesPalette's entity verbs bypass the action registry

**Context.** Surfaced by the undo-attribution slice's Task 4 enumeration (sealed
2026-08-14): `EntitiesPalette.tsx` wires freeze/bake/delete to
`fieldHostRef.current?.…` directly rather than through action rows. Consequences, none
currently a defect: the three verbs have no gate (no `enabled` predicate, no
refusal vocabulary), no ⌘K/menu presence beyond the palette, and no agent route — which
is exactly what keeps them human-attributed today (the origin parameter on
`setEntityFrozen`/`bakeEntity`/`deleteEntity` is threaded end to end but nothing
agent-reachable calls them). The asymmetry with their `edit.delete`/`edit.duplicate`
neighbours is undocumented at the palette itself.

**Trigger to revisit:** an agent needs freeze/bake/delete (each would become a registry
row and inherit gates + origin threading for free — the plumbing already exists); or the
next chrome pass touches EntitiesPalette for any reason.

**Reference:** `EntitiesPalette.tsx`'s direct `fieldHostRef` calls; the threaded-but-
unreachable verbs in `field-entities.ts` (`setFrozen`/`bake`/`remove`); the archived
undo-attribution execution report's unthreaded-paths list.
