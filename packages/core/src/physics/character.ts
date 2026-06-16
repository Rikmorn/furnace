import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import { warn } from "../log/internal.ts";
import {
  _lookupPhysicsBody,
  _lookupPhysicsWorld,
} from "../resources/internal.ts";
import type { Vec3 } from "../transform/types.ts";
import type {
  Body,
  BodySlot,
  CharacterController,
  Vec3Tuple,
  World,
  WorldSlot,
} from "./types.ts";

/** Options for {@link createCharacterController}. All optional; omitted fields
 *  use Rapier's defaults (slide on, autostep/snap-to-ground off). */
export type CharacterControllerOptions = {
  /** Skin-width gap kept around the collider while solving. Default 0.01. */
  offset?: number;
  /** Up axis. Default `[0,1,0]`. */
  up?: Vec3Tuple;
  /** Auto-step over small ledges up to `maxHeight`, for gaps ≥ `minWidth`. */
  autostep?: { maxHeight: number; minWidth: number; includeDynamic?: boolean };
  /** Snap the body down to ground within this distance (keeps contact on slopes/steps). */
  snapToGround?: number;
  /** Max slope angle (radians) the body can climb. */
  maxSlopeClimbAngle?: number;
  /** Min slope angle (radians) at which the body slides instead of standing. */
  minSlopeSlideAngle?: number;
  /** Slide along blocking geometry instead of stopping dead. Default true. */
  slide?: boolean;
};

const DEFAULT_OFFSET = 0.01;

/**
 * Create a kinematic character controller in `world` (a movement solver for a
 * kinematic capsule). Setup-loud: throws on a stale world or a malformed offset.
 *
 * @throws FurnaceError - if `world` is invalid/destroyed, or `offset` is non-positive/non-finite.
 */
export function createCharacterController(
  ctx: Context,
  world: World,
  opts: CharacterControllerOptions = {},
): CharacterController {
  const worldSlot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
  if (worldSlot === null) {
    throw new FurnaceError(
      "physics.createCharacterController: world handle is invalid or destroyed",
    );
  }
  const offset = opts.offset ?? DEFAULT_OFFSET;
  if (!Number.isFinite(offset) || offset <= 0) {
    throw new FurnaceError(
      "physics.createCharacterController: offset must be a positive finite number",
    );
  }
  const rapier = worldSlot.rapier.createCharacterController(offset);
  if (opts.up !== undefined) {
    rapier.setUp({ x: opts.up[0], y: opts.up[1], z: opts.up[2] });
  }
  if (opts.autostep) {
    rapier.enableAutostep(
      opts.autostep.maxHeight,
      opts.autostep.minWidth,
      opts.autostep.includeDynamic ?? true,
    );
  }
  if (opts.snapToGround !== undefined) {
    rapier.enableSnapToGround(opts.snapToGround);
  }
  if (opts.maxSlopeClimbAngle !== undefined) {
    rapier.setMaxSlopeClimbAngle(opts.maxSlopeClimbAngle);
  }
  if (opts.minSlopeSlideAngle !== undefined) {
    rapier.setMinSlopeSlideAngle(opts.minSlopeSlideAngle);
  }
  if (opts.slide !== undefined) rapier.setSlideEnabled(opts.slide);

  const controller: CharacterController = {
    _world: world,
    _rapier: rapier,
    _destroyed: false,
  };
  worldSlot.controllers.add(controller);
  return controller;
}

/**
 * Destroy a {@link CharacterController}: remove it from its world's backend +
 * tracking set. Idempotent silent no-op on an already-destroyed controller or a
 * stale world.
 */
export function destroyCharacterController(
  ctx: Context,
  controller: CharacterController,
): void {
  if (controller._destroyed) return;
  const worldSlot = _lookupPhysicsWorld<WorldSlot>(ctx, controller._world);
  if (worldSlot !== null) {
    worldSlot.rapier.removeCharacterController(controller._rapier);
    worldSlot.controllers.delete(controller);
  }
  controller._destroyed = true;
}

/**
 * Resolve a `desired` translation for a kinematic capsule `body` against the
 * world's colliders, writing the corrected movement into `out` and returning
 * whether the body is grounded. Hot-path; runtime-quiet — warns on non-finite
 * `desired`, and returns `false` with zeroed `out` on a destroyed controller or
 * stale handles. Obstacles are seen only after the world has {@link step}ped at
 * least once (Rapier's broadphase is populated by {@link step}); a call before
 * the first step returns `desired` unobstructed. Apply `out` with
 * {@link setBodyNextKinematicTranslation}, then {@link step}.
 */
export function computeMovement(
  ctx: Context,
  controller: CharacterController,
  body: Body,
  desired: Vec3Tuple,
  out: Vec3,
): boolean {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (controller._destroyed) return false;
  if (!desired.every((c) => Number.isFinite(c))) {
    warn("physics", "computeMovement: desired translation must be finite", {
      desired,
    });
    return false;
  }
  const worldSlot = _lookupPhysicsWorld<WorldSlot>(ctx, controller._world);
  const bodySlot = _lookupPhysicsBody<BodySlot>(ctx, body);
  if (worldSlot === null || bodySlot === null) return false;

  const collider = worldSlot.rapier.getCollider(bodySlot.colliderHandle);
  controller._rapier.computeColliderMovement(collider, {
    x: desired[0],
    y: desired[1],
    z: desired[2],
  });
  const m = controller._rapier.computedMovement();
  out[0] = m.x;
  out[1] = m.y;
  out[2] = m.z;
  return controller._rapier.computedGrounded();
}
