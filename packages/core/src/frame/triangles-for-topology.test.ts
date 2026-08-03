import { expect, test } from "bun:test";
import { trianglesForTopology } from "./triangles-for-topology.ts";

test("trianglesForTopology: triangle-list returns floor(count / 3)", () => {
  expect(trianglesForTopology("triangle-list", 0)).toBe(0);
  expect(trianglesForTopology("triangle-list", 3)).toBe(1);
  expect(trianglesForTopology("triangle-list", 6)).toBe(2);
  expect(trianglesForTopology("triangle-list", 7)).toBe(2);
  expect(trianglesForTopology("triangle-list", 36)).toBe(12);
});

test("trianglesForTopology: triangle-strip returns max(0, count - 2)", () => {
  expect(trianglesForTopology("triangle-strip", 0)).toBe(0);
  expect(trianglesForTopology("triangle-strip", 1)).toBe(0);
  expect(trianglesForTopology("triangle-strip", 2)).toBe(0);
  expect(trianglesForTopology("triangle-strip", 3)).toBe(1);
  expect(trianglesForTopology("triangle-strip", 10)).toBe(8);
});

test("trianglesForTopology: non-triangle topologies return 0", () => {
  expect(trianglesForTopology("line-list", 6)).toBe(0);
  expect(trianglesForTopology("line-strip", 6)).toBe(0);
  expect(trianglesForTopology("point-list", 6)).toBe(0);
});
