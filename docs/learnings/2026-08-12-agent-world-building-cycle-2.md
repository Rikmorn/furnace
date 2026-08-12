# Agent world-building, cycle 2: the skill held; the door cannot measure unbuilt space; material is what makes a place (2026-08-12)

The second entry in the cycle `docs/learnings/2026-08-11-agent-world-building-cycle-1.md`
opened. **Sections up to "The tool surface" are the E1 executor's own, written before the
owner walked and left as written.** Everything from *The walk* onward was added at the review
session the same day, including two corrections to the executor's text — marked where they
land, never edited over.

**Artifact policy.** The world `monastery-in-the-rock` is a **local artifact on the authoring
machine**: `packages/dungeon/.gitignore` excludes `worlds/*` apart from `index.json` and
`default`, by the owner's cycle-2 ruling (`docs/backlog/infrastructure/skill-cycle-worlds-have-no-durable-home.md`).
Nobody else can re-run a command against it. Every number below carries the command that
produced it so the derivation is checkable even though the input is not.

Cycle 1 asked whether an agent had the discipline to build a world. It did; the aim was
wrong, and `packages/editor/.claude/skills/sculpting-worlds/SKILL.md` was written to fix
the aim. **Cycle 2 E1 is the first run with that skill loaded.** The skill held — corners
were probed, gaps were filed, measurement stayed separated from conclusion. What the run
found instead is a structural limit in the door, and a set of expressiveness gaps in the
editor that bind the human as much as the agent.

## The run

2026-08-12. Fresh session started in `packages/editor`, skill loaded, driving the live
editor over its MCP door. Budget 80 door calls; **58 used**. The ask, verbatim:

> Build me a monastery buried in the rock: the long cloister, the refectory, the
> scriptorium, the crypt, and the spring cave the monks built it all around. Five places —
> walking from one into another should feel like crossing into somewhere else.

World `monastery-in-the-rock`, named and baked. Nothing committed.

## What stands

All coordinates world metres, Y up. Built level floor **y = 0.5**; crypt **y = −6**; cave
floor **y = 2.5–3.0**.

| Place | Extent (x / y / z) | What it is |
| --- | --- | --- |
| Cloister | 0..6 / 0..4.5 / **0..34** | Two `hall` stamps butted N–S into one 33 m colonnaded gallery, 5 m wide, 3.5 m high, masonry. The spine. |
| Refectory | −17..−4 / 0..4 / 5..16 | 12 m wide, **3 m** high, grid piers. Entered west through a 5 m compression tunnel (2.0 × 2.2 m) at z ≈ 10.5. |
| Scriptorium | −0.5..6.5 / 0..7 / 38..46 | 6 × 7 m plan, **6 m** high. Entered north through an identical 2.2 m tunnel — low passage into double height. |
| Crypt | 11..29 / **−6..−3.75** / −14..−2 | 18 × 12 m, 2.25 m headroom, 11 rock piers, dirt-painted with piers repainted rock. Two-flight stair from the cloister's south end, turning east on a landing at y = −3. |
| Spring cave | 12..44 / 0..16 / 4..28 (carve AABB) | `cave`, 4 chambers r=7, verticality 0.7. Moss-stone, 34 props, a basin cut at (26, 2.5, 15). |

The loop: cloister → east threshold (z=15) → cave → long ascent → crypt → stair → back to
the cloister's south end. Refectory and scriptorium are the two deliberate dead ends.

Contrast was carried by form and material, since there are only four material classes:
narrow/low masonry gallery → broad/low pier hall → tall masonry shaft → low rough dirt
crypt → irregular moss-stone cavern.

## MEASURED

- Fresh world is **solid rock everywhere** — ray at (20,40,20) returns distance 0.
- Cloister: one clear **33.65 m** sightline, z=0.6 → 34.25. Both stamps' auto-centred
  doors line up; the colonnade never enters the centre lane.
- Refectory link: clear **21.5 m**, x=5 → −16.5 (tunnel, door, and across the pier field).
- Scriptorium link: clear **15.75 m**, z=30 → 45.75.
- Cave: **17.25 m** continuous void at y=5 (x=14.5 → 31.75). Floor **3.0** at x=22,
  **2.5** at x=26.
- Stair landing exactly **y = −3.0**, 2.2 m headroom. Crypt floor exactly **y = −6.0**.
  Mid-ascent floor **y = −2.0** at (16, 6.2).
- Props: **34/34 scanned, `floating: []`, `overlapping: []`, not truncated** — after
  fixing 2 stalagmites the lint caught at 0.264 m against a 0.25 m threshold.
