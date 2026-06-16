import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as input from "@furnace/core/input";
import { vec3 } from "@furnace/core/transform";

export type MoveKeys = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
};

const PITCH_LIMIT = Math.PI / 2 - 0.01; // avoid gimbal flip at straight up/down

/** World gravity along Y (m/s²). Negative = downward. */
export const GRAVITY = -9.81;

/** Advance vertical velocity one tick. Grounded resets accumulated fall and
 *  applies a small downward bias (so snap-to-ground keeps contact on steps/slopes);
 *  airborne integrates gravity. Returns the new velocity and this tick's vertical
 *  delta. Pure; unit-tested. */
export function gravityStep(
  vVel: number,
  grounded: boolean,
  gravity: number,
  dtSeconds: number,
): { vVel: number; dy: number } {
  if (grounded) return { vVel: 0, dy: gravity * dtSeconds };
  const nv = vVel + gravity * dtSeconds;
  return { vVel: nv, dy: nv * dtSeconds };
}

/** World-space forward unit vector for a yaw/pitch (right-handed Y-up, identity → -Z).
 *  Pure; unit-tested. */
export function forwardVector(
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** XZ-plane movement delta for held keys at `distance` (= speed*dt), normalized
 *  so diagonals aren't faster. `yaw` rotates the input basis onto world XZ.
 *  Pure; unit-tested. */
export function moveDelta(
  keys: MoveKeys,
  yaw: number,
  distance: number,
): [number, number, number] {
  const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); // +1 = strafe right
  const dz = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0); // +1 = forward
  if (dx === 0 && dz === 0) return [0, 0, 0];
  const fwd = forwardVector(yaw, 0); // (-sin, 0, -cos)
  const right: [number, number] = [Math.cos(yaw), -Math.sin(yaw)]; // (x,z) of the right vector
  let mx = right[0] * dx + fwd[0] * dz;
  let mz = right[1] * dx + fwd[2] * dz;
  const len = Math.hypot(mx, mz);
  mx = (mx / len) * distance;
  mz = (mz / len) * distance;
  return [mx, 0, mz];
}

/** A first-person controller: owns yaw/pitch + vertical velocity, produces a
 *  desired per-tick move (input + gravity) for the physics character controller,
 *  and places the camera from the resolved body position. Mouselook uses raw
 *  pointer-lock (engine input has no relative delta). Position authority lives in
 *  the physics body, not here. */
export class FpController {
  yaw = 0;
  pitch = 0;
  private vVel = 0;
  private readonly speed: number;
  private readonly sensitivity: number;
  private readonly eyeOffset: number;
  private accumDX = 0;
  private accumDY = 0;
  private detachMouse: (() => void) | null = null;

  constructor(
    opts: {
      speed?: number;
      sensitivity?: number;
      eyeOffset?: number;
    } = {},
  ) {
    this.speed = opts.speed ?? 4; // m/s
    this.sensitivity = opts.sensitivity ?? 0.0022; // rad per pixel
    this.eyeOffset = opts.eyeOffset ?? 0.7; // camera height above body centre
  }

  /** Wire pointer-lock + raw movementX/Y. Click the canvas to capture the mouse. */
  attachMouse(canvas: HTMLCanvasElement): void {
    const onClick = (): void => {
      void canvas.requestPointerLock();
    };
    const onMove = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) return;
      this.accumDX += e.movementX;
      this.accumDY += e.movementY;
    };
    canvas.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMove);
    this.detachMouse = (): void => {
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMove);
    };
  }

  /** Consume accumulated mouse deltas into yaw/pitch. Call once per frame. */
  consumeMouse(): void {
    this.yaw -= this.accumDX * this.sensitivity;
    this.pitch -= this.accumDY * this.sensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.accumDX = 0;
    this.accumDY = 0;
  }

  /** The desired world-space move this tick: horizontal from held keys (yaw-
   *  rotated), vertical from gravity. `grounded` (from the previous resolve)
   *  gates gravity accumulation.
   *
   *  Side-effect: advances the private `vVel` (vertical-velocity accumulator),
   *  so it must be called exactly once per physics tick — skipping a tick
   *  leaves `vVel` stale; calling twice double-steps gravity. */
  desiredMove(dtSeconds: number, grounded: boolean): [number, number, number] {
    const keys: MoveKeys = {
      forward: input.isKeyDown("KeyW"),
      back: input.isKeyDown("KeyS"),
      left: input.isKeyDown("KeyA"),
      right: input.isKeyDown("KeyD"),
    };
    const [dx, , dz] = moveDelta(keys, this.yaw, this.speed * dtSeconds); // Y is always 0; vertical comes from gravityStep
    const g = gravityStep(this.vVel, grounded, GRAVITY, dtSeconds);
    this.vVel = g.vVel;
    return [dx, g.dy, dz];
  }

  /** Place the camera at the body position + eye offset, looking along yaw/pitch. */
  placeCamera(cam: Camera, bodyPos: [number, number, number]): void {
    const ex = bodyPos[0];
    const ey = bodyPos[1] + this.eyeOffset;
    const ez = bodyPos[2];
    const f = forwardVector(this.yaw, this.pitch);
    camera.setPosition(cam, vec3.fromValues(ex, ey, ez));
    camera.setTarget(cam, vec3.fromValues(ex + f[0], ey + f[1], ez + f[2]));
  }

  destroy(): void {
    this.detachMouse?.();
    this.detachMouse = null;
  }
}
