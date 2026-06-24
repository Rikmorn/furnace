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

When polishing generated-area visuals, OR when the macro-layout work (the deferred
Poisson/MST/loops, reachability validators, retiring `LEVEL_BOXES`) makes region connection a
first-class concern — at which point the connection contract (`Connection`), cardinal-snap
placement (`compose.ts`), the vestibule, and the cave-mouth/entrance-bore carving should be
redesigned together for both correctness and looks. Likely its own slice.

## Reference

- `packages/dungeon/src/themes/cave.ts` (entrance bore, branch tunnels, `buildGrid`),
  `packages/dungeon/src/compose.ts` (`buildArea`, `placeRoom`, `vestibule`),
  `packages/dungeon/src/main.ts` (`AREA_ORIGIN`), `packages/dungeon/src/level.ts` (doorway cut).
- Design rationale: `docs/research/2026-06-22-dungeon-2.2.2-procgen-algorithms.md` §3 (the
  connection / vestibule-seam research that fed this slice). The as-built seam lives in
  `packages/dungeon/src/compose.ts` (`vestibule`, `placeRoom`) and `packages/dungeon/src/themes/cave.ts`
  (tunnel mouths). Macro-layout (Poisson/MST/loops) remains deferred — see this entry's Trigger.
- Sibling deferral: `docs/backlog/dungeon/pillarhall-centerline-pillar-navigability.md`.
