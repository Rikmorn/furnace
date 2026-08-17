---
summary: B-1's "pass a handle in or get one back, you own it" rule does not scale to streaming or level-loading; a lifetime root has to express the dungeon loader's three-lifetimes-in-one-load asymmetry, and it is not called Scene
---

# A resource ownership root — strategy-driven GPU lifetime

Long-term answer to the question Tranche B-1 surfaced: **who owns GPU resources, and how do we
cascade teardown?** B-1's ownership rule ("pass a handle in or get one back → you own it") is
correct for the engine's current scope but doesn't scale to streaming, level-loading, or
per-bundle teardown — patterns a real game/app would need.

> **Retargeted 2026-08-05 (foundations T2).** This entry was called
> "scene-based resource ownership" and proposed a `Scene` concept as the ownership root. That
> name was borrowed from `@furnace/core/scene`, which is **deleted** — and the borrowing was
> always a bit of a lie, because the ownership root is a *lifetime* concept and the scene
> document was a *serialization* concept. The requirement is unchanged and the naming is now
> free: whatever this ships as, it is not called Scene.

Some root concept (a `Bundle`, an `Arena`, a `World` — the name is part of the design) would
act as the ownership root. Consumers register resources with it; one `destroy(root)` call
cascades everything it owns. Strategy choices stay open:

- **Refcounted handles** — shared resources tracked by ref; freed when count hits zero.
  (Bevy-ish.)
- **Owner-driven** — each resource has one designated owner; cascade follows ownership tree.
  (Babylon-ish, Filament-ish.)
- **Bundle/tag-based** — resources tagged by level or load-bundle; teardown selectively frees
  by tag. (Custom for streaming.)

The right answer depends on what the consumer's use case actually needs. Refcounting is
heaviest; bundle tags are lightest; owner-driven is in between.

## The live precedent to design against

`LoadedWorld` (`packages/dungeon/src/world/world-loader.ts`) is a hand-rolled instance of
exactly this, and it is the best evidence available about what the abstraction has to handle.
It returns a `destroy()` that frees the meshes, geometries and instanced draws THAT LOAD
created — and deliberately does NOT free the static physics bodies (they die with
`physics.destroyWorld`) or the `MaterialCache` (the caller's, and it outlives the draws). A
general root has to express that asymmetry: **three lifetimes in one load, two of them not
the root's.** Any design that assumes "everything a load touches dies with the load" is
already wrong against the one real consumer.

## Why deferred from B-1

B-1 fixed an active leak by deleting a violating API. It did not introduce the new abstraction
this would require — a separate top-level concept, coordination with stats, `gpu.dispose`,
render targets, post effects, and every other module that allocates GPU resources. That's
multi-tranche work with its own brainstorm + spec + plan cycle.

B-1's deliberate non-foreclosure: by codifying the simple ownership rule in
`engine-conventions.md`, B-1 leaves room for a root to either *replace* the rule (the root owns
everything; the rule applies inside its boundaries) or *layer over* it (the root tracks
references but the rule still describes the underlying handles). Either path stays open.

## Distinct from `transform-hierarchy-helpers.md`

That entry is about *transform composition* (parent/child, world matrices, traversal). This one
is about *resource lifetime*. They used to be described as candidates to ship together as one
`@furnace/core/scene` module; that shared destination is gone, and they should now be judged
independently — which is the honest position anyway, since nothing about a transform hierarchy
implies a lifetime policy.

## Trigger to revisit

When a real use case needs streaming, level loading, or per-bundle teardown — concretely, when
a second `LoadedWorld`-shaped hand-roll appears (the dungeon's is the first), when the cookbook
gains a multi-world demo, OR when a consumer reports the ownership rule becoming unwieldy at
scale (more than ~20 long-lived handles to track).

**Reference:**
- Tranche B-1's "Alternatives considered" table noted a scene-based root as the
  rejected-because-too-big option.
- `docs/reference/engine-conventions.md` §Resource ownership — the rule a root would supersede
  or layer over.
- `packages/dungeon/src/world/world-loader.ts` — `LoadedWorld.destroy()`, the live hand-rolled
  instance and its three-lifetime asymmetry.
- Adjacent: `docs/backlog/engine-architecture/transform-hierarchy-helpers.md` (transform
  composition; not the same scope).
