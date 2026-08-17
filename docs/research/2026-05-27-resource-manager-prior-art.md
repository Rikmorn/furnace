# Prior art: Resource manager subsystems in game engines and rendering libraries

This document surveys how mature engines structure a **centralized resource manager** — the layer that knows about every create and every destroy, decides *when* a freed resource is actually torn down, and decouples the renderer from per-resource lifecycle. It is the layer above the per-handle dispose/destroy semantics already covered in [`2026-05-27-destroy-ownership-prior-art.md`](./2026-05-27-destroy-ownership-prior-art.md). That file looked at "what does `destroy(handle)` do at the boundary"; this one looks at "who owns the pool of all handles, and what indirection sits between user-signal and actual free". Most surveyed systems are C++/Rust; the JS-side precedent is thin and converges on direct-reference patterns. Findings below are verified by reading the cited primary source in this session except where marked "uncertain" or "secondary source".

---

## 1. Per-system findings

### Sokol-gfx — pool + generation counter (canonical reference)

Read directly from `sokol_gfx.h` at master (26,796 lines). Line numbers below cite that file.

**Handle.** 32-bit ID in a zero-cost struct: `typedef struct sg_buffer { uint32_t id; } sg_buffer;` and similar for `sg_image`, `sg_sampler`, `sg_shader`, `sg_pipeline`, `sg_view`. The ID packs **lower 16 bits = pool slot index, upper 16 bits = generation counter** (lines 6201–6203: `_SG_SLOT_SHIFT = 16`, `_SG_SLOT_MASK = (1<<_SG_SLOT_SHIFT)-1`).

**Pool** (lines 6129–6142):

```c
typedef struct { uint32_t id; uint32_t uninit_count; sg_resource_state state; } _sg_slot_t;
typedef struct { int size; int queue_top; uint32_t* gen_ctrs; int* free_queue; } _sg_pool_t;
```

**Manager scope.** One pool per resource type, all in `_sg.pools` (lines 7235–7240). Pool sizes are fixed at setup time (defaults: 128 buffers, 128 images, 32 shaders, 64 pipelines, 256 views). Slot 0 reserved for the invalid-id sentinel (line 7478).

**ID construction on alloc** (lines 7657–7660): generation counter bumped, packed into upper bits.

```c
uint32_t ctr = ++pool->gen_ctrs[slot_index];
slot->id = (ctr<<_SG_SLOT_SHIFT)|(slot_index & _SG_SLOT_MASK);
```

**Lookup with generation check** (lines 7714–7722) — the use-after-free defence:

```c
_SOKOL_PRIVATE _sg_buffer_t* _sg_lookup_buffer(uint32_t buf_id) {
    if (SG_INVALID_ID != buf_id) {
        _sg_buffer_t* buf = _sg_buffer_at(buf_id);
        if (buf->slot.id == buf_id) return buf;   // generation match
    }
    return 0;
}
```

If a slot has been recycled, the stored `slot.id` carries a new generation and the comparison fails. Lookup is O(1): one bounds check, one comparison.

**Creation.** Two-step (`sg_alloc_buffer` + `sg_init_buffer`) or one-shot (`sg_make_buffer`). The two-step path exists to issue handles before async data is available.

**Destruction.** `sg_destroy_buffer` returns the slot to the free queue; generation counter persists for next reuse.

**Use-after-free.** Silent — lookup returns null, caller short-circuits. No throw, no warn. Generation comparison is the entire mechanism.

**Trade-offs.** Fixed pool means OOM is a hard cap, not a heap-grow. No internal refcounting — sharing is the caller's responsibility. Generation overflow at 2^16 is admitted in source comment (line 7650: "for now, just overflow").

---

### bgfx — deferred destruction across double-buffered frame pipeline

Read from `include/bgfx/bgfx.h` and `bkaradzic.github.io/bgfx/internals.html`.

**Handle.** 16-bit only, via `BGFX_HANDLE` macro (lines ~65–67):

```cpp
#define BGFX_HANDLE(_name) \
    struct _name { uint16_t idx; }; \
    inline bool isValid(_name _h) { return bgfx::kInvalidHandle != _h.idx; }
```

`kInvalidHandle = UINT16_MAX`. No generation counter — relies on consumer discipline.

**Manager scope.** One global bgfx context. Resource API calls are mutex-guarded (`m_resourceApiLock`).

