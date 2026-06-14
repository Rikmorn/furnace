import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import type { Context } from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import { vec3 } from "@furnace/core/transform";

export type MoveKeys = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
};

const PITCH_LIMIT = Math.PI / 2 - 0.01; // avoid gimbal flip at straight up/down

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

/** A first-person controller: owns yaw/pitch + position, drives the camera each
 *  frame. Mouselook uses raw pointer-lock (engine input has no relative delta). */
export class FpController {
  yaw = 0;
  pitch = 0;
  readonly position: [number, number, number];
  private readonly speed: number;
  private readonly sensitivity: number;
  private accumDX = 0;
  private accumDY = 0;
  private detachMouse: (() => void) | null = null;

  constructor(opts: {
    position: [number, number, number];
    speed?: number;
    sensitivity?: number;
  }) {
    this.position = [...opts.position];
    this.speed = opts.speed ?? 4; // m/s
    this.sensitivity = opts.sensitivity ?? 0.0022; // rad per pixel
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

  /** Advance one frame: consume mouse deltas → yaw/pitch; keyboard → position;
   *  push pose to the camera. `dtSeconds` from the frame loop. `clampMove` lets
   *  Task 8 inject collision (identity by default). */
  update(
    _ctx: Context,
    cam: Camera,
    dtSeconds: number,
    clampMove: (
      from: [number, number, number],
      delta: [number, number, number],
    ) => [number, number, number] = (_, d) => d,
  ): void {
    this.yaw -= this.accumDX * this.sensitivity;
    this.pitch -= this.accumDY * this.sensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.accumDX = 0;
    this.accumDY = 0;

    const keys: MoveKeys = {
      forward: input.isKeyDown("KeyW"),
      back: input.isKeyDown("KeyS"),
      left: input.isKeyDown("KeyA"),
      right: input.isKeyDown("KeyD"),
    };
    const delta = moveDelta(keys, this.yaw, this.speed * dtSeconds);
    const moved = clampMove(this.position, delta);
    this.position[0] += moved[0];
    this.position[1] += moved[1];
    this.position[2] += moved[2];

    const f = forwardVector(this.yaw, this.pitch);
    camera.setPosition(
      cam,
      vec3.fromValues(this.position[0], this.position[1], this.position[2]),
    );
    camera.setTarget(
      cam,
      vec3.fromValues(
        this.position[0] + f[0],
        this.position[1] + f[1],
        this.position[2] + f[2],
      ),
    );
  }

  destroy(): void {
    this.detachMouse?.();
    this.detachMouse = null;
  }
}
