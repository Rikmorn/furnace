import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _lookupMesh } from "../resources/internal.ts";
import type { Mesh, MeshSlot } from "./types.ts";

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
