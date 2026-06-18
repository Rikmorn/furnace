# Collision representation decoupled from render — field-derived collision proxies

**This is the leading direction for 2.2.** It supersedes
`character-mover-trimesh-wall-robustness.md` (deleted) and subsumes
`heightfield-walkable-collision-surface.md` (deleted) — both were facets of this.

## Context

Slice 2.1.1 made generated *floors* walkable with a custom `CharacterMover`, but
three problems share **one root cause** — internal-edge "ghost collisions" on the
detailed Surface-Nets trimesh:
- the original floor stall (fixed at the surface level by downward-ray ground detection),
- **curved generated trimesh WALLS still trap the capsule** — falling into the grotto
  pit / vertical shaft, the player gets stuck (the horizontal `slideHorizontal`
  shapecast catches corrupted contact normals and there is no depenetration step),
- the hall↔chamber seam **fall-through gap**.

Patching each (depenetration, seam-stitching, per-case normal clamps) treats symptoms.
They are one bug.

## The direction

Stop colliding against the detailed render trimesh. Introduce a **separate, simpler
collision representation** — convex proxies — and collide the player (and later AI,
projectiles, line-of-sight) against *that*, while rendering the detailed mesh.
**Convex proxies have no internal edges by construction → the entire ghost-collision
bug class disappears at the source**, with no depenetration patches.

Render mesh ≠ collision mesh is the *norm* in shipping engines (Unreal collision hulls,
Source brushes-vs-detail); aliasing them (as 2.1.1 does) is the outlier. Research pass 2
(2026-06-18) explicitly recommended "a simpler/smoothed collision surface for what the
character walks on," and quantified simple collision as ~10–20× cheaper to build.

## The field-aligned form (the key insight — avoids the classic cost)

The usual objection to two geometries is **keeping them in sync**. We dodge it: the
world is a **field** `f(seed, pos)`. So do **not** derive the proxy *from* the render
mesh — derive **both the visual mesh and the collision proxy from the field**. Single
source of truth, two realizations (detailed for the eyes, simple for the body). No sync
dependency; dead-on with the field-as-geometry north star (see
`region-recipe-as-truth.md`, `procedural-generation-direction.md`).

## Proxy forms by geometry kind (the generation crux)

The proxy strategy depends on the geometry form, so it **co-evolves with what 2.2
generates** (same braid as traversal↔geometry):
- **Heightfield** → single-valued (no-overhang) floors. (This is exactly the former
  `heightfield-walkable-collision-surface` idea — one proxy form, now folded in.
  Rapier `ColliderDesc.heightfield` exists in vendored 0.19.3.)
- **Convex hulls / boxes** → walls, rooms, corridors. (Authored cuboids already prove
  the controller is robust against convex geometry.)
- **Convex decomposition (VHACD-style) or field-sampled primitives** → caves / overhangs
  / multi-valued geometry.

**The crux is proxy *generation* from a procedural field** — solved elsewhere (voxel
engines, VHACD), so it wants a **focused research pass** before design, not invention.

## Consistency with 2.1.1 (not a reversal)

The custom `CharacterMover` **stays** and is still essential — collide-and-slide,
step-up, slope gate, ground-snap. This just feeds it **clean collision input instead of
making it fight ghost edges**. Proxies are not limited to heightfields (hulls/boxes
cover caves/overhangs), so 2.1.1's "handle arbitrary geometry, not just heightfield-able
floors" motivation is preserved. It is a layering, not a walk-back.

## Honest costs ("only if justified")

- **Collide against an approximation** — a ledge/nook you can *see* may not be *there*
  for collision. Acceptable for an atmospheric crawler, but name it as an accepted trade.
- **Proxy generation is real work** and braids with the geometry generation; not a clean
  standalone slice.
- Don't over-build a generic proxy system before the 2.2 geometry forms are known.

## Relationship to 2.2 (needs a holistic review)

This likely **leads** 2.2: generating *richer* geometry on a collision story that still
traps the controller would compound the problem. But 2.2 also bundles the original
procgen-layout work. Next session, review holistically and decide further splits across:
- this (collision-proxy-from-field),
- `procedural-generation-direction.md` (generator richness — seeded passes, macro+micro,
  verticality),
- populate/scatter + `first-class-gpu-instancing.md`,
- `region-recipe-as-truth.md` (recipe-as-truth, deferred from 2.1).

## First step when picked up

1. Research proxy-generation strategies for procedural/field geometry (heightfield vs
   convex-decomp vs field-sampled primitives; what voxel/terrain games actually ship).
2. Brainstorm the 2.2 holistic split with that research in hand.

**Reference.** `packages/dungeon/src/char-move.ts` (`slideHorizontal` — the shapecast
exposed to ghost contacts); 2.1.1 spec (`docs/superpowers/specs/2026-06-18-...`); the
2026-06-18 non-flat-ground research pass (collision-surface-representation finding);
memory `project_dungeon_epic2_procgen`.