**Destruction model — deferred to the render thread.** From the internals doc:

> "the actual GPU work (uploading textures, creating buffers, etc.) is deferred: the commands are recorded into the frame's command buffer and executed later on the render thread."

The architecture is a **double-buffered frame pipeline**: two `Frame` objects, one being written by the API thread (submit buffer), one read by the render thread (render buffer). `bgfx::frame()` flips them (`bx::swap`). **Destroy commands enqueue into the submit buffer and only execute when that buffer flips to the render side** — typically 1–2 `frame()` calls of latency. This eliminates "destroy mid-frame, GPU still using it" bugs by construction.

**Use-after-free.** `isValid(handle)` checks against the sentinel; recycled-slot detection isn't provided.

**Trade-offs vs sokol.** Smaller handle, no generation counter, no use-after-free detection at the handle layer. In exchange: thread-safe deferred destroy across a producer/consumer pipeline. Reflects bgfx's "production renderer with explicit multithreading" stance vs sokol's "minimal single-threaded foundation".

---

### wgpu (Rust) — `Arc`-based handles with internal `LifetimeTracker`

Read from `docs.rs/wgpu/latest/wgpu/struct.Buffer.html` and `deepwiki.com/gfx-rs/wgpu/1.1-architecture`.

**Handle.** `wgpu::Buffer` is a public `Clone`-able handle implementing `Clone, Eq, Hash, PartialEq, Ord, PartialOrd`. Internally `Arc`-wrapped around a `wgpu-core` resource. The wgpu-hal crate-level note confirms it: "a `wgpu_hal::Device` must outlive all resources created from it, and `wgpu-core` types ensure these requirements are upheld mostly by using `Arc`."

**Manager scope.** Per-`Device` "Hubs and Trackers" in `wgpu-core`. Two named trackers:
- **`DeviceTracker`** — usage state for barrier generation.
- **`LifetimeTracker`** — resources whose last `Arc` owner has dropped but the GPU may still be using them.

**Destruction — hybrid.** Three concurrent mechanisms:
- `Buffer::destroy(&self)` — "Destroy the associated native resources as soon as possible." Takes `&self` so multiple destroys are structurally possible; idempotency per WebGPU spec.
- `Drop` on last `Arc` — queues into `LifetimeTracker`; actual free waits for the next submission-index fence ≥ last use.
- A device-local "destruction" read-write lock blocks destroys while a `Buffer::as_hal()` guard is held.

**Use-after-free.** Structurally impossible for the GPU memory while clones exist. Post-`destroy()` use produces WebGPU validation errors per spec.

**Lookup cost.** `Arc` clone = one atomic increment; deref = one pointer chase. No hash, no generation check.

**Trade-offs.** Best sharing semantics. The whole stack relies on `Arc` and `Drop` — neither exists in JS.

---

### Filament — Engine-as-resource-manager

Read from `filament/include/filament/Engine.h`.

**Handle.** Raw C++ pointers from factory methods: `SwapChain*`, `Renderer*`, `Scene*`, `Camera*`. No opaque ID, no refcount.

**Manager scope.** One central Engine. Quote: *"Each Engine instance keeps track of all objects created by the user, such as vertex and index buffers, lights, cameras, etc..."*

**Creation.** Every resource via `Engine::createX(...)`. No public direct allocation.

**Destruction.** Consumer-driven `engine.destroy(x)`, with engine-level fallback: *"leaked resources are freed when the engine instance is destroyed and a warning is emitted in the console."* Plus a global ordering rule: *"`Engine.destroy()` should be called last and after all other resources have been destroyed."*

**Use-after-free.** Not policed. UB (typical C++).

**Trade-offs.** Conceptually clean dual-responsibility model — explicit destroy, sweep + warn on leak. Heavy API surface (two methods per resource type). No deferral or generation safety at the public layer.

---

### Vulkan Memory Allocator (VMA) — the layer below

From `gpuopen.com/vulkan-memory-allocator/`.

VMA is *not* a resource manager in this survey's sense — it is the **memory-allocation layer below**. It returns `(VkDeviceMemory, offset, size)` triples by sub-allocating from large memory blocks, handles defragmentation, and tracks per-type budgets. Object identity, refcounting, lifetime tracking, and handle-to-resource mapping are out of scope.

**Relevance.** Useful as a boundary marker: "GPU memory pool" and "named resource identity" are distinct concerns. WebGPU does not expose sub-allocation, so this layer is invisible to JS-side engines.

