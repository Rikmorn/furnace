---
summary: the Tier 2 cross-cutting modules decided on but never built — animation, assets, glTF, audio, event bus, ECS storage, jobs, transform hierarchy, wasm hot loop, debug draw
---

# Unbuilt Tier 2 modules

Tracker for the cross-cutting modules the original core-architecture design named as
**Tier 2** — decided on in principle, never built, and still waiting on a real consumer.
Each section below is one previously standalone entry, keeping its Context, *Trigger to
revisit* and *Reference* as written.

A vocabulary note, because the word is older than the current reference doc: "Tier 2" is
the **design spec's** term for cross-cutting modules layered over the shipped surface. The
as-built tier split recorded in `docs/reference/engine-architecture.md` §15 is a different
axis — **engine substrate** vs **world tier** — and names only shipped modules. Nothing
below is in either as-built tier; that is the point of the tracker.

They are merged because they share one shape of trigger: *"first consumer that actually
needs it"*. None is blocked on a decision, none has a consumer today, and each would be a
new module (or a new runtime) rather than an extension of a shipped one. Sections are
ordered content-first (animation → assets → glTF → audio) then substrate-ish (bus → ECS
storage → jobs → transform hierarchy → behaviour contract → wasm hot loop → debug draw).

## `@furnace/core/animation` — Tier 2 module

Animation primitives: tweens, easing curves, keyframe sequences, eventually skeleton/bone systems for skinned meshes. Likely depends on `frame.fixedClock` for deterministic timing and on `transform` for matrix math. Distinct from `frame.fixedClock` itself — that provides the *clock*; this module provides *what to do with it*.

Open design questions to settle when this is brainstormed: whether animations are state objects (`anim.create()` + `anim.update(dt)`) or function-pipeline style (compose easing/curves into a value-producer per frame); how they hook into mesh transforms (push vs pull); how to compose multiple animations affecting the same target (blending, additive layers).

**Trigger to revisit:** First demo needing motion beyond per-frame manual updates — typically when a triangle needs to bounce, a UI element needs to fade in, or a mesh needs to follow a path.

**Reference:** Core architecture design § "Tier 2 modules".

## `@furnace/core/assets` — Tier 2 module

Asset loading pipeline: glTF for meshes (de-facto interchange format), OBJ for simple mesh debugging, KTX2/Basis for compressed textures, MP3/OGG/Opus for audio. Async-first by nature (network I/O); follows the `load`/`request`/`fetch` naming convention from the Tier 1 design language.

Open design questions: caching (per-context cache? global LRU? consumer-managed?), progress reporting (per-asset `onProgress` callback? aggregated load-queue depth?), error handling (typed `FurnaceLoadError` with kind discriminator?), texture color-space inference (assume sRGB for `.png`/`.jpg`, linear for `.exr`, follow KTX2 metadata?), retry/timeout semantics, parallel loading limits.

Should integrate with `stats` for load-queue depth, bytes-loaded gauges, and per-asset timing.

**Trigger to revisit:** First demo loading a non-primitive mesh (glTF) or compressed texture. Mesh primitives (`mesh.primitives.cube/sphere/...`) and the existing texture-load helper cover most early needs.

**Reference:** Core architecture design § "Tier 2 modules".

## glTF import — external-asset import path (distinct from .fmesh)

The `.fmesh` binary format (introduced in Slice 2.1) is an **internal** furnace format:
it is produced by furnace's own region baker from procedurally generated mesh data and is
not intended for external art assets. It has no normals-map / PBR materials / animation /
skin / multi-primitive support — it is a geometry-only cache for a generated region.

A separate **glTF import path** is needed when:
- Artists export assets from Blender / Maya / Substance to bring into a furnace scene.
- The demo wants real art (hero props, character meshes, world decorations) instead of
  procedural geometry.
- PBR material data (base color texture + metallic-roughness + normal map + emissive) is
  part of the asset.

The shape of this work:
- A `geometry.loadGltf(ctx, url)` (or a scene resource kind `"gltf"`) that fetches a
  `.glb` / `.gltf`, parses it (probably via a small dedicated parser or a thin wrapper
  over `@loaders.gl/gltf`), and produces furnace `Geometry` + `Texture` + (eventually)
  `Material` handles.
- Multi-primitive mesh nodes → multiple `Geometry` handles, one per primitive.
- PBR material → deferred until the PBR material pipeline lands (see
  `lighting-and-shading-capability-gaps.md` §PBR material pipeline).
