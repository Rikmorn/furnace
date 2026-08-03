import { expect, test } from "bun:test";
import { vec3 } from "../transform/vec3.ts";
import * as camera from "./index.ts";
import { projectToScreen, type ScreenProjection } from "./project.ts";

function cam() {
  const c = camera.perspective({
    fovYRad: Math.PI / 3,
    aspect: 1,
    near: 0.1,
    far: 100,
  });
  camera.setPosition(c, vec3.fromValues(0, 0, 5));
  camera.setTarget(c, vec3.fromValues(0, 0, 0));
  camera.setUp(c, vec3.fromValues(0, 1, 0));
  return c;
}

test("screenToRay: center ray points down -Z from the eye", () => {
  const c = cam();
  const ray = camera.screenToRay(c, 0, 0); // NDC center
  expect(ray.origin[0]).toBeCloseTo(0, 5);
  expect(ray.origin[1]).toBeCloseTo(0, 5);
  // origin is the near-plane point: eye.z (5) - near (0.1) = 4.9
  expect(ray.origin[2]).toBeCloseTo(4.9, 4);
  // looking toward origin → dir ≈ (0,0,-1)
  expect(ray.dir[0]).toBeCloseTo(0, 4);
  expect(ray.dir[1]).toBeCloseTo(0, 4);
  expect(ray.dir[2]).toBeCloseTo(-1, 4);
});

test("screenToRay: round-trips with projectToScreen", () => {
  const c = cam();
  const world = vec3.fromValues(1.2, -0.7, 0);
  const scr: ScreenProjection = { x: 0, y: 0, w: 0 };
  const vpW = 800;
  const vpH = 600;
  expect(projectToScreen(scr, c, world, vpW, vpH)).toBe(true);
  const ndcX = (scr.x / vpW) * 2 - 1;
  const ndcY = -((scr.y / vpH) * 2 - 1);
  const ray = camera.screenToRay(c, ndcX, ndcY);
  const t =
    ((world[2] as number) - (ray.origin[2] as number)) / (ray.dir[2] as number);
  expect((ray.origin[0] as number) + t * (ray.dir[0] as number)).toBeCloseTo(
    world[0] as number,
    3,
  );
  expect((ray.origin[1] as number) + t * (ray.dir[1] as number)).toBeCloseTo(
    world[1] as number,
    3,
  );
  const len = Math.hypot(
    ray.dir[0] as number,
    ray.dir[1] as number,
    ray.dir[2] as number,
  );
  expect(len).toBeCloseTo(1, 5);
});
