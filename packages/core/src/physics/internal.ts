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
  return desc;
}

/** Map a furnace shape to a Rapier collider descriptor (event-enabled). */
export function buildColliderDesc(
  shape: ShapeDescriptor,
  density: number,
): RAPIER.ColliderDesc {
  const desc =
    "ball" in shape
      ? RAPIER.ColliderDesc.ball(shape.ball)
      : RAPIER.ColliderDesc.cuboid(
          shape.cuboid[0],
          shape.cuboid[1],
          shape.cuboid[2],
        );
  desc.setDensity(density);
  desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  return desc;
}
