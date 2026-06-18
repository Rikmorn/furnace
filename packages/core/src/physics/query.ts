import RAPIER from "@dimforge/rapier3d-compat";
import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _lookupPhysicsBody,
  _lookupPhysicsWorld,
} from "../resources/internal.ts";
import type { Body, BodySlot, Vec3Tuple, World, WorldSlot } from "./types.ts";

/** A single ray/shape hit in world space. */
export type RayHit = {
  /** Distance from the ray origin to the hit, along `dir`. */
  toi: number;
  /** World-space hit point. */
  point: [number, number, number];
  /** World-space surface normal at the hit. */
  normal: [number, number, number];
};

/** Options for {@link castRay}. */
export type CastRayOptions = {
  origin: Vec3Tuple;
  /** Direction (need not be normalised; it is normalised internally). A
   *  zero-length `dir` is degenerate and yields a `null` (miss) result. */
  dir: Vec3Tuple;
  /** Maximum distance to search along `dir`. */
  maxDistance: number;
  /** A body whose collider is excluded from the cast (e.g. the caster itself). */
  excludeBody?: Body;
};

/** Below this length a direction vector is treated as degenerate (→ zero vector). */
const MIN_DIR_LENGTH = 1e-9;

function unit(v: Vec3Tuple): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < MIN_DIR_LENGTH) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Cast a ray through `world` and return the nearest hit (point + surface normal)
 * within `maxDistance`, or `null` on a miss. Obstacles are seen only after the
 * world has {@link step}ped at least once. Runtime-quiet: returns `null` on a
 * stale/destroyed world.
 *
 * @throws FurnaceError - if `maxDistance` is non-finite or negative.
 */
export function castRay(
  ctx: Context,
  world: World,
  opts: CastRayOptions,
): RayHit | null {
  if (!Number.isFinite(opts.maxDistance) || opts.maxDistance < 0) {
    throw new FurnaceError(
      "physics.castRay: maxDistance must be finite and >= 0",
    );
  }
  const worldSlot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
  if (worldSlot === null) return null;
  const [dx, dy, dz] = unit(opts.dir);
  const ray = new RAPIER.Ray(
    { x: opts.origin[0], y: opts.origin[1], z: opts.origin[2] },
    { x: dx, y: dy, z: dz },
  );
  const exclude =
    opts.excludeBody !== undefined
      ? _lookupPhysicsBody<BodySlot>(ctx, opts.excludeBody)
      : null;
  const excludeCollider =
    exclude !== null
      ? worldSlot.rapier.getCollider(exclude.colliderHandle)
      : undefined;
  const hit = worldSlot.rapier.castRayAndGetNormal(
    ray,
    opts.maxDistance,
    true, // solid
    undefined, // filterFlags
    undefined, // filterGroups
    excludeCollider,
  );
  if (hit === null) return null;
  const p = ray.pointAt(hit.timeOfImpact);
  return {
    toi: hit.timeOfImpact,
    point: [p.x, p.y, p.z],
    normal: [hit.normal.x, hit.normal.y, hit.normal.z],
  };
}
