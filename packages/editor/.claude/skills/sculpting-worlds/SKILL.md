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

Correct is not the same as convincing.

- **Contrast makes hierarchy.** A tall space reads as tall only if approached through a
  low one. Vary height, width and density between neighbours.
- **Vary the section along a passage.** A constant cross-section is the one thing the
  human called boring; a square one reads as manufactured, not natural.
- **A landmark must be useful** — something to navigate by: distinctive in shape, scale
  or material, not decoration.
- **Uniqueness by scarcity does not scale.** Two odd places make two landmarks; ten need
  real differentiation. If you cannot tell two apart in a sentence, neither can the
  player.
- **Loops beat dead ends.** Two ways between two places turn backtracking into a circuit.
- **Give districts different material.** The material change is what makes a transition
  legible as one.
- **Entrances and thresholds are moments.** Build the junction where one kind of space
  breaks into another; don't let it fall out of the carve.
- **Sightlines are opportunities, not guarantees.** A long clear view lets a player
  orient; it does not make them.

## Ambition, and what to do when you hit a wall

- "Build a world" means the substantial reading, not a demo room. **State the plan
  first** so the human can dial it, then build it.
- Improvising around a gap is right mid-build; **filing it by name afterwards is
  required too** — an entry under `docs/backlog/<topic>/`, in the shape that directory's
  README documents. The baseline improvised around three real gaps and filed none; that
  is how a capability gap becomes folklore instead of work.
- Say what you could not do, in plain words, in the report.

## Legibility to the human

- Build on a **scratch world**, never one that matters.
- Save under a name that says what it is.
- Tell the human **where**, in world metres. They cannot see your coordinates.
- Captures are proof, not navigation — take them at the end, of what you are claiming.
- **Separate what you measured from what you concluded.** The baseline's report mixed
  both with no marker between them: its measurements held up under independent check;
  three conclusions were carried forward as facts, and two were later disproved. A
  conclusion in a measurement's clothes costs its reader more than "I did not check
  this" ever would.

## Growing this skill

- **Build lessons go to `docs/learnings/` as dated entries, never appended here.**
  `AGENTS.md` § Keeping docs current forbids a tracked doc that is a constant write
  target: it grows without bound and rots in place. Everything above rests on
  `docs/learnings/2026-08-11-agent-world-building-cycle-1.md`.
- **A rule enters here only when a run showed an agent failing without it.** That gate,
  not terseness, is why it is short.
- A new generator, material or archetype needs **no edit** — the vocabulary is read at
  runtime, not listed. A capability that retires a procedure does: a generator spanning
  storeys would end the advice on hand-carving between levels.
