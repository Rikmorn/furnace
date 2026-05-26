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

/**
 * Build a standalone `+Z`-facing unit plane {@link Geometry} (single quad,
 * two triangles, normals along `+Z`, UVs in `[0,1]`). `size` is the full edge
 * length and defaults to `1`.
 *
 * Use when sharing one plane geometry across many meshes (e.g. instanced
 * backdrops). For the single-mesh path, use {@link plane} instead.
 */
export function planeGeometry(
  ctx: Context,
  opts?: { size?: number },
): Geometry {
  const size = opts?.size ?? 1;
  return createGeometry(ctx, planeGeometryData(size));
}

/**
 * Convenience factory: build a fresh `+Z`-facing unit plane {@link Geometry}
 * and bind it to `opts.material`, returning a ready-to-render {@link Mesh}.
 * `size` is the full edge length and defaults to `1`.
 *
 * The geometry is owned by this mesh; share via {@link planeGeometry} +
 * `mesh.create` when one plane must back multiple meshes.
 */
export function plane(
  ctx: Context,
  opts: { material: Material; size?: number },
): Mesh {
  return create(ctx, {
    geometry: planeGeometry(ctx, opts),
    material: opts.material,
  });
}
