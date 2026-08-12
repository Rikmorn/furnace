---
summary: the 0.5 m kit lattice and the agent's 0.4 m step height do not overlap, so no kit-class stair is walkable
---

# The 0.5 m kit lattice cannot express a stair the agent can climb

Filed 2026-08-12 from the sculpting-worlds cycle-2 E1 monastery run; validated and accepted at
that cycle's review the same day.

Kit-class field ops are constrained to a 0.5 m lattice. Measured in that run, a fill of
material 3 (`masonry`, the only `kind: "kit"` class in
`packages/dungeon/catalog/materials.json`) with a 0.25 m rise is REFUSED:

```
field op group: ops[0] — field op: kit-class box must sit on the 0.5 m lattice
```

The dungeon's agent (`packages/dungeon/catalog/agent.json`) has `stepHeight: 0.4`. So the
smallest step masonry can express is 0.5 m, and the largest step the agent can walk up is
0.4 m. **The two constraints do not overlap**: there is no legal kit-class stair. Any
built-looking stair has to be cut in an organic class instead (rock/dirt/moss-stone,
which are free of the lattice), which is what the run did — the monastery's stair up into
the spring cave is `rock`, not `masonry`, purely because masonry could not be walked on.

That is a content-vocabulary hole, not a bug: the kit exists to render panelled,
architectural surfaces, and stairs are among the most architectural things a monastery
has. Today every stair in a built district must be visually organic.

Three shapes a fix could take, none obviously right:

- Give the kit a **stair/riser piece** with its own sub-lattice, so a run of steps is one
  kit primitive rather than N boxes — probably the honest answer, since a 0.25 m box
  stack was never going to render as masonry anyway.
- **Relax the lattice** to 0.25 m for kit fills, and accept whatever the panel/collar
  renderer does with half-cells.
- Raise `climbCeiling`-style tolerance so a 0.5 m riser is walkable, which changes agent
  feel everywhere to fix one authoring gap — the weakest of the three.

**Trigger to revisit:** First time a built district needs a stair, ramp or tiered floor
that must read as masonry rather than as cut rock — or when the kit gains its second
material class.

**Reference:** the kit-lattice clause in `assertOpValid` (`packages/core/src/field/ops.ts`);
`packages/core/src/field/types.ts` (`BrushShape` — kit-class writes accept the BOX
alone, which is why "one kit primitive per run of steps" needs a new shape rather than a
looser bound); `packages/dungeon/catalog/agent.json` (`stepHeight`);
`docs/backlog/dungeon/content-vocabulary-is-the-differentiation-ceiling.md`. Sibling:
`field-op-vocabulary-has-no-architectural-altitude.md` — the same missing stair primitive seen
from the ops side rather than the material side; the first fix option here IS that entry's
stair/ramp op.
