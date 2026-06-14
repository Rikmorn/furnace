import { expect, test } from "bun:test";
import {
  _packScene,
  type Ambient,
  type Fog,
  SCENE_BYTE_SIZE,
} from "../../src/frame/lights.ts";

const AMB: Ambient = { sky: [1, 1, 1], ground: [0, 0, 0], intensity: 0.5 };

test("fog packs into the _reserved header lane (floats 12..15): rgb + density", () => {
  const buf = new ArrayBuffer(SCENE_BYTE_SIZE);
  const fog: Fog = { color: [0.1, 0.2, 0.3], density: 0.42 };
  _packScene(buf, [], AMB, [], fog);
  const f = new Float32Array(buf);
  expect(f[12]).toBeCloseTo(0.1, 6);
  expect(f[13]).toBeCloseTo(0.2, 6);
  expect(f[14]).toBeCloseTo(0.3, 6);
  expect(f[15]).toBeCloseTo(0.42, 6);
});

test("omitted fog → density 0 (disabled, backward compatible)", () => {
  const buf = new ArrayBuffer(SCENE_BYTE_SIZE);
  _packScene(buf, [], AMB, [], undefined);
  const f = new Float32Array(buf);
  expect(f[15]).toBe(0); // density 0 → fog factor 0 → no visual change
});
