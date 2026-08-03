import { expect, test } from "bun:test";
import { z } from "zod";
import { fieldFurnaceMeta, parseOrThrow, resolveParams } from "./schema.ts";
import * as t from "./t.ts";

test("t.vec3 accepts a 3-tuple and rejects wrong lengths", () => {
  expect(t.vec3().safeParse([1, 2, 3]).success).toBe(true);
  expect(t.vec3().safeParse([1, 2]).success).toBe(false);
  expect(t.vec3().safeParse([1, 2, 3, 4]).success).toBe(false);
  expect(t.vec3().safeParse("nope").success).toBe(false);
});

test("t.quat accepts a 4-tuple only", () => {
  expect(t.quat().safeParse([0, 0, 0, 1]).success).toBe(true);
  expect(t.quat().safeParse([0, 0, 1]).success).toBe(false);
});

test("t.resource carries furnace meta naming its table", () => {
  expect(fieldFurnaceMeta(t.resource("geometries"))).toEqual({
    kind: "resource",
    table: "geometries",
  });
});

test("fieldFurnaceMeta reads through .optional()", () => {
  expect(fieldFurnaceMeta(t.resource("shaders").optional())).toEqual({
    kind: "resource",
    table: "shaders",
  });
  expect(fieldFurnaceMeta(z.number().optional())).toBeUndefined();
});

test("t.ref carries its required components", () => {
  expect(fieldFurnaceMeta(t.ref("transform", "rigidBody"))).toEqual({
    kind: "ref",
    requires: ["transform", "rigidBody"],
  });
});

test("resolveParams swaps resource ids for looked-up handles, leaves the rest", () => {
  const shape = {
    geometry: t.resource("geometries"),
    detail: t.resource("shaders").optional(),
    name: z.string(),
  };
  const handle = { fake: true };
  const calls: [string, string][] = [];
  const resolved = resolveParams(
    shape,
    { geometry: "g1", name: "n" },
    (table, id) => {
      calls.push([table, id]);
      return handle;
    },
  );
  expect(resolved["geometry"]).toBe(handle);
  expect(resolved["name"]).toBe("n");
  expect(resolved["detail"]).toBeUndefined();
  expect(calls).toEqual([["geometries", "g1"]]); // absent optional ref not looked up
});

test("parseOrThrow wraps the first zod issue into a FurnaceError with location", () => {
  const schema = z.strictObject({ position: t.vec3() });
  expect(() =>
    parseOrThrow(
      schema,
      { position: [1, 2] },
      'entity "ball" component "transform"',
    ),
  ).toThrow(/scene: entity "ball" component "transform" invalid at "position"/);
  expect(parseOrThrow(schema, { position: [1, 2, 3] }, "x")).toEqual({
    position: [1, 2, 3],
  });
});
