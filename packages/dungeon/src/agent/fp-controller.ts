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
const EYE_SMOOTH_RATE = 12; // per-second exponential rate for camera eye-height smoothing (higher = snappier; lower = floatier). Tunable.

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

/** A first-person controller: owns yaw/pitch, produces the desired per-tick
 *  horizontal move (yaw-rotated input) for the mover, and places the camera from
 *  the resolved body position. Mouselook uses raw pointer-lock (engine input has
 *  no relative delta). Position + vertical authority live in the physics body and
 *  CharacterMover, not here. */
export class FpController {
  yaw = 0;
  pitch = 0;
  private readonly speed: number;
  private readonly sensitivity: number;
  private readonly eyeOffset: number;
  private accumDX = 0;
  private accumDY = 0;
  private smoothEyeY: number | null = null;
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

  /** The desired horizontal world-space move this tick (yaw-rotated input).
   *  Vertical motion is owned by CharacterMover (separate gravity pass). */
  desiredHorizontal(dtSeconds: number): [number, number, number] {
    const keys: MoveKeys = {
      forward: input.isKeyDown("KeyW"),
      back: input.isKeyDown("KeyS"),
      left: input.isKeyDown("KeyA"),
      right: input.isKeyDown("KeyD"),
    };
    return moveDelta(keys, this.yaw, this.speed * dtSeconds);
  }

  /** Place the camera at the body position + eye offset, looking along yaw/pitch.
   *  Horizontal (x/z) tracks the body exactly; the eye HEIGHT is smoothed toward
   *  the body height with frame-rate-independent exponential easing so single-frame
   *  body-Y jumps (step-ups, rough generated terrain) ease over a few frames instead
   *  of snapping. First call snaps (no swoop from 0); needs `dtSeconds` for the ease. */
  placeCamera(
    cam: Camera,
    bodyPos: [number, number, number],
    dtSeconds: number,
  ): void {
    const targetEyeY = bodyPos[1] + this.eyeOffset;
    if (this.smoothEyeY === null) {
      this.smoothEyeY = targetEyeY; // first frame: snap (no swoop from 0)
    } else {
      const t = 1 - Math.exp(-EYE_SMOOTH_RATE * dtSeconds); // frame-rate-independent
      this.smoothEyeY += (targetEyeY - this.smoothEyeY) * t;
    }
    const ex = bodyPos[0];
    const ey = this.smoothEyeY;
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
