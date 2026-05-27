import type { Mat4, Vec3 } from "./types.ts";

/**
 * `Vec3` math helpers. All operations follow the gl-matrix
 * `(out, ...args) => out` calling convention: the first argument is the
 * destination buffer, which is mutated and also returned for chaining.
 *
 * @remarks
 *
 * `lerp` is component-wise linear interpolation — use {@link quat.slerp}
 * for rotations. Allocation-free except for `create`/`fromValues`, which
 * allocate a fresh `Float32Array(3)`.
 */
export const vec3 = {
  /** Allocate a new zero-initialised `Vec3`. */
  create(): Vec3 {
    return new Float32Array(3);
  },

  /** Allocate a new `Vec3` initialised with the given components. */
  fromValues(x: number, y: number, z: number): Vec3 {
    const out = new Float32Array(3);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  },

  /** Write `(x, y, z)` into `out`. */
  set(out: Vec3, x: number, y: number, z: number): Vec3 {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  },

  /** Copy components of `a` into `out`. */
  copy(out: Vec3, a: Vec3): Vec3 {
    out[0] = a[0] as number;
    out[1] = a[1] as number;
    out[2] = a[2] as number;
    return out;
  },

  /** Component-wise addition: `out = a + b`. */
  add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out[0] = (a[0] as number) + (b[0] as number);
    out[1] = (a[1] as number) + (b[1] as number);
    out[2] = (a[2] as number) + (b[2] as number);
    return out;
  },

  /** Component-wise subtraction: `out = a - b`. */
  sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out[0] = (a[0] as number) - (b[0] as number);
    out[1] = (a[1] as number) - (b[1] as number);
    out[2] = (a[2] as number) - (b[2] as number);
    return out;
  },

  /** Scalar multiplication: `out = a * s`. */
  scale(out: Vec3, a: Vec3, s: number): Vec3 {
    out[0] = (a[0] as number) * s;
    out[1] = (a[1] as number) * s;
    out[2] = (a[2] as number) * s;
    return out;
  },

  /**
   * Component-wise linear interpolation: `out = a + (b - a) * t`.
   *
   * For rotations, use {@link quat.slerp} instead — lerping quaternion
   * components does not produce a rotation along the great-circle arc.
   */
  lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
    const ax = a[0] as number;
    const ay = a[1] as number;
    const az = a[2] as number;
    out[0] = ax + ((b[0] as number) - ax) * t;
    out[1] = ay + ((b[1] as number) - ay) * t;
    out[2] = az + ((b[2] as number) - az) * t;
    return out;
  },

  /** Dot product: `a · b`. */
  dot(a: Vec3, b: Vec3): number {
    return (
      (a[0] as number) * (b[0] as number) +
      (a[1] as number) * (b[1] as number) +
      (a[2] as number) * (b[2] as number)
    );
  },

  /** Cross product: `out = a × b`. */
  cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    const ax = a[0] as number;
    const ay = a[1] as number;
    const az = a[2] as number;
    const bx = b[0] as number;
    const by = b[1] as number;
    const bz = b[2] as number;
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
  },

  /** Euclidean length: `sqrt(x² + y² + z²)`. */
  length(a: Vec3): number {
    const x = a[0] as number;
    const y = a[1] as number;
    const z = a[2] as number;
    return Math.sqrt(x * x + y * y + z * z);
  },

  /**
   * Normalize `a` to unit length, writing into `out`.
   *
   * If `length(a) === 0`, writes the zero vector into `out` (no throw, no
   * NaN propagation) — callers that care about degenerate input should
   * check `length` themselves.
   */
  normalize(out: Vec3, a: Vec3): Vec3 {
    const len = vec3.length(a);
    if (len === 0) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return out;
    }
    const inv = 1 / len;
    out[0] = (a[0] as number) * inv;
    out[1] = (a[1] as number) * inv;
    out[2] = (a[2] as number) * inv;
    return out;
  },

  /**
   * Transform `v` (treated as the homogeneous point `(v.x, v.y, v.z, 1)`)
   * by 4x4 matrix `m`, applying the perspective divide. Writes the
   * resulting 3-vector into `out`.
   *
   * If the computed `w` is zero, falls back to `w = 1` (no divide-by-zero).
   */
  transformMat4(out: Vec3, v: Vec3, m: Mat4): Vec3 {
    const x = v[0] as number;
    const y = v[1] as number;
    const z = v[2] as number;
    const m0 = m[0] as number;
    const m1 = m[1] as number;
    const m2 = m[2] as number;
    const m3 = m[3] as number;
    const m4 = m[4] as number;
    const m5 = m[5] as number;
    const m6 = m[6] as number;
    const m7 = m[7] as number;
    const m8 = m[8] as number;
    const m9 = m[9] as number;
    const m10 = m[10] as number;
    const m11 = m[11] as number;
    const m12 = m[12] as number;
    const m13 = m[13] as number;
    const m14 = m[14] as number;
    const m15 = m[15] as number;
    // biome-ignore format: clarify precedence trap
    const w = (m3 * x + m7 * y + m11 * z + m15) || 1;
    out[0] = (m0 * x + m4 * y + m8 * z + m12) / w;
    out[1] = (m1 * x + m5 * y + m9 * z + m13) / w;
    out[2] = (m2 * x + m6 * y + m10 * z + m14) / w;
    return out;
  },
};
