import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _lookupGeometry, _lookupMesh } from "../resources/internal.ts";
import type { Geometry, GeometrySlot, Mesh, MeshSlot } from "./types.ts";

/**
 * Resolve a {@link Geometry} handle to its slot data; throws on a stale
 * or destroyed handle. Engine-internal — used by `frame.render` and other
 * paths that need direct slot access.
 *
 * @throws FurnaceGpuError - if `geometry` does not resolve to a live slot
 *   (already destroyed, generation mismatch, or invalid handle).
 */
export function _resolveGeometry(
  ctx: Context,
  geometry: Geometry,
): GeometrySlot {
  const slot = _lookupGeometry<GeometrySlot>(ctx, geometry);
  if (slot === null) {
    throw new FurnaceGpuError(
      `geometry handle ${geometry} resolves to no live slot (destroyed, stale, or invalid)`,
    );
  }
  return slot;
}

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
