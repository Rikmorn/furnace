# The field-op vocabulary has no architectural altitude

Filed at sculpting-worlds cycle 2's review (2026-08-12), from that cycle's E1 monastery run.
**This one binds the human author exactly as hard as the agent** — it is not a door gap, and
it should not be fixed at the door.

## Three primitives, and every architectural move is arithmetic on top of them

`BrushShape` is `sphere | box | capsule` (`packages/core/src/field/types.ts:97-110`), the
capsule being exactly ONE segment `a → b`. Kit-class writes accept the box alone. There is
nothing above that altitude, so every architectural move decomposes at the caller:

- **Stairs and ramps.** The run built three staircases from **~66 hand-computed axis-aligned
  boxes**, each a `center`/`halfExtents` triple whose arithmetic the agent did by hand — and it
  carried a systematic one-cell error through all of them, caught only by accident through the
  prop lint on an unrelated check. A **stair/ramp op** — A to B, width, riser, engine tiles it —
  is one op instead of ~28, and it makes the agent profile's 0.4 m `stepHeight` the engine's
  constraint to satisfy rather than the caller's to remember.
- **Polylines.** `capsule` takes one segment, so every elbow of a passage is a separate op and
  every join is the caller's to get right. Cycle 1's human wedge was at a corner where two
  swept capsules met; cycle 2 spent ops on the same class of join. A **polyline sweep** makes
  the joint the engine's problem, which is where the two cycles' evidence says it belongs.
- **Sections.** Today the choice is `box` — a square slot, which the `sculpting-worlds` skill
  itself warns "reads as manufactured, not natural" — or `capsule`, a round tube with a curved
  floor you cannot stand flat on. **There is no flat-floor / arched-ceiling primitive**, the
  most common architectural section there is. Everything in the cycle-2 monastery is
  square-sectioned because those were the options; that is a shape chosen by the vocabulary,
  not by the author.

## The paint mask has no surface-aware member

`BrushMask` is `organic-only | kit-only | class | solid-only | selection`
(`types.ts:120-125`). The cross-cutting filter axis EXISTS — what it has no member for is
orientation or height: no *floor only*, no *below Y*, no *surfaces facing up*.

Measured cost in the run: the crypt was painted by dropping one large box and then
**re-painting 11 pier boxes to locally undo it**, because a basic environment-art move —
"dirt on the floor, rock on the piers" — has to be expressed as slab arithmetic. The fix is a
new `BrushMask` member, not a new op kind, which makes it the cheapest item here and the one
with the clearest shape.

## Why this is one entry

These are one theme — **the ops describe primitives where the author thinks in architecture** —
and they want deciding together, because a stair op and an arched-section op and a facing-up
mask are three answers to "what altitude does the field's write surface sit at". Fixing one at
a time produces three unrelated primitives; fixing them together is a vocabulary. New public
API surface in every case, so all of it fails the `AGENTS.md` inline-fix threshold.

**Trigger to revisit:** the first slice that has to build an interior a human will call
*architecture* rather than *caves* — or the next time an author (human or agent) decomposes one
intent into more than ~10 hand-computed brush ops. Explicitly NOT in the cycle-3 E0-equivalent
set: the owner ruled at cycle 2's close that this half backlogs with triggers because it
changes the editor's authoring model rather than the door.

**Reference:** `packages/core/src/field/types.ts` (`BrushShape` :97-110, `BrushMask` :120-125,
`SmoothParams` :127-139 for the one op that DOES carry a mode vocabulary);
`packages/dungeon/catalog/agent.json` (`stepHeight`, the constraint a stair op would own);
`docs/learnings/2026-08-12-agent-world-building-cycle-2-e1.md` §4 and §10. Siblings:
`kit-lattice-excludes-a-walkable-stair.md` (why the built-looking stair could not be masonry —
the same missing primitive from the material side),
`lattice-aligned-box-op-writes-nothing.md` (why the ~66 hand-computed boxes were silently one
cell low), `docs/backlog/dungeon/content-vocabulary-is-the-differentiation-ceiling.md`.
