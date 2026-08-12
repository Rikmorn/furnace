---
summary: who owns a GPU resource: teardown cascade policy, ownership roots, allocations the resource manager cannot see, and the ctxId wraparound defect in the handle encoding
---

# Resource lifetime, ownership and tracking

Tracker for the open questions about **who owns a GPU resource** in `@furnace/core` — how
teardown cascades, what the manager is allowed to know, and which allocations it can see at
all. Each section is one previously standalone entry with its Context, *Trigger to revisit*
and *Reference* kept as written.

They are merged because they are four views of one seam: the resource manager
(`@furnace/core/resources`) and the per-context handle pools it stands over. The follow-on
set and the ownership-root design are the "what should the policy be" half; the
create-wrapper and consumer-owned-buffer entries are the "what is currently invisible to it"
half; the ctxId-wraparound entry is the one live defect in the handle encoding those pools
share. Triggers differ per section and are stated per section — several are consumer-driven
("a second consumer wants X"), one is a latent-bug trigger.

Two `docs/reference/engine-conventions.md` paragraphs cite this tracker by section name
(*Resources introspection restore*, *Resource lifecycle events*); both live inside the
**Resource-manager follow-ons** section below.

## Resource-manager follow-ons

Tracker for the two resource-manager (RM) follow-ons both filed by RM-4 on landing
(2026-05-28) and both gated on the same trigger: **the first external consumer
(outside `@furnace/core`) files a concrete need.** One is a lifecycle-events channel
RM-4 rejected as speculative; the other is the `list` / `snapshot` introspection
surface RM-4 deleted for having zero call sites. They are merged because they share
that "external-consumer-with-a-concrete-need, not speculative readiness" trigger and
both restore/add cleanly over the manager's existing internals.

### Resource lifecycle events — external consumer trigger

*Filed by RM-4 on landing (2026-05-28). RM-4 considered an events-based decoupling between the manager and stats and rejected it as speculative — both modules are internal-to-core, ship in the same package, and evolve together. The "right transport for right consumer" principle (codified in `engine-conventions.md` §"Stats relationship") says events earn their keep only when an external consumer of those events exists.*

#### When to revisit

When an external consumer (outside `@furnace/core`) files a concrete need for resource-lifecycle event subscription. Candidates:
- A telemetry exporter that batches resource creation rates for production monitoring
- A devtool plugin subscribing to live resource creation for a UI inspector
- A performance overlay that reacts to allocation bursts (e.g. detects "more than N meshes allocated per frame")
- A profiler integration concrete enough to specify the events it needs

The trigger is "first external consumer with a concrete need," not speculative readiness.

#### What to build when triggered

