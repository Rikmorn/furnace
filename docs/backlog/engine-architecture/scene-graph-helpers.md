# `@furnace/core/scene` — Tier 2 module

Optional scene-graph helpers layered on top of `mesh` and `transform`: parent/child relationships, world-space transform composition (parent matrix × local matrix), dirty-flag propagation through hierarchies, traversal helpers (`scene.walk(root, fn)`).

Explicitly *not* a framework — the engine never auto-traverses a scene during `frame.render`. Consumers opt in by passing a scene to a helper that flattens it: `frame.render(ctx, { draw: scene.flatten(root) })`. The scene-graph is a *consumer-side data structure* with engine-provided utilities for the common operations.

Open design questions: whether `mesh` returns nodes that already understand parent/child (light coupling) or whether the scene module wraps existing meshes (full decoupling); how transforms compose when meshes can also be ECS entities later; whether the helper supports lazy/cached world-matrix computation.

**A-8 note (2026-05-29):** the API-posture tranche classified Scene / scene-graph as a higher-tier convenience built *on top* of the core handle layer (`api-posture.md` R8 — abstraction tier). This affirms the Tier-2 framing above; A-8 routed it here (not built) per the anti-spiral rule.

**Trigger to revisit:** When consumer code repeatedly hand-rolls "iterate this hierarchy and compute world matrices" — typically when a demo grows beyond ~10 entities with parent/child relationships.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Tier 2 modules".
