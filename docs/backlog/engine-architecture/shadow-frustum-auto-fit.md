---
summary: the directional shadow's ortho extent and target are hand-sized by the consumer because the engine has no scene-AABB to fit them from; auto-fit and cascade splitting both wait on that world-bounds layer
---

# Directional shadow frustum — auto-fit to scene bounds

Stage 4's directional shadow uses an **orthographic** light frustum whose extent is
a **consumer-specified** `orthoHalfExtent` (with a `target` point the light looks
at) — see `packages/core/src/frame/shadow-projection.ts`. The consumer hand-sizes
the half-extent to bracket the part of the scene that should cast/receive shadows.

There is **no auto-fit**: the engine does not compute the ortho box from the
scene's geometry, because furnace has **no world-bounds / scene-AABB
infrastructure** — there is no retained scene graph to walk for bounds, and no
per-mesh AABB aggregation. Auto-fitting a directional shadow frustum (and, later,
fitting CSM cascade splits) both depend on that missing world-bounds layer.

The consumer-extent primitive is deliberately the substrate auto-fit and CSM build
*on*: once world-bounds exist, auto-fit becomes "compute `orthoHalfExtent` +
`target` from the scene AABB instead of taking them from the consumer," and CSM
becomes "split that fitted frustum into cascades." The current hand-tuned extent is
the manual version of the same knob.

**Trigger to revisit:** hand-tuning `orthoHalfExtent` / `target` per scene becomes
painful (e.g. a scene that moves or grows, where a fixed extent wastes resolution
or clips shadows), OR CSM work begins (`cascaded-and-point-shadows.md`) —
both want a world-bounds layer first.

**Reference:** `packages/core/src/frame/shadow-projection.ts` (the
consumer-specified `orthoHalfExtent` + `target`); `cascaded-and-point-shadows.md`
(CSM, which also needs the fitted/split frustum); `transform-hierarchy-helpers.md` (the
absent retained-hierarchy/world-bounds infrastructure auto-fit would require).
