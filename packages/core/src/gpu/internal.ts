// Engine-private state carried inside Context._internal.
// Only the gpu module's own internals construct or read these fields.

export type InternalState = {
  disposed: boolean;
  // More fields added as modules need them (pipeline cache, resource registry, etc.).
};

// Constructors used only inside core. Not exported via gpu/index.ts.
export function createInternalState(): InternalState {
  return { disposed: false };
}

export function markDisposed(internal: InternalState): void {
  internal.disposed = true;
}

export function isDisposedInternal(internal: InternalState): boolean {
  return internal.disposed;
}
