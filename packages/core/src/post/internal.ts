import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _lookupEffect } from "../resources/internal.ts";
import type { Effect, EffectSlot } from "./effect.ts";

/**
 * Resolve an {@link Effect} handle to its slot data; throws on a stale
 * or destroyed handle. Engine-internal — used by `frame.render` to read
 * pipeline / bindings / blend in the post pass (symmetric to
 * `_resolveMaterial` / `_resolveMesh` / `_resolveGeometry`).
 *
 * @throws FurnaceGpuError - if `effect` does not resolve to a live slot
 *   (already destroyed, generation mismatch, or invalid / cross-context
 *   handle).
 */
export function _resolveEffect(ctx: Context, effect: Effect): EffectSlot {
  const slot = _lookupEffect<EffectSlot>(ctx, effect);
  if (slot === null) {
    throw new FurnaceGpuError(
      `effect handle ${effect} resolves to no live slot (destroyed, stale, or invalid)`,
    );
  }
  return slot;
}
