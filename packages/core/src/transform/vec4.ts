import type { Vec4 } from "./types.ts";

/**
 * `Vec4` math helpers. All operations follow the gl-matrix
 * `(out, ...args) => out` calling convention — first argument is the
 * destination, mutated and returned.
 *
 * Minimal surface; extend as needed.
 */
export const vec4 = {
  /** Allocate a new zero-initialised `Vec4`. */
  create(): Vec4 {
    return new Float32Array(4);
  },

  /** Allocate a new `Vec4` initialised with the given components. */
  fromValues(x: number, y: number, z: number, w: number): Vec4 {
    const out = new Float32Array(4);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
  },

  /** Write `(x, y, z, w)` into `out`. */
  set(out: Vec4, x: number, y: number, z: number, w: number): Vec4 {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
  },

  /** Copy components of `a` into `out`. */
  copy(out: Vec4, a: Vec4): Vec4 {
    out[0] = a[0] as number;
    out[1] = a[1] as number;
    out[2] = a[2] as number;
    out[3] = a[3] as number;
    return out;
  },
};
