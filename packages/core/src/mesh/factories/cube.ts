import type { Context } from "../../gpu/index.ts";
import type { Material } from "../../material/types.ts";
import { createGeometry } from "../geometry.ts";
import { create } from "../mesh.ts";
import type { Geometry, GeometryData, Mesh } from "../types.ts";

type Vec3Tuple = readonly [number, number, number];

type CubeFace = {
  readonly normal: Vec3Tuple;
  // Tangent and bitangent span the face in object space; combined with the
  // half-extent `s` they yield the four CCW corners viewed from outside.
  readonly tangent: Vec3Tuple;
  readonly bitangent: Vec3Tuple;
};

const VERTICES_PER_FACE = 4;

// Face order: +Z, -Z, +Y, -Y, +X, -X.
// For each face we pick (tangent, bitangent) such that
//   tangent × bitangent = normal
// which guarantees CCW winding when viewed from outside the cube.
const CUBE_FACES: readonly CubeFace[] = [
  { normal: [0, 0, 1], tangent: [1, 0, 0], bitangent: [0, 1, 0] }, // +Z
  { normal: [0, 0, -1], tangent: [-1, 0, 0], bitangent: [0, 1, 0] }, // -Z
  { normal: [0, 1, 0], tangent: [1, 0, 0], bitangent: [0, 0, -1] }, // +Y
  { normal: [0, -1, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1] }, // -Y
  { normal: [1, 0, 0], tangent: [0, 0, -1], bitangent: [0, 1, 0] }, // +X
  { normal: [-1, 0, 0], tangent: [0, 0, 1], bitangent: [0, 1, 0] }, // -X
];

const FACE_UV_CORNERS: readonly Vec3Tuple[] = [
  [-1, -1, 0],
  [1, -1, 0],
  [1, 1, 0],
  [-1, 1, 0],
];

// Corner = face_center (=normal*s) + tangent * cornerSign.u * s + bitangent * cornerSign.v * s.
// `cornerSign` is one of FACE_UV_CORNERS — its z is unused (zero).
function faceCorner(
  face: CubeFace,
  cornerSign: Vec3Tuple,
  halfSize: number,
): Vec3Tuple {
  const u = cornerSign[0];
  const v = cornerSign[1];
  return [
    (face.normal[0] + face.tangent[0] * u + face.bitangent[0] * v) * halfSize,
    (face.normal[1] + face.tangent[1] * u + face.bitangent[1] * v) * halfSize,
    (face.normal[2] + face.tangent[2] * u + face.bitangent[2] * v) * halfSize,
  ];
}

function buildCubeIndices(): Uint16Array {
  // Two triangles per face over (base, base+1, base+2, base+3): (0,1,2) and (0,2,3).
  const faceIndices = (face: number): number[] => {
    const base = face * VERTICES_PER_FACE;
    return [base, base + 1, base + 2, base, base + 2, base + 3];
  };
  const flat = CUBE_FACES.flatMap((_, f) => faceIndices(f));
  return Uint16Array.from(flat);
}

function cubeGeometryData(size: number): GeometryData {
  const s = size / 2;

  const positions = new Float32Array(
    CUBE_FACES.flatMap((face) =>
      FACE_UV_CORNERS.flatMap((corner) => faceCorner(face, corner, s)),
    ),
  );
  const normals = new Float32Array(
    CUBE_FACES.flatMap((face) =>
      Array.from({ length: VERTICES_PER_FACE }, () => face.normal).flat(),
    ),
  );
  const uvs = new Float32Array(
    CUBE_FACES.flatMap(() => [0, 0, 1, 0, 1, 1, 0, 1]),
  );
  const indices = buildCubeIndices();

  return { positions, normals, uvs, indices };
}

/**
 * Build a standalone cube {@link Geometry} (six axis-aligned faces, CCW
 * winding viewed from outside, per-face normals, per-face UVs in `[0,1]`).
 * `size` is the full edge length and defaults to `1`.
 *
 * Use when you want to share one geometry across multiple meshes (pass to
 * `mesh.create({ geometry: shared, material })`). For the common
 * single-mesh path, use {@link cube} instead.
 */
export function cubeGeometry(ctx: Context, opts?: { size?: number }): Geometry {
  const size = opts?.size ?? 1;
  return createGeometry(ctx, cubeGeometryData(size));
}

/**
 * Convenience factory: build a fresh cube {@link Geometry} and bind it to
 * `opts.material`, returning a ready-to-render {@link Mesh}. `size` is the
 * full edge length and defaults to `1`.
 *
 * The geometry is owned by this mesh; share via {@link cubeGeometry} +
 * `mesh.create` when one cube must back multiple meshes.
 */
export function cube(
  ctx: Context,
  opts: { material: Material; size?: number },
): Mesh {
  return create(ctx, {
    geometry: cubeGeometry(ctx, opts),
    material: opts.material,
  });
}
