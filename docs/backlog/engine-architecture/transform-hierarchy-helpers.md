# Transform-hierarchy helpers — a Tier 2 module over `mesh` + `transform`

Optional hierarchy helpers layered on top of `mesh` and `transform`: parent/child
relationships, world-space transform composition (parent matrix × local matrix), dirty-flag
propagation through hierarchies, traversal helpers (`walk(root, fn)`).

Explicitly *not* a framework — the engine never auto-traverses a hierarchy during
`frame.render`. Consumers opt in by passing a root to a helper that flattens it:
`frame.render(ctx, { meshes: flatten(root) })`. The hierarchy is a *consumer-side data
structure* with engine-provided utilities for the common operations.

Open design questions: whether `mesh` returns nodes that already understand parent/child (light
coupling) or whether the module wraps existing meshes (full decoupling); how transforms compose
if meshes later become ECS entities; whether the helper supports lazy/cached world-matrix
computation.

> **Retargeted 2026-08-05 (foundations T2).** This entry was titled
> "`@furnace/core/scene` — Tier 2 module" and reserved that module path for itself. Two things
> changed. (1) `@furnace/core/scene` shipped as something else entirely — the document
> format — and has now been **deleted**, so the name is neither taken nor a good fit: this is
> a *transform* concern, and calling it "scene" is what let it be confused with serialization
> for two years. (2) The "design it serializable from the outset" instruction below was aimed
> at a scene-document interchange that no longer exists; the live interchange is the field
> artifact + op log (`docs/reference/engine-architecture.md` §15), which models VOXELS and
> ENTITY PLACEMENTS, not a node tree — so a transform hierarchy has no interchange to be
> compatible with until something needs to serialize one.

**A-8 note (2026-05-29):** the API-posture tranche classified scene-graph-style hierarchy as a
higher-tier convenience built *on top* of the core handle layer (`api-posture.md` R8 —
abstraction tier). That framing is unchanged and is why this is Tier 2, not core surface. A-8
routed it here (not built) per the anti-spiral rule.

**Known downstream want.** `shadow-follow-ons.md` cites this entry as the missing
retained-hierarchy / world-bounds infrastructure that automatic shadow-frustum fitting would
need — today `orthoHalfExtent` and `target` are consumer-specified because nothing in the
engine knows the extent of what is being drawn.

**Trigger to revisit:** when consumer code repeatedly hand-rolls "iterate this hierarchy and
compute world matrices" — typically when a demo grows beyond ~10 entities with parent/child
relationships. The dungeon does NOT count and is unlikely to: its world is a field, and its
props are flat instanced records with baked world poses.

**Reference:** Core architecture design § "Tier 2 modules"; `docs/reference/api-posture.md` R8;
`docs/backlog/engine-architecture/shadow-follow-ons.md` (the auto-fit dependency);
`docs/backlog/engine-architecture/resource-ownership-root.md` (lifetime, not composition — a
separate question, judged separately since T2).
