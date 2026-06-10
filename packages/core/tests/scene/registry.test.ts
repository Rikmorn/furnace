import { afterAll, beforeEach, expect, test } from "bun:test";
import { z } from "zod";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import {
  defineComponent,
  defineResource,
  getComponent,
  getResourceKind,
  getSettingsSchema,
  resetRegistryForTests,
  setSettingsSchema,
} from "../../src/scene/registry.ts";
import * as t from "../../src/scene/t.ts";

beforeEach(() => resetRegistryForTests());
afterAll(() => {
  resetRegistryForTests();
  registerBuiltins();
});

test("defineComponent registers and getComponent returns schema + shape", () => {
  defineComponent("spin", { params: { speed: z.number() } });
  const reg = getComponent("spin");
  expect(reg).toBeDefined();
  expect(reg?.schema.safeParse({ speed: 1 }).success).toBe(true);
  expect(reg?.schema.safeParse({ speed: 1, extra: true }).success).toBe(false); // strict
});

test("defineComponent with no params accepts only an empty object", () => {
  defineComponent("marker", {});
  expect(getComponent("marker")?.schema.safeParse({}).success).toBe(true);
  expect(getComponent("marker")?.schema.safeParse({ x: 1 }).success).toBe(
    false,
  );
});

test("duplicate component name throws", () => {
  defineComponent("spin", {});
  expect(() => defineComponent("spin", {})).toThrow(
    /spin.*already registered/i,
  );
});

test("defineResource registers per table+kind; duplicates throw", () => {
  defineResource("geometries", "cube", { build: (() => ({})) as never });
  expect(getResourceKind("geometries", "cube")).toBeDefined();
  expect(getResourceKind("geometries", "nope")).toBeUndefined();
  expect(() =>
    defineResource("geometries", "cube", { build: (() => ({})) as never }),
  ).toThrow(/geometries.*cube.*already registered/i);
});

test("settings schema slot", () => {
  setSettingsSchema({ clearColor: t.vec4().optional() });
  expect(getSettingsSchema().safeParse({}).success).toBe(true);
  expect(
    getSettingsSchema().safeParse({ clearColor: [0, 0, 0, 1] }).success,
  ).toBe(true);
  expect(getSettingsSchema().safeParse({ bogus: 1 }).success).toBe(false);
});

test("reset clears everything", () => {
  defineComponent("spin", {});
  resetRegistryForTests();
  expect(getComponent("spin")).toBeUndefined();
});
