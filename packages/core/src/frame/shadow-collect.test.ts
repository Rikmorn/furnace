import { expect, test } from "bun:test";
import type { Light } from "./lights.ts";
import { MAX_SHADOW_CASTERS } from "./lights.ts";
import { _collectShadowCasters } from "./shadow-map.ts";

const dirCaster = (): Light => ({
  type: "directional",
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  shadow: { orthoHalfExtent: 5, near: 0.1, far: 20 },
});

test("collects directional/spot lights with a shadow config, assigns slots 0..n", () => {
  const lights: Light[] = [
    {
      type: "point",
      position: [0, 1, 0],
      color: [1, 1, 1],
      intensity: 1,
      range: 10,
    }, // not a caster
    dirCaster(),
    {
      type: "spot",
      position: [0, 3, 0],
      direction: [0, -1, 0],
      color: [1, 1, 1],
      intensity: 1,
      range: 10,
      innerAngle: 0.3,
      outerAngle: 0.5,
      shadow: { near: 0.1 },
    },
  ];
  const { casters, overflowed } = _collectShadowCasters(lights);
  expect(overflowed).toBe(false);
  expect(casters.length).toBe(2);
  expect(casters[0]?.slot).toBe(0);
  expect(casters[1]?.slot).toBe(1);
  expect(casters[0]?.lightIndex).toBe(1); // the directional at index 1
  expect(casters[1]?.lightIndex).toBe(2); // the spot at index 2
});

test("a directional/spot WITHOUT a shadow config does not cast", () => {
  const lights: Light[] = [
    {
      type: "directional",
      direction: [0, -1, 0],
      color: [1, 1, 1],
      intensity: 1,
    },
  ];
  expect(_collectShadowCasters(lights).casters.length).toBe(0);
});

test("clamps to MAX_SHADOW_CASTERS and reports overflow (runtime-quiet)", () => {
  const lights: Light[] = Array.from(
    { length: MAX_SHADOW_CASTERS + 2 },
    dirCaster,
  );
  const { casters, overflowed } = _collectShadowCasters(lights);
  expect(casters.length).toBe(MAX_SHADOW_CASTERS);
  expect(overflowed).toBe(true);
});

test("undefined lights -> no casters, no overflow", () => {
  expect(_collectShadowCasters(undefined)).toEqual({
    casters: [],
    overflowed: false,
  });
});
