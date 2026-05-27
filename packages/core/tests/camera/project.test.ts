import { expect, test } from "bun:test";
import { policy } from "../../src/camera/fit-policy.ts";
import { orthographic } from "../../src/camera/orthographic.ts";
import { perspective } from "../../src/camera/perspective.ts";
import {
  projectToScreen,
  type ScreenProjection,
} from "../../src/camera/project.ts";
import { vec3 } from "../../src/transform/vec3.ts";

const approx = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

test("world origin projects to viewport center for centered perspective camera", () => {
  const cam = perspective({ aspect: 1, position: vec3.fromValues(0, 0, 5) });
  const out: ScreenProjection = { x: 0, y: 0, w: 0 };
  const ok = projectToScreen(out, cam, vec3.fromValues(0, 0, 0), 800, 800);
  expect(ok).toBe(true);
  expect(approx(out.x, 400)).toBe(true);
  expect(approx(out.y, 400)).toBe(true);
  expect(out.w).toBeGreaterThan(0);
});

test("point behind camera returns false and leaves out untouched", () => {
  const cam = perspective({ aspect: 1, position: vec3.fromValues(0, 0, 5) });
  const sentinel: ScreenProjection = { x: 999, y: 999, w: 999 };
  const ok = projectToScreen(
    sentinel,
    cam,
    vec3.fromValues(0, 0, 10),
    800,
    800,
  );
  expect(ok).toBe(false);
  expect(sentinel.x).toBe(999);
  expect(sentinel.y).toBe(999);
  expect(sentinel.w).toBe(999);
});

test("off-center world point produces off-center screen coord (perspective)", () => {
  const cam = perspective({ aspect: 1, position: vec3.fromValues(0, 0, 5) });
  const out: ScreenProjection = { x: 0, y: 0, w: 0 };
  const ok = projectToScreen(out, cam, vec3.fromValues(1, 0, 0), 800, 800);
  expect(ok).toBe(true);
  expect(out.x).toBeGreaterThan(400);
  expect(approx(out.y, 400)).toBe(true);
});

test("orthographic camera supported", () => {
  const cam = orthographic({
    fitPolicy: policy.stretch({ left: -3, right: 3, bottom: -3, top: 3 }),
    near: 0.1,
    far: 100,
    position: vec3.fromValues(0, 0, 5),
  });
  const out: ScreenProjection = { x: 0, y: 0, w: 0 };
  const ok = projectToScreen(out, cam, vec3.fromValues(0, 0, 0), 800, 600);
  expect(ok).toBe(true);
  expect(approx(out.x, 400)).toBe(true);
  expect(approx(out.y, 300)).toBe(true);
});

test("out parameter is overwritten cleanly across consecutive calls", () => {
  const cam = perspective({ aspect: 1, position: vec3.fromValues(0, 0, 5) });
  const out: ScreenProjection = { x: 0, y: 0, w: 0 };
  projectToScreen(out, cam, vec3.fromValues(1, 0, 0), 800, 800);
  const xRight = out.x;
  projectToScreen(out, cam, vec3.fromValues(-1, 0, 0), 800, 800);
  expect(out.x).toBeLessThan(xRight);
  expect(approx(out.x, 800 - xRight)).toBe(true);
});

test("viewport size scales screen output proportionally", () => {
  const cam = perspective({ aspect: 1, position: vec3.fromValues(0, 0, 5) });
  const outSmall: ScreenProjection = { x: 0, y: 0, w: 0 };
  const outLarge: ScreenProjection = { x: 0, y: 0, w: 0 };
  projectToScreen(outSmall, cam, vec3.fromValues(1, 0, 0), 400, 400);
  projectToScreen(outLarge, cam, vec3.fromValues(1, 0, 0), 800, 800);
  expect(approx(outLarge.x, outSmall.x * 2)).toBe(true);
});
