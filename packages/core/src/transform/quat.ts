import type { Quat, Vec3 } from "./types.ts";

const SLERP_LINEAR_EPSILON = 1e-6;

/**
 * Quaternion math helpers. Quaternions are stored as `(x, y, z, w)` with
 * identity `(0, 0, 0, 1)`. All operations follow the gl-matrix
 * `(out, ...args) => out` calling convention — first argument is the
 * destination, mutated and returned.
 *
 * @remarks
 *
 * `slerp` is the rotation-correct counterpart to {@link vec3.lerp}: prefer
 * it whenever you are interpolating orientations. Angles are radians
 * throughout.
 */
export const quat = {
  /** Allocate a new identity quaternion `(0, 0, 0, 1)`. */
  create(): Quat {
    const out = new Float32Array(4);
    out[3] = 1;
    return out;
  },

  /** Allocate a new quaternion initialised with the given components. */
  fromValues(x: number, y: number, z: number, w: number): Quat {
    const out = new Float32Array(4);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
  },

  /**
   * Write the identity quaternion `(0, 0, 0, 1)` into `out`.
   *
   * Distinct from {@link quat.create}, which allocates a fresh identity;
   * `identity` reuses the caller's buffer.
   */
  identity(out: Quat): Quat {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
  },

  /** Copy components of `a` into `out`. */
  copy(out: Quat, a: Quat): Quat {
    out[0] = a[0] as number;
    out[1] = a[1] as number;
    out[2] = a[2] as number;
    out[3] = a[3] as number;
    return out;
  },

  /**
   * Build a quaternion from intrinsic XYZ Euler angles (radians).
   *
   * Rotation order is X then Y then Z applied to the rotating frame —
   * equivalent to multiplying `qx * qy * qz`. For a different convention,
   * compose `fromAxisAngle` rotations manually.
   */
  fromEuler(out: Quat, x: number, y: number, z: number): Quat {
    const hx = x * 0.5;
    const hy = y * 0.5;
    const hz = z * 0.5;
    const sx = Math.sin(hx);
    const cx = Math.cos(hx);
    const sy = Math.sin(hy);
    const cy = Math.cos(hy);
    const sz = Math.sin(hz);
    const cz = Math.cos(hz);
    out[0] = sx * cy * cz + cx * sy * sz;
    out[1] = cx * sy * cz - sx * cy * sz;
    out[2] = cx * cy * sz + sx * sy * cz;
    out[3] = cx * cy * cz - sx * sy * sz;
    return out;
  },

  /**
   * Build a quaternion representing a rotation of `angleRad` radians
   * around `axis`. `axis` is assumed to be unit length — callers wanting
   * defensive normalization should call {@link vec3.normalize} first.
   */
  fromAxisAngle(out: Quat, axis: Vec3, angleRad: number): Quat {
    const half = angleRad * 0.5;
    const s = Math.sin(half);
    out[0] = (axis[0] as number) * s;
    out[1] = (axis[1] as number) * s;
    out[2] = (axis[2] as number) * s;
    out[3] = Math.cos(half);
    return out;
  },

  /**
   * Hamilton product: `out = a * b`. Composes rotations in the order
   * "apply `b` first, then `a`" when used to rotate vectors.
   */
  multiply(out: Quat, a: Quat, b: Quat): Quat {
    const ax = a[0] as number;
    const ay = a[1] as number;
    const az = a[2] as number;
    const aw = a[3] as number;
    const bx = b[0] as number;
    const by = b[1] as number;
    const bz = b[2] as number;
    const bw = b[3] as number;
    out[0] = ax * bw + aw * bx + ay * bz - az * by;
    out[1] = ay * bw + aw * by + az * bx - ax * bz;
    out[2] = az * bw + aw * bz + ax * by - ay * bx;
    out[3] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
  },

  /**
   * Normalize `a` to unit length, writing into `out`.
   *
   * If `|a| === 0`, writes the identity quaternion `(0, 0, 0, 1)` — a
   * downstream-safe sentinel. Multiplying by identity is a no-op rather
   * than the NaN-cascade you would get from a zero quaternion.
   */
  normalize(out: Quat, a: Quat): Quat {
    const ax = a[0] as number;
    const ay = a[1] as number;
    const az = a[2] as number;
    const aw = a[3] as number;
    const len = Math.hypot(ax, ay, az, aw);
    if (len === 0) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    }
    const inv = 1 / len;
    out[0] = ax * inv;
    out[1] = ay * inv;
    out[2] = az * inv;
    out[3] = aw * inv;
    return out;
  },

  /**
   * Conjugate: negates the vector part, leaves `w` unchanged. For unit
   * quaternions this is also the inverse rotation.
   */
  conjugate(out: Quat, a: Quat): Quat {
    out[0] = -(a[0] as number);
    out[1] = -(a[1] as number);
    out[2] = -(a[2] as number);
    out[3] = a[3] as number;
    return out;
  },

  /**
   * Spherical linear interpolation from `a` to `b` at parameter `t ∈ [0, 1]`.
   *
   * Takes the shortest path on the unit hypersphere (negates `b` if
   * `a · b < 0`). Falls back to component-wise lerp when the arc length
   * is below `1e-6` radians to avoid divide-by-zero from `sin(θ)`. Use
   * this — not {@link vec3.lerp} on the components — for interpolating
   * rotations.
   */
  slerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
    const ax = a[0] as number;
    const ay = a[1] as number;
    const az = a[2] as number;
    const aw = a[3] as number;
    let bx = b[0] as number;
    let by = b[1] as number;
    let bz = b[2] as number;
    let bw = b[3] as number;
    let cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw;
    if (cosHalfTheta < 0) {
      cosHalfTheta = -cosHalfTheta;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    if (cosHalfTheta >= 1) {
      out[0] = ax;
      out[1] = ay;
      out[2] = az;
      out[3] = aw;
      return out;
    }
    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
    if (Math.abs(sinHalfTheta) < SLERP_LINEAR_EPSILON) {
      out[0] = ax * 0.5 + bx * 0.5;
      out[1] = ay * 0.5 + by * 0.5;
      out[2] = az * 0.5 + bz * 0.5;
      out[3] = aw * 0.5 + bw * 0.5;
      return out;
    }
    const ra = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const rb = Math.sin(t * halfTheta) / sinHalfTheta;
    out[0] = ax * ra + bx * rb;
    out[1] = ay * ra + by * rb;
    out[2] = az * ra + bz * rb;
    out[3] = aw * ra + bw * rb;
    return out;
  },
};
