import { beforeEach, expect, test } from "bun:test";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import {
  defineComponent,
  introspect,
  resetRegistryForTests,
} from "../../src/scene/registry.ts";
import * as t from "../../src/scene/t.ts";

beforeEach(() => {
  resetRegistryForTests();
  registerBuiltins();
});

test("introspect serves both surfaces as JSON Schema", () => {
  const r = introspect();
  expect(Object.keys(r.components)).toEqual(
    expect.arrayContaining(["transform", "meshRenderer", "camera"]),
  );
  expect(Object.keys(r.resources["geometries"])).toContain("cube");
  expect(Object.keys(r.resources["shaders"])).toContain("unlit");
  expect(Object.keys(r.resources["materials"])).toContain("standard");
  expect(r.settings).toMatchObject({ type: "object" });
});

test("component schemas carry field kinds, optionality, and furnace meta", () => {
  const mr = introspect().components["meshRenderer"] as {
    properties: Record<string, Record<string, unknown>>;
    required: string[];
    additionalProperties: boolean;
  };
  expect(mr.properties["geometry"]).toMatchObject({
    type: "string",
    furnace: { kind: "resource", table: "geometries" },
  });
  expect(mr.required).toEqual(expect.arrayContaining(["geometry", "material"]));
  expect(mr.additionalProperties).toBe(false);

  const tf = introspect().components["transform"] as {
    required?: string[];
    properties: Record<string, unknown>;
  };
  expect(tf.required ?? []).toEqual([]); // all transform fields optional
  expect(tf.properties["position"]).toMatchObject({
    furnace: { kind: "vec3" },
  });
});

test("custom registrations appear, with ref targets reflected", () => {
  defineComponent("follow", {
    params: { target: t.ref("transform", "meshRenderer") },
  });
  const follow = introspect().components["follow"] as {
    properties: Record<string, unknown>;
  };
  expect(follow.properties["target"]).toMatchObject({
    furnace: { kind: "ref", requires: ["transform", "meshRenderer"] },
  });
});
