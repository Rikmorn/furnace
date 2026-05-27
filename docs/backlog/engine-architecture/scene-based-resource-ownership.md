# Scene-based resource ownership — strategy-driven lifetime

Long-term answer to the question Tranche B-1 surfaced: **who owns GPU resources, and how do we cascade teardown?** B-1's ownership rule ("pass a handle in or get one back → you own it") is correct for the engine's current scope but doesn't scale to streaming, level-loading, or per-bundle teardown — patterns a real game/app would need.

A `Scene` concept (or `Bundle` / `World` / equivalent) would act as the ownership root. Consumers register resources with the scene; one `scene.destroy(scene)` call cascades everything the scene owns. Strategy choices stay open:

- **Refcounted handles** — shared resources tracked by ref; freed when count hits zero. (Bevy-ish.)
- **Owner-driven** — each resource has one designated owner; cascade follows ownership tree. (Babylon-ish, Filament-ish.)
- **Bundle/tag-based** — resources tagged by level or load-bundle; teardown selectively frees by tag. (Custom for streaming.)

The right answer depends on what the consumer's use case actually needs. Refcounting is heaviest; bundle tags are lightest; owner-driven is in between.

## Why deferred from B-1

B-1 fixed an active leak by deleting a violating API. It did not introduce the new abstraction Scene would require — a separate top-level concept, coordination with stats, `gpu.dispose`, render targets, post effects, and every other module that allocates GPU resources. That's multi-tranche work with its own brainstorm + spec + plan cycle.

B-1's deliberate non-foreclosure: by codifying the simple ownership rule in `engine-conventions.md`, B-1 leaves room for Scene to either *replace* the rule (Scene owns everything; the rule applies inside Scene boundaries) or *layer over* it (Scene tracks references but the rule still describes the underlying handles). Either path stays open.

## Distinct from `scene-graph-helpers.md`

The existing `scene-graph-helpers.md` backlog entry is about *transform composition* (parent/child, world matrices, traversal). This entry is about *resource lifetime*. They could ship together as one `@furnace/core/scene` module, or they could be separate concerns under different names. That's a design question for the future tranche.

## Trigger to revisit

When a real use case needs streaming, level loading, or per-bundle teardown — concretely, when the cookbook gains a multi-scene demo or hello-world grows a level-switch feature, OR when a consumer reports the ownership rule becoming unwieldy at scale (more than ~20 long-lived handles to track).

**Reference:**
- `docs/superpowers/specs/2026-05-27-tranche-b1-mesh-factory-geometry-ownership-design.md` — B-1's "Alternatives considered" table notes scene-based ownership as the rejected-because-too-big option.
- `docs/reference/engine-conventions.md` §Resource ownership — the rule Scene would supersede or layer over.
- Adjacent: `docs/backlog/engine-architecture/scene-graph-helpers.md` (transform composition; not the same scope).
