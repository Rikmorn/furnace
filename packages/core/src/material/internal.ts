import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _lookupMaterial } from "../resources/internal.ts";
import type { Material, MaterialSlot } from "./types.ts";

/**
 * Resolve a {@link Material} handle to its slot data; throws on a stale
 * or destroyed handle. Engine-internal — used by `frame.render`, the
 * `unlit` factory to attach owned buffers post-alloc, and other paths
 * that need direct slot access.
 *
 * @throws FurnaceGpuError - if `material` does not resolve to a live
 *   slot (already destroyed, generation mismatch, or invalid handle).
 */
export function _resolveMaterial(
  ctx: Context,
  material: Material,
): MaterialSlot {
  const slot = _lookupMaterial<MaterialSlot>(ctx, material);
  if (slot === null) {
    throw new FurnaceGpuError(
      `material handle ${material} resolves to no live slot (destroyed, stale, or invalid)`,
    );
  }
  return slot;
}
