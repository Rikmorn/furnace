import type { Vec4 } from "./types.ts";

export const vec4 = {
  create(): Vec4 {
    return new Float32Array(4);
  },

  fromValues(x: number, y: number, z: number, w: number): Vec4 {
    const out = new Float32Array(4);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
  },

  set(out: Vec4, x: number, y: number, z: number, w: number): Vec4 {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
  },

  copy(out: Vec4, a: Vec4): Vec4 {
    out[0] = a[0] as number;
    out[1] = a[1] as number;
    out[2] = a[2] as number;
    out[3] = a[3] as number;
    return out;
  },
};
