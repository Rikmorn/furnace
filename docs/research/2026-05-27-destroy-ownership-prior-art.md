# Prior art: GPU/runtime resource ownership and dispose/destroy semantics

This document surveys how mature systems handle the *ownership story* around resources with explicit teardown — focusing on the under-discussed half of the problem: **what happens when a disposed handle is used or disposed again**. The goal is to feed furnace's `material/mesh/geometry/post` ownership design with a strategy menu drawn from real precedent, not invented behaviour categories.

Sources are cited inline; for source-code claims, the file paths and line numbers in the cited GitHub trees are listed. All findings below are verified by reading the cited primary source in this session except where explicitly marked "uncertain".

---

## 1. Per-system findings

### C# `IDisposable` / Dispose pattern

Microsoft's API reference is unusually direct:

> "If an object's `Dispose` method is called more than once, the object must ignore all calls after the first one. The object must not throw an exception if its `Dispose` method is called multiple times. Instance methods other than `Dispose` can throw an `ObjectDisposedException` when resources are already disposed."
> ([learn.microsoft.com/en-us/dotnet/api/system.idisposable.dispose](https://learn.microsoft.com/en-us/dotnet/api/system.idisposable.dispose))

The Dispose-pattern guidance reinforces it: "a `Dispose` method should be idempotent... Furthermore, subsequent invocations of `Dispose` should do nothing." ([learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose))

- **Mechanism:** A `_disposed` boolean (or `Interlocked.CompareExchange` int for thread-safety) inside `Dispose(bool disposing)`. Standard idiom: `if (_disposed) return; ... _disposed = true;`. `SafeHandle` wraps unmanaged handles to guarantee `ReleaseHandle` runs exactly once.
- **Ownership model:** Single-owner by convention. Cascading is documentation, not enforcement.
- **Double-dispose:** Idempotent + silent. Required.
- **Use-after-dispose:** `ObjectDisposedException` from *other* instance methods. Dispose itself stays silent; *use* throws.

### TC39 Explicit Resource Management (`Symbol.dispose`, `using`)

- **Status:** Stage 3 proposal, shipped in TypeScript 5.2 / ES2024. Repo: [tc39/proposal-explicit-resource-management](https://github.com/tc39/proposal-explicit-resource-management).
- **`using` contract:** Each binding's `Symbol.dispose` is called exactly once on block exit, in reverse declaration order.
- **Idempotency requirement:** **None mandated.** No mention of "idempotent", "twice", or "already disposed" in the README. Only soft guidance: "A disposable should try to ensure access is consistent with its 'disposed' state, though this isn't strictly necessary since some disposables could be reusable."
- **Use-after-dispose:** Not addressed; punted to the implementer.
- **Implication:** `using` provides no safety net beyond "call once per block exit". The contract is delegated.

### Java `Closeable` vs `AutoCloseable`

The most instructive split — Java's library authors made the *opposite* choice in the same language within a few years.

- **`Closeable.close()` (since 1.5):** "If the stream is already closed then invoking this method has no effect." ([docs.oracle.com/javase/8/docs/api/java/io/Closeable.html](https://docs.oracle.com/javase/8/docs/api/java/io/Closeable.html)) Idempotency **required**.
- **`AutoCloseable.close()` (since 1.7, for `try-with-resources`):** "this `close` method is *not* required to be idempotent... However, implementers of this interface are strongly encouraged to make their `close` methods idempotent." ([docs.oracle.com/javase/8/docs/api/java/lang/AutoCloseable.html](https://docs.oracle.com/javase/8/docs/api/java/lang/AutoCloseable.html))
- **Why the split:** `AutoCloseable` was deliberately weaker so it could be retrofitted onto classes that genuinely *cannot* be re-closed. `Closeable extends AutoCloseable` — IO streams stay under the stronger rule.
- **Use-after-close:** Throws (e.g. `IOException("Stream closed")` from `InputStream.read`). Standard pattern: a closed flag checked in mutators.

### C++ RAII (`unique_ptr`, `shared_ptr`)

- **Ownership:** `unique_ptr<T>` is single-owner, compile-time enforced. Moves null the source.
- **Double-destroy:** Structurally impossible through the smart pointer. `reset()` after the first non-null reset frees nothing.
- **Use-after-move:** Source pointer is null; `*src` is UB. Static tools (clang-tidy `bugprone-use-after-move`) flag this.
- **`shared_ptr`:** Refcounted; final destructor releases. `weak_ptr::lock()` is the type-system-blessed "is this still alive?" check.
- **Manual `delete`:** Double-`delete` is UB — smart pointers exist to make this unreachable.
- **Relevance to JS/TS:** None portable. JS has no move semantics, no scope destructors.

### Rust `Drop` and `wgpu-rs`

- **Ownership:** Single-owner enforced by the borrow checker. `Drop::drop` runs exactly once. `Rc<T>`/`Arc<T>` are refcounted; final drop releases.
- **wgpu-rs** ([docs.rs/wgpu/latest/wgpu/struct.Buffer.html](https://docs.rs/wgpu/latest/wgpu/struct.Buffer.html)): A `wgpu::Buffer` is a refcounted, `Clone`-able handle. The crate provides **both** `Drop` (last owner triggers cleanup) and an explicit `destroy(&self)` — "Destroy the associated native resources as soon as possible." Same for `Device`. The explicit method exists because Drop timing is unpredictable when handles are cloned; consumers sometimes need *now*.
- **Double-destroy:** Safe per the underlying WebGPU contract. The Rust type system does not prevent multiple `destroy(&self)` calls because the method takes `&self` (not `self`); idempotency falls to the implementation (uncertain whether wgpu-rs adds a flag internally — would require reading crate source).

### Three.js dispose

- **`Material.dispose`** ([three.js/src/materials/Material.js](https://github.com/mrdoob/three.js/blob/master/src/materials/Material.js)) and **`BufferGeometry.dispose`** ([three.js/src/core/BufferGeometry.js](https://github.com/mrdoob/three.js/blob/master/src/core/BufferGeometry.js)) are both literally:
  ```js
  dispose() { this.dispatchEvent( { type: 'dispose' } ); }
  ```
  No flag. No guard. Renderers subscribe and release the backing GPU resource.
- **Ownership model:** The high-level `Material`/`BufferGeometry` is a *descriptor*; the renderer holds the GPU resource in caches keyed by descriptor identity. `dispose` is a signal to evict.
- **Double-dispose:** Re-dispatches the event. Cache lookup finds nothing and no-ops. Idempotent via the cache layer, not via a flag on the descriptor.
- **WebGPU backend** ([WebGPUBackend.js](https://github.com/mrdoob/three.js/blob/master/src/renderers/webgpu/WebGPUBackend.js)) calls `.destroy()` on GPUBuffer/GPUTexture directly and treats `device.lost` with `reason === 'destroyed'` as expected. No defensive flags — relies on the spec'd idempotency.
- **Notable:** No `disposed` getter on the public types. Consumers cannot ask "is this disposed?" — a deliberate consequence of the descriptor/renderer split.

### Babylon.js dispose

- **`Node.dispose`** ([packages/dev/core/src/node.ts:945](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/node.ts)) sets `_isDisposed = true` and then runs the body. There is **no `if (this._isDisposed) return` guard** — double-dispose runs the body twice (re-emits observable, re-iterates descendants). The flag is for *consumers* to query via `isDisposed()`, not for self-protection.
- **`Material.dispose`** ([packages/dev/core/src/Materials/material.pure.ts:2009](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Materials/material.pure.ts)) has no `_isDisposed` field at all on Material. The doc comment is the load-bearing detail: `@param _forceDisposeEffect kept for backward compat. We reference count the effect now.` Babylon explicitly switched its shader/effect cache to internal refcounting, exposing a single-owner public `dispose()` over a shared resource. This is the exact pattern furnace's pipeline cache needs.
- **Ownership model:** Single-owner public; refcounted shared internals for shaders/effects.
- **Double-dispose:** Not guarded at the Material level. Each call decrements the effect cache refcount; a double-dispose would underflow.
- **Use-after-dispose:** `isDisposed()` is consumer-checked; no `ObjectDisposedException` equivalent.

### PixiJS destroy

**`Container.destroy`** ([src/scene/container/Container.ts:2081](https://github.com/pixijs/pixijs/blob/dev/src/scene/container/Container.ts)):

```ts
public destroyed = false;  // line 810 — note: public, not _destroyed
public destroy(options: DestroyOptions = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // ... remove children, null out _position/_scale/_pivot/_origin/_skew, emit 'destroyed' ...
}
```

- **Ownership:** Single-owner, runtime-enforced. The flag is *both* a guard against double-destroy *and* a queryable consumer property.
- **Double-destroy:** Idempotent + silent (early return).
- **Use-after-destroy:** Not policed inside individual mutators. PixiJS *nulls out* `_position`, `_scale`, `_pivot`, `_origin`, `_skew` — so subsequent property access through these crashes naturally with TypeError. The doc comment is the contract: "After an object is destroyed, all of its functionality is disabled and references are removed." Closer to "fail loudly via null-deref" than `ObjectDisposedException`.
- **Notable hybrid:** PixiJS combines C#-style flag idempotency on destroy itself with a scorched-earth nullification for use-after-destroy. The flag is public surface, not internal.

### Unity `Object.Destroy()` and "fake null"

- **Mechanism:** `UnityEngine.Object` overloads `==`/`!=`. After `Destroy(obj)`, the C# wrapper persists but the native peer is freed. `obj == null` returns `true` (fake null); `obj is null` returns `false` (language operator bypasses the overload). Source: [Unity Discussions thread](https://discussions.unity.com/t/deprecation-of-operator-overload-and-fake-null-for-unityengine-object/840277).
- **Why:** Designers could write `if (target == null)` intuitively, and method calls on destroyed objects throw a friendly `MissingReferenceException` rather than a generic NRE.
- **Double-destroy:** No-op.
- **Use-after-destroy:** `MissingReferenceException` on method calls.
- **Cost — widely regretted.** Modern C# null operators (`?.`, `??`, `is null`, pattern matching) bypass the overload and return *wrong* answers on destroyed objects. Unity has discussed deprecation for ~10 years without acting. The lesson: **piggy-backing on language null semantics for "destroyed" state breaks every null-checking feature the language adds afterwards.**

### Unreal `UObject` (PendingKill / IsValid)

Less verified — based on docs/community wiki, not engine source.

- **Mechanism:** Explicit `RF_PendingKill` flag. `Destroy()` marks pending kill; GC on a later frame nulls references and finalises. `IsValid(obj)` returns `false` if null *or* pending-kill.
- **Why explicit flag, not RAII:** UObjects are GC-managed and referenced from many places (script, blueprints, replication). Immediate destruction would invalidate replication state mid-frame. The flag defers actual cleanup to a safe point.
- **Double-destroy:** Benign — flag is already set.
- **Use-after-destroy:** GC nulls strong references on the next pass; `IsValid` is the manual guard. Source: [unrealcommunity.wiki/memory-management](https://unrealcommunity.wiki/memory-management-6rlf3v4i).

### WebGPU spec itself

The load-bearing prior art — dictates what's possible at the layer furnace wraps.

- **`GPUBuffer.destroy()`** ([§5.1.4](https://www.w3.org/TR/webgpu/#dom-gpubuffer-destroy)): *"**It is valid to destroy a buffer multiple times.** Content timeline: call `this.unmap()`. Device timeline: set `this.[[internal state]]` to '**destroyed**'."* The destroyed internal state: *"The buffer cannot be used in any operations due to being `destroy()`ed."*
- **`GPUDevice.destroy()`**: *"Destroys the device, preventing further operations on it. Outstanding asynchronous operations will fail. **It is valid to destroy a device multiple times.**"*
- **`GPUTexture.destroy()`**: analogous — enters a destroyed internal state. The spec groups textures with buffers in the "invalid internal objects" discussion.
- **Use-after-destroy:** Generates **validation errors** on the device timeline, surfaced through `GPUError` and capturable by `pushErrorScope`. **Does not throw synchronous JS exceptions** from the calling method — destroy lives on the device timeline, so validation does too.
- **Consequence:** The lowest layer is already idempotent on destroy and non-throwing on use-after-destroy. A wrapper that throws on either is adding behaviour, not preserving it.

---

## 2. Synthesis: four ownership strategies

Distilling the field, four coherent strategies emerge. Each bundles ownership model, double-dispose contract, use-after-dispose contract, mechanism, and trade-off. They are presented neutral — the user picks one.

### Strategy A — Idempotent silent destroy, public `destroyed` flag, fail-loud on use-after-destroy

Bundles C#, Java `Closeable`, PixiJS, and (de facto) WebGPU itself.

- **Ownership:** Single public owner. Internal caches may refcount privately; `destroy` decrements the refcount exactly once.
- **Double-dispose:** Idempotent + silent. `if (handle.destroyed) return` at the top of every `destroy` function.
- **Use-after-dispose:** Two sub-flavours:
  - **A1 — Throw from non-destroy methods (C# canonical):** Cheap guards on public methods that consume the handle. Engine throws on use, not on re-destroy.
  - **A2 — Null the fields, let the next access crash (PixiJS canonical):** No explicit guards; `destroy` nulls internal references. Subsequent uses fail with TypeError on null access.
- **Mechanism:** A `destroyed: boolean` flag on the public handle (or on a hidden `_internal` object behind a branded type). Cheap, runtime-only.
- **Convergence signal:** What C#, Java `Closeable`, PixiJS, and the WebGPU spec all do. TC39 is silent but compatible.
- **Trade-offs:** No compile-time enforcement. Refcounting story is clean: `destroy` is the single decrement site.

### Strategy B — Idempotent silent destroy, no flag, sentinel-via-WeakSet (Three.js style)

- **Ownership model:** The public handle is a *descriptor*; the engine's internal cache is the real owner. `destroy` is a signal (event or WeakSet eviction), not a state mutation on the handle.
- **Double-dispose:** Idempotent. Second dispatch hits an empty cache and no-ops.
- **Use-after-dispose:** The descriptor still "works" — it's just data. The engine, when asked to render with it, looks up the GPU resource, finds nothing, and either silently re-uploads or warns. This is Three.js's actual behaviour: dispose evicts; use re-creates.
- **Mechanism:** Engine-side `WeakMap<Handle, GpuResource>` or event-driven cache eviction. No `destroyed` field on the handle.
- **Trade-offs:** Smallest public surface (no flag to maintain). But: opaque to consumers (no `isDestroyed()` query without a side-channel), and lets dispose-then-use silently *re-create* resources, which is friendly but can hide leaks. Best fit when the engine is happy to lazily recreate dropped resources.

### Strategy C — Single-owner enforced by linear type discipline (Rust / move-style)

- **Ownership model:** Encode ownership in the type. After `destroy(handle)`, the variable holding `handle` is morally "moved-from". JS/TS can't enforce this — but TypeScript can *approximate* via:
  - Branded types where `destroy` returns a `DestroyedHandle` and accepts only `LiveHandle`, with the caller expected to discard the variable. (Practical limit: requires `const result = destroy(h); h = result;` discipline, easy to forget.)
  - Linters / custom rules flagging post-destroy uses.
- **Double-dispose:** Compile-time error if the discipline is followed; runtime no-op or throw otherwise.
- **Use-after-dispose:** Compile-time error if the discipline is followed.
- **Mechanism:** Type system. No runtime mechanism (or a thin runtime flag as belt-and-braces).
- **Trade-offs:** Strong static guarantees in theory; in practice JS escape hatches (`any`, runtime-typed config, network/storage round-trips) defeat it. C++'s `unique_ptr` and Rust's borrow checker have ecosystems built around respecting move semantics — JS doesn't. **Not used by any of the major JS-side engines surveyed.** Three.js, Babylon, PixiJS all picked runtime mechanisms because the type-system route doesn't survive contact with the JS object graph.

### Strategy D — Fake-null / Proxy-trapped use-after-destroy (Unity-style)

- **Ownership model:** Single-owner. Destroy keeps the handle alive but rewires it to fail-loudly-but-meaningfully on access.
- **Double-dispose:** Idempotent.
- **Use-after-dispose:** Throws a *specific* error (`MissingReferenceException`-equivalent) via Proxy `get`/`apply` traps, or via overloaded comparison/coercion. Better diagnostics than null-deref TypeError.
- **Mechanism:** ES Proxy. Wrap the handle at create time so destroy can flip the proxy into "dead" mode.
- **Trade-offs:** Best diagnostics on misuse. But: Proxy breaks `===` identity invariants depending on how it's constructed, breaks `instanceof` if the prototype isn't preserved, breaks `in`/`Object.keys` in non-obvious ways, and adds a layer of indirection on every property access. Unity's regret over a decade ([Unity Discussions thread](https://discussions.unity.com/t/deprecation-of-operator-overload-and-fake-null-for-unityengine-object/840277)) is the cautionary tale: clever post-destroy semantics fight every language-level evolution. **No JS-side prior art surveyed uses Proxy traps for this.**

---

## 3. Closing observations

**Strong convergence signal.** C# (spec-mandated), Java `Closeable` (spec-mandated), PixiJS (source-verified), Babylon's `Node` flag exposure (source-verified), TC39 `Symbol.dispose` (compatible if not mandated), and the WebGPU spec for `GPUBuffer/GPUTexture/GPUDevice` (spec-mandated) all agree: **double-destroy is idempotent and silent.** Java `AutoCloseable` is the only weakened version, and even it "strongly encourages" idempotency. The throwing post-effect destroy that furnace ships today is an outlier against every primary source surveyed.

**Where the field diverges is use-after-destroy.** Three.js does nothing (lazy re-upload). PixiJS nulls fields (TypeError on use). C# canonical pattern throws `ObjectDisposedException`. Babylon exposes `isDisposed()` and trusts the caller. WebGPU itself emits validation errors on the device timeline — async, capture-able, non-throwing. The spread is wider here because the trade-off (diagnostic strength vs. cost-per-call vs. error model) genuinely has no single right answer.

**Refcounting bridging single-owner.** Babylon's Material is the directly applicable precedent: a public single-owner `dispose()` over an internal refcounted effect/shader cache, with the public API doc-commented as "we reference count internally now". The bridge is: `destroy` decrements the refcount exactly once. The idempotent-silent guard at the public layer (Strategy A) is exactly what prevents double-decrement underflow.

**"Warn-and-no-op" is largely a furnace-local invention.** None of the surveyed systems warn on double-destroy as their default behaviour. The closest precedent is `console.warn` calls in debug builds of some engines for *use-after-destroy*, not for double-destroy itself. The dominant industry default is silent idempotency.

**Type-system enforcement (Strategy C) has no prior art in JS-side engines.** Three.js, Babylon, PixiJS, and Cocos2d-x all chose runtime mechanisms. The TC39 proposal sidesteps the question. This is a signal — not a proof, but a strong prior — that JS's escape hatches make compile-time ownership too leaky to be load-bearing.

The viable strategies for a JS/TS WebGPU engine are A1, A2, and B. C is theoretically attractive and practically rare; D is documented as a long-running regret in the one engine that picked it.

**Fed:** the handle + generation-counter resource-manager choice in `docs/reference/engine-conventions.md` §Resource manager, which cites this file and `2026-05-27-resource-manager-prior-art.md` as the prior art that drove it.
