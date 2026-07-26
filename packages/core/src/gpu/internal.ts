// Engine-private state carried inside Context._internal.
// Only the gpu module's own internals construct or read these fields.

import {
  createResourceManager,
  type ResourceManager,
} from "../resources/manager.ts";
import { createStatsState, type StatsState } from "../stats/state.ts";

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