- Advisor, `pending: 0`: **2541** findings — 890 ledge + 1396 lip-near-wall (*info*),
  **184 low-clearance + 71 narrow (*candidate*)**. No pit rows. `truncated: true`.
- Bake wrote `playerStart` = **[2.27, 27.38, 55.68]** — 27 m up and 22 m north of anything
  built, inside solid rock.

## CONCLUDED, not measured

- **That the five places read as distinct.** Design intent from contrast in
  width/height/material. Nobody has walked it.
- **That the loop is traversable.** Each link was measured separately; the whole was never
  traced, and the crypt↔cave junction at z 12.5–13 is arithmetic on two of the agent's own
  boxes, not a probe.
- **Reachability is unverified.** Every flag row came back with the `unreachable` tag
  *absent* — the flood had not visited, which is not "reachable". The flood seeds from
  `playerStart`, which at bake time was the bad spawn above.
- **The 255 candidates are unadjudicated**, and `truncated: true` means not all rows were
  seen.
- The world has **never been loaded by the game**, only baked.

## Gaps filed

Three new drafts, uncommitted:

- `editor-and-tooling/action-run-input-is-schema-untyped.md`
- `engine-architecture/kit-lattice-excludes-a-walkable-stair.md`
- `engine-architecture/lattice-aligned-box-op-writes-nothing.md`

Two existing entries confirmed with fresh measurement, not duplicated:

- `editor-and-tooling/agent-can-add-but-cannot-revise.md` — §4 (camera/spawn) reproduced
  exactly; and `edit.delete` proved unreachable for a second reason (it confirms against
  the *selected* stamp, and no agent verb selects an entity).
- `dungeon/content-vocabulary-is-the-differentiation-ceiling.md` — four material classes
  for five places.

---

# The tool surface

Ranked by what it cost the run. Items 1–6 are door-shaped; 4, 7, 10 and 11 bind the human
author too.

## 1. The structural one: only carved space can be measured

A ray from inside solid returns 0, so **the field is unqueryable except through voids the
caller already made**. The cost of finding out where something is scales with how much has
already been dug — backwards.

Concretely: *"where is the floor of the cave I just generated?"* cost a failed tunnel, two
viewport captures used as an X-ray aiming device, an entity query that returned a useless
AABB, a dive into `packages/core/src/field/cave.ts`, a speculative 8 m-tall dig, and two
probes. **Eight door calls and a source read to answer one question about an object the
editor had just created.** The source read was decisive and free — but only because this
agent had filesystem access. One driving a remote editor could not have recovered.

Three fixes, cheapest first:

- **A ray that returns all crossings, not just the first hit.** One ray down a column from
  outside the world reports the entire vertical structure — `solid 0→2.5, air 2.5→8,
  solid 8→…`. This alone replaces most of those eight calls. Small change to
  `raycast.ts`; highest value-per-effort item on this list.
- **A heightfield query** — surface Y over a region on a grid. That is what "is this
  walkable, and at what level" actually wants.
- **Entities report structure, not a bounding box.** `about="entity"` returned
  `min [12,0,4] max [44,16,28]` for the cave — a box that is ~90% rock. `buildChambers`
  had already computed exact centres, radii and floor heights and discarded them. The
  generator knows; the door doesn't say.

## 2. Doors are advertised as connections but carry no position

Every generator has `doorNorth/South/East/West`, which reads as a connection affordance.
But a door opens into solid rock, and **you cannot ask where it is**. Worse for the cave:
`buildMouths` sets the mouth's height from the nearest chamber's floor, so it is
unknowable without reading source.

If `about="entity"` returned each door's world position and bore size, the entire
cave-hunting episode collapses into one query and one straight tunnel. Smallest change,
largest effect on "can an agent assemble stamps into a building".

## 3. Reachability — the question most wanted, and unavailable

*"Is every place reachable from every other?"* is the world-builder's question. The flood
exists in `reachability.ts`. It seeds from `playerStart`. `playerStart` is not settable.
So the analysis that would have validated the loop in one call was unavailable, and eight
rays were substituted that each verified one link and never verified the whole.

**Let the flood take a caller-supplied seed** — or better,
`about="connected", points: [[…],[…]]` → "these N points are/aren't one component". A
small wrapper on existing machinery that converts this run's weakest claim into a
measurement.

## 4. The brush vocabulary is too primitive for architecture

