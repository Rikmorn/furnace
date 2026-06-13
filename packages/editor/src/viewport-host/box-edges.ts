/**
 * Corner index bit layout matches `LoadedScene.entityBoxCorners`: bit0=x, bit1=y, bit2=z.
 * For corner index `c`: x = c&1 ? max.x : min.x, y = c&2 ? max.y : min.y, z = c&4 ? max.z : min.z.
 * Each pair in EDGES differs in exactly one bit, producing the 12 axis-aligned box edges:
 *   x-aligned edges: [0,1],[2,3],[4,5],[6,7]  (differ in bit0)
 *   y-aligned edges: [0,2],[1,3],[4,6],[5,7]  (differ in bit1)
 *   z-aligned edges: [0,4],[1,5],[2,6],[3,7]  (differ in bit2)
 */
const EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7], // x-aligned
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7], // y-aligned
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7], // z-aligned
];

/**
 * Expand 8 world AABB corners (Float32Array of length 24, 3 floats per corner) into
 * a line-list suitable for `frame.drawLines`: one vertex pair per edge, plus a
 * per-vertex RGBA color array.
 *
 * @param corners - 24-element Float32Array from `LoadedScene.entityBoxCorners`.
 * @param rgba - Highlight color as `[r, g, b, a]` in [0,1] range.
 * @returns `{ vertices, colors }` — both typed arrays sized for `DrawLinesOptions`.
 */
export function boxEdges(
  corners: Float32Array,
  rgba: [number, number, number, number],
): { vertices: Float32Array; colors: Float32Array } {
  const vertices = new Float32Array(EDGES.length * 2 * 3);
  const colors = new Float32Array(EDGES.length * 2 * 4);
  for (let e = 0; e < EDGES.length; e++) {
    const [a, b] = EDGES[e] as [number, number];
    vertices.set(corners.subarray(a * 3, a * 3 + 3), e * 6);
    vertices.set(corners.subarray(b * 3, b * 3 + 3), e * 6 + 3);
    colors.set(rgba, e * 8);
    colors.set(rgba, e * 8 + 4);
  }
  return { vertices, colors };
}
