import { expect, test } from "bun:test";
// Importing @furnace/core/scene auto-registers the builtins (index.ts side effect).
import { introspect } from "@furnace/core/scene";
import { resolveKind } from "../src/frontend/inspector/kind.ts";
import type { JsonSchemaNode } from "../src/frontend/inspector/types.ts";

test("furnace.kind wins", () => {
  // `furnace` lives at the schema-node ROOT — z.toJSONSchema hoists zod's
  // `.meta({ furnace })` there, it is NOT nested under a `meta` wrapper.
  expect(resolveKind({ type: "array", furnace: { kind: "vec3" } })).toBe(
    "vec3",
  );
  expect(
    resolveKind({
      type: "string",
      furnace: { kind: "resource", table: "materials" },
    }),
  ).toBe("resource");
  expect(resolveKind({ furnace: { kind: "color" } })).toBe("color");
});
test("enum before plain type", () => {
  // D-25 split the enum answer by CARDINALITY (see `tests/inspector/numeric-schema.test.ts`
  // for both sides of that boundary). What this case is about is unchanged: an `enum` node
  // is never read as its `type`, whichever control it lands on.
  expect(resolveKind({ type: "string", enum: ["perspective"] })).toBe(
    "segmented",
  );
  expect(
    resolveKind({
      type: "string",
      enum: ["a", "b", "c", "d", "e"],
    }),
  ).toBe("enum");
});
test("plain JSON types, integer folds to number", () => {
  expect(resolveKind({ type: "number" })).toBe("number");
  expect(resolveKind({ type: "integer" })).toBe("number");
  expect(resolveKind({ type: "string" })).toBe("string");
  expect(resolveKind({ type: "boolean" })).toBe("boolean");
  expect(resolveKind({ type: "object", properties: {} })).toBe("object");
});
test("unknown shapes fall back", () => {
  expect(resolveKind({})).toBe("unknown");
  expect(resolveKind({ type: "array" })).toBe("unknown");
});

// Regression: resolveKind must dispatch off the REAL introspect() wire shape, not
// a hand-written fixture. z.toJSONSchema hoists furnace meta to the node root; an
// earlier `schema.meta?.furnace` read silently rendered vec/quat/color/resource
// fields as the read-only DefaultField (the M5A holistic-review CRITICAL).
test("resolves real introspect() nodes (root-level furnace key)", () => {
  const reflection = introspect();
  const prop = (schema: unknown, key: string): JsonSchemaNode => {
    const props = (schema as { properties: Record<string, JsonSchemaNode> })
      .properties;
    const node = props[key];
    if (!node) throw new Error(`introspect node missing property "${key}"`);
    return node;
  };

  const transform = reflection.components["transform"];
  expect(resolveKind(prop(transform, "position"))).toBe("vec3");
  expect(resolveKind(prop(transform, "rotation"))).toBe("quat");
  expect(resolveKind(prop(transform, "scale"))).toBe("vec3");

  const geometry = prop(reflection.components["meshRenderer"], "geometry");
  expect(resolveKind(geometry)).toBe("resource");
  expect(geometry.furnace?.table).toBe("geometries");

  expect(resolveKind(prop(reflection.settings, "clearColor"))).toBe("color");
});