---

### Unity Addressables — two-level explicit refcounting

From `docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html`.

**Handle.** `AsyncOperationHandle<T>` from `LoadAssetAsync<T>(...)`; holds a refcount-1 reference to an internal load operation.

**Two-level refcount:**
- **Asset refcount** — `LoadAssetAsync` increments, `Release` decrements. Multiple loads of the same asset share one operation and bump the same count.
- **Bundle refcount** — loading any asset increments the containing bundle's count. Memory only frees when the bundle's count hits zero. Quote: *"Memory used by an asset is not freed until the AssetBundle it belongs to is also unloaded."*

**Trade-offs.** Precise but error-prone — exposed refcount means imbalance leaks or underflows. Unity tooling warns on imbalance. The two-level design exists because bundles are the storage unit; granular per-asset unloading is impossible.

---

### Unreal Engine — UObject GC + AssetManager refcount

From `dev.epicgames.com/documentation/en-us/unreal-engine/unreal-object-handling-in-unreal-engine`, `slicker.me/unreal/garbage-collection.htm`, and `jooballin.com` AssetManager writeup. Secondary sources — not all verified to engine source in this session.

**Two stacked systems:**

1. **UObject mark-and-sweep GC.** References discovered via the reflection system: `UPROPERTY()` fields are scanned, raw `UObject*` outside `UPROPERTY` is *not* and won't keep an object alive. `Destroy()` flags `RF_PendingKill`; the next sweep finalises. Incremental in UE5+.
2. **AssetManager** — higher-level layer. `AsyncLoadPrimaryAsset` increments a strong refcount; `UnloadPrimaryAsset` decrements. AssetManager holds `UPROPERTY` references; releasing them makes assets GC-eligible.

**Trade-offs.** GC eliminates manual `delete` and cycles, at the cost of pauses (mitigated by incremental sweeping) and the reflection-system trap (forgetting `UPROPERTY` is a silent bug). AssetManager's refcount lives *on top of* GC, not in place of it.

---

### Babylon.js — `AssetContainer` for grouped lifecycle

From `doc.babylonjs.com/typedoc/classes/BABYLON.AssetContainer` and `packages/dev/core/src/assetContainer.ts`.

**Concept.** A *bag of assets loaded together* — meshes, materials, textures, animations — addressable as a unit. Methods: `addAllToScene()`, `removeAllFromScene()`, `moveAllFromScene()`, `dispose()`.

**Manager scope.** The container is a sub-manager / named grouping, not a separate authoritative manager. Scene owns top-level resources.

**Destruction.** Fan-out — `dispose()` iterates each contained asset's `dispose()`. No refcounting at the container layer.

**Known leaks.** Issue 6051 and forum threads document `removeAllFromScene` missing InstancedMesh instances and `addAllToScene`/`removeAllFromScene` leaking materials/textures — the failure mode of "bag of assets" when the container's view drifts from the scene's references.

**Relevance.** JS-side precedent for **grouped lifecycle** without going to manager-mediated indirection.

---

### Three.js — `WebGLProperties` and event-driven cache eviction

Read from `src/renderers/webgl/WebGLProperties.js` and `WebGLObjects.js`.

**Handle.** Public types (`BufferGeometry`, `Material`, `Texture`) are **descriptors**, not GPU resources. The renderer keeps `WebGLProperties` — a `WeakMap<Descriptor, BackingGPUState>`.

**Manager scope.** Per-renderer. `WebGLProperties` is internal to a `WebGLRenderer` instance.

**Creation.** Implicit — first time the renderer sees a descriptor without backing GPU state, it creates it. No user-visible `create` call for GPU state.

**Destruction.** Descriptor `dispose()` does literally `dispatchEvent({ type: 'dispose' })`. The renderer subscribes and calls `WebGLProperties.remove(descriptor)`, which `delete`s the WeakMap entry and frees GPU resources.

**Use-after-dispose.** The descriptor is still a valid descriptor. Re-rendering with it **lazily re-creates** the GPU resource. Friendly, but masks leaks.

**WeakMap nuance.** Dropping all descriptor references (without dispose) makes the WeakMap entry GC-eligible — but only the mapping is collected, not the GPU resource in the value. Explicit `dispose()` remains required for actual GPU cleanup.

