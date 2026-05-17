import { expect, test } from "bun:test";
import planeShader from "../src/scene/plane.wgsl" with { type: "text" };
import triangleShader from "../src/triangle.wgsl" with { type: "text" };

test("triangle WGSL declares vertex and fragment entry points", () => {
  expect(triangleShader.length).toBeGreaterThan(0);
  expect(triangleShader).toContain("@vertex");
  expect(triangleShader).toContain("@fragment");
  expect(triangleShader).toContain("vs_main");
  expect(triangleShader).toContain("fs_main");
});

test("plane WGSL declares vertex and fragment entry points", () => {
  expect(planeShader.length).toBeGreaterThan(0);
  expect(planeShader).toContain("@vertex");
  expect(planeShader).toContain("@fragment");
  expect(planeShader).toContain("vs_main");
  expect(planeShader).toContain("fs_main");
});
