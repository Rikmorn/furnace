/** 2-component vector backed by a `Float32Array` of length 2. Reserved — not currently produced by any engine function. */
export type Vec2 = Float32Array;
/** 3-component vector backed by a `Float32Array` of length 3. */
export type Vec3 = Float32Array;
/** 4-component vector backed by a `Float32Array` of length 4. */
export type Vec4 = Float32Array;
/** Quaternion backed by a `Float32Array` of length 4, ordered `(x, y, z, w)`. Identity is `(0, 0, 0, 1)`. */
export type Quat = Float32Array;
/** 3x3 matrix backed by a `Float32Array` of length 9. Reserved — not currently produced by any engine function. */
export type Mat3 = Float32Array;
/** 4x4 matrix backed by a `Float32Array` of length 16, column-major (matches WebGPU's expected memory layout). */
export type Mat4 = Float32Array;
