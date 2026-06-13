import { expect, test } from "bun:test";
import { boxEdges } from "../../src/viewport-host/box-edges.ts";

test("boxEdges: 8 corners → 12 line segments (24 vertices)", () => {
  const corners = new Float32Array(24).map((_, i) => i); // dummy distinct corners
  const { vertices } = boxEdges(corners, [1, 1, 0, 1]);
  expect(vertices.length).toBe(12 * 2 * 3); // 12 edges × 2 pts × 3 floats
});

test("boxEdges: colors match vertex count × 4", () => {
  const { vertices, colors } = boxEdges(new Float32Array(24), [1, 0, 0, 1]);
  expect(colors.length).toBe((vertices.length / 3) * 4);
});
