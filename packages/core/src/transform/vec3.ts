import type { Mat4, Vec3 } from "./types.ts";

export const vec3 = {
  create(): Vec3 {
    return new Float32Array(3);
  },

  fromValues(x: number, y: number, z: number): Vec3 {
    const out = new Float32Array(3);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  },

  set(out: Vec3, x: number, y: number, z: number): Vec3 {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  },

  copy(out: Vec3, a: Vec3): Vec3 {
    out[0] = a[0] as number;
    out[1] = a[1] as number;
    out[2] = a[2] as number;
    return out;
  },

  add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out[0] = (a[0] as number) + (b[0] as number);
    out[1] = (a[1] as number) + (b[1] as number);
    out[2] = (a[2] as number) + (b[2] as number);
    return out;
  },

  sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out[0] = (a[0] as number) - (b[0] as number);
    out[1] = (a[1] as number) - (b[1] as number);
    out[2] = (a[2] as number) - (b[2] as number);
    return out;
  },

  scale(out: Vec3, a: Vec3, s: number): Vec3 {
    out[0] = (a[0] as number) * s;
    out[1] = (a[1] as number) * s;
    out[2] = (a[2] as number) * s;
    return out;
  },

  dot(a: Vec3, b: Vec3): number {
    return (
      (a[0] as number) * (b[0] as number) +
      (a[1] as number) * (b[1] as number) +
      (a[2] as number) * (b[2] as number)
    );
  },

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

  length(a: Vec3): number {
    const x = a[0] as number;
    const y = a[1] as number;
    const z = a[2] as number;
    return Math.sqrt(x * x + y * y + z * z);
  },

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
    const w = m3 * x + m7 * y + m11 * z + m15 || 1;
    out[0] = (m0 * x + m4 * y + m8 * z + m12) / w;
    out[1] = (m1 * x + m5 * y + m9 * z + m13) / w;
    out[2] = (m2 * x + m6 * y + m10 * z + m14) / w;
    return out;
  },
};
