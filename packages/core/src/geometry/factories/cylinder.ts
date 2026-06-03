import type { Context } from "../../gpu/index.ts";
import { create } from "../geometry.ts";
import { assertPositiveFinite } from "../geometry-validation.ts";
import type { Geometry, GeometryData } from "../types.ts";

const RADIAL_SEGMENTS = 32; // subdivisions around the barrel
const DEFAULT_RADIUS = 0.5;
const DEFAULT_HEIGHT = 1;
const TWO_PI = Math.PI * 2;

/**
 * Build the raw {@link GeometryData} for a Y-axis cylinder of `radius` /
 * `height`, centred at the origin (spans `[-height/2, +height/2]`), capped
 * both ends. Barrel uses radial outward normals with a duplicated UV seam;
 * caps are triangle fans with ±Y normals. Exported for headless tests; not
 * part of the public surface.
 */
export function cylinderGeometryData(
  radius: number,
  height: number,
): GeometryData {
  const halfH = height / 2;
  const ringCount = RADIAL_SEGMENTS + 1; // inclusive seam duplicate (barrel)
  const barrelVerts = ringCount * 2;
  const capVerts = 1 + RADIAL_SEGMENTS; // centre + ring (fan, no seam dup)
  const vertexCount = barrelVerts + capVerts * 2;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  // --- Barrel: top/bottom vertex pairs around the seam-inclusive ring. ---
  for (let s = 0; s <= RADIAL_SEGMENTS; s++) {
    const phi = (s / RADIAL_SEGMENTS) * TWO_PI;
    const cx = Math.cos(phi);
    const cz = Math.sin(phi);
    const top = s * 2;
    const bot = top + 1;
    writeVertex(
      positions,
      normals,
      uvs,
      top,
      radius * cx,
      halfH,
      radius * cz,
      cx,
      0,
      cz,
      s / RADIAL_SEGMENTS,
      1,
    );
    writeVertex(
      positions,
      normals,
      uvs,
      bot,
      radius * cx,
      -halfH,
      radius * cz,
      cx,
      0,
      cz,
      s / RADIAL_SEGMENTS,
      0,
    );
  }

  // --- Caps: centre + distinct ring (no seam dup; the fan wraps). ---
  const topCentre = barrelVerts;
  const topRing = topCentre + 1;
  const botCentre = topRing + RADIAL_SEGMENTS;
  const botRing = botCentre + 1;
  writeVertex(
    positions,
    normals,
    uvs,
    topCentre,
    0,
    halfH,
    0,
    0,
    1,
    0,
    0.5,
    0.5,
  );
  writeVertex(
    positions,
    normals,
    uvs,
    botCentre,
    0,
    -halfH,
    0,
    0,
    -1,
    0,
    0.5,
    0.5,
  );
  for (let s = 0; s < RADIAL_SEGMENTS; s++) {
    const phi = (s / RADIAL_SEGMENTS) * TWO_PI;
    const cx = Math.cos(phi);
    const cz = Math.sin(phi);
    const u = 0.5 + 0.5 * cx;
    const v = 0.5 + 0.5 * cz;
    writeVertex(
      positions,
      normals,
      uvs,
      topRing + s,
      radius * cx,
      halfH,
      radius * cz,
      0,
      1,
      0,
      u,
      v,
    );
    writeVertex(
      positions,
      normals,
      uvs,
      botRing + s,
      radius * cx,
      -halfH,
      radius * cz,
      0,
      -1,
      0,
      u,
      v,
    );
  }

  const indices = cylinderIndices(topCentre, topRing, botCentre, botRing);
  return { positions, normals, uvs, indices };
}

// biome-ignore format: deliberate column alignment for packed hot-loop params
function writeVertex(
  positions: Float32Array,
  normals:   Float32Array,
  uvs:       Float32Array,
  vi:        number,
  px: number, py: number, pz: number,
  nx: number, ny: number, nz: number,
  u:  number, v:  number,
): void {
  positions[vi * 3 + 0] = px;
  positions[vi * 3 + 1] = py;
  positions[vi * 3 + 2] = pz;
  normals[vi * 3 + 0] = nx;
  normals[vi * 3 + 1] = ny;
  normals[vi * 3 + 2] = nz;
  uvs[vi * 2 + 0] = u;
  uvs[vi * 2 + 1] = v;
}

function cylinderIndices(
  topCentre: number,
  topRing: number,
  botCentre: number,
  botRing: number,
): Uint16Array {
  const indices = new Uint16Array(
    RADIAL_SEGMENTS * 6 + RADIAL_SEGMENTS * 3 * 2,
  );
  let idx = 0;
  // Barrel: paired top/bottom verts at index s*2 / s*2+1. Outward = +radial.
  for (let s = 0; s < RADIAL_SEGMENTS; s++) {
    const topA = s * 2;
    const botA = topA + 1;
    const topB = (s + 1) * 2;
    const botB = topB + 1;
    indices[idx++] = topA;
    indices[idx++] = topB;
    indices[idx++] = botA;
    indices[idx++] = topB;
    indices[idx++] = botB;
    indices[idx++] = botA;
  }
  // Top cap fan (outward +Y): (centre, ring[next], ring[s]).
  for (let s = 0; s < RADIAL_SEGMENTS; s++) {
    const next = (s + 1) % RADIAL_SEGMENTS;
    indices[idx++] = topCentre;
    indices[idx++] = topRing + next;
    indices[idx++] = topRing + s;
  }
  // Bottom cap fan (outward -Y): (centre, ring[s], ring[next]).
  for (let s = 0; s < RADIAL_SEGMENTS; s++) {
    const next = (s + 1) % RADIAL_SEGMENTS;
    indices[idx++] = botCentre;
    indices[idx++] = botRing + s;
    indices[idx++] = botRing + next;
  }
  return indices;
}

/**
 * Build a standalone Y-axis cylinder {@link Geometry} centred at the origin
 * (spans `[-height/2, +height/2]`), capped both ends, with outward unit
 * normals, UVs in `[0,1]`, and CCW winding viewed from outside. `radius`
 * defaults to `0.5`, `height` to `1`. Tessellation is fixed at 32 radial
 * segments.
 *
 * Pass to `mesh.create({ geometry, material })` to bind. The caller owns the
 * returned geometry — see `engine-conventions.md` §Resource ownership.
 *
 * @throws FurnaceError - if `radius` or `height` is not a finite number
 *   greater than `0`.
 */
export function cylinder(
  ctx: Context,
  opts?: { radius?: number; height?: number },
): Geometry {
  const radius = opts?.radius ?? DEFAULT_RADIUS;
  const height = opts?.height ?? DEFAULT_HEIGHT;
  assertPositiveFinite("radius", radius);
  assertPositiveFinite("height", height);
  return create(ctx, cylinderGeometryData(radius, height));
}
