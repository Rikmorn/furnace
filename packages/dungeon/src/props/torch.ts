import type * as frame from "@furnace/core/frame";

/** A carried torch: a point light that follows a position with a flickering
 *  intensity. Deterministic summed-sine flicker (no Math.random). */
export class Torch {
  private t = 0;
  constructor(
    private readonly base = 6, // base intensity
    private readonly range = 9, // falloff radius (world units)
    private readonly color: [number, number, number] = [1.0, 0.6, 0.25], // warm
  ) {}

  /** Advance flicker by dt and return the light at `position`. */
  light(
    position: [number, number, number],
    dtSeconds: number,
  ): frame.PointLight {
    this.t += dtSeconds;
    // summed sines → organic flicker in ~[0.82, 1.05]
    const flick =
      1 +
      0.08 * Math.sin(this.t * 11) +
      0.05 * Math.sin(this.t * 27 + 1.3) -
      0.04 * Math.sin(this.t * 3.1);
    return {
      type: "point",
      position,
      color: this.color,
      intensity: this.base * flick,
      range: this.range,
    };
  }
}
