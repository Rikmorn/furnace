import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _lookupGeometry } from "../resources/internal.ts";
import type { Geometry, GeometrySlot } from "./types.ts";

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
    throw new FurnaceGpuError("geometry was destroyed or stale");
  }
  return slot;
}
