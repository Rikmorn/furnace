import type { Context } from "../../gpu/index.ts";
import { create } from "../geometry.ts";
import { assertPositiveFinite } from "../geometry-validation.ts";
import type { Geometry, GeometryData } from "../types.ts";

const LONGITUDE_SEGMENTS = 32; // subdivisions around the Y (vertical) axis
const LATITUDE_RINGS = 16; // pole-to-pole bands
const DEFAULT_RADIUS = 0.5;
const TWO_PI = Math.PI * 2;

/**
 * Build the raw {@link GeometryData} for a UV (lat/long) sphere of `radius`,
 * centred at the origin. Fixed tessellation. The seam column is duplicated so
 * U is continuous; pole rows degenerate to triangles (standard UV sphere).
 * Exported for headless tests; not part of the public surface.
 */
export function sphereGeometryData(radius: number): GeometryData {
  const vertsPerRow = LONGITUDE_SEGMENTS + 1; // inclusive seam duplicate
  const rowCount = LATITUDE_RINGS + 1; // inclusive both poles
  const vertexCount = vertsPerRow * rowCount;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let lat = 0; lat <= LATITUDE_RINGS; lat++) {
    const theta = (lat / LATITUDE_RINGS) * Math.PI; // 0 (north) -> pi (south)
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let lon = 0; lon <= LONGITUDE_SEGMENTS; lon++) {
      const phi = (lon / LONGITUDE_SEGMENTS) * TWO_PI;
      const nx = sinTheta * Math.cos(phi);
      const ny = cosTheta;
      const nz = sinTheta * Math.sin(phi);
      const v = lat * vertsPerRow + lon;
      positions[v * 3 + 0] = nx * radius;
      positions[v * 3 + 1] = ny * radius;
      positions[v * 3 + 2] = nz * radius;
      normals[v * 3 + 0] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      uvs[v * 2 + 0] = lon / LONGITUDE_SEGMENTS;
      uvs[v * 2 + 1] = lat / LATITUDE_RINGS;
    }
  }

  return { positions, normals, uvs, indices: sphereIndices(vertsPerRow) };
}

function sphereIndices(vertsPerRow: number): Uint16Array {
  const indices = new Uint16Array(LATITUDE_RINGS * LONGITUDE_SEGMENTS * 6);
  let idx = 0;
  for (let lat = 0; lat < LATITUDE_RINGS; lat++) {
    for (let lon = 0; lon < LONGITUDE_SEGMENTS; lon++) {
      const a = lat * vertsPerRow + lon; // upper-left
      const b = a + 1; // upper-right
      const c = a + vertsPerRow; // lower-left
      const d = c + 1; // lower-right
      // Outward (CCW from outside): (a, b, c) + (b, d, c).
      indices[idx++] = a;
      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = b;
      indices[idx++] = d;
      indices[idx++] = c;
    }
  }
  return indices;
}

/**
 * Build a standalone UV-sphere {@link Geometry} centred at the origin
 * (latitude/longitude tessellation, outward unit normals, UVs in `[0,1]`,
 * CCW winding viewed from outside). `radius` defaults to `0.5` (unit
 * diameter). Tessellation is fixed at 32 longitude segments × 16 latitude rings.
 *
 * Pass to `mesh.create({ geometry, material })` to bind. The caller owns the
 * returned geometry — see `engine-conventions.md` §Resource ownership.
 *
 * @throws FurnaceError - if `radius` is not a finite number greater than `0`.
 */
export function sphere(ctx: Context, opts?: { radius?: number }): Geometry {
  const radius = opts?.radius ?? DEFAULT_RADIUS;
  assertPositiveFinite("radius", radius);
  return create(ctx, sphereGeometryData(radius));
}
