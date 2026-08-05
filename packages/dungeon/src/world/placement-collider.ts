// packages/dungeon/src/world/placement-collider.ts
// The catalog collision primitive → physics shape descriptor mapping, alone in its own
// module so the two consumers that need it can have it without each other's dependencies:
// `world-loader.ts` (the GPU-side world loader) and `walk-probe.ts` (the headless verify
// probe, which runs with `createHeadlessPhysicsContext` and must not pull the renderer
// into an analyzer worker's bundle to derive a collider shape).
//
// The POSE half of the pair is core's `field.collisionCenter` — call both, never
// hand-compose either.
import type { PlacementCollision } from "@furnace/core/field";
import type { ShapeDescriptor } from "@furnace/core/physics";

/** A static collider shape for one placed prop, derived from the archetype's catalog
 *  collision primitive scaled by the record's per-axis scale (D-F3-10: colliders are
 *  DERIVED, never stored).
 *
 *  Scale approximation (the plan's AABB posture): a `box` scales PER-AXIS (exact for an
 *  axis-aligned cuboid). A `sphere`/`capsule` primitive has no per-axis form, so its radius
 *  (and the capsule's half-height) scale by the MAX scale axis — exact for scatter's
 *  uniform-scale records (sx=sy=sz), a conservative over-approximation only if a future
 *  non-uniform placement source appears. That is the same rule core's `collisionExtentY`
 *  applies, which is what lets `field.collisionCenter` anchor this shape with an extent
 *  computed THERE.
 *
 *  MAGNITUDES: a negative scale axis is a mirror, and mirroring moves no surface — so every
 *  extent takes `Math.abs` and a mirrored record derives its twin's collider. Signed
 *  arithmetic would hand Rapier a negative ball radius / cuboid half-extent, and split this
 *  derivation from `collisionExtentY` (which takes magnitudes too).
 *
 *  Rotation is no concern of this function — the pose is `field.collisionCenter`'s. */
export function placementCollider(
  collision: PlacementCollision,
  scale: readonly [number, number, number],
): ShapeDescriptor {
  const sx = Math.abs(scale[0]);
  const sy = Math.abs(scale[1]);
  const sz = Math.abs(scale[2]);
  const maxAxis = Math.max(sx, sy, sz);
  if (collision.kind === "sphere") return { ball: collision.radius * maxAxis };
  if (collision.kind === "capsule") {
    return {
      capsule: {
        halfHeight: collision.halfHeight * maxAxis,
        radius: collision.radius * maxAxis,
      },
    };
  }
  const [hx, hy, hz] = collision.halfExtents;
  return { cuboid: [hx * sx, hy * sy, hz * sz] };
}
