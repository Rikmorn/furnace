import { expect, test } from "bun:test";
import type { DirectionalLight, SpotLight } from "./lights.ts";

test("directional light accepts a shadow config", () => {
  const l: DirectionalLight = {
    type: "directional",
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    shadow: { orthoHalfExtent: 5, near: 0.1, far: 20, normalBias: 1.5 },
  };
  expect(l.shadow?.orthoHalfExtent).toBe(5);
});

test("spot light accepts a shadow config; shadow is optional", () => {
  const a: SpotLight = {
    type: "spot",
    position: [0, 3, 0],
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 2,
    range: 10,
    innerAngle: 0.3,
    outerAngle: 0.5,
    shadow: { near: 0.1 },
  };
  const b: SpotLight = { ...a, shadow: undefined };
  expect(a.shadow?.near).toBe(0.1);
  expect(b.shadow).toBeUndefined();
});

test("directional shadow accepts target and distance; both round-trip", () => {
  const l: DirectionalLight = {
    type: "directional",
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    shadow: {
      orthoHalfExtent: 8,
      near: 0.5,
      far: 40,
      target: [1, 0, 0],
      distance: 10,
    },
  };
  expect(l.shadow?.distance).toBe(10);
  expect(l.shadow?.target).toEqual([1, 0, 0]);
});