**Trade-offs.** Cleanest JS-native model — uses WeakMap, events, native GC. No manager API surface. The lazy-recreate behaviour is the non-obvious cost.

---

### D3D12 / Vulkan descriptor heaps — fence-tracked slot recycling

From `gamedeveloper.com/programming/managing-d3d12-resource-lifetimes` and `diligentgraphics.com/diligent-engine/architecture/d3d12/managing-descriptor-heaps/`.

Descriptor heap slots can't be freed immediately — GPU may still be reading. Standard pattern: free → push to deferred-release queue tagged with current fence/frame; at end-of-frame, release queued items whose fences have signalled. Alternative: per-frame stacks, reset on fence completion (ring of stacks).

**Relevance.** This is the GPU-side analog of the deferral pattern bgfx implements at the API layer. **WebGPU hides this** — destroyed resources remain usable by in-flight commands per spec; the browser handles fence tracking. For a furnace-side manager, the WebGPU spec already provides this safety; the deferral is *available* (destroy is safe mid-frame) without the bookkeeping.

---

## 2. Synthesis: four resource manager strategies

Each strategy bundles handle representation, manager scope, creation/destruction model, use-after-free behaviour, and the renderer-coupling story.

### Strategy 1 — Pool + generation counter (Sokol pattern)

- **Handle:** Opaque integer (commonly 32-bit: 16-bit slot index + 16-bit generation). Zero-cost copy. Strongly-typed wrapper struct for compile-time discrimination.
- **Manager scope:** One pool per resource type, owned by a single global or per-context manager. Fixed-size pools (cap baked into slot-index bit width).
- **Creation:** `alloc_X()` reserves a slot and bumps generation; `init_X(handle, desc)` populates. One-shot `make_X(desc)` is the common case. Handles exist from `alloc` onward — supports async data flow.
- **Destruction:** `destroy_X(handle)` — slot returns to free queue, generation counter persists, slot is eligible for reuse with a different generation.
- **Use-after-free:** Generation mismatch on lookup → null pointer → caller short-circuits. Cheap, deterministic, silent.
- **Memory model:** One backing array per type, allocated up-front. No per-resource heap alloc after pool setup. Good cache behaviour for iteration.
- **Renderer coupling:** Renderer holds opaque IDs, calls `lookup_X(id)` per use. Lookups are O(1). Renderer carries zero lifecycle knowledge.
- **JS translation:** Trivial — `Uint32Array` for generation counters, plain arrays (or typed-array-of-records) for slot data. Branded TypeScript types for opaque IDs. Loses C's contiguous-struct cache layout but keeps the algorithmic protection.
- **Trade-offs:** Fixed-pool OOM is a hard error. No refcounting. Generation overflow at 2^16 is a real concern for very-long-lived contexts.

### Strategy 2 — Deferred destruction over a frame pipeline (bgfx pattern)

- **Handle:** Small opaque integer (16-bit common). No generation counter — relies on consumer discipline.
- **Manager scope:** One global manager; destruction queue split across a producer/consumer pipeline.
- **Creation:** Synchronous from the API thread; queues a create-command.
- **Destruction:** **Always deferred.** `destroy(handle)` enqueues; the command runs when the submit buffer flips. Typical latency: 1–2 `frame()` calls.
- **Use-after-free:** Best-effort. `isValid` checks invalid-id only; recycled-slot use is consumer's responsibility.
- **Renderer coupling:** Renderer is the command-buffer consumer — sees a stream of commands including create/destroy.
- **JS translation:** A second thread isn't needed; queue destroys, flush at frame boundary. WebGPU already handles GPU-side fence tracking. The deferral is consumer-observable determinism, not a safety requirement.
- **Trade-offs:** Eliminates mid-frame-destroy bugs by construction. Latency cost visible in tight create/destroy/recreate loops. No use-after-free detection — prevention is architectural, not algorithmic.

### Strategy 3 — Refcounted smart-handle (wgpu / Addressables / Babylon-internal pattern)

