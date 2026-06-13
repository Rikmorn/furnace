import { beforeEach, expect, test } from "bun:test";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { introspect, resetRegistryForTests } from "../../src/scene/registry.ts";

beforeEach(() => {
  resetRegistryForTests();
  registerBuiltins();
});

test("introspect: transform.scale carries its default [1,1,1]", () => {
  const t = introspect().components["transform"] as {
    properties: Record<string, { default?: unknown; furnace?: unknown }>;
  };
  const scale = t.properties["scale"];
  expect(scale?.default).toEqual([1, 1, 1]);
});

test("introspect: transform.position carries its default [0,0,0]", () => {
  const t = introspect().components["transform"] as {
    properties: Record<string, { default?: unknown }>;
  };
  expect(t.properties["position"]?.default).toEqual([0, 0, 0]);
});

test("introspect: transform.rotation carries its default [0,0,0,1]", () => {
  const t = introspect().components["transform"] as {
    properties: Record<string, { default?: unknown }>;
  };
  expect(t.properties["rotation"]?.default).toEqual([0, 0, 0, 1]);
});
