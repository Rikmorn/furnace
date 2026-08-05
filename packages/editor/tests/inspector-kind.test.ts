import { expect, test } from "bun:test";
import { toJsonSchema, z } from "@furnace/core/registry";
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

// Regression: resolveKind must dispatch off the REAL `toJsonSchema` wire shape,
// not a hand-written fixture. zod hoists `.meta({ furnace })` to the node root;
// an earlier `schema.meta?.furnace` read silently rendered vec/quat/color/resource
// fields as the read-only DefaultField (the M5A holistic-review CRITICAL).
//
// The wrappers are load-bearing, not decoration: hoisting has to survive
// `.default().optional()` (how a schema authors an omittable field with a display
// seed) and bare `.optional()`, as well as a required field. `io: "input"` is the
// reflection side of the registry contract.
const REFLECTED = toJsonSchema(
  z.object({
    position: z
      .tuple([z.number(), z.number(), z.number()])
      .meta({ furnace: { kind: "vec3" } })
      .default([0, 0, 0])
      .optional(),
    rotation: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .meta({ furnace: { kind: "quat" } })
      .default([0, 0, 0, 1])
      .optional(),
    scale: z
      .tuple([z.number(), z.number(), z.number()])
      .meta({ furnace: { kind: "vec3" } })
      .default([1, 1, 1])
      .optional(),
    geometry: z
      .string()
      .meta({ furnace: { kind: "resource", table: "geometries" } }),
    clearColor: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .meta({ furnace: { kind: "color" } })
      .optional(),
  }),
  { io: "input" },
);

test("resolves real reflected nodes (root-level furnace key)", () => {
  const prop = (schema: unknown, key: string): JsonSchemaNode => {
    const props = (schema as { properties: Record<string, JsonSchemaNode> })
      .properties;
    const node = props[key];
    if (!node) throw new Error(`reflected node missing property "${key}"`);
    return node;
  };

  expect(resolveKind(prop(REFLECTED, "position"))).toBe("vec3");
  expect(resolveKind(prop(REFLECTED, "rotation"))).toBe("quat");
  expect(resolveKind(prop(REFLECTED, "scale"))).toBe("vec3");

  const geometry = prop(REFLECTED, "geometry");
  expect(resolveKind(geometry)).toBe("resource");
  expect(geometry.furnace?.table).toBe("geometries");

  expect(resolveKind(prop(REFLECTED, "clearColor"))).toBe("color");
});
