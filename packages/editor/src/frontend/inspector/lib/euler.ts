// Hand-rolled euler↔quat, MATCHING core/transform quat.fromEuler (intrinsic XYZ,
// equivalent to qx*qy*qz). The frontend cannot value-import @furnace/core, so
// this is duplicated deliberately and pinned to core's convention by a test.
const DEG = Math.PI / 180;
const INV = 180 / Math.PI;
/** sin(90°) threshold for gimbal-lock detection in quatToEulerDeg (|m13| ≈ 1 means pitch ≈ ±90°). */
const GIMBAL_LOCK_THRESHOLD = 0.9999999;

/** Intrinsic XYZ Euler degrees → quaternion [x,y,z,w]. Matches core quat.fromEuler. */
export function eulerDegToQuat(
  e: readonly [number, number, number],
): [number, number, number, number] {
  const hx = e[0] * DEG * 0.5;
  const hy = e[1] * DEG * 0.5;
  const hz = e[2] * DEG * 0.5;
  const sx = Math.sin(hx);
  const cx = Math.cos(hx);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sz = Math.sin(hz);
  const cz = Math.cos(hz);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/** Quaternion [x,y,z,w] → intrinsic XYZ Euler degrees (inverse of eulerDegToQuat). */
export function quatToEulerDeg(
  q: readonly [number, number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
  const ey = Math.asin(clamp(m13));
  let ex: number;
  let ez: number;
  if (Math.abs(m13) < GIMBAL_LOCK_THRESHOLD) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex * INV, ey * INV, ez * INV];
}
