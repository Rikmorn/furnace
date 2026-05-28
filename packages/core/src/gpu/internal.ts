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
};

// Module-level monotonic counter. Wraps at 16 bits (65535 contexts per
// JS-realm lifetime); ctxId 0 reserved for the invalid-handle sentinel.
let nextCtxId = 1;

/**
 * Engine-internal: monotonic context-id assignment. Used by both
 * `createInternalState` (for non-canvas test contexts) and `context.ts`'s
 * inline construction (for production contexts that also carry canvas
 * boundary fields).
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
  };
}

export function markDisposed(internal: InternalState): void {
  internal.disposed = true;
}

export function isDisposedInternal(internal: InternalState): boolean {
  return internal.disposed;
}
