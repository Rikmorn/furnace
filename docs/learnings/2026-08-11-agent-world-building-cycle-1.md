# Agent world-building, cycle 1: the discipline was there, the aim was wrong (2026-08-11)

The baseline run behind `packages/editor/.claude/skills/sculpting-worlds/SKILL.md`. Every
rule in that skill traces to a failure recorded here; this file is the evidence, and the
first entry in the cycle it describes.

## The run

2026-08-11. A fresh agent, **no skill loaded**, driving the live editor over its MCP door
by JSON-RPC. The ask, verbatim:

> Build me an abandoned mine that broke into a natural cave system, on more than one
> level, that I can walk through.

Bounded at ~50 door calls. It used 45.

## What it built

7 entities — 1 hall, 1 maze, 3 caves, 2 scatters — **42 props with a clean lint** (0
floating, 0 overlapping), 517 chunks, 966 ops in 12 undo entries. A room-and-pillar stope,
a haulage drift with alcoves, a cross-cut into old workings, a hole-through into a cave,
and **two independent descents** — a switchback incline and a five-leg spiral winze — so
the level pair forms a loop rather than a dead end.

All of that was verified independently, from the door and from disk. None of it is taken
from the agent's own report.

## Finding 1 — the discipline was already there

The prior going in was that an unguided agent under-scopes and skips verification. **That
prior was wrong.** Unprompted, it:

- derived the generator coarse-cell size and anchor corner empirically — committed a probe
  hall, read its footprint back;
- ray-fixed the floor height rather than assuming it;
- verified junctions by ray, not by eye;
- caught and repaired a cross-cut that dead-ended 1 m short of the maze — a defect nothing
  had told it to look for;
- probed both ramps' floor continuity against predicted heights;
- batched 966 ops into 12 undo entries.

Guidance aimed at "make the agent verify" would have been aimed at a problem it did not
have.

## Finding 2 — the verification was aimed wrong

It probed **straights and mid-spans**, which were all fine. **Every defect was at a
corner.** The method was sound and systematically pointed at the wrong places. This is the
finding that changes what guidance is worth writing: not *verify more*, but *verify at
corners, thresholds and joins*.

## Finding 3 — no design language at all

The report was gradients, clearances, widths and probe results, end to end. **Not one
sentence about whether the space read as anything** — no contrast, no hierarchy, no
landmark, no threshold. The vocabulary for "is this convincing to walk through" was simply
absent, and nothing in the tooling supplies it.

## Finding 4 — it worked around gaps and filed none

One probe found solid rock where the generators' own doors should have opened. It abandoned
that route, hand-carved past the problem, and mentioned it **only when asked**. A capability
gap that a build routes around silently becomes folklore instead of work.

## Finding 5 — measured and inferred were mixed with no marker

Its *measurements* held up under independent check. Three of its **conclusions** were
carried forward as facts by the reader; two were later disproved outright:

- that `world.saveAs` repoints the project default — it does not; **`world.bake` does,
  every time**;
- that setting an explicit door offset cannot move a hall's reported blocked cell —
  sweeping the offset **does** move it, and some offsets succeed.

A third — that cave footprints come back about 2 m larger than the requested region — did
not reproduce when checked against the live entity list.

**This is the finding with the longest reach: nothing in the report distinguished the two
kinds of statement.** A conclusion in a measurement's clothing propagates, and costs its
reader more than an explicit "I did not check this" ever would.

## The human walk

Not boring; **the branching reads**. Four observations, none of them predicted by any
measurement:

- The dullest stretch was a **hand-dug passage of uniform square cross-section** — flat
  variance along a path, and a square section reads as manufactured, not natural.
- Two places worked as landmarks **by scarcity**. In the walker's own words: if they
  repeated, more would be needed to tell them apart. Scarcity is a ceiling, not a
  technique.
- A character **wedged at a corner where two swept capsules met**.
- The walker **did not know one of the two shipped prop archetypes existed**. Vocabulary
  discoverability is not only an agent problem.

## The measurement

The project's walkability advisor, run offline over the saved world — `bun
scripts/measure-analyze.ts` from `packages/dungeon`, which analyses the generated cave
configs and every **local** v2 field world under `worlds/`:

| Measure | Result |
|---|---|
| Candidates on walkable ground | **16** (82 raw) |
| Pit regions | **0** |
| Project bar | ~15 candidates, ~0 pits per world |
| Flood coverage | 7,119 of 7,342 flags reached; 223 unreachable; **0 never-visited** |

Where each number sits in that output: the per-world block (`── local field world "red-1"
──`) carries the flood counts on its `ALL` row and the candidate counts on its
`DEFAULT-VISIBLE` row; the closing `── P-F4-3b bar ──` restates the world as one summary
line. **The `0 never-visited` is not printed at all** — `reachable` counts `unreachable !==
true`, merging `false` with `undefined`, so the tri-state split (7,119 / 223 / 0) is a
separate read over the same store.

**And the summary line carries no `seeds usable/given` column.** The 12-config walked
matrix has one; the committed-world rows do not. Read on its own, that line cannot tell *the
flood reached everything* from *the flood seeded nothing* — a world with no usable seed
prints `0 pit region(s)` for the same reason a clean world does, because `markUnreachable`
and `detectPits` both skip it. The per-world block above is where the check lives: `red-1`
reports `seeds: 1/1 usable`.

**All 16 candidates are `narrow`.** Twelve sit in the lower level and the descents. Four
stack vertically at x ≈ 8.5, z ≈ −6 across y −9.00 to −9.75 — **one per elbow of the
spiral descent, which is exactly where the human wedged.** The bar for `narrow` is 0.68 m
of free width.

## The artifact that is not there

The world was saved locally as `red-1` under `packages/dungeon/worlds/`. It is **not in the
repo**: `packages/dungeon/.gitignore` excludes `worlds/*` apart from `index.json` and
`default`. So the table above is one machine's scratch bake, nobody else can re-run the
command against it, and cycle 2 has nothing to diff — **a cycle designed as a before/after
kept no committed before.**

## The conclusion that matters most

**The analyzer named the defect correctly and the finding reached nobody.** The chrome
shows those flags to a human in a palette; the agent door has no arm to ask for them. Not
a missing tool — an unexposed one. Every other gap in this run costs a build; this one
costs the ability to learn from a build.

## What the run produced

Three backlog entries — read them for the gap detail rather than restating it here:

- `docs/backlog/engine-architecture/stamps-not-authored-to-connect.md`
- `docs/backlog/engine-architecture/scatter-variants-not-bound-to-archetype.md`
- `docs/backlog/editor-and-tooling/agent-can-add-but-cannot-revise.md`

## What cycle 2 should test

The skill loaded, against an ask that needs **more than two places that must read as
different**. Cycle 1 got its two landmarks by scarcity and the walker said so; an ask that
demands three or four puts that ceiling under direct test, and tests whether the
`## Composing` rules survive contact with a world where scarcity cannot do the work.
