---
name: sculpting-worlds
description: Use when the task is to dig, carve, stamp, mine, or bake terrain to build a world or level in the furnace editor — running a generator, sculpting a cave, placing a stamp, or shaping 3-D space into something a person would find convincing to walk through.
---

# Sculpting Worlds

Driving the furnace editor to build convincing 3-D worlds.

## Read the box before you build

- The generator registry — every param, its range, its default — is one call:
  `session_query` with `about: "generators"`. Make it before you plan, not when a param
  throws.
- Material classes and prop archetypes are **project files**, under the path `project_get`
  returns. Read them rather than assuming what exists.
- Never carry a memorised list of what exists. It changes; the read does not.

## Facts that do not rot

- Field cell is **0.25 m**. Y is up.
- **Generator dimension params count coarse cells of 0.5 m, not metres.** A hall of width
  8 is 4 m across. Halve every dimension you were about to type.
- The door standard is **2.0 m wide × 3.0 m high**.
- A stamp anchors at the **region min corner**, not its centre.
- A stamp's footprint is its interior **plus a one-cell shell**: an interior of
  12 × 6 × 16 m reports a footprint of 13 × 7 × 17 m.
- Walkable free width is **0.68 m**. Below that, a character does not fit.

## Where to probe

Verifying carefully is not verifying in the right places.

- Probe **corners, thresholds and joins**, not straights and mid-spans. In the baseline
  every mid-span probed fine and every single defect was at a corner.
- **An elbow of two swept capsules pinches at the join.** Two cylinders meeting at an
  angle leave a saddle narrower than either — reliably under the 0.68 m bar on a tight
  corner. Overlap the sweeps past the corner, or put a sphere at the elbow, then re-probe
  the throat.
- Probe **where two stamps meet**, and where a stamp meets hand-carved ground. Nothing
  checks that two stamps' doorways line up.
- Measure with `session_query`'s ray. A corner is exactly where a picture cannot be
  trusted.
- **A ray cast from inside solid returns distance 0**, so you cannot probe a void before
  you have carved it. Build the descent first, then probe outward from inside it.

## Known traps

- **A hall's auto-centred door lane can land on a pillar**, and the commit is refused. Two
  moves clear it: set a door offset whose lane misses the pillars, or choose a pillar
  spacing that does not align with the lane.
- `world.bake` refuses an unnamed world. Name it with `world.saveAs`, which takes one —
  **`world.save` cannot name an untitled world from the door.** It takes no input at all,
  answers ok, and opens a naming drawer for the human; the world stays untitled and the
  next bake refuses again.
- **`world.bake` also repoints the project default at that world**, rewriting
  `worlds/index.json`. Baking is not only compiling.
- Baking re-derives the player spawn from the editor camera's eye, so a bake can put the
  spawn outside the world you just built — and the walkability analysis is seeded from
  that spawn, so a bad spawn degrades that too. Park the camera somewhere walkable first.
- **The scatter generator's variant count is not bounded by the archetype's mesh count**,
  and its default exceeds at least one shipped archetype. Read the catalog and pass a
  legal value, or the world throws when the game loads it.

## Composing

## Ambition, and what to do when you hit a wall

## Legibility to the human

## Growing this skill
