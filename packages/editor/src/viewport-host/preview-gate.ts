import type { SceneDocument } from "@furnace/core/scene";

/**
 * Component keys whose contribution's ORIENTATION is derived from the entity's
 * transform rotation at build time — a light's / camera's forward direction is
 * `-Z` rotated by the transform quaternion (core `buildLight` / `buildCamera`,
 * via `dirFromRotation`). Editing such an entity's rotation therefore changes a
 * value that lives outside `LoadedScene.meshes`.
 */
const TRANSFORM_DERIVED_COMPONENTS = ["light", "camera"] as const;

/**
 * Whether a `transform` edit on `entityId` must route through the clone+rebuild
 * preview path instead of the mesh-only `setEntityTransform` fast-path.
 *
 * The fast-path pokes only mesh transforms; it never rebuilds a light or camera.
 * But a light's / camera's direction is transform-DERIVED and refreshed ONLY by
 * `rebuildEntity`, so a rotation edit on such an entity would leave its direction
 * stale under the fast-path (no direction preview). Returning `true` here forces
 * those entities through the rebuild path, which rebuilds the light/camera with
 * the new rotation → correct direction. Pure so it is unit-testable in isolation.
 */
export function transformEditNeedsRebuild(
  doc: SceneDocument,
  entityId: string,
): boolean {
  const entity = doc.entities.find((e) => e.id === entityId);
  if (!entity) return false;
  return TRANSFORM_DERIVED_COMPONENTS.some((c) => c in entity.components);
}
