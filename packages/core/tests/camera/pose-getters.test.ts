import { expect, test } from "bun:test";
import {
  getPosition,
  getTarget,
  getUp,
  perspective,
  setPosition,
  setTarget,
  setUp,
} from "../../src/camera/index.ts";
import { vec3 } from "../../src/transform/vec3.ts";

test("getPosition/getTarget/getUp read back what the setters wrote", () => {
  const cam = perspective();
  setPosition(cam, vec3.fromValues(1, 2, 3));
  setTarget(cam, vec3.fromValues(4, 5, 6));
  setUp(cam, vec3.fromValues(0, 0, 1));

  const out = vec3.create();
  expect(Array.from(getPosition(out, cam))).toEqual([1, 2, 3]);
  expect(Array.from(getTarget(out, cam))).toEqual([4, 5, 6]);
  expect(Array.from(getUp(out, cam))).toEqual([0, 0, 1]);
});

test("pose getters return the out param (chainable)", () => {
  const cam = perspective();
  const out = vec3.create();
  expect(getPosition(out, cam)).toBe(out);
});