- **Handle:** Refcount-incrementing wrapper. Cheap to clone. wgpu uses `Arc`; Addressables uses an explicit refcount field; Babylon uses an opaque handle over an internal-refcounted effect cache.
- **Manager scope:** Per resource type (wgpu hubs), per loading domain (Addressables), or per shared-resource class (Babylon effect cache).
- **Creation:** Returns a handle with refcount 1; clone increments.
- **Destruction:** Refcount decrement on drop/release; final decrement triggers free. Often *also* deferred — wgpu's `LifetimeTracker` waits for GPU fences; Addressables ties asset memory to bundle-refcount.
- **Use-after-free:** Structurally impossible while clones exist. After explicit `destroy()`, falls back to the underlying spec (WebGPU validation errors).
- **Renderer coupling:** Renderer holds a refcounted handle like any other consumer — sharing semantics are uniform.
- **JS translation:** **No native `Arc`.** Possible to fake with explicit `acquire`/`release` (Addressables-style), but consumer discipline is required. `FinalizationRegistry` exists but is non-deterministic and the spec warns against using it for resource cleanup. A "best-effort" hybrid: explicit refcount with `FinalizationRegistry` as a *leak detector* that warns on dropped-without-release.
- **Trade-offs:** Best sharing semantics — geometry shared across 100 meshes works naturally. Worst introspection. In JS, largest impedance mismatch.

### Strategy 4 — Engine-as-manager, single ownership, explicit destroy (Filament / three.js pattern)

- **Handle:** Direct object/pointer reference. Single owner.
- **Manager scope:** One top-level Engine or Renderer per context. Lifecycle is the user's; the Engine *knows what's been issued* but doesn't gate operations.
- **Creation:** `engine.createX(desc)` (Filament) or implicit-on-first-use (three.js descriptor pattern).
- **Destruction:** Consumer-driven explicit destroy (Filament) or signal-based eviction via event/cache (three.js). Engine teardown sweeps leaks with a warning.
- **Use-after-free:** Not policed at the manager layer; resolved per resource (three.js lazily re-creates; Filament is UB).
- **Renderer coupling:** Renderer holds the same references the consumer holds. Decoupling is by discipline, not indirection.
- **JS translation:** This is what three.js, Babylon, PixiJS already do. The pattern is JS-native — no language features missing. Manager's role is bookkeeping for teardown-sweep + event subscription, not gatekeeping every operation.
- **Trade-offs:** Minimum surface, minimum overhead, no indirection. No use-after-free detection beyond per-resource destroy contracts. Sharing across owners is unsolved at the manager layer — consumers either accept duplicate uploads or build their own caches.

---

## 3. Closing observations

### Decoupling: how the renderer talks to the manager

Two shapes across the survey:

1. **Handle-as-token, lookup at use-site (Sokol, bgfx).** Renderer holds opaque IDs and calls `lookup(id)` per draw. O(1) bounds + generation check. Renderer carries zero lifecycle knowledge — strongest decoupling.
2. **Handle-as-reference, direct dereference (wgpu, Filament, three.js).** Renderer holds an `Arc` (or raw pointer) and dereferences directly. No per-frame lookup, but lifetime is held implicitly by the renderer's possession.

For WebGPU draw counts in the hundreds-to-low-thousands per frame, both costs are negligible vs GPU work. The choice is about architectural clarity, not perf.

### "Signal vs act" indirection — what it buys

Deferred-free systems (bgfx end-of-frame, wgpu `LifetimeTracker`, Unreal pending-kill, D3D12 fence queues) buy:
- **Mid-frame safety** — destroy during render is safe.
- **Batched teardown** — multiple destroys process together.
- **Reordering for safety** — destroys reorder freely relative to commands.

**WebGPU's spec gives most of this for free.** `GPUBuffer.destroy()` is safe to call mid-frame; destroyed resources remain usable by already-recorded commands. A furnace-side manager could pass destroys straight through (rely on the spec) *or* queue them and flush at a frame boundary anyway (gives consumer-observable determinism — "after `destroy` and `frame()` returned, it's gone" — that WebGPU doesn't promise).

### Refcounting: exposed vs internal

- **Exposed refcount (Unity Addressables).** Consumers call `Acquire`/`Release` explicitly. Precise but error-prone — imbalance leaks or underflows.
- **Internal refcount under single-owner public API (Babylon material → effect cache).** Public `dispose()` is single-owner; manager refcounts shared sub-resources beneath. Consumers don't see the refcount.

For "geometry shared across 100 meshes", the internal-refcount pattern is the cleaner JS fit: consumers create N meshes pointing at one geometry handle, manager tracks the share count, actual GPU free happens at last-mesh-destroy with no refcount API.

### Streaming / LRU eviction

