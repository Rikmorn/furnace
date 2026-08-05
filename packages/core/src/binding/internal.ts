// The binding module's engine-private door. Sibling core modules reach the
// layout calculator, the render-boundary flush, and the slot's GPUBuffer
// through this file rather than deep-importing binding.ts / layout.ts. None of
// it is consumer surface — that is index.ts.

import type { Context } from "../gpu/index.ts";
import { _lookupBinding } from "../resources/internal.ts";
import type { Binding, BindingSlot } from "./types.ts";

/**
 * Resolve a consumer-declared schema to byte offsets + total buffer size.
 * Engine-internal: `shader.create` resolves a declared layout at compile time,
 * and the post built-ins resolve theirs once at module load.
 */
export { computeLayout } from "./layout.ts";

/**
 * Drain the per-ctx dirty-binding set: upload each dirty binding's CPU scratch
 * to its `GPUBuffer` via one `queue.writeBuffer` call, then clear `slot.dirty`
 * and the set. Called by `frame.render` before any draw calls.
 *
 * Stale handles in the set (binding destroyed after being marked dirty) are
 * silently skipped — the slot lookup returns `null` and the handle is removed
 * from the set with the rest of `dirty.clear()`.
 */
export function _flushDirtyBindings(ctx: Context): void {
  const dirty = ctx._internal.resources.dirtyBindings;
  for (const handle of dirty) {
    const slot = _lookupBinding<BindingSlot>(ctx, handle);
    // Skip a stale handle (destroyed since marked) or an already-clean slot;
    // both are cleared from the set by dirty.clear() below.
    if (slot === null || !slot.dirty) continue;
    ctx.queue.writeBuffer(slot.buffer, 0, slot.scratch);
    slot.dirty = false;
  }
  dirty.clear();
}

/**
 * Return the binding's `GPUBuffer`, or `null` on stale handles. Used by
 * `material.create` and `post.create` to build the `@group(1)` bind group over
 * the binding's buffer without coupling to {@link BindingSlot}'s shape.
 */
export function _bufferOf(ctx: Context, b: Binding): GPUBuffer | null {
  const slot = _lookupBinding<BindingSlot>(ctx, b);
  return slot !== null ? slot.buffer : null;
}
