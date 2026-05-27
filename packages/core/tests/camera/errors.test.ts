import { expect, test } from "bun:test";
import { setAspect, setNearFar } from "../../src/camera/common.ts";
import { orthographic } from "../../src/camera/orthographic.ts";
import { perspective, setFov } from "../../src/camera/perspective.ts";

test("setFov on orthographic camera throws", () => {
  const cam = orthographic();
  expect(() => setFov(cam, Math.PI / 2)).toThrow(/perspective-only/);
});

test("setNearFar with near >= far throws", () => {
  const cam = perspective();
  expect(() => setNearFar(cam, 10, 5)).toThrow(/near must be less than far/);
  expect(() => setNearFar(cam, 5, 5)).toThrow(/near must be less than far/);
});

test("setNearFar with near <= 0 on perspective throws", () => {
  const cam = perspective();
  expect(() => setNearFar(cam, 0, 100)).toThrow(
    /perspective near must be positive/,
  );
  expect(() => setNearFar(cam, -1, 100)).toThrow(
    /perspective near must be positive/,
  );
});

test("setNearFar with negative near on orthographic is allowed", () => {
  const cam = orthographic();
  expect(() => setNearFar(cam, -5, 5)).not.toThrow();
});

test("setNearFar with non-finite values throws", () => {
  const cam = perspective();
  expect(() => setNearFar(cam, Number.NaN, 100)).toThrow(/finite/);
  expect(() => setNearFar(cam, 0.1, Number.POSITIVE_INFINITY)).toThrow(
    /finite/,
  );
});

test("setAspect with non-positive or non-finite throws", () => {
  const cam = perspective();
  expect(() => setAspect(cam, 0)).toThrow(/positive finite/);
  expect(() => setAspect(cam, -1)).toThrow(/positive finite/);
  expect(() => setAspect(cam, Number.NaN)).toThrow(/positive finite/);
  expect(() => setAspect(cam, Number.POSITIVE_INFINITY)).toThrow(
    /positive finite/,
  );
});

test("setFov with non-positive or non-finite throws", () => {
  const cam = perspective();
  expect(() => setFov(cam, 0)).toThrow(/positive finite/);
  expect(() => setFov(cam, -1)).toThrow(/positive finite/);
  expect(() => setFov(cam, Number.NaN)).toThrow(/positive finite/);
});

test("perspective factory with invalid options throws", () => {
  expect(() => perspective({ aspect: -1 })).toThrow(/positive finite/);
  expect(() => perspective({ near: 0 })).toThrow(
    /perspective near must be positive/,
  );
  expect(() => perspective({ near: 10, far: 5 })).toThrow(
    /near must be less than far/,
  );
  expect(() => perspective({ fovYRad: 0 })).toThrow(/positive finite/);
});

test("orthographic factory with invalid bounds throws", () => {
  expect(() => orthographic({ near: 10, far: 5 })).toThrow(
    /near must be less than far/,
  );
  expect(() => orthographic({ left: Number.NaN })).toThrow(/finite/);
});
