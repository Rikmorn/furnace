# The placement sizing convention is implemented twice, with nothing pinning the two together

**Context.** One rule — "how big is a placed prop, given its archetype's collision
primitive and its record's per-axis scale" — has two independent implementations:

- `proxyScale` / `proxyExtents` in `packages/editor/src/viewport-host/field-placements.ts`
  (editor): the proxy the editor DRAWS, both as a ghost wireframe and as the committed
  instanced prop.
- `placementCollider` in `packages/dungeon/src/field-world.ts` (game): the static collider
  the runtime DERIVES at load.

They agree exactly today, including the fiddly parts — a `box` scales per-axis, a
`sphere`/`capsule` takes the MAX scale axis because a radius has no per-axis form, and a
capsule's height is `2·(halfHeight + radius)`. The editor's TSDoc says so and cites the
dungeon as the authority. But nothing FAILS if one drifts, and drift is silent in the worst
possible way: the whole value of the proxy is that it predicts the collider, so a divergence
shows up as props that looked well-spaced in the editor and interpenetrate (or block a
walk-lane) in the game — exactly the class of bug a walk-gate is expensive to diagnose.

A parity test was considered and rejected as not-yet-cheap. `placementCollider` is a private
function inside `field-world.ts`, a module that pulls the dungeon's renderer and physics; an
editor test cannot import it without either exporting it (a dungeon src change for a test's
benefit) or loading a heavy module headlessly. Re-encoding the mapping in a test instead
would just be a THIRD copy of the convention, catching drift only in whichever copy the test
happened not to share.

The durable fix is the one the duplication points at: promote the sizing beside
`packPlacementMatrices` in `packages/core/src/field/kit-render.ts`, which is already the
single source of truth for the other half of this exact problem (placement TRS packing,
extracted in F3b Task 6 precisely because three consumers had copies). That needs core to
carry the collision-primitive vocabulary — which today lives only in the two consumers'
local catalog types — so it is a core API decision, not a patch.

**Trigger to revisit:** F4 or F5 next touches either implementation, OR the placement
sizing gains a third consumer (which is the same threshold Task 6 used for
`packPlacementMatrices`), OR a walk-gate turns up props that collide differently than they
drew.

**Reference:** `packages/editor/src/viewport-host/field-placements.ts` (`proxyExtents`,
`proxyScale` — and their TSDoc, which names the dungeon as the authority);
`packages/dungeon/src/field-world.ts` (`placementCollider`);
`packages/core/src/field/kit-render.ts` (`packPlacementMatrices` — where the promoted
version would live, and the precedent for promoting);
`packages/editor/tests/catalog.test.ts` (the cross-package coupling-test precedent: it
parses the catalog the dungeon actually ships).
