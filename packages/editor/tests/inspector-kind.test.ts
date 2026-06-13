import { expect, test } from "bun:test";
import { resolveKind } from "../src/frontend/inspector/kind.ts";

test("furnace.kind wins", () => {
  expect(
    resolveKind({ type: "array", meta: { furnace: { kind: "vec3" } } }),
  ).toBe("vec3");
  expect(
    resolveKind({
      type: "string",
      meta: { furnace: { kind: "resource", table: "materials" } },
    }),
  ).toBe("resource");
  expect(resolveKind({ meta: { furnace: { kind: "color" } } })).toBe("color");
});
test("enum before plain type", () => {
  expect(resolveKind({ type: "string", enum: ["perspective"] })).toBe("enum");
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