Three staircases were built from **~66 hand-computed axis-aligned boxes**, each a
`center`/`halfExtents` triple whose arithmetic the agent did by hand — carrying a
systematic one-cell error through all of them, caught only by accident via the prop lint
on an unrelated check.

The gap is altitude, not count:

- **A stair/ramp op** — A to B, width, riser, engine tiles it. One op instead of 28, and
  the 0.4 m step limit becomes the engine's problem rather than the caller's.
- **A polyline sweep.** `capsule` takes exactly one segment, so every elbow is a separate
  op and every join is the caller's to get right.
- **A vaulted section.** Today the choice is `box` (square slot — "reads as manufactured",
  the exact thing the skill warns against) or `capsule` (round tube with a curved floor
  you cannot stand flat on). There is no flat-floor/arched-ceiling primitive, the most
  common architectural section there is. Everything in this monastery is square-sectioned
  because those were the options.

This one binds humans equally.

## 5. `edit_apply` reports nothing about what it did

`{"ok": true}` — no dirty count, no written-sample count, no touched bounds, while
`generate` returns `dirtyChunks`. That asymmetry is exactly how the lattice-aligned no-op
went undetected: a write that changed zero samples was indistinguishable from one that
worked, and was caught only because an unrelated measurement came back byte-identical.
Every write verb should report what it wrote.

## 6. The advisor produces volume, not answers

2541 findings, `truncated: true`, no filters — no way to ask for "candidates only", "inside
this box", or "in the crypt". 90% of the payload (2286 rows) was `info` drowning 255
candidates. The practical result: **the advisor's numbers were reported rather than used.**
None of the 184 low-clearance candidates were triaged, because there was no way to narrow
them to a place.

Wants: filter by kind / severity / region, and a per-region rollup so "crypt 40, cave 200,
cloister 0" is one call.

## 7. Units and anchors are a constant tax

Hall in 0.5 m cells, maze in 2.5 m cells, cave radius in metres, field in 0.25 m,
footprint = interior + a 1 m shell. The run got it right only by spending a call measuring
entity 308 immediately to confirm the mapping before trusting it — verification that
should not be necessary.

Worse: `doorNorthOffset` ranges to 28 on the hall, 7 on the maze, 62 on the cave, **in
units the schema never states**. Door offsets were therefore avoided entirely — an entire
expressive axis lost to undocumented units, and precisely the axis that would have allowed
aiming doors instead of hand-carving junctions.

Fix: let `generate` take an interior extent in metres, or state offset units in the schema.

## 8. No agent-side undo, and `dig` has no inverse

The door says "to reverse something you just did, apply the inverse ops explicitly." True
for `fill`. **False for `dig`** — the destroyed material class cannot be restored. So an
agent's mistakes are permanent, which makes agents timid in the wrong direction: carves
were sized conservatively all session because none could be taken back.

Attribution is the known blocker. Worth knowing it is load-bearing for how *ambitious* an
agent will be, not only for history hygiene.

## 9. Cheap wins

- **Batch queries.** 14 rays were 14 round trips. A `rays: [...]` batch is trivial and
  would have paid for itself several times over.
- **`about="catalog"`.** Materials / archetypes / agent config were read off disk.
  `project_get` returns a *path*, quietly assuming filesystem access — an agent driving a
  remote editor cannot read the catalog at all, and would hit the stalagmite `variants`
  trap face-first.
