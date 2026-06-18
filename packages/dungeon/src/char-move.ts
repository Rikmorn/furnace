import type { Context } from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";

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
}
