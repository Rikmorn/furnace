import { beforeEach, expect, test } from "bun:test";
import { registerBuiltins } from "./builtins.ts";
import {
  getComponent,
  getResourceKind,
  getSettingsSchema,
  resetRegistryForTests,
} from "./registry.ts";

beforeEach(() => {
  resetRegistryForTests();
  registerBuiltins();
});

test("builtins register the slice-1 surface", () => {
  expect(getComponent("transform")).toBeDefined();
  expect(getComponent("meshRenderer")).toBeDefined();
  expect(getComponent("camera")).toBeDefined();
  expect(getResourceKind("geometries", "cube")).toBeDefined();
  expect(getResourceKind("shaders", "unlit")).toBeDefined();
  expect(getResourceKind("materials", "standard")).toBeDefined();
});

test("transform is pure data: schema but no build", () => {
  const reg = getComponent("transform");
  expect(reg?.build).toBeUndefined();
  expect(reg?.schema.safeParse({ position: [0, 1, 2] }).success).toBe(true);
  expect(reg?.schema.safeParse({ position: [0, 1] }).success).toBe(false);
  expect(
    reg?.schema.safeParse({ rotation: [0, 0, 0, 1], scale: [1, 1, 1] }).success,
  ).toBe(true);
});

test("camera params validate the slice-1 shape", () => {
  const reg = getComponent("camera");
  expect(
    reg?.schema.safeParse({ kind: "perspective", aspect: 1 }).success,
  ).toBe(true);
  expect(reg?.schema.safeParse({ kind: "ortho", aspect: 1 }).success).toBe(
    false,
  );
  expect(reg?.schema.safeParse({ aspect: 1 }).success).toBe(false); // kind required
});

test("standard material accepts shader ref + optional color params", () => {
  const reg = getResourceKind("materials", "standard");
  expect(reg?.schema.safeParse({ shader: "s1" }).success).toBe(true);
  expect(
    reg?.schema.safeParse({ shader: "s1", params: { color: [1, 0, 0, 1] } })
      .success,
  ).toBe(true);
  expect(
    reg?.schema.safeParse({ shader: "s1", params: { color: [1, 0] } }).success,
  ).toBe(false);
});

test("settings schema registered (clearColor optional, strict)", () => {
  expect(getSettingsSchema().safeParse({}).success).toBe(true);
  expect(
    getSettingsSchema().safeParse({ clearColor: [0, 0, 0, 1] }).success,
  ).toBe(true);
  expect(getSettingsSchema().safeParse({ unknown: 1 }).success).toBe(false);
});

test("registerBuiltins after reset does not throw (fresh registry)", () => {
  resetRegistryForTests();
  expect(() => registerBuiltins()).not.toThrow();
});
