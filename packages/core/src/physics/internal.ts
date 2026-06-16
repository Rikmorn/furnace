import RAPIER from "@dimforge/rapier3d-compat";
import type { BodyDescriptor, ShapeDescriptor } from "./types.ts";

let initPromise: Promise<void> | null = null;

/**
 * Lazily run Rapier's one-time wasm init, memoized across all worlds. Awaited
 * inside {@link createWorld}; concurrent first calls share one promise.
 */
export function ensureRapierInit(): Promise<void> {
  if (initPromise === null) initPromise = RAPIER.init();
  return initPromise;
}

/** Map a furnace body descriptor to a Rapier rigid-body descriptor. */
export function buildRigidBodyDesc(d: BodyDescriptor): RAPIER.RigidBodyDesc {
  const desc =
    d.type === "dynamic"
      ? RAPIER.RigidBodyDesc.dynamic()
      : d.type === "kinematicPosition"
        ? RAPIER.RigidBodyDesc.kinematicPositionBased()
        : RAPIER.RigidBodyDesc.fixed();
  const [px, py, pz] = d.position;
  desc.setTranslation(px, py, pz);
  if (d.rotation !== undefined) {
    const [x, y, z, w] = d.rotation;
    desc.setRotation({ x, y, z, w });
  }
  if (d.linearVelocity !== undefined) {
    const [x, y, z] = d.linearVelocity;
    desc.setLinvel(x, y, z);
  }
  if (d.angularVelocity !== undefined) {
    const [x, y, z] = d.angularVelocity;
    desc.setAngvel({ x, y, z });
  }
  if (d.linearDamping !== undefined) desc.setLinearDamping(d.linearDamping);
  if (d.angularDamping !== undefined) desc.setAngularDamping(d.angularDamping);
  return desc;
}

const PIN_BORDER_RADIUS = 0.02; // rounded edge for solver robustness + rolling

/** Map a furnace shape to a Rapier shape descriptor (no density/events yet). */
function buildShapeDesc(shape: ShapeDescriptor): RAPIER.ColliderDesc {
  if ("ball" in shape) return RAPIER.ColliderDesc.ball(shape.ball);
  if ("cuboid" in shape) {
    return RAPIER.ColliderDesc.cuboid(
      shape.cuboid[0],
      shape.cuboid[1],
      shape.cuboid[2],
    );
  }
  if ("capsule" in shape) {
    return RAPIER.ColliderDesc.capsule(
      shape.capsule.halfHeight,
      shape.capsule.radius,
    );
  }
  // roundCylinder's border is added to the requested dims (Minkowski sum), so
  // compensate to keep { halfHeight, radius } the true outer dimension. The
  // `max(dim - b, b)` floor keeps the Rapier dims positive for sub-2b inputs
  // (those read slightly larger than requested — irrelevant at pin scale).
  const b = Math.min(PIN_BORDER_RADIUS, shape.cylinder.radius * 0.5);
  return RAPIER.ColliderDesc.roundCylinder(
    Math.max(shape.cylinder.halfHeight - b, b),
    Math.max(shape.cylinder.radius - b, b),
    b,
  );
}

/** Map a furnace body descriptor to a Rapier collider descriptor (event-enabled). */
export function buildColliderDesc(d: BodyDescriptor): RAPIER.ColliderDesc {
  const desc = buildShapeDesc(d.shape);
  desc.setDensity(d.density ?? 1);
  if (d.friction !== undefined) desc.setFriction(d.friction);
  if (d.restitution !== undefined) desc.setRestitution(d.restitution);
  desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  return desc;
}
