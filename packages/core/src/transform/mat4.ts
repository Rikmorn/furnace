import type { Mat4, Quat, Vec3 } from "./types.ts";

const MIN_AXIS_LENGTH = 1e-6;
const LOOK_AT_EYE_TARGET_EPSILON = 1e-6;

/**
 * 4x4 matrix math helpers. Matrices are stored column-major in a length-16
 * `Float32Array` — the layout WebGPU expects when uploaded to a buffer.
 * All operations follow the gl-matrix `(out, ...args) => out` calling
 * convention: first argument is the destination, mutated and returned.
 *
 * @remarks
 *
 * Right-handed coordinate system throughout (see {@link mat4.lookAt} and
 * {@link mat4.perspective}). Angles are radians.
 */
export const mat4 = {
  /** Allocate a new identity matrix. */
  create(): Mat4 {
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
  },

  /**
   * Write the identity matrix into `out`.
   *
   * Distinct from {@link mat4.create}, which allocates a fresh identity;
   * `identity` reuses the caller's buffer.
   */
  identity(out: Mat4): Mat4 {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  },

  /** Copy all 16 entries of `a` into `out`. */
  copy(out: Mat4, a: Mat4): Mat4 {
    for (let i = 0; i < 16; i++) out[i] = a[i] as number;
    return out;
  },

  /** Matrix multiplication: `out = a * b`. Safe to alias `out` with `a` or `b`. */
  multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    const a00 = a[0] as number;
    const a01 = a[1] as number;
    const a02 = a[2] as number;
    const a03 = a[3] as number;
    const a10 = a[4] as number;
    const a11 = a[5] as number;
    const a12 = a[6] as number;
    const a13 = a[7] as number;
    const a20 = a[8] as number;
    const a21 = a[9] as number;
    const a22 = a[10] as number;
    const a23 = a[11] as number;
    const a30 = a[12] as number;
    const a31 = a[13] as number;
    const a32 = a[14] as number;
    const a33 = a[15] as number;

    let b0 = b[0] as number;
    let b1 = b[1] as number;
    let b2 = b[2] as number;
    let b3 = b[3] as number;
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[4] as number;
    b1 = b[5] as number;
    b2 = b[6] as number;
    b3 = b[7] as number;
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[8] as number;
    b1 = b[9] as number;
    b2 = b[10] as number;
    b3 = b[11] as number;
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[12] as number;
    b1 = b[13] as number;
    b2 = b[14] as number;
    b3 = b[15] as number;
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    return out;
  },

  /** Post-multiply `m` by a translation of `v`: `out = m * T(v)`. Safe to alias `out` with `m`. */
  translate(out: Mat4, m: Mat4, v: Vec3): Mat4 {
    const x = v[0] as number;
    const y = v[1] as number;
    const z = v[2] as number;
    if (out !== m) {
      mat4.copy(out, m);
    }
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
    out[12] = m0 * x + m4 * y + m8 * z + m12;
    out[13] = m1 * x + m5 * y + m9 * z + m13;
    out[14] = m2 * x + m6 * y + m10 * z + m14;
    out[15] = m3 * x + m7 * y + m11 * z + m15;
    return out;
  },

  /** Post-multiply `m` by a non-uniform scale of `v`: `out = m * S(v)`. */
  scale(out: Mat4, m: Mat4, v: Vec3): Mat4 {
    const x = v[0] as number;
    const y = v[1] as number;
    const z = v[2] as number;
    out[0] = (m[0] as number) * x;
    out[1] = (m[1] as number) * x;
    out[2] = (m[2] as number) * x;
    out[3] = (m[3] as number) * x;
    out[4] = (m[4] as number) * y;
    out[5] = (m[5] as number) * y;
    out[6] = (m[6] as number) * y;
    out[7] = (m[7] as number) * y;
    out[8] = (m[8] as number) * z;
    out[9] = (m[9] as number) * z;
    out[10] = (m[10] as number) * z;
    out[11] = (m[11] as number) * z;
    out[12] = m[12] as number;
    out[13] = m[13] as number;
    out[14] = m[14] as number;
    out[15] = m[15] as number;
    return out;
  },

  /**
   * Post-multiply `m` by a rotation of `angleRad` radians around `axis`:
   * `out = m * R(axis, angle)`.
   *
   * If `|axis| < 1e-6`, silently copies `m` into `out` (no rotation
   * applied) rather than producing NaN. Internally normalizes the axis,
   * so callers do not need to pre-normalize.
   */
  rotate(out: Mat4, m: Mat4, angleRad: number, axis: Vec3): Mat4 {
    const ax = axis[0] as number;
    const ay = axis[1] as number;
    const az = axis[2] as number;
    const len = Math.hypot(ax, ay, az);
    if (len < MIN_AXIS_LENGTH) return mat4.copy(out, m);
    const inv = 1 / len;
    const x = ax * inv;
    const y = ay * inv;
    const z = az * inv;
    const s = Math.sin(angleRad);
    const c = Math.cos(angleRad);
    const t = 1 - c;

    const a00 = m[0] as number;
    const a01 = m[1] as number;
    const a02 = m[2] as number;
    const a03 = m[3] as number;
    const a10 = m[4] as number;
    const a11 = m[5] as number;
    const a12 = m[6] as number;
    const a13 = m[7] as number;
    const a20 = m[8] as number;
    const a21 = m[9] as number;
    const a22 = m[10] as number;
    const a23 = m[11] as number;

    const b00 = x * x * t + c;
    const b01 = y * x * t + z * s;
    const b02 = z * x * t - y * s;
    const b10 = x * y * t - z * s;
    const b11 = y * y * t + c;
    const b12 = z * y * t + x * s;
    const b20 = x * z * t + y * s;
    const b21 = y * z * t - x * s;
    const b22 = z * z * t + c;

    out[0] = a00 * b00 + a10 * b01 + a20 * b02;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22;
    if (out !== m) {
      out[12] = m[12] as number;
      out[13] = m[13] as number;
      out[14] = m[14] as number;
      out[15] = m[15] as number;
    }
    return out;
  },

  /**
   * Invert `m`, writing into `out`.
   *
   * @returns `out` on success, or `null` if `m` is singular (determinant
   * is zero). Callers must check for `null` — `out` is left in an
   * indeterminate state on the singular path.
   */
  invert(out: Mat4, m: Mat4): Mat4 | null {
    const a00 = m[0] as number;
    const a01 = m[1] as number;
    const a02 = m[2] as number;
    const a03 = m[3] as number;
    const a10 = m[4] as number;
    const a11 = m[5] as number;
    const a12 = m[6] as number;
    const a13 = m[7] as number;
    const a20 = m[8] as number;
    const a21 = m[9] as number;
    const a22 = m[10] as number;
    const a23 = m[11] as number;
    const a30 = m[12] as number;
    const a31 = m[13] as number;
    const a32 = m[14] as number;
    const a33 = m[15] as number;

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    let det =
      b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
  },

  /** Transpose `m`, writing into `out`. Safe to alias `out` with `m`. */
  transpose(out: Mat4, m: Mat4): Mat4 {
    if (out === m) {
      const a01 = m[1] as number;
      const a02 = m[2] as number;
      const a03 = m[3] as number;
      const a12 = m[6] as number;
      const a13 = m[7] as number;
      const a23 = m[11] as number;
      out[1] = m[4] as number;
      out[2] = m[8] as number;
      out[3] = m[12] as number;
      out[4] = a01;
      out[6] = m[9] as number;
      out[7] = m[13] as number;
      out[8] = a02;
      out[9] = a12;
      out[11] = m[14] as number;
      out[12] = a03;
      out[13] = a13;
      out[14] = a23;
    } else {
      out[0] = m[0] as number;
      out[1] = m[4] as number;
      out[2] = m[8] as number;
      out[3] = m[12] as number;
      out[4] = m[1] as number;
      out[5] = m[5] as number;
      out[6] = m[9] as number;
      out[7] = m[13] as number;
      out[8] = m[2] as number;
      out[9] = m[6] as number;
      out[10] = m[10] as number;
      out[11] = m[14] as number;
      out[12] = m[3] as number;
      out[13] = m[7] as number;
      out[14] = m[11] as number;
      out[15] = m[15] as number;
    }
    return out;
  },

  /**
   * Write the **normal matrix** of `m` into `out` — the inverse-transpose of
   * `m`, which transforms normals correctly under non-uniform scale (the naive
   * `model * normal` skews them). Stored as a full `mat4x4<f32>`; shaders read
   * the upper-left 3×3.
   *
   * Falls back to writing the identity when `m` is singular (non-invertible),
   * rather than emitting NaN.
   */
  normalFromMat4(out: Mat4, m: Mat4): Mat4 {
    const inv = mat4.invert(out, m);
    if (inv === null) return mat4.identity(out);
    return mat4.transpose(out, out);
  },

  /**
   * Right-handed perspective projection.
   *
   * @param fovYRad - Vertical field of view in radians.
   * @param aspect - Viewport `width / height`.
   * @param near - Near clip-plane distance (positive).
   * @param far - Far clip-plane distance (positive). Pass `Infinity` for
   * an infinite far plane.
   *
   * Maps view-space depth to the WebGPU clip-space range `z ∈ [0, 1]`.
   */
  perspective(
    out: Mat4,
    fovYRad: number,
    aspect: number,
    near: number,
    far: number,
  ): Mat4 {
    const f = 1.0 / Math.tan(fovYRad / 2);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[15] = 0;
    if (far !== Infinity) {
      const nf = 1 / (near - far);
      out[10] = far * nf;
      out[14] = far * near * nf;
    } else {
      out[10] = -1;
      out[14] = -near;
    }
    return out;
  },

  /**
   * Right-handed orthographic projection.
   *
   * Argument order is `left, right, bottom, top, near, far` — matches
   * gl-matrix. Maps view-space depth to the WebGPU clip-space range
   * `z ∈ [0, 1]`.
   */
  ortho(
    out: Mat4,
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
  ): Mat4 {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    out[0] = -2 * lr;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = -2 * bt;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = nf;
    out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = near * nf;
    out[15] = 1;
    return out;
  },

  /**
   * Right-handed view matrix that places the camera at `eye` looking at
   * `target` with `up` as the world-up hint.
   *
   * Returns the identity matrix if `eye` and `target` are within `1e-6`
   * of each other on every axis. If `up` is colinear with the view
   * direction, the orthonormalization zeros out the offending axis
   * rather than throwing — the resulting view will be degenerate but
   * not NaN.
   */
  lookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    const ex = eye[0] as number;
    const ey = eye[1] as number;
    const ez = eye[2] as number;
    const tx = target[0] as number;
    const ty = target[1] as number;
    const tz = target[2] as number;
    const ux = up[0] as number;
    const uy = up[1] as number;
    const uz = up[2] as number;

    if (
      Math.abs(ex - tx) < LOOK_AT_EYE_TARGET_EPSILON &&
      Math.abs(ey - ty) < LOOK_AT_EYE_TARGET_EPSILON &&
      Math.abs(ez - tz) < LOOK_AT_EYE_TARGET_EPSILON
    ) {
      return mat4.identity(out);
    }

    let zx = ex - tx;
    let zy = ey - ty;
    let zz = ez - tz;
    const zlen = 1 / Math.hypot(zx, zy, zz);
    zx *= zlen;
    zy *= zlen;
    zz *= zlen;

    let xx = uy * zz - uz * zy;
    let xy = uz * zx - ux * zz;
    let xz = ux * zy - uy * zx;
    let xlen = Math.hypot(xx, xy, xz);
    if (!xlen) {
      xx = 0;
      xy = 0;
      xz = 0;
    } else {
      xlen = 1 / xlen;
      xx *= xlen;
      xy *= xlen;
      xz *= xlen;
    }

    let yx = zy * xz - zz * xy;
    let yy = zz * xx - zx * xz;
    let yz = zx * xy - zy * xx;
    let ylen = Math.hypot(yx, yy, yz);
    if (!ylen) {
      yx = 0;
      yy = 0;
      yz = 0;
    } else {
      ylen = 1 / ylen;
      yx *= ylen;
      yy *= ylen;
      yz *= ylen;
    }

    out[0] = xx;
    out[1] = yx;
    out[2] = zx;
    out[3] = 0;
    out[4] = xy;
    out[5] = yy;
    out[6] = zy;
    out[7] = 0;
    out[8] = xz;
    out[9] = yz;
    out[10] = zz;
    out[11] = 0;
    out[12] = -(xx * ex + xy * ey + xz * ez);
    out[13] = -(yx * ex + yy * ey + yz * ez);
    out[14] = -(zx * ex + zy * ey + zz * ez);
    out[15] = 1;
    return out;
  },

  /**
   * Build a rotation-only 4x4 matrix from quaternion `q`.
   *
   * `q` is assumed to be unit length — feed `quat.normalize` first if you
   * are unsure.
   */
  fromQuat(out: Mat4, q: Quat): Mat4 {
    const x = q[0] as number;
    const y = q[1] as number;
    const z = q[2] as number;
    const w = q[3] as number;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  },

  /**
   * Compose a TRS transform: `out = T(t) * R(q) * S(s)`.
   *
   * Application order on a point is scale first, then rotate, then
   * translate — the conventional model-matrix layout. `q` is assumed
   * unit length.
   */
  fromRotationTranslationScale(out: Mat4, q: Quat, t: Vec3, s: Vec3): Mat4 {
    const x = q[0] as number;
    const y = q[1] as number;
    const z = q[2] as number;
    const w = q[3] as number;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    const sx = s[0] as number;
    const sy = s[1] as number;
    const sz = s[2] as number;
    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0;
    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[7] = 0;
    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;
    out[12] = t[0] as number;
    out[13] = t[1] as number;
    out[14] = t[2] as number;
    out[15] = 1;
    return out;
  },
};
