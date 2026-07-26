import { createInternalState } from "../gpu/internal.ts";
import type { PhysicsContext } from "./types.ts";

/**
 * **Escape hatch.** Build a {@link PhysicsContext} with no GPU behind it, for
 * callers that need physics where `requestContext` cannot run — a plain unit
 * test, a Web Worker, a headless probe. The ordinary path is to pass the
 * `Context` from `gpu.requestContext`, which is assignable to
 * {@link PhysicsContext}; reach for this only when there is no such context.
 *
 * **Valid for `@furnace/core/physics` only.** The returned value has no
 * `device`, `queue`, `canvas`, `format`, or `pixelRatio` — so handing it to a
 * `gpu`/`mesh`/`material`/`frame` function is a compile error, not a runtime
 * failure. It holds no GPU objects at all, so nothing in it needs a device.
 *
 * Each call takes the next id from the same per-realm counter
 * `gpu.requestContext` draws from, so headless and GPU contexts share one
 * sequence and stay distinct across a realm's first 65535 contexts: their
 * resource handles never cross, and passing one context's `World`/`Body` to
 * another reads as invalid. Ids are 16 bits and recycle beyond that — the same
 * SPA-lifetime limit `Context` carries — so create one context per session
 * rather than one per query.
 *
 * **Lifecycle: there is no dispose.** `gpu.dispose` takes a full `Context` and
 * does not apply here; no headless equivalent exists, and none is needed. The
 * context's own state (slot pools, stats counters) is ordinary JS and is
 * collected once the last reference is dropped. Still call {@link destroyWorld}
 * on each world: that is what releases the world's Rapier wasm allocations
 * *promptly*. Skipping it is not an unbounded leak — rapier's wasm-bindgen glue
 * registers a `FinalizationRegistry` that frees them once the wrapper is
 * collected — but finalization is non-deterministic, so the wasm heap stays
 * occupied for an unpredictable window.
 */
export function createHeadlessPhysicsContext(): PhysicsContext {
  // Frozen to match `Context`, which `requestContext` also freezes: the type is
  // readonly either way, so this only hardens the JS-consumer path.
  return Object.freeze({ _internal: createInternalState() });
}
