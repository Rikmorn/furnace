# Dungeon: no overlap-avoidance in piece placement (rooms can interpenetrate)

**Context.** `connect.ts join`/`placePiece` rigidly position a piece so its door Connection
coincides with a target portal. Nothing checks that the placed piece's *body* doesn't collide
with already-placed pieces (other rooms, the authored level). So placement can — and at the
2.2.4 multi-level showcase did — drop two large rooms on top of each other and through the
chamber: the `attachUpperLevel` `pillarHall` (~21×22 m) and `greatHall` (~25×20 m) overlapped
each other by **13.4 × 4.1 × 6.4 m** and both buried the authored chamber. The headless climb
tests didn't catch it because they break at the landing and never walk into the room interiors —
the overlap is invisible to a path-only gate (the same "subset world hides the real thing" trap
as 2.2.1/2.2.2). A 2.2.4-local stopgap relocates the showcase rooms into separated clear void
and adds an AABB non-overlap assertion to the climb tests; the underlying algorithm is still
missing.

**The principle (from the user, 2026-06-30):** rooms should not overlap. If two pieces *do*
overlap, that must be **intentional** — a deliberate boolean/CSG merge that yields a
weird-shaped *single* room — never accidental interpenetration of two whole rooms. So placement
needs to either (a) keep pieces apart, or (b) overlap them on purpose and merge the result.

**Trigger to revisit.** The generated world graph (2.2.5+). Auto-layout of many pieces makes
collision-free placement load-bearing — a graph that places nodes by join alone will pile pieces
on top of each other at scale. This is the algorithm 2.2.5 needs, not a hand-tune.

**Options to revisit (pick when scoping the work):**
- **Collision-aware layout / packing.** When placing a piece, test its AABB (or a tighter
  proxy) against placed pieces + the authored level; if it collides, push it out along the
  connector axis (lengthen the connector — connectors are already arbitrary-length) or reject &
  reseat. A force-directed / bounding-volume packing pass over the world graph is the general
  form. Needs a cheap piece-vs-piece overlap test (the showcase used a per-region world-AABB
  union — see the throwaway `scratchpad/upper-aabb.ts` from the 2.2.4 gate).
- **Intentional-overlap merge (CSG).** When a design *wants* two pieces to fuse (a weird-shaped
  cavern, a room punched into another), union their volumes and re-mesh, so the overlap is one
  coherent shape rather than two z-fighting boxes. Pairs with the connector-geometry-stitching
  work — see [[connector-geometry-stitching]].
- **Right-size the pieces.** Independently: the box-room `pillarHall`/`greatHall` presets are
  large *destination* rooms; an elevated landing wants a small room. A size-parameterised
  "landing" variant would make showcases like this fit without fighting placement.

**Reference.** `packages/dungeon/src/connect.ts` (`join`/`placePiece` — placement, no collision
test), `packages/dungeon/src/compose.ts` (`attachUpperLevel`/`attachUpperRoom`, `buildArea`).
Surfaced at the Slice 2.2.4 visual gate (2026-06-29/30); measured overlap via a throwaway AABB
script. Sibling gap: [[connector-geometry-stitching]] (joining surfaces, vs this — keeping bodies
apart).
