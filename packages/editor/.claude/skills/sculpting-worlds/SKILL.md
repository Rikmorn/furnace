---
name: sculpting-worlds
description: Use when the task is to dig, carve, stamp, mine, or bake terrain to build a world or level in the furnace editor — running a generator, sculpting a cave, placing a stamp, or shaping 3-D space into something a person would find convincing to walk through.
---

# Sculpting Worlds

Driving the furnace editor to build convincing 3-D worlds.

## Read the box before you build

- **Never carry a memorised list of what exists.** It changes; the read does not.
- The generator registry: read it **before you plan**, not when a param throws.
- Material classes and prop archetypes are **project files** — `catalog/materials.json`
  and `catalog/entities.json`, under the path `project_get` returns.
- **The generator's SOURCE is part of the box.** Where the schema is silent on behaviour —
  where a cave's mouths sit — read the generator. One run spent eight door calls hunting a
  floor its source states.

## Facts that do not rot

- Field cell is **0.25 m**. Y is up.
- **Units differ per generator; the schema states them.** A hall's `width`/`height`/`depth`
  count coarse cells of 0.5 m — width 8 is 4 m across. A maze's `cellsX`/`cellsZ` count
  maze cells of 2.5 m. A cave's `chamberRadius` and a scatter's `minSpacing` are metres.
  Read the unit off the registry, never convert from memory.
- The door standard is **2.0 m wide × 3.0 m high**.
- A stamp anchors at the **region min corner**, not its centre.
- A stamp's footprint is its interior **plus a one-coarse-cell (0.5 m) shell**: an interior
  of 12 × 6 × 16 m reports a footprint of 13 × 7 × 17 m.
- Walkable free width is `2·radius + skin` from the project's `catalog/agent.json` —
  **0.68 m** in the dungeon. Below that, a character does not fit.

## Where to probe

Verifying carefully is not verifying in the right places.

- Probe **corners, thresholds and joins**, not straights and mid-spans. In the baseline
  every defect was at a corner — and a corner is exactly where a picture cannot be trusted.
- **Re-probe every elbow.** Four of the baseline's sixteen walkability candidates sat one
  per elbow of a spiral descent — exactly where the human wedged. Widen the throat at a
  corner and probe it, whatever the legs measure.
- Probe **where two stamps meet**, and where a stamp meets hand-carved ground. Nothing
  checks that two stamps' doorways line up.
- **A ray cast from inside solid returns distance 0**, so you cannot probe a void before
  you have carved it. Build the descent first, then probe outward from inside it.
- **Never defer verification to a tool you have not confirmed is usable.** A run pushed
  ~66 hand-computed ops trusting an advisor to catch the arithmetic, then could not filter
  its 2,541 findings; every op was one cell low. That is not verifying.

## Known traps

- **A hall's auto-centred door lane can land on a pillar**, and the call answers `failed`,
  not a refusal. Two moves clear it: set a door offset whose lane misses the pillars, or a
  pillar spacing that does not align with the lane.
- `world.bake` refuses an unnamed world. Name it with `world.saveAs`, which takes one —
  **`world.save` cannot.** It takes no input, answers ok, and opens a naming drawer for the
  human; the world stays untitled and the next bake refuses again.
- **`world.bake` also repoints the project default at that world**, rewriting
  `worlds/index.json`. Baking is not only compiling.
- Baking re-derives the player spawn from the editor camera's eye, so a bake can put the
  spawn outside the world you just built — and it seeds the walkability analysis, degrading
  that too. Park the camera somewhere walkable first.
- **The scatter generator's `variants` is not bounded by the archetype's mesh count**,
  and its default exceeds at least one shipped archetype. Read the catalog and pass a
  legal value, or the world throws when the game loads it.

## Composing

Correct is not the same as convincing.

- **Material is what makes a place a place.** Walked: two sharing a material read as one
  whatever their dimensions — a 5 m gallery and a 12 m hall, both masonry, came back as
  "rooms"; the pair differing in material AND form was told apart on sight. Spend a class
  per place that must read as distinct. When they run out, say so — that is the ceiling,
  not a cue to vary numbers.
- **Contrast makes hierarchy, not identity.** A tall space reads as tall only if
  approached through a low one — that works. It does not make it a DIFFERENT place:
  height and width contrast did no identification work.
- **Vary the section along a passage.** A constant cross-section is the one thing the
  human called boring; a square one reads as manufactured, not natural.
- **Uniqueness by scarcity does not scale.** Two odd places make two landmarks; ten need
  real differentiation. If you cannot tell two apart in a sentence, neither can the
  player.
- **Loops beat dead ends.** Two ways between two places turn backtracking into a circuit.
- **Entrances and thresholds are moments — and that is where the wedge will be.** Build
  the junction where one kind of space breaks into another, then PROBE it: two cycles,
  both wedges at a threshold.

## Ambition, and what to do when you hit a wall

- "Build a world" means the substantial reading, not a demo room. **State the plan
  first** so the human can dial it.
- Improvising around a gap is right mid-build; **filing it by name afterwards is
  required too** — an entry under `docs/backlog/<topic>/`, in the shape that directory's
  README documents. Unfiled, a capability gap becomes folklore instead of work.
- Say what you could not do, in plain words, in the report.

## Legibility to the human

- Build on a **scratch world**, never one that matters.
- Name it for what it is.
- Tell the human **where**, in world metres. They cannot see your coordinates.
- Take captures at the end, of what you are claiming.
- **Separate what you measured from what you concluded.** A conclusion in a measurement's
  clothes costs its reader more than "I did not check this" ever would.

## Growing this skill

- **A rule enters here only when a run showed an agent failing without it.** That gate,
  not terseness, is why this is short.
- Lessons go to `docs/learnings/` as dated entries, never appended here — everything above
  rests on that directory's `agent-world-building-cycle-*` files.