- **An aimable off-screen capture** (`eye` / `target`, not touching the human's camera).
  There are no interior shots of anything built in this run — every picture is a distant
  X-ray, because axis snaps inherit wherever the human's camera happened to be, and
  `view.frameWorld` had to be pressed (moving their view) just to get a legible overview.
  This does not violate the "capture is for LOOKS, not WHERE" principle; it is what makes
  the LOOKS judgment possible where the agent built rather than where the human stands.

## 10. Painting is volumetric, not surface-aware

The crypt was painted by dropping one large box and then re-painting 11 pier boxes to
locally undo it. There is no "floor only" / "below Y" / "surfaces facing up" mask, so a
basic environment-art move has to be expressed as slab arithmetic. Binds humans equally.

## 11. Material and prop vocabulary is thin

Four material classes (rock, dirt, moss-stone, one kit) for five places; two prop
archetypes, both rocks. A monastery wants worked stone vs rough stone vs plaster vs tile
vs timber, and props that are furniture rather than geology. Already filed as the
differentiation ceiling; this run is a second data point at a larger scale.

## What is genuinely good

Worth protecting in any redesign:

- **The tool descriptions are the best-written MCP surface encountered.** `cursor` as an
  opaque token, `armed` vs `brush`, "empty means nothing is wrong *unless* truncated" —
  those distinctions pre-empted real errors rather than explaining them afterwards.
- **The prop lint** caught a defect no eye would find, and its contact rule is *defined*
  rather than eyeballed — which is the only reason it was actionable.
- **Refusals name the failing index and the reason** (`ops[0] — kit-class box must sit on
  the 0.5 m lattice`), which turned a dead end into a design finding in one step.
- `generate` **reporting the seed it actually used**, and **batch-as-one-undo-step**, are
  both right.

## Suggested disposition

Plan, don't backlog — small, and each removes a whole class of blind work:

1. All-crossings ray (§1)
2. Door positions on `about="entity"` (§2)
3. Caller-seeded reachability (§3)
4. Write-counts from `edit_apply` (§5)

Backlog with triggers — larger, and they change the editor's authoring model, not just the
door:

5. Stair/ramp op + vaulted section (§4)
6. Advisor filtering (§6)
7. Surface-aware painting (§10)
8. Material/prop vocabulary (§11, already filed)

Already filed, unchanged: `action_run` input schema, kit lattice vs step height,
lattice-aligned no-op, agent revision/undo, camera and spawn.

## What the agent got wrong, independent of tooling

- Two viewport captures were spent as X-ray aiming devices before reading `cave.ts`.
  Reading the generator source was free and decisive and should have come first — the
  skill says "read the box before you build", and the generator's *source* is part of that
  box whenever the registry schema is silent on behaviour.
- The one-cell fill bias went unnoticed through ~66 ops because the agent trusted its own
  arithmetic and deferred tread-level verification to an advisor whose output it then
  could not filter. Deferring verification to a tool you have not confirmed is usable is
  the same mistake as not verifying.
- The loop was reported connected on arithmetic at one junction. It should have been
  probed, budget permitting — 22 calls were left unspent.

---

# The walk (the owner, 2026-08-12, after a re-bake with the camera parked)

## MEASURED — the owner's verdict, verbatim

> "i've walked the world, it was fine apart from being stuck at the cave mouth and it having
> a hole to empty space, feel was good though"

and, on the five blind place-identifications:

> "yes and no, i could tell they were supposed to be different, but it was too simplistic for
> me to really differentiate, but that's a limitation on the tools and what we can do. The
> spring cave looked different from the crypt for instance and recognisably even if the
> cloister and refectory kinda look like rooms … it's not a huge issue as the tool doesn't
> let us be that expressive"

**This is the cycle's designed measurement and it came back mixed, which is the useful
answer.** Cycle 2 was set up so that "the vocabulary ceiling held — two of five places were
indistinguishable" would count as SUCCESS. It held, and the walk isolated *which variable*
does the work:

| Pair | Material | Form | Read as distinct? |
| --- | --- | --- | --- |
| spring cave vs crypt | moss-stone vs dirt — **different** | irregular cavern vs pier grid | **YES, "recognisably"** |
| cloister vs refectory | masonry vs masonry — **same** | 5 m colonnade vs 12 m pier hall | **NO — "rooms"** |

The failing pair carried a **2.4× width contrast** (5 m vs 12 m) plus a height difference, and
still read as one kind of place. Dimensional contrast did no identification work; material plus
form did all of it. *(The scriptorium drew no comment either way — two of the three masonry
places are the evidence, not three.)*

## CONCLUDED, not measured

- **That the composition half is separable from the vocabulary half.** The owner books the
  ceiling to the tools, and for material scarcity that is right — four classes cannot serve
  five places. But cloister and refectory were the **same generator (`hall`), same material,
  same feature (piers)**, differing only in dimensions: the agent spent its scarcest axis
  identically on both. That reading is the review's, not the owner's, and it is an inference
  from the build record rather than from anything the walker said.
- **That the scriptorium read as distinct.** No data either way.
- The **dullest stretch** and the **defect locations** were not collected. Part W asked for
  both; the walk verdict arrived as prose and the review did not get them. That is a gap in
  this record, stated rather than filled in — see the void-hole entry, which cannot be closed
  without a location.

# What the review measured, after the re-bake

`bun scripts/measure-analyze.ts` from `packages/dungeon`, 2026-08-12, **local artifact on the
authoring machine**. Run AFTER the owner's pre-walk re-bake with a parked camera, which is what
makes these numbers mean anything — E1's own bake had put `playerStart` inside solid rock.

| Figure | Value | Note |
| --- | ---: | --- |
| seeds | **1/1 usable** | E1's flood never ran; this one did |
| chunks / placed props | 329 / 34 | |
| flags, all kinds | **2,541** | identical to E1's live read |
| floor columns | 13,839 | |
| climb flood / enterable flood | 13,458 (97%) / 13,474 (97%) | cross-check agrees on every tagged flag |
| candidates, raw → walkable ground | **255 → 71** | |
| pit regions | **0** | the detector ran, and found none |

**The finding that matters most, and it is not about this world.** `low-clearance` scores **0
on walkable ground in all twelve worlds and cave configs the run covers — 1,117 candidates,
zero actionable, every time** (`grep "low-clearance    candidate"` over the output: totals
2/12/42/66/185/171/28/184/345/6/64/12, walkable-ground column 0 in every row). The script's own
comment says why: it anchors on the **offending neighbour**, which is excluded from standable
ALWAYS. So the kind is structurally non-actionable under the project's own stop condition — and
`session_query {about:"flags"}` relays it as `severity: "candidate"`, indistinguishable from
`narrow`. In the run that was **184 of 255 rows**, and it blew the `MAX_REPORTED` cap, so
`truncated: true` was cutting the rows that *were* real.

Cycle 1's conclusion was *"the analyzer named the defect correctly and the finding reached
nobody."* Cycle 2 is that one level up: **it reached the agent in a shape it could not use.**
Building the door was necessary and not sufficient.

**Where the wedge probably is** — INFERRED, not confirmed by the owner. `narrow` candidates
with 0.25 m free width against a 0.68 m bar sit at (21.13, 2.50, z 15.88–17.13), and 0.5 m ones
at (19.63–20.88, 2.00–2.50, 17.38): the climb from the built corridor at y = 0.5 into the cave
floor at y = 2.5, which is where E1 puts the east threshold. Consistent with the one-cell fill
bias E1 confessed to. The owner was asked to confirm hard-stop vs sawtooth (the latter would
implicate the tracked `organic-cave-mouth-offaxis-rimride` class instead) and did not; both
remain open.

# Two corrections to the executor's text above

Left in place rather than edited over, because a record that quietly fixes itself teaches
nothing.

1. **§3's "let the flood take a caller-supplied seed" is already true in core.**
   `markUnreachable` and `detectPits` are public exports of `@furnace/core/field` and **both
   already take `seeds: readonly [number, number, number][]`**
   (`packages/core/src/field/reachability.ts`, exported at `index.ts:101`). What is hard-wired
   is the EDITOR: `field-analyzer.ts:433` seeds from the manifest `playerStart` and nothing
   else. The item is editor-local, not core — and the owner's disposition ruling had classified
   it as core, so cycle 3 would have scoped a change that is already built.
2. **§2's door-position item splits core/editor too.** The generators discard the centres,
   radii and floor heights they compute (core); the entity arm would have to relay them
   (editor). Filed against `stamps-not-authored-to-connect.md`, whose FIRST listed fix option
   this already was — the entry predicted the gap in June and named the shape.

Both corrections came from reading the source at review rather than from re-running anything.
That is the cycle-1 lesson (*four false facts entered by trusting a report's inferences*)
collecting for a second time, on a report that was otherwise scrupulous about the distinction.

# What the skill learned

Four `§Composing` bullets went into cycle 2 ON TRIAL, per the cycle-1 seal. Adjudicated
against this run, at the word pin the owner ratified (1,100):

| Bullet | Verdict | Evidence |
| --- | --- | --- |
| *Give districts different material* | **KEEP**, rewritten and promoted to first | the only pair that read distinctly is the different-material pair |
| *Contrast makes hierarchy* | **REWRITE** — "…not identity" | applied twice, and dimensional contrast did no identification work |
| *Entrances and thresholds are moments* | **REWRITE** — joined to probing | two cycles, two walks, both wedges at a threshold |
| *A landmark must be useful* | **STRIKE** | zero evidence across two runs: no agent built one, no walker navigated by one |

Three rules were added on run evidence: the generator's **source** is part of the box (§1's
eight wasted calls); **never defer verification to a tool you have not confirmed is usable**
(the ~66 one-cell-low ops, deferred to an advisor that could not be filtered); and the material
rule above. Skill went 948 → **1,097 words** (`wc -w`), under the 1,100 pin, verified by
`bun test packages/editor/tests/skill-references.test.ts` — 9 pass, and sabotage-proven both
ways this session (a fake action id reds *"every action id the skill names is a real action"*;
1,120 words redded the budget case before the trim).
