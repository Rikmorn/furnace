import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import { warn } from "../log/internal.ts";
import {
  _allocPhysicsBody,
  _destroyPhysicsBody,
  _lookupPhysicsBody,
  _lookupPhysicsWorld,
} from "../resources/internal.ts";
import type { Quat, Vec3 } from "../transform/types.ts";
import { buildColliderDesc, buildRigidBodyDesc } from "./internal.ts";
import type {
  Body,
  BodyDescriptor,
  BodySlot,
  ShapeDescriptor,
  Vec3Tuple,
  World,
  WorldSlot,
} from "./types.ts";

const VEC3_LEN = 3;

function isFiniteVec3(v: Vec3Tuple): boolean {
  return (
    Array.isArray(v) &&
    v.length === VEC3_LEN &&
    v.every((c) => Number.isFinite(c))
  );
}

function isValidShape(shape: ShapeDescriptor): boolean {
  if ("ball" in shape) return Number.isFinite(shape.ball);
  if ("cuboid" in shape) return isFiniteVec3(shape.cuboid);
  if ("capsule" in shape) {
    return (
      Number.isFinite(shape.capsule.halfHeight) &&
      Number.isFinite(shape.capsule.radius)
    );
  }
  if ("trimesh" in shape) {
    return (
      shape.trimesh.vertices instanceof Float32Array &&
      shape.trimesh.vertices.length > 0 &&
      shape.trimesh.indices instanceof Uint32Array &&
      shape.trimesh.indices.length > 0 &&
      shape.trimesh.indices.length % 3 === 0
    );
  }
  return (
    Number.isFinite(shape.cylinder.halfHeight) &&
    Number.isFinite(shape.cylinder.radius)
  );
}

function validateBodyDescriptor(d: BodyDescriptor): void {
  if (d == null) {
    throw new FurnaceError("physics.createBody: descriptor is required");
  }
  if (
    d.type !== "dynamic" &&
    d.type !== "static" &&
    d.type !== "kinematicPosition"
  ) {
    throw new FurnaceError(`physics.createBody: unknown body type "${d.type}"`);
  }
  if (!isFiniteVec3(d.position)) {
    throw new FurnaceError(
      "physics.createBody: position must be a finite [x,y,z]",
    );
  }
  if (!isValidShape(d.shape)) {
    throw new FurnaceError(
      "physics.createBody: shape must be { ball }, { cuboid }, { cylinder }, { capsule } or { trimesh }",
    );
  }
}

/**
 * Create a rigid {@link Body} in `world`. `type` selects dynamic (simulated),
 * static (immovable), or kinematicPosition (pose-driven, ignores gravity);
 * `shape` is the collider (ball/cuboid/cylinder/capsule/trimesh).
 * Dynamic mass comes from `density` (default 1).
 *
 * @throws FurnaceError - if the descriptor is malformed (unknown type,
 *   non-finite position, or invalid shape).
 * @throws FurnaceError - if `world` is not a live handle.
 */
export function createBody(
  ctx: Context,
  world: World,
  descriptor: BodyDescriptor,
): Body {
  validateBodyDescriptor(descriptor);
  const worldSlot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
  if (worldSlot === null) {
    throw new FurnaceError(
      "physics.createBody: world handle is invalid or destroyed",
    );
  }
  const rapierBody = worldSlot.rapier.createRigidBody(
    buildRigidBodyDesc(descriptor),
  );
  const collider = worldSlot.rapier.createCollider(
    buildColliderDesc(descriptor),
    rapierBody,
  );
  const colliderHandle = collider.handle;
  const slot: BodySlot = {
    world,
    rapierBody,
    colliderHandle,
    _teardown: () => undefined,
  };
  const handle = _allocPhysicsBody(ctx, slot);
  // Wire teardown after alloc so it can capture the body handle for unlinking.
  slot._teardown = () => {
    worldSlot.rapier.removeRigidBody(rapierBody);
    worldSlot.bodies.delete(handle);
    worldSlot.colliderToBody.delete(colliderHandle);
  };
  worldSlot.bodies.add(handle);
  worldSlot.colliderToBody.set(colliderHandle, handle);
  return handle;
}

/**
 * Destroy a {@link Body}: remove it from its world's backend simulation and
 * free its slot. Idempotent silent no-op on a stale/destroyed handle.
 */
export function destroyBody(ctx: Context, body: Body): void {
  _destroyPhysicsBody<BodySlot>(ctx, body, (s) => s._teardown());
}

/**
 * Read a body's world-space translation into `out` (returns `out`). Hot-path
 * getter — `out` is unchanged on a stale/destroyed handle.
 */
export function getBodyTranslation(ctx: Context, body: Body, out: Vec3): Vec3 {
  const slot = _lookupPhysicsBody<BodySlot>(ctx, body);
  if (slot === null) return out;
  const t = slot.rapierBody.translation();
  out[0] = t.x;
  out[1] = t.y;
  out[2] = t.z;
  return out;
}

/**
 * Read a body's world-space rotation quaternion into `out` (returns `out`).
 * Hot-path getter — `out` is unchanged on a stale/destroyed handle.
 */
export function getBodyRotation(ctx: Context, body: Body, out: Quat): Quat {
  const slot = _lookupPhysicsBody<BodySlot>(ctx, body);
  if (slot === null) return out;
  const r = slot.rapierBody.rotation();
  out[0] = r.x;
  out[1] = r.y;
  out[2] = r.z;
  out[3] = r.w;
  return out;
}

/**
 * Set a body's world-space linear velocity (a runtime "kick" — throw, jump,
 * launch). Wakes the body. Hot-path setter; runtime-quiet — logs a warning on
 * non-finite input and is a silent no-op on a stale/destroyed handle.
 */
export function setBodyLinearVelocity(
  ctx: Context,
  body: Body,
  v: Vec3Tuple,
): void {
  const slot = _lookupPhysicsBody<BodySlot>(ctx, body);
  if (slot === null) return;
  if (!v.every((c) => Number.isFinite(c))) {
    warn("physics", "setBodyLinearVelocity: velocity must be finite", { v });
    return;
  }
  slot.rapierBody.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
}

/**
 * Queue a `kinematicPosition` body's next world-space translation; the move is
 * applied by the following {@link step}. Hot-path setter; runtime-quiet — logs a
 * warning on non-finite input and is a silent no-op on a stale/destroyed handle.
 */
export function setBodyNextKinematicTranslation(
  ctx: Context,
  body: Body,
  pos: Vec3Tuple,
): void {
  const slot = _lookupPhysicsBody<BodySlot>(ctx, body);
  if (slot === null) return;
  if (!pos.every((c) => Number.isFinite(c))) {
    warn(
      "physics",
      "setBodyNextKinematicTranslation: position must be finite",
      {
        pos,
      },
    );
    return;
  }
  slot.rapierBody.setNextKinematicTranslation({
    x: pos[0],
    y: pos[1],
    z: pos[2],
  });
}
