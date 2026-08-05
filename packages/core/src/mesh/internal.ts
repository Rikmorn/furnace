import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _lookupMesh } from "../resources/internal.ts";
import type { Mesh, MeshSlot } from "./types.ts";

/**
 * Upload an instanced mesh's per-instance matrix and tint scratch when its slot
 * is dirty, then clear the flag. Engine-internal: `frame.render` calls it per
 * instanced draw with the slot it already resolved.
 */
export { _flushInstancedIfDirty } from "./instanced.ts";

/**
 * Recompute a mesh's model matrix from TRS and write its object uniform buffer
 * when the slot's transform is dirty. Engine-internal: the render, shadow-map,
 * and render-to-texture passes call it per draw with the slot they already
 * resolved.
 */
export { _recomputeModelIfDirty } from "./mesh.ts";

/**
 * Resolve a {@link Mesh} handle to its slot data; throws on a stale or
 * destroyed handle. Engine-internal — used by `frame.render` and other
 * paths that need direct slot access.
 *
 * @throws FurnaceGpuError - if `mesh` does not resolve to a live slot
 *   (already destroyed, generation mismatch, or invalid handle).
 */
export function _resolveMesh(ctx: Context, mesh: Mesh): MeshSlot {
  const slot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (slot === null) {
    throw new FurnaceGpuError(
      `mesh handle ${mesh} resolves to no live slot (destroyed, stale, or invalid)`,
    );
  }
  return slot;
}
