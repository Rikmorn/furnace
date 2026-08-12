# The advisor answers volume, not questions — and one of its kinds can never be actionable

Filed at sculpting-worlds cycle 2's review (2026-08-12) from that cycle's E1 monastery run
plus an independent analyzer re-run. Two gaps, one shape: the walkability advisor computes
more than it says, and says more than a caller can use. The `flags` arm built at cycle 2's
E0 is what made both visible — it is doing its job; what it relays is the problem.

## 1. `low-clearance` is excluded from walkable ground BY CONSTRUCTION, and the wire does not say so

The project's stop condition is read against **walkable ground**, defined in
`packages/dungeon/scripts/measure-analyze.ts` as a flag whose anchor cell is BOTH reachable
(`unreachable !== true`) AND standable (a floor anchor with a full `clearance` air run above
it). That script's own comment states the consequence: `low-clearance` *"anchors on the
OFFENDING NEIGHBOUR and is therefore **excluded ALWAYS**"*.

**Measured, not reasoned** — `bun scripts/measure-analyze.ts` from `packages/dungeon`,
2026-08-12, local artifact on the authoring machine. Across all twelve worlds and cave
configs the run covers, `low-clearance` scores **1,117 candidates total and 0 on walkable
ground in every single one**:

```
grep "low-clearance    candidate" <output>
   →  2/0   12/0   42/0   66/0  185/0  171/0   28/0  184/0  345/0    6/0   64/0   12/0
      (total / walkable-ground, one row per world)
```

So the kind is structurally non-actionable under the definition the project measures itself
by — and `session_query {about:"flags"}` relays it as `severity: "candidate"`, indistinguishable
from `narrow`. In the cycle-2 run that was **184 of 255 candidate rows**, 72% of the payload,
which the agent duly reported and could not triage. It also blew the `MAX_REPORTED` cap and
set `truncated: true`, so the rows that WERE actionable were the ones at risk of being cut.

Two things this is NOT. It is not "the advisor is wrong" — `low-clearance` is a real geometric
finding and the chrome's panel is right to draw it. And it is not fixed by relaying the
standable test: the honest fix is for the wire to carry the distinction the stop condition
already draws, so a caller can ask for what it can act on. Note the tri-state `unreachable`
tag IS already on the wire, so leg (i) of the definition is relayable today; leg (ii)
(standability, re-derived in `measure/solidity.ts`) is not.

## 2. No filter, no rollup — so the answer's size is the world's size

2,541 findings, `truncated: true`, and no way to ask for "candidates only", "inside this box",
or "in the crypt". 90% of that payload (2,286 rows) was `info` severity. The practical result
in the run: **the advisor's numbers were reported rather than used** — none of the 184
low-clearance candidates were triaged, because there was no way to narrow them to a place.

Wants: filter by kind / severity / region, and a per-region rollup so *"crypt 40, cave 200,
cloister 0"* is one call. A rollup is the higher-value half — it turns the advisor from a list
into a map, which is the form a world-builder can act on.

**This gap has a walked defect behind it.** The owner's cycle-2 walk found a wedge at the cave
mouth. The analyzer re-run puts `narrow` candidates with **0.25 m free width against a 0.68 m
bar** at (21.13, 2.50, z 15.88–17.13) and 0.5 m ones at (19.63–20.88, 2.00–2.50, 17.38) — the
climb from the built corridor at y = 0.5 up into the cave floor at y = 2.5, which is where the
E1 report puts the east threshold. The finding reached the agent and was undigestible. Cycle 1
recorded *"the analyzer named the defect correctly and the finding reached nobody"*; cycle 2 is
that one level up — **it reached the agent in a shape it could not use**, which is the same
failure wearing a door.

## 3. Reachability cannot be seeded by a caller — and this is an EDITOR gap, not a core one

**A correction to the E1 report, verified in source at review.** That report's §3 proposes
*"let the flood take a caller-supplied seed"* as a core change. `markUnreachable` and
`detectPits` are public exports of `@furnace/core/field` and **both already take
`seeds: readonly [number, number, number][]`** (`packages/core/src/field/reachability.ts`,
exported at `index.ts`). Core is already caller-seeded. What is hard-wired is the
EDITOR: `analyzerSeeds` in `field-analyzer.ts` seeds both passes from the loaded world's
manifest `playerStart` and nothing else, and no door verb sets `playerStart`.

The consequence is what cycle 2's run hit: the flood seeds from a spawn the bake derives from
the human's camera, so a bad spawn vacates the entire reachability analysis. In E1 that is
exactly what happened — the bake wrote `playerStart` 27 m up inside solid rock, every flag came
back with `unreachable` ABSENT, and the agent correctly refused to claim reachability. The
world's own answer was unavailable through no fault of the world.

`about="connected", points: [[…],[…]]` → *"these N points are/aren't one component"* is the
shape the world-builder actually wants, and it is a small wrapper over machinery that already
accepts the argument. **This is the item whose classification the owner's cycle-2 ruling got
wrong** (it was listed among "CORE/engine surface"); recording the correction here so cycle-3
planning does not scope a core change that is already built.

**Trigger to revisit:** **cycle-3 planning takes these as its E0-equivalent** (ruled by the
owner at cycle 2's close, 2026-08-12; §2 PROMOTED into that set at review, on the confirmed
cave-mouth candidates above). Sooner if any consumer other than the chrome's panel reads
flags.

**Reference:** `packages/editor/src/field-host/field-query.ts` (`flagsAnswer` — relays kind,
severity, position, tri-state `unreachable` and verdict; no standability, no filter);
`packages/editor/src/field-host/field-analyzer.ts` (`analyzerSeeds` — the `playerStart`-only
seeding); `packages/core/src/field/reachability.ts` (`markUnreachable` / `detectPits`, both already
seed-taking); `packages/dungeon/scripts/measure-analyze.ts` (the walkable-ground definition
and its `low-clearance` exclusion note);
`docs/learnings/2026-08-12-agent-world-building-cycle-2.md` §3 and §6.
Siblings: `docs/backlog/engine-architecture/field-read-surface-gaps.md` (the CORE half of the
same four items), `edit-apply-reports-nothing-about-what-it-wrote.md`,
`pending-zero-cannot-say-the-advisor-is-off.md` (the other freshness debt on the same arm).
