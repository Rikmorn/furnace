# Behaviour contract — the game's update/behaviour model

**Status:** **PARTIAL — the component half is deleted, the behaviour half survives.** This
entry originally tracked two things: (a) "what does `defineComponent(...)` look like?", which
landed at M1/M2 as `@furnace/core/scene`'s registry, and (b) the **behaviour runtime** — the
`state` + lifecycle + `requires` design below, which was never built. Foundations T2
(2026-08-05) **deleted `@furnace/core/scene`**, so (a) is gone: there are no scene components,
no `defineComponent`, no `t.ref`, and the serialized format they rode on does not exist. What
is left is (b), restated below against the machinery that actually survived.

> **Re-anchored 2026-08-05.** The two sibling deferrals this entry used to hand work off to —
> `loadscene-region-composition.md` (streaming N region scenes into one world) and
> `scene-format-migration-chain.md` (format versioning) — were **closed** in the same tranche,
> their subjects having been deleted. Their concerns did not evaporate, they moved:
> **streaming** is now a property of the field's chunked store (chunk-local integer coords, no
> whole-world-in-memory assumption, pay-only-for-dirty — the One Field charter's mega-world
> invariants, `docs/reference/core-modules.md` §field), and **versioning** is the field
> manifest's `version` tag plus `parseOps`' future-oplog guard.
> `ecs-data-oriented-soa-layout.md` is still live and still the storage half.

## What the behaviour runtime would attach to now

Branch A discovery survives verbatim and is **live code**, just in a different registry:
`@furnace/core/registry`'s `defineService`/`getService` and `field`'s `defineGenerator` both
work by the consumer's module being *imported* before use, which is what registers it. The
dungeon's `editor-extensions.ts` is the worked example (`defineService("analyzerVerify", …)`
at import time, resolved by the editor's analyzer worker through `getService`). So the
"extensions self-register by being imported; one registry, two readers" mechanism is proven —
it just holds generators and services rather than components.

What a behaviour runtime does NOT have any more is a serialized entity/component document to
attach behaviours to. The world is a field plus placement records; the nearest live thing to
"an entity with authored params" is a **generator entity** (`GeneratorEntity` in
`@furnace/core/field` — id, generator id, params, seed, region, op span, reconfigurable in
place). Whether behaviours attach to those, to placement records, or to a new entity concept
is **the first design question**, and this entry does not answer it.

## Retained design (2026-06-09), for whatever consumes it

- **Schema-as-first-class.** A behaviour type declares its `params` as one schema. That single
  declaration yields **both** the compile-time TS type (mapped type) **and** the runtime
  validator — no validator-vs-type drift. This is exactly what `defineGenerator` does today
  (one zod raw shape → `parseOrThrow` at evaluate + the emitted `paramSchema` the editor's form
  renders), so the pattern is no longer speculative — it is shipped and load-bearing.
- **Behaviours add `state` + lifecycle.** Beyond `params` (authored, serialized data), a
  behaviour has **`state`** (runtime-only, transient, never serialized) and logic. Full
  lifecycle: `state()` (data init, no services) → `init(bx)` (one-time wired setup, refs
  resolved) → `onEnable(bx)` → `update(bx)` (variable rate) / `lateUpdate(bx)` (after all
  updates) / `fixedUpdate(bx)` (fixed rate, before `physics.step`) → `onDisable(bx)` →
  `dispose(bx)`. Ordering guarantees: **all `state()` before any `init()`**;
  `update`→`lateUpdate` are two passes; disabled behaviours skip the per-tick hooks. The two
  rates map onto furnace's loop: `update` = `frame.loop` callback, `fixedUpdate` = inside
  `frame.fixedClock`'s tick. (Naming `update`/`fixedUpdate` is the dominant cross-engine
  convention — Unity + Bevy verbatim.)
- **`requires` + typed refs.** A behaviour declares the sibling data it needs and typed
  references to other entities. Both are **validated once at the load boundary**, after which
  the hooks are fully typed with **zero runtime checks** ("parse, don't validate"). A
  deliberate divergence from Unity/Godot/PlayCanvas/Bevy (all bind weakly at runtime), uniquely
  enabled by furnace being TS-first. **Caveat since T2:** the `t.ref` boundary validation that
  was going to implement it died with `scene`, so the mechanism would be rebuilt against
  whatever the entity concept turns out to be.
- **Behaviours are local.** A behaviour touches its own entity + explicitly-referenced entities
  only — never a queried population, and **no entity spawn/destroy in v1**. Population
  operations are engine primitives or proper ECS **systems** later (the SoA half, deferred).
- **Three designed-for seams (not built, shaped to slot in):** `swap(old)` hot-reload (editor
  HMR); collision callbacks (`physics.step` already returns `CollisionEvent[]`; dispatch +
  enter/stay/exit diffing is a separate subsystem); hierarchy-cascading active state.

## Connection to ECS storage layout

Still holds: SoA (`ecs-data-oriented-soa-layout.md`) requires knowing component shape; a
schema-as-first-class descriptor supplies it. Storage stays a separate, deferred question.

**Trigger to revisit:** when the dungeon needs anything that ACTS — a door that opens, a
creature that moves, a trap that fires. Nothing in the game does today; it is a walkable world
with static props, which is exactly why this has stayed deferred through three epics. The
design question it must answer first is what a behaviour attaches to in a field world.

**Reference:** `packages/core/src/field/registry.ts` (schema-as-first-class, shipped);
`packages/core/src/registry/registry.ts` (`defineService`/`getService` — Branch A discovery,
shipped); `packages/core/src/field/types.ts` (`GeneratorEntity`, the nearest live entity
concept); `docs/reference/engine-architecture.md` §15 (the tiers, and why the document format
went); `ecs-data-oriented-soa-layout.md` (the deferred storage half);
`editor-and-tooling/editor-backend-architecture.md` (Branch-A discovery, decisions 5–6).
