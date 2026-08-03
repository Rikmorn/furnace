import { expect, test } from "bun:test";
import { TABLE_ORDER } from "./t.ts";

test("TABLE_ORDER includes textures (before materials) and effects", () => {
  expect(TABLE_ORDER).toEqual([
    "geometries",
    "textures",
    "shaders",
    "materials",
    "effects",
  ]);
  expect(TABLE_ORDER.indexOf("textures")).toBeLessThan(
    TABLE_ORDER.indexOf("materials"),
  );
});
