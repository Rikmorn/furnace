import { expect, test } from "bun:test";
import { quat } from "./quat.ts";
import { vec3 } from "./vec3.ts";

test("transformQuat: identity quaternion leaves the vector unchanged", () => {
  const out = vec3.create();
  vec3.transformQuat(
    out,
    vec3.fromValues(1, 2, 3),
    quat.fromValues(0, 0, 0, 1),
  );
  expect([out[0], out[1], out[2]]).toEqual([1, 2, 3]);
});

test("transformQuat: 90° about +Y rotates -Z forward to -X", () => {
  const out = vec3.create();
  const q = quat.create();
  quat.fromAxisAngle(q, vec3.fromValues(0, 1, 0), Math.PI / 2);
  vec3.transformQuat(out, vec3.fromValues(0, 0, -1), q);
  expect(out[0] as number).toBeCloseTo(-1, 5);
  expect(out[1] as number).toBeCloseTo(0, 5);
  expect(out[2] as number).toBeCloseTo(0, 5);
});
