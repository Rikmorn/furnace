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
};

// Constructors used only inside core. Not exported via gpu/index.ts.
export function createInternalState(): InternalState {
  return {
    disposed: false,
    stats: createStatsState(performance.now()),
    resources: createResourceManager(),
  };
}

export function markDisposed(internal: InternalState): void {
  internal.disposed = true;
}

export function isDisposedInternal(internal: InternalState): boolean {
  return internal.disposed;
}
