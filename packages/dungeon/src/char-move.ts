import type { Context } from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { SLOPE_LIMIT_COS, STEP_HEIGHT } from "./walkability.ts";

/** Project `v` onto the plane with unit normal `n` (Quake PM_ClipVelocity):
 *  `v - n·(v·n)`. Removes the component of `v` heading into the surface,
 *  preserving the tangential slide. Pure; unit-tested. */
export function clipVelocity(
  v: [number, number, number],
  n: [number, number, number],
): [number, number, number] {
  const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
}

/** A surface is walkable if its (unit) normal's Y is at least `limitCos`
 *  (= cos of the max climbable slope angle). Pure; unit-tested. */
export function isWalkable(
  normal: [number, number, number],
  limitCos: number,
): boolean {
  return normal[1] >= limitCos;
}

const SKIN = 0.08; // gap kept between the capsule and surfaces (tunable)
const MAX_SLIDE_ITERS = 4;
const MIN_MOVE_LENGTH = 1e-5; // below this the remaining move is exhausted
const GRAVITY = -9.81;
/** Snap-to-ground reach below the feet. MUST be >= STEP_HEIGHT so applyGravity's ground
 *  ray still reaches the floor after a step-up raise — otherwise a (possibly spurious)
 *  step-up leaves the body floating, then it falls and snaps, producing vertical jitter
 *  while moving on trimesh/stepped ground. Asserted in tests/walkability.test.ts. */
export const GROUND_SNAP = 0.45;
const STALL_GAIN = 0.6; // horizontal-progress fraction below which we try a step-up
const SHOVE_LIFT = 0.1; // raise the shove probe off the floor so it doesn't graze the resting surface

export type Capsule = { halfHeight: number; radius: number };

/** A custom kinematic-capsule mover: horizontal collide-and-slide, a separate
 *  gravity/ground pass, and explicit step-up — all on raycast/shapecast, so it is
 *  robust to the trimesh internal-edge contact-normal corruption that stalls
 *  Rapier's built-in KCC. Future verbs (crouch/jump/mantle/climb) extend this. */
export class CharacterMover {
  vVel = 0;
  constructor(
    private readonly capsule: Capsule,
    private readonly body: physics.Body,
  ) {}

  /** Resolve a horizontal move from `pos` by `desired` (Y ignored), sliding along
   *  obstacles. Returns the new world position. Iterative shapecast collide-and-slide. */
  slideHorizontal(
    ctx: Context,
    world: physics.World,
    pos: [number, number, number],
    desired: [number, number, number],
  ): [number, number, number] {
    let p: [number, number, number] = [pos[0], pos[1], pos[2]];
    let move: [number, number, number] = [desired[0], 0, desired[2]];
    for (let i = 0; i < MAX_SLIDE_ITERS; i++) {
      const dist = Math.hypot(move[0], move[1], move[2]);
      if (dist < MIN_MOVE_LENGTH) break;
      const dir: [number, number, number] = [
        move[0] / dist,
        move[1] / dist,
        move[2] / dist,
      ];
      const hit = physics.castShape(ctx, world, {
        shape: { capsule: this.capsule },
        position: p,
        dir,
        maxDistance: dist + SKIN,
        excludeBody: this.body,
      });
      if (hit === null) {
        p = [p[0] + move[0], p[1] + move[1], p[2] + move[2]];
        break;
      }
      const travel = Math.max(0, hit.toi - SKIN);
      p = [
        p[0] + dir[0] * travel,
        p[1] + dir[1] * travel,
        p[2] + dir[2] * travel,
      ];
      const remaining: [number, number, number] = [
        move[0] - dir[0] * travel,
        move[1] - dir[1] * travel,
        move[2] - dir[2] * travel,
      ];
      move = clipVelocity(remaining, hit.normal);
    }
    return p;
  }

  private footOffset(): number {
    return this.capsule.halfHeight + this.capsule.radius;
  }