- Skinned meshes / morph targets → deferred further.
- The Khronos sample ladder is the natural tranche sizer (minimal textured mesh → full
  PBR scene).

**Distinct from `.fmesh`:** glTF is an interchange format for authored art; `.fmesh`
is an internal cache format for generated geometry. They are separate concerns and should
not share an import path — a glTF loader should not produce `.fmesh` files, nor should
the `.fmesh` decoder grow glTF concepts.

**Trigger to revisit:** First demo that needs to import external art (an artist-authored
prop, a hero character mesh, a decorated room element that is not procedurally generated).
Also fires when the PBR material pipeline lands (`lighting-and-shading-capability-gaps.md` §PBR material pipeline) — that work
needs real art assets to demonstrate correctly.

**Reference:** The Khronos glTF sample models repository. `lighting-and-shading-capability-gaps.md` §PBR material pipeline
(PBR material pipeline, a likely co-dependency). `docs/backlog/` entries for
the *`@furnace/core/assets`* section (broader asset loading direction).

## AudioWorklet + audio DSP

Audio is a separate workstream entirely — runs on `AudioWorklet`, a dedicated high-priority audio thread outside the JS event loop (per `docs/reference/engine-architecture.md` §10). Lands as the `@furnace/core/audio` Tier 2 module.

Likely depends on a wasm-backed DSP implementation (Rust → wasm, AudioWorklet hosts the wasm). Connects naturally to the central event bus (the *`@furnace/core/bus`* section) — e.g., physics emits collision events, audio listens and plays hit sounds.

**Trigger to revisit:** When audio is on the roadmap.

**Reference:** Core architecture design § "Tier 2 modules".

## `@furnace/core/bus` — central pub/sub event bus

Cross-module event channel built on the Tier 1 `events` primitive. Lets unrelated subsystems coordinate without knowing about each other: physics emits `"collision"` → audio listens and plays a hit sound; gameplay emits `"player.died"` → UI listens and shows a death screen; network emits `"snapshot.received"` → world-state listens and applies the snapshot.

Distinct from per-module `onX` events (which the producer module owns directly) — the bus is for events whose producers and consumers are independent and whose event set is open-ended.

Open design questions to settle when this is brainstormed: synchronous fan-out vs queued/frame-bounded delivery (Bevy-style `Events<T>` with double-buffering vs Three.js-style immediate dispatch); typed event registry (`bus.on<CollisionEvent>("collision", fn)`) vs free-form; multi-listener ordering semantics; back-pressure (what if listeners are slow?); listener removal patterns (handle-based vs callback identity).

**Trigger to revisit:** First time two unrelated subsystems need to coordinate via events — likely when physics and audio both land in Tier 2.

**Reference:** Core architecture design § "Events architecture".

## ECS / data-oriented SoA layout

The vision from `docs/reference/engine-architecture.md` §9 — SoA `Float32Array`s for positions/velocities/etc., with systems declaring read/write component sets for parallel scheduling. Lands as the `@furnace/core/ecs` Tier 2 module (per the core architecture design spec). Not relevant until we render >1 entity; target ~1000+ entities justifies the machinery.

Connects to the *Behaviour contract* section — how component types are defined and stored is the central design question alongside the storage layout itself.

**A-8 note (2026-05-29):** the API-posture tranche classified ECS as a higher-tier module built *on top* of the core handle layer (`api-posture.md` R8 — abstraction tier). This affirms the Tier-2 framing above; A-8 routed it here (not built) per the anti-spiral rule.

**Trigger to revisit:** First time we render multiple meshes or want to manage entities.

**Reference:** Core architecture design § "Tier 2 modules".

## `@furnace/core/jobs` — unified job/scheduler abstraction

A `jobs.schedule(work, { dependsOn })` API that abstracts GPU compute dispatches, sync wasm calls, and Web Worker message passes behind one submission surface. The scheduler picks the substrate based on the job's nature; consumer declares dependencies and the scheduler builds a DAG.

The metaphor is right (main thread = orchestrator, work happens on substrates) but browser tech doesn't give us a unified API today — each substrate has different semantics (GPU = fire-and-forget through `queue.submit`; Web Workers = `postMessage` with structured clone or SharedArrayBuffer; AudioWorklet = continuous processing; wasm = sync function calls). The job system would be the abstraction layer that hides those differences.

Real engineering required: dependency graph that spans substrates; data marshalling between threads (`SharedArrayBuffer` setup, structured-clone serialization); completion signalling across substrates (GPU `onSubmittedWorkDone` vs Worker `postMessage` reply vs sync wasm); handling failures partway through a chain.

