import { expect, test } from "bun:test";
import { main } from "../src/entry.ts";
import shader from "../src/triangle.wgsl" with { type: "text" };

test("entry exports main", () => {
  expect(typeof main).toBe("function");
});

test("triangle WGSL declares vertex and fragment entry points", () => {
  expect(shader.length).toBeGreaterThan(0);
  expect(shader).toContain("@vertex");
  expect(shader).toContain("@fragment");
  expect(shader).toContain("vs_main");
  expect(shader).toContain("fs_main");
});
