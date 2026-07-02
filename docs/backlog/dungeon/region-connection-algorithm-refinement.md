# Region-connection algorithm refinement (cave mouths + seams look off)

## Context

Slice 2.2.2 shipped the theme-generator architecture with a working but visually-rough
region-connection model, validated at the Phase A visual gate (2026-06-24):

- **Cave→room seams** use a `capsuleCavern` tunnel that **overshoots the grid** so the bore
  stays full-radius at the mouth (`themes/cave.ts` `TUNNEL_OVERSHOOT`), plus a flat-floored
  **vestibule** box (`compose.ts`). The branch room is placed *beyond* the mouth; the cave has
  no branch-end chamber.
- **Level→cave entrance** uses an **entrance bore** (a `-Z` tunnel carved through the hub wall)
  that **protrudes ~1.8 m into the authored chamber** (the grid pad), aligned to a doorway cut
  in the chamber wall (`main.ts` `AREA_ORIGIN`, `level.ts`).

The user's gate verdict: *"the mouths of the caves look off, but nothing to really deal with
here, we should look at the algorithm to connect rooms at a later stage."* It is **walkable**
(headless walk-probes cross every seam without stall/fall-through; `cave-entrance.gpu.test.ts`,
`area-traversal.gpu.test.ts`), just not visually polished — the cave mouths read as abrupt
bores rather than shaped openings, and the entrance bore pokes into the chamber.

Known rough edges feeding this:
- The cave bore opens at the **grid edge** (uniform `GRID_PAD`), so the mouth lands a couple
  of metres past the intended seam plane (into the room / into the chamber) rather than exactly
  at the doorway. Per-direction grid bounding (open the seam face at the hub edge, pad the rest)
  would tighten it but was deferred to avoid a grid re-architecture mid-gate.
- Branch directions are hard-constrained to the open `+X/+Z` quadrant in `cave.ts` because the
  wing is placed flush against the authored level (a `-X`/`-Z` branch drove a room into the
  spawn corridor). This couples the generic cave theme to one specific placement, and caps the
  wing at 2 branches. A cleaner model would pass allowed/forbidden branch directions (or the
  level's footprint) into the generator from the composition layer, OR place the wing in genuinely
  open space with a connecting passage (allowing full 2–3 directional branching).

## Trigger to revisit

**Partially superseded.** Slice 2.2.4 replaced cardinal-snap placement + the `vestibule` bridge
with the general `connect.ts join`/`route` primitive, and Slice 2.2.5a replaced `compose.ts`
itself with `layout.ts`'s collision-aware graph placer (`compose.ts` is deleted). The
"connection contract should be redesigned" half of this trigger has therefore already happened.
What's still open is narrower: the cave-mouth/entrance-bore **aesthetics** (abrupt bore vs. a
shaped opening) and the `cave.ts` branch-direction hard-constraint below — revisit when
polishing generated-area visuals, or alongside `docs/backlog/dungeon/connector-geometry-stitching.md`
(the general surface-stitching gap `route`/`join` still doesn't address).

## Reference

- `packages/dungeon/src/themes/cave.ts` (entrance bore, branch tunnels, `buildGrid`),
  `packages/dungeon/src/level.ts` (`CHAMBER_DOOR`, doorway cut). The hand-tuned `main.ts`
  `AREA_ORIGIN` this entry originally cited was deleted in Slice 2.2.4; the level↔cave seam is
  now positioned by `layout.ts`/`connect.ts join` off `CHAMBER_DOOR`, same aesthetics as before.
- Design rationale: `docs/research/2026-06-22-dungeon-2.2.2-procgen-algorithms.md` §3 (the
  connection / vestibule-seam research that fed this slice) — describes the now-retired
  `compose.ts` `vestibule`/`placeRoom` shape; the current placement path is
  `packages/dungeon/src/connect.ts` (`join`/`route`) + `packages/dungeon/src/layout.ts`
  (`layoutWorld`). Macro-layout (Poisson/MST/loops) remains deferred — see this entry's Trigger.
- Sibling deferral: `docs/backlog/dungeon/pillarhall-centerline-pillar-navigability.md`.
