import type { Geometry, GeometrySlot } from "../geometry/types.ts";
import type { Context } from "../gpu/index.ts";
import type { Material, MaterialSlot } from "../material/types.ts";
import {
  _destroyGeometry,
  _destroyMaterial,
  _lookupGeometry,
  _lookupMaterial,
} from "../resources/internal.ts";

// Shared Mesh/InstancedMesh → Geometry/Material refcount helpers. Both kinds
// hold a reference to a Geometry + Material and must release them symmetrically
// on teardown; this is the single source of truth for that decrement-and-
// maybe-finalize logic (mesh.ts and instanced.ts both import it).

export function decrementGeometryRefcount(
  ctx: Context,
  geometry: Geometry,
): void {
  const geometrySlot = _lookupGeometry<GeometrySlot>(ctx, geometry);
  if (geometrySlot === null) return;
  geometrySlot.userCount -= 1;
  if (geometrySlot.userCount === 0 && geometrySlot.markedDestroyed) {
    geometrySlot.markedDestroyed = false;
    _destroyGeometry<GeometrySlot>(ctx, geometry, (s) => s._teardown());
  }
}

export function decrementMaterialRefcount(
  ctx: Context,
  material: Material,
): void {
  const materialSlot = _lookupMaterial<MaterialSlot>(ctx, material);
  if (materialSlot === null) return;
  materialSlot.userCount -= 1;
  if (materialSlot.userCount === 0 && materialSlot.markedDestroyed) {
    materialSlot.markedDestroyed = false;
    _destroyMaterial<MaterialSlot>(ctx, material, (s) => s._teardown());
  }
}