- Manager emits at `allocSlot` / `destroySlot` (the existing single-writer points)
- Events flow through `@furnace/core/events` Emitter primitive (existing substrate)
- Stats stays on its current direct-call path — events are ADDITIVE, not replacement (stats's tight coupling is fine for an internal-to-internal path)
- Event shape probably: `{ kind, op: "alloc" | "destroy", bytes }` — minimal payload, consumer derives what it needs

The events channel is small to build; the work is gated only by knowing what shape the real consumer wants.

#### Reference

- `engine-conventions.md` §"Stats relationship" — codified principle

### Resources introspection restore — `list` / `snapshot`

*Filed by RM-4 on landing (2026-05-28). RM-4 deleted `resources.list` and `resources.snapshot` from the public surface because zero consumer-package call sites existed (verified during spec phase). The manager retains `_iterateLive` internally; restoration is mechanical when needed.*

#### What was deleted

- `resources.summary(ctx) → ResourceSummary` — covered by `stats.snapshot(ctx).resources.*`; not restored even on trigger (use stats).
- `resources.list<H>(ctx, kind) → IterableIterator<H>` — deleted; restorable.
- `resources.snapshot(ctx) → ResourceSnapshot` — deleted; restorable.
- Types: `ResourceSummary`, `ResourceSnapshot`.

#### When to revisit

When an external consumer needs live-handle iteration or per-kind handle-array snapshot for:
- A dev-tools panel that lists every live resource by kind
- Custom dispose logic that wants to walk a specific kind before scene transition
- A post-mortem dump tool that needs structured handle arrays

The trigger is "first external consumer files a concrete need," not speculative readiness.

#### What to do when triggered

- Re-expose `list` and `snapshot` wrappers in `packages/core/src/resources/index.ts` over the existing `_iterateLive<unknown>(ctx, kind)` internal helper.
- Restore `ResourceSummary` / `ResourceSnapshot` type definitions.
- Add test coverage matching the consumer's use case.

Implementation is ~30 LOC; no design questions.

#### Reference

- Deleted code: see git history at the RM-4 deletion commit

## A resource ownership root — strategy-driven GPU lifetime

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

### The live precedent to design against

`LoadedWorld` (`packages/dungeon/src/world/world-loader.ts`) is a hand-rolled instance of
exactly this, and it is the best evidence available about what the abstraction has to handle.
It returns a `destroy()` that frees the meshes, geometries and instanced draws THAT LOAD
created — and deliberately does NOT free the static physics bodies (they die with
`physics.destroyWorld`) or the `MaterialCache` (the caller's, and it outlives the draws). A
general root has to express that asymmetry: **three lifetimes in one load, two of them not
the root's.** Any design that assumes "everything a load touches dies with the load" is
already wrong against the one real consumer.

### Why deferred from B-1

B-1 fixed an active leak by deleting a violating API. It did not introduce the new abstraction
this would require — a separate top-level concept, coordination with stats, `gpu.dispose`,
render targets, post effects, and every other module that allocates GPU resources. That's
multi-tranche work with its own brainstorm + spec + plan cycle.

B-1's deliberate non-foreclosure: by codifying the simple ownership rule in
`engine-conventions.md`, B-1 leaves room for a root to either *replace* the rule (the root owns
everything; the rule applies inside its boundaries) or *layer over* it (the root tracks
references but the rule still describes the underlying handles). Either path stays open.

### Distinct from `unbuilt-tier-2-modules.md` §Transform-hierarchy helpers

That entry is about *transform composition* (parent/child, world matrices, traversal). This one
is about *resource lifetime*. They used to be described as candidates to ship together as one
`@furnace/core/scene` module; that shared destination is gone, and they should now be judged
independently — which is the honest position anyway, since nothing about a transform hierarchy
implies a lifetime policy.

### Trigger to revisit

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
- Adjacent: `docs/backlog/engine-architecture/unbuilt-tier-2-modules.md` §Transform-hierarchy helpers (transform
  composition; not the same scope).

## Wrap `device.createBuffer` / `createTexture` for automatic resource tracking

Tranche 5 instruments six engine-internal buffer/texture create sites by hand (`_registerResource` + handle storage at each one). The pattern is fine for the current count, but if create sites grow significantly we want a single point of truth — `gpu.createBuffer(ctx, descriptor)` and `gpu.createTexture(ctx, descriptor)` wrappers that register automatically, plus matching `gpu.destroyBuffer(buffer)` / `gpu.destroyTexture(texture)` helpers.

Implementation sketch: a `WeakMap<GPUBuffer | GPUTexture, ResourceHandle>` inside `gpu/` keyed by the underlying GPU object. Engine modules call `gpu.createBuffer(ctx, desc)` instead of `ctx.device.createBuffer(desc)`; the wrapper handles registration and stashes the handle. `gpu.destroyBuffer(buffer)` looks up the handle and unregisters before calling `buffer.destroy()`. Consumers using raw `ctx.device.createBuffer` are still allowed — those just don't surface in the memory totals.

Open design questions: do we wrap or replace `ctx.device.createBuffer` access? Replacement is cleaner but breaks the "ctx is a transparent data carrier" model. Wrapping leaves both paths usable but means engine modules must remember to use the wrapped path.

**Trigger to revisit:** When engine-internal create sites exceed ~15, or when a new tranche adds resource types (e.g. compute pipelines, query sets) that should participate in tracking without each one re-implementing the register/unregister boilerplate.

**Reference:** Core Tranche 5 (stats expansion) — "Why explicit-at-site instead of wrapped `device.createBuffer/Texture`".

## Consumer-owned uniform buffers: candidates for a managed-buffer primitive

*Tier-2 candidate. Surfaced during Resource Manager Stage 2 closeout (2026-05-28).*

> **THE PREMISE IS DEAD, and this is recorded rather than re-pointed — T5 branch review,
> 2026-08-11.** As written below, this section rests on named cookbook demos holding
> consumer-owned `GPUBuffer`s they destroy by hand. **They do not, and have not since
> 2026-05-31** — three days after this entry was filed. Commit `fcaa37a5`
> ("migrate material @group(1) params to the binding bridge (E-B)") moved both demos onto
> `@furnace/core/binding`. Today `grep -rn "createBuffer\|GPUBuffer" packages/cookbook/src`
> returns **one line, and it is a comment saying "Bindings own their GPUBuffers"**; the
> shader demo calls `binding.create` / `binding.setUniform` / `binding.destroy`, and the
> only raw `destroy()` calls left in `render-target/entry.ts` are on the PiP **textures**
> (`r.texture` / `r.depthTexture`), not uniform buffers.
>
> **So this entry's own trigger has already fired and been satisfied without anyone noticing.**
> It said "when a future tranche introduces a managed-buffer primitive… these sites become
> candidates for migration". `@furnace/core/binding` IS that primitive (Tranche E-B), and the
> sites DID migrate. What survives is narrower and still true: `MaterialDescriptor.bindings`
> still accepts raw `GPUBindGroupEntry[]` as a public, consumer-owned, untracked escape hatch
> (`packages/core/src/material/material.ts` — its TSDoc says "All three are consumer-owned"),
> and it now has **zero cookbook consumers**. Whether an escape hatch with no demo behind it
> should stay, be documented as unmanaged, or go, is a surface decision for the classification
> audit — **flagged for the review, deliberately not taken here.**
>
> The original text is kept below unchanged, because it is the record of why the migration was
> wanted.

Several cookbook demos pass consumer-owned `GPUBuffer` instances into `MaterialDescriptor.bindings` (`@group(1)` entries) and manage their lifecycle by hand via `buffer.destroy()`:

- `packages/cookbook/src/demos/shader/entry.ts` — consumer-owned uniform buffers backing the striped + plasma materials. *(Migrated to `binding` at `fcaa37a5`; the `:153-154,165-166` line citation this carried now lands on `binding.setUniform` calls and has been dropped rather than re-pointed.)*
- `packages/cookbook/src/demos/render-target/entry.ts` — similar consumer-owned uniform buffers in the PiP rebuild flow. *(Migrated at the same commit.)*

Stage 1's resource manager covers Mesh / Material / Geometry / Effect, but NOT the consumer-owned buffers passed into those resources via `MaterialDescriptor.bindings` / `EffectDescriptor.bindings`. Those stay consumer-owned by design — consumers create them, write to them per frame, and destroy them.

When a future tranche introduces a managed-buffer primitive (likely as part of Tier-2 asset / streaming work), these raw `GPUBuffer.destroy()` sites become candidates for migration to the managed shape.

### Trigger to revisit

- When Tier-2 asset loader work begins, OR
- When a managed-buffer primitive is introduced in any other tranche that these sites should adopt for consistency.

**Reference:** Surfaced 2026-05-28 during Stage-2 closeout adjacency check. Stage 1 spec §2 explicitly OUT'd asset-loader / streaming layer / LRU eviction as Tier-2 work; this entry tracks one consumer-side surface that will need migration when that work lands.

## ctxId wraparound silently aliases handles across contexts

The ctxId field in a resource handle exists to stop one context's handle resolving into another context's live slot — `_lookupRaw`/`_destroyRaw` compare `decodeCtxId(handle)` against `ctx._internal.ctxId` and reject on mismatch (`packages/core/src/resources/internal.ts`). That guard is exact for the first 65535 contexts in a JS realm and then stops being exact: `_nextContextId` (`packages/core/src/gpu/internal.ts`, lines 43–47 as of 2026-08-11) wraps `0xffff → 1` with **no guard and no aliasing detection**, and `encodeHandle` masks ctxId to 16 bits, so context N and context N+65535 are indistinguishable to every lookup. A stale handle from the older one then resolves into the newer one's live slot at the same index and generation — precisely the wrong-slot resolution the field was added to prevent, and silent when it happens.

Not a today-problem, and the napkin says so: one context per verify at ~1 Hz in a worker that never reloads is ~18 hours of continuous operation to wrap, and per-user-edit construction is unreachable. It is also a limit `Context` has always carried (documented in `packages/core/src/resources/handle.ts` as an SPA-lifetime limit).

Filed now because F4 Task 4 changed the cost side of that calculation, not the risk side. `createHeadlessPhysicsContext` makes context construction an order of magnitude cheaper than `requestContext` — no adapter, no device, no canvas configure, no swapchain — so a caller can now plausibly build contexts in a loop where previously the GPU handshake made that self-limiting. The TSDoc on `createHeadlessPhysicsContext` and the tranche-B prompts both say "one context per session, not one per query"; this entry covers the case where that guidance is not followed.

**Trigger to revisit:** a caller constructs contexts per-operation rather than per-session — e.g. the analyzer worker or the walk-probe builds a fresh headless context per verify instead of reusing one for the session, or any long-lived worker's context count becomes unbounded in the number of user actions.

**Cheap mechanism if it fires:** a warn (or assert) on wrap inside `_nextContextId` — the counter already has the single choke point, so detecting "this realm has now recycled ctxIds, handle-crossing rejection is no longer exact" is a two-line change. Widening the field is the expensive option and needs the handle layout revisited (`encodeHandle` currently spends bits 0-15 slot / 16-31 generation / 32-47 ctxId inside the uint48 safe-integer budget).

**Reference:** `packages/core/src/gpu/internal.ts` (`_nextContextId`, the wrap); `packages/core/src/resources/handle.ts` (`encodeHandle`/`decodeCtxId`, the 16-bit layout + the existing SPA-lifetime note); `packages/core/src/resources/internal.ts` (`_lookupRaw`/`_destroyRaw`, the guard); `packages/core/src/physics/context.ts` (the cheap construction path); cross-context rejection is pinned by `packages/core/src/physics/headless-context.test.ts`.
