// The gpu module's engine-private door, and the state carried inside
// Context._internal. Only the gpu module's own internals construct or read
// those fields; sibling core modules reach the dispose-cascade registration
// through this file rather than deep-importing dispose-cascade.ts. None of it
// is consumer surface — that is index.ts.

import {
  createResourceManager,
  type ResourceManager,
} from "../resources/manager.ts";
import { createStatsState, type StatsState } from "../stats/state.ts";

/**
 * Register a teardown callback on the ctx's dispose cascade; returns an
 * unsubscribe. Engine-internal: the frame and post subsystems hold ctx-bound
 * lazy GPU state (depth textures, shadow maps, the post target pool, the
 * fullscreen VS) and self-register their cleanup on first allocation.
 */
export { _onDispose } from "./dispose-cascade.ts";

export type InternalState = {
  disposed: boolean;
  stats: StatsState;
  resources: ResourceManager;
  ctxId: number;
  sampleCount: 1 | 4;
  hdr: boolean;
  workingColorFormat: GPUTextureFormat;
};

// Module-level monotonic counter. Wraps at 16 bits (65535 contexts per
// JS-realm lifetime); ctxId 0 reserved for the invalid-handle sentinel.
let nextCtxId = 1;

/**
 * Engine-internal: monotonic context-id assignment. Used by both
 * `createInternalState` (for canvas-less contexts — test fixtures, and the
 * shipped `physics.createHeadlessPhysicsContext` path) and `context.ts`'s
 * inline construction (for production contexts that also carry canvas
 * boundary fields). One sequence serves both, so a headless context's handles
 * can never resolve inside a GPU context.
 */
export function _nextContextId(): number {
  const id = nextCtxId;
  nextCtxId = nextCtxId === 0xffff ? 1 : nextCtxId + 1;
  return id;
}

// Constructors used only inside core. Not exported via gpu/index.ts.
export function createInternalState(): InternalState {
  return {
    disposed: false,
    stats: createStatsState(performance.now()),
    resources: createResourceManager(),
    ctxId: _nextContextId(),
    sampleCount: 1,
    hdr: false,
    // Stub sentinel for canvas-less contexts (no swapchain to query) — test
    // fixtures and headless physics alike, neither of which renders. The real
    // working format is derived in requestContext from hdr + viewFormat.
    workingColorFormat: "bgra8unorm",
  };
}

export function markDisposed(internal: InternalState): void {
  internal.disposed = true;
}

export function isDisposedInternal(internal: InternalState): boolean {
  return internal.disposed;
}
