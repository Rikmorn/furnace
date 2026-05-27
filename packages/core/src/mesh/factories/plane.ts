import type { Context } from "../../gpu/index.ts";
import { createGeometry } from "../geometry.ts";
import type { Geometry, GeometryData } from "../types.ts";

function planeGeometryData(size: number): GeometryData {
  const s = size / 2;
  const positions = new Float32Array([-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
}

/**
 * Build a standalone `+Z`-facing unit plane {@link Geometry} (single quad,
 * two triangles, normals along `+Z`, UVs in `[0,1]`). `size` is the full edge
 * length and defaults to `1`.
 *
 * Pass to `mesh.create({ geometry, material })` to bind. The caller owns
 * the returned geometry — see `engine-conventions.md` §Resource ownership.
 */
export function planeGeometry(
  ctx: Context,
  opts?: { size?: number },
): Geometry {
  const size = opts?.size ?? 1;
  return createGeometry(ctx, planeGeometryData(size));
}