  /** Resolve the vertical pass from `pos`. The slope gate uses a centre down-RAY
   *  for the TRUE surface normal (a shape sweep picks up corrupted trimesh
   *  internal-edge normals). The rest HEIGHT, however, comes from a downward
   *  capsule SWEEP from STEP_HEIGHT above: it rests the body on the highest
   *  support within its footprint instead of letting a single ray sink it into a
   *  voxel pocket narrower than the capsule (where it would wedge and stick). On a
   *  smooth surface the sweep and the ray agree, so trimesh behaviour is unchanged.
   *  Grounded/walkable only when the ground passes the slope gate; otherwise
   *  integrate gravity so the player slides/falls off too-steep surfaces. */
  applyGravity(
    ctx: Context,
    world: physics.World,
    pos: [number, number, number],
    dt: number,
  ): { pos: [number, number, number]; grounded: boolean } {
    const foot = this.footOffset();
    const ray = physics.castRay(ctx, world, {
      origin: [pos[0], pos[1], pos[2]],
      dir: [0, -1, 0],
      maxDistance: foot + GROUND_SNAP,
      excludeBody: this.body,
    });
    if (ray !== null && isWalkable(ray.normal, SLOPE_LIMIT_COS)) {
      this.vVel = 0;
      // Rest on the highest support under the footprint (rim-riding, no pocket sink).
      const sweep = physics.castShape(ctx, world, {
        shape: { capsule: this.capsule },
        position: [pos[0], pos[1] + STEP_HEIGHT, pos[2]],
        dir: [0, -1, 0],
        maxDistance: STEP_HEIGHT + GROUND_SNAP,
        excludeBody: this.body,
      });
      const restY =
        sweep !== null ? pos[1] + STEP_HEIGHT - sweep.toi : ray.point[1] + foot;
      return { pos: [pos[0], restY, pos[2]], grounded: true };
    }
    // No ground, or too steep to stand on → fall/slide.
    this.vVel += GRAVITY * dt;
    return { pos: [pos[0], pos[1] + this.vVel * dt, pos[2]], grounded: false };
  }

  /** Full per-tick resolve: horizontal slide (with step-up), then the vertical
   *  gravity/ground pass. `desiredHoriz` is the input move (Y ignored). */
  resolve(
    ctx: Context,
    world: physics.World,
    pos: [number, number, number],
    desiredHoriz: [number, number, number],
    dt: number,
  ): { pos: [number, number, number]; grounded: boolean } {
    const flat = this.slideHorizontal(ctx, world, pos, desiredHoriz);
    const flatDist = Math.hypot(flat[0] - pos[0], flat[2] - pos[2]);
    const flatGain =
      flatDist / Math.max(1e-5, Math.hypot(desiredHoriz[0], desiredHoriz[2]));
    let horiz = flat;
    // If horizontal progress stalled, try stepping up and over.
    if (flatGain < STALL_GAIN) {
      const raised: [number, number, number] = [
        pos[0],
        pos[1] + STEP_HEIGHT,
        pos[2],
      ];
      const stepped = this.slideHorizontal(ctx, world, raised, desiredHoriz);
      const stepGain = Math.hypot(
        stepped[0] - raised[0],
        stepped[2] - raised[2],
      );
      if (stepGain > flatDist + 1e-4) {
        horiz = stepped; // accept the raised path; gravity snaps the feet down next
      }
    }
    return this.applyGravity(ctx, world, horiz, dt);
  }
}

/** Shove the dynamic body directly ahead of the capsule, if it is in `shovable`.
 *  Casts the capsule forward along `moveDir` (horizontal) and, on a shovable hit,
 *  sets that body's linear velocity to push it. Call before `physics.step` so the
 *  step integrates the shove. Game-interaction policy lives with the caller via
 *  `shovable`; the mover itself stays pure locomotion. */
export function shoveDynamicBodies(
  ctx: Context,
  world: physics.World,
  capsule: Capsule,
  selfBody: physics.Body,
  pos: [number, number, number],
  moveDir: [number, number, number],
  shovable: ReadonlySet<physics.Body>,
  speed: number,
  reach: number,
): void {
  const len = Math.hypot(moveDir[0], 0, moveDir[2]);
  if (len < MIN_MOVE_LENGTH) return;
  const dir: [number, number, number] = [moveDir[0] / len, 0, moveDir[2] / len];
  const hit = physics.castShape(ctx, world, {
    shape: { capsule },
    position: [pos[0], pos[1] + SHOVE_LIFT, pos[2]],
    dir,
    maxDistance: reach,
    excludeBody: selfBody,
  });
  if (hit !== null && hit.body !== null && shovable.has(hit.body)) {
    physics.setBodyLinearVelocity(ctx, hit.body, [
      dir[0] * speed,
      0,
      dir[2] * speed,
    ]);
  }
}