**Trigger to revisit:** When the consumer surface accumulates 4-5 distinct kinds of "heavy" work that would benefit from unified scheduling — likely after physics, audio, animation, and one of (AI / pathfinding / large-data processing) arrive.

**Reference:** Core architecture design § "Tier 2 cross-cutting patterns".

## Transform-hierarchy helpers — a Tier 2 module over `mesh` + `transform`

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
`docs/backlog/engine-architecture/resource-lifetime-ownership-and-tracking.md` §A resource ownership root (lifetime, not composition — a
separate question, judged separately since T2).

## Behaviour contract — the game's update/behaviour model

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
> the *ECS / data-oriented SoA layout* section is still live and still the storage half.

### What the behaviour runtime would attach to now

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

### Retained design (2026-06-09), for whatever consumes it

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

### Connection to ECS storage layout

Still holds: SoA (the *ECS / data-oriented SoA layout* section) requires knowing component shape; a
schema-as-first-class descriptor supplies it. Storage stays a separate, deferred question.

**Trigger to revisit:** when the dungeon needs anything that ACTS — a door that opens, a
creature that moves, a trap that fires. Nothing in the game does today; it is a walkable world
with static props, which is exactly why this has stayed deferred through three epics. The
design question it must answer first is what a behaviour attaches to in a field world.

**Reference:** `packages/core/src/field/registry.ts` (schema-as-first-class, shipped);
`packages/core/src/registry/registry.ts` (`defineService`/`getService` — Branch A discovery,
shipped); `packages/core/src/field/types.ts` (`GeneratorEntity`, the nearest live entity
concept); `docs/reference/engine-architecture.md` §15 (the tiers, and why the document format
went); the *ECS / data-oriented SoA layout* section (the deferred storage half);
`editor-and-tooling/editor-backend-architecture.md` (Branch-A discovery, decisions 5–6).

## Rust transforms wasm crate

Compile a Rust matrix-math crate to wasm via `wasm-pack` to host the hot scene-graph transform loop (positions/quaternions/scale → matrices) off the JS engine. Specific instance of the broader "module wasm-backing" pattern — any core module whose hot path becomes a measurable problem can be replaced with a Rust→wasm implementation behind the same function-level API (design language rule 4, per the core architecture spec).

The Tier 1 `transform` module is pure JS/TS to start; this entry is its eventual perf upgrade. Not relevant until we have a scene graph at all (or large numbers of entities that need their world matrices recomputed each frame).

**Trigger to revisit:** When transforms become a hot path.

**Reference:** `docs/research/2026-05-21-shallot.md` § "Engine library + wasm hot loops" for the reference pattern.

## Debug drawing primitives

> **Partially shipped (Stage 4B, 2026-06-04):** the line substrate exists —
> `frame.drawLines` (immediate `line-list` overlay) + `physics.getDebugLines`
> (Rapier collider wireframe pass-through). STILL DEFERRED: the general
> immediate-mode gizmo system (`debug.line/box/sphere/axes` accumulation API),
> non-physics clients (mesh normals, camera frustums, scene-graph axes), and
> contact-point / AABB / joint visualization (furnace's `CollisionEvent` carries
> no contact data; Rapier's `debugRender` default draws collider shapes only).
> **Revisit trigger:** a 2nd+ non-line debug client, OR a need to debug contacts.

Lines, boxes, axes, frustums, arrows — drawn over the rendered scene for diagnostic visualization. Used everywhere in real engines: physics colliders, AI navigation graphs, mesh normals, camera frustums, bone hierarchies, raycast results. Cheap to add once we have one client; useless before then.

Likely a `@furnace/core/debug-draw` module (or `dev/debug-draw`, to signal it's not for production builds). API shape: immediate-mode style (`debug.line(start, end, color)`) accumulated into one batched draw per frame; cleared automatically each frame. Could also support persistent lines (`debug.line(..., { ttlMs: 2000 })`) for diagnostic trails.

Should be tree-shakeable so production builds can drop it; possibly compile-time-gated via a build flag.

**Trigger to revisit:** See the banner's **Revisit trigger** above. The original trigger — physics-collider visualization — fired in Stage 4B (which shipped the line substrate); remaining future needs include scene-graph axes for transform debugging, mesh normals, or another non-line gizmo client.

**Reference:** Core architecture design § "Tier 2 cross-cutting patterns".
