import type { Context } from "../../gpu/index.ts";
import { create } from "../geometry.ts";
import { assertPositiveFinite } from "../geometry-validation.ts";
import type { Geometry, GeometryData } from "../types.ts";

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
 * Pass to `mesh.create({ geometry, material })` to bind. The caller owns
 * the returned geometry — see `engine-conventions.md` §Resource ownership.
 *
 * @throws FurnaceError - if `size` is not a finite number greater than `0`.
 */
export function cube(ctx: Context, opts?: { size?: number }): Geometry {
  const size = opts?.size ?? 1;
  assertPositiveFinite("size", size);
  return create(ctx, cubeGeometryData(size));
}
