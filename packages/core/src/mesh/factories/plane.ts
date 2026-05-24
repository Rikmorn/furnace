import type { Context } from "../../gpu/index.ts";
import type { Material } from "../../material/types.ts";
import { createGeometry } from "../geometry.ts";
import { create } from "../mesh.ts";
import type { Geometry, GeometryData, Mesh } from "../types.ts";

function planeGeometryData(size: number): GeometryData {
  const s = size / 2;
  const positions = new Float32Array([-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
}

export function planeGeometry(
  ctx: Context,
  opts?: { size?: number },
): Geometry {
  const size = opts?.size ?? 1;
  return createGeometry(ctx, planeGeometryData(size));
}

export function plane(
  ctx: Context,
  opts: { material: Material; size?: number },
): Mesh {
  return create(ctx, {
    geometry: planeGeometry(ctx, opts),
    material: opts.material,
  });
}
