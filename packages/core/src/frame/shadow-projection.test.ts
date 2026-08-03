import { expect, test } from "bun:test";
import type { DirectionalLight, SpotLight } from "./lights.ts";
import {
  _directionalLightViewProj,
  _spotLightViewProj,
} from "./shadow-projection.ts";

function project(m: Float32Array, x: number, y: number, z: number) {
  // column-major mat4 * vec4(x,y,z,1)
  // Fixed-index reads on a known-length Float32Array — noUncheckedIndexedAccess bypass class (typescript.md).
  const w =
    (m[3] as number) * x +
    (m[7] as number) * y +
    (m[11] as number) * z +
    (m[15] as number);
  return {
    x:
      ((m[0] as number) * x +
        (m[4] as number) * y +
        (m[8] as number) * z +
        (m[12] as number)) /
      w,
    y:
      ((m[1] as number) * x +
        (m[5] as number) * y +
        (m[9] as number) * z +
        (m[13] as number)) /
      w,
    z:
      ((m[2] as number) * x +
        (m[6] as number) * y +
        (m[10] as number) * z +
        (m[14] as number)) /
      w,
  };
}

test("directional matrix maps the target to NDC center (0, 0)", () => {
  const l: DirectionalLight = {
    type: "directional",
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    shadow: { orthoHalfExtent: 5, near: 0.1, far: 20, target: [0, 0, 0] },
  };
  const m = _directionalLightViewProj(l);
  const p = project(m, 0, 0, 0);
  // The matrix is raw proj·view (no UV remap), so center projects to NDC (0, 0).
  expect(p.x).toBeCloseTo(0, 3);
  expect(p.y).toBeCloseTo(0, 3);
  // Target sits at view-space z = -dist = -10; ortho depth = (10 - 0.1) / (20 - 0.1) ≈ 0.497.
  expect(p.z).toBeCloseTo(0.497, 3);
});

test("spot matrix produces depth in [0,1] for a point inside the cone", () => {
  const l: SpotLight = {
    type: "spot",
    position: [0, 3, 0],
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 2,
    range: 10,
    innerAngle: 0.3,
    outerAngle: 0.5,
    shadow: { near: 0.1, far: 10 },
  };
  const m = _spotLightViewProj(l);
  const p = project(m, 0, 0, 0); // 3 units in front of the light
  expect(p.z).toBeGreaterThan(0);
  expect(p.z).toBeLessThan(1);
});