None of the surveyed *handle-layer* managers (Sokol, bgfx, wgpu, Filament, three.js) directly solve LRU streaming. Unity Addressables comes closest (refcount + on-demand load/unload) but doesn't do LRU either. LRU is invariably a *higher* layer that calls into the resource manager when a working-set entry expires. The lower-level manager just needs fast destroy/create cycles without fragmenting — pool+generation (Strategy 1) is the strongest fit for that.

### Generation counters — what they catch, what they cost

Sokol's pattern specifically catches **"old handle to a slot that has been recycled to a different resource"** — silent data corruption otherwise. Cost: one extra `uint32_t` per slot plus one comparison per lookup. Bgfx omits it because deferred-destroy means slots aren't reused within a frame, but the protection is weaker for handles held across frames. For JS, the same logic applies — `Uint32Array` for counters is cheap, integer compare is cheap, the bug class it catches is hard to catch any other way at the same cost.

### What JS cannot replicate, what it can

- **No `Arc`, no `Drop`.** Strategy 3 pays the largest impedance mismatch. `FinalizationRegistry` is the only language-level handle on "this object became unreachable", and the spec warns it's not a substitute for explicit cleanup. The Addressables pattern (explicit `Release`) is the closest viable analog.
- **No move semantics.** Strategy C in the prior research file (linear types) remains attractive in theory, unused in practice.
- **No aligned heap or zero-cost abstractions.** Strategy 1's pool model is *behaviourally* replicable — `Uint32Array` for counters, plain arrays for slot data. Survives translation: generation counter, O(1) lookup, no per-resource heap allocation. What doesn't survive: contiguous-struct cache locality.
- **`WeakMap` / `FinalizationRegistry` are JS-native gifts.** Strategy 4's descriptor pattern is *easier* in JS than in C — `WeakMap<Descriptor, BackingResource>` is one line. The trade-off (lazy re-create on use-after-dispose) is genuine, not a JS limitation.
- **`uint32` handles work natively.** Numbers are 64-bit floats, but `>>>0` and `Uint32Array` make the bit-level operations cheap and exact. Branded TypeScript types give opaque-handle discipline at the type level.

### Fundamental limits

1. **WebGPU is async to JS.** Any "destroy now" is, at the GPU level, "destroy when the device timeline gets there". The spec handles this; whether the manager surfaces the async-ness is a design choice.
2. **No language-enforced single-owner.** Every JS-side manager surveyed (three.js, Babylon, PixiJS) accepts this and uses runtime flags + documentation.
3. **GC timing is non-deterministic.** Any "released when no longer referenced" semantic fires unpredictably. Explicit destroy must remain primary; GC-driven cleanup is at best a backstop.

These limits constrain the design space to (some combination of) Strategies 1, 2, and 4. Strategy 3 is implementable in JS but pays the largest impedance cost.

---

*Citations: sokol_gfx.h lines 6129–6203, 7475–7722 — https://github.com/floooh/sokol/blob/master/sokol_gfx.h ; bgfx.h lines ~65–67, ~1078–1092 — https://github.com/bkaradzic/bgfx/blob/master/include/bgfx/bgfx.h ; bgfx internals — https://bkaradzic.github.io/bgfx/internals.html ; wgpu Buffer — https://docs.rs/wgpu/latest/wgpu/struct.Buffer.html ; wgpu architecture — https://deepwiki.com/gfx-rs/wgpu/1.1-architecture ; Filament Engine.h — https://github.com/google/filament/blob/main/filament/include/filament/Engine.h ; VMA — https://gpuopen.com/vulkan-memory-allocator/ ; Unity Addressables memory mgmt — https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html ; Unreal Object Handling — https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-object-handling-in-unreal-engine ; Babylon AssetContainer — https://doc.babylonjs.com/typedoc/classes/BABYLON.AssetContainer and https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/assetContainer.ts ; three.js WebGLProperties.js, WebGLObjects.js — https://github.com/mrdoob/three.js/blob/master/src/renderers/webgl/ ; D3D12 lifetime — https://www.gamedeveloper.com/programming/managing-d3d12-resource-lifetimes ; Diligent descriptor heaps — https://diligentgraphics.com/diligent-engine/architecture/d3d12/managing-descriptor-heaps/ .*

**Fed:** the handle + generation-counter resource-manager choice in `docs/reference/engine-conventions.md` §Resource manager, which cites this file and `2026-05-27-destroy-ownership-prior-art.md` as the prior art that drove it.
