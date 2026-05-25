/**
 * Compute the triangle contribution of a single draw given the material's
 * primitive topology and the draw's index/vertex count. Returns 0 for
 * non-triangle topologies (line-list, line-strip, point-list).
 */
export function trianglesForTopology(
  topology: GPUPrimitiveTopology,
  count: number,
): number {
  if (topology === "triangle-list") return Math.floor(count / 3);
  if (topology === "triangle-strip") return Math.max(0, count - 2);
  return 0;
}
