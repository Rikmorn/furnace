import { expect, test } from "bun:test";
import triangleShader from "../src/triangle.wgsl" with { type: "text" };

test("triangle WGSL declares vertex and fragment entry points", () => {
  expect(triangleShader.length).toBeGreaterThan(0);
  expect(triangleShader).toContain("@vertex");
  expect(triangleShader).toContain("@fragment");
  expect(triangleShader).toContain("vs_main");
  expect(triangleShader).toContain("fs_main");
});
