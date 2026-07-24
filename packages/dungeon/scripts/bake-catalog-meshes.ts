// packages/dungeon/scripts/bake-catalog-meshes.ts — archetype mesh bake (F3b
// Task 7). Run by hand from the repo root:
//
//   bun packages/dungeon/scripts/bake-catalog-meshes.ts
//
// Generates the unit-sized `.fmesh` render blobs the catalog (catalog/entities.json)
// references, writing them to catalog/meshes/. These are COMMITTED project assets
// (not worlds/ user scratch). This is an INTERNAL script — it does not ship, so
// Bun/Node APIs are free and the Pr-2 "forbidden float math" rules do NOT apply.
// Determinism here is a nicety, not a contract (the baked FILE is canonical): the
// generators use fixed seeds so the snapshot test — bake twice → identical bytes —
// holds.
//
// Two archetypes:
//   • rock       — a cube-sphere (subdivided cube normalized to a sphere) displaced
//                  per-vertex by fBm value noise; 3 variants.
//   • stalagmite — tapered stacked cone rings with radial noise jitter, base at
//                  y=0, unit height; 2 variants.
// Both fit in ±0.5 (rock) / [0,1] height (stalagmite) — instance scale does the
// real sizing. Smooth normals are recomputed area-weighted from the welded topology.

import { resolve } from "node:path";
import { encodeMeshBlob, type MeshBlob } from "@furnace/core/scene";

type RenderBlock = MeshBlob["render"];
type V3 = [number, number, number];
type Tri = [number, number, number];
type Vtx = { pos: V3; uv: [number, number] };

// ─── vec helpers (tuples — indices are `number`, no noUncheckedIndexedAccess widening) ───
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
function normalize(v: V3): V3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return len > 1e-12 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
}

// ─── integer-hash value noise (mirrors core/field/cave.ts latticeValue; smooth
//     lumps because it is sampled at world position, so neighbours displace
//     coherently). No Pr-2 constraint here — this is a Node-side bake. ───
const NOISE_MIX = 0x2545f491;
function latticeValue(
  xi: number,
  yi: number,
  zi: number,
  seed: number,
): number {
  let h =
    (Math.imul(xi, 73856093) ^
      Math.imul(yi, 19349663) ^
      Math.imul(zi, 83492791) ^
      (seed | 0)) |
    0;
  h = Math.imul(h ^ (h >>> 15), NOISE_MIX) | 0;
  h = (h ^ (h >>> 13)) | 0;
  return ((h >>> 9) / 0x7f_ff_ff) * 2 - 1; // 23-bit → [0,1] → [-1,1]
}
const smoothstep01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smoothstep01(x - xi);
  const ty = smoothstep01(y - yi);
  const tz = smoothstep01(z - zi);
  const c = (dx: number, dy: number, dz: number): number =>
    latticeValue(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), tx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), tx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), tx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}
/** Two-octave fBm in ≈[-1, 1]. */
function fbm(p: V3, seed: number): number {
  const a = valueNoise(p[0], p[1], p[2], seed);
  const b = valueNoise(p[0] * 2, p[1] * 2, p[2] * 2, seed ^ 0x9e3779b9);
  return a * 0.667 + b * 0.333;
}

/** Recomputes area-weighted smooth normals from the welded topology and flattens
 *  to a {@link RenderBlock}. The un-normalized face cross product has magnitude
 *  2·area, so summing it into each vertex IS the area weighting. */
function finalizeMesh(verts: Vtx[], tris: Tri[]): RenderBlock {
  const acc: V3[] = verts.map(() => [0, 0, 0]);
  for (const [ia, ib, ic] of tris) {
    const va = verts[ia];
    const vb = verts[ib];
    const vc = verts[ic];
    if (!va || !vb || !vc) continue;
    const fn = cross(sub(vb.pos, va.pos), sub(vc.pos, va.pos));
    for (const idx of [ia, ib, ic]) {
      const n = acc[idx];
      if (!n) continue;
      n[0] += fn[0];
      n[1] += fn[1];
      n[2] += fn[2];
    }
  }
  const positions = new Float32Array(verts.length * 3);
  const normals = new Float32Array(verts.length * 3);
  const uvs = new Float32Array(verts.length * 2);
  verts.forEach((v, i) => {
    positions.set(v.pos, i * 3);
    normals.set(normalize(acc[i] ?? [0, 1, 0]), i * 3);
    uvs.set(v.uv, i * 2);
  });
  return { positions, normals, uvs, indices: new Uint32Array(tris.flat()) };
}

// ─── rock: displaced cube-sphere ───
const ROCK_RES = 8; // grid cells per cube-face edge
const ROCK_BASE = 0.4; // base sphere radius (metres)
const ROCK_AMP = 0.08; // ± displacement → extent ∈ [0.32, 0.48] < 0.5
const ROCK_FREQ = 2.6; // noise frequency over the unit sphere
const ROCK_SEED_BASE = 0x52_4f_43_4b; // "ROCK"

// Face basis (normal, tangent, bitangent) — the cube.ts convention; tangent ×
// bitangent = normal, so a face grid welds seamlessly with its neighbours.
const CUBE_FACES: { normal: V3; tangent: V3; bitangent: V3 }[] = [
  { normal: [0, 0, 1], tangent: [1, 0, 0], bitangent: [0, 1, 0] },
  { normal: [0, 0, -1], tangent: [-1, 0, 0], bitangent: [0, 1, 0] },
  { normal: [0, 1, 0], tangent: [1, 0, 0], bitangent: [0, 0, -1] },
  { normal: [0, -1, 0], tangent: [1, 0, 0], bitangent: [0, 0, 1] },
  { normal: [1, 0, 0], tangent: [0, 0, -1], bitangent: [0, 1, 0] },
  { normal: [-1, 0, 0], tangent: [0, 0, 1], bitangent: [0, 1, 0] },
];

const quantKey = (p: V3): string =>
  `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;

function buildRock(seed: number): RenderBlock {
  // Weld shared cube-edge vertices across faces by quantized cube position, so
  // displacement (a function of direction) is seam-free and normals stay smooth.
  const byKey = new Map<string, number>();
  const dirs: V3[] = [];
  const uvs: [number, number][] = [];
  const tris: Tri[] = [];

  for (const face of CUBE_FACES) {
    const grid: number[][] = [];
    for (let j = 0; j <= ROCK_RES; j++) {
      const row: number[] = [];
      for (let i = 0; i <= ROCK_RES; i++) {
        const u = (i / ROCK_RES) * 2 - 1;
        const v = (j / ROCK_RES) * 2 - 1;
        const cubePos: V3 = [
          face.normal[0] + face.tangent[0] * u + face.bitangent[0] * v,
          face.normal[1] + face.tangent[1] * u + face.bitangent[1] * v,
          face.normal[2] + face.tangent[2] * u + face.bitangent[2] * v,
        ];
        const key = quantKey(cubePos);
        let idx = byKey.get(key);
        if (idx === undefined) {
          idx = dirs.length;
          byKey.set(key, idx);
          const dir = normalize(cubePos);
          dirs.push(dir);
          uvs.push([dir[0] * 0.5 + 0.5, dir[2] * 0.5 + 0.5]);
        }
        row.push(idx);
      }
      grid.push(row);
    }
    for (let j = 0; j < ROCK_RES; j++) {
      for (let i = 0; i < ROCK_RES; i++) {
        const a = grid[j]?.[i];
        const b = grid[j]?.[i + 1];
        const c = grid[j + 1]?.[i + 1];
        const d = grid[j + 1]?.[i];
        if (
          a === undefined ||
          b === undefined ||
          c === undefined ||
          d === undefined
        )
          continue;
        tris.push([a, b, c], [a, c, d]); // CCW viewed from outside
      }
    }
  }

  const verts: Vtx[] = dirs.map((dir, i) => {
    const radius = ROCK_BASE + ROCK_AMP * fbm(scale3(dir, ROCK_FREQ), seed);
    return { pos: scale3(dir, radius), uv: uvs[i] ?? [0, 0] };
  });
  return finalizeMesh(verts, tris);
}

// ─── stalagmite: tapered stacked cone rings ───
const STAL_RINGS = 12; // vertical levels (ring k at y = k / STAL_RINGS)
const STAL_SEG = 12; // segments around
const STAL_BASE_R = 0.24; // base radius (metres) — with jitter stays < 0.5
const STAL_TAPER = 1.5; // radius = base · (1 - y)^taper
const STAL_AMP = 0.14; // radial noise jitter fraction
const STAL_FREQ = 2.4; // noise frequency
const STAL_SEED_BASE = 0x53_54_41_4c; // "STAL"

function buildStalagmite(seed: number): RenderBlock {
  const verts: Vtx[] = [];
  const tris: Tri[] = [];
  // ring[k][s] = vertex index; rings 0..STAL_RINGS-1, then a single apex.
  const ring: number[][] = [];
  for (let k = 0; k < STAL_RINGS; k++) {
    const y = k / STAL_RINGS;
    const taper = (1 - y) ** STAL_TAPER;
    const row: number[] = [];
    for (let s = 0; s < STAL_SEG; s++) {
      const ang = (s / STAL_SEG) * Math.PI * 2;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      // Sample noise on the (periodic) ring circle so the seam at s=0 is smooth.
      const jitter =
        1 +
        STAL_AMP * fbm([cos * STAL_FREQ, y * STAL_FREQ, sin * STAL_FREQ], seed);
      const r = STAL_BASE_R * taper * jitter;
      row.push(verts.length);
      verts.push({ pos: [r * cos, y, r * sin], uv: [s / STAL_SEG, y] });
    }
    ring.push(row);
  }
  const apex = verts.length;
  verts.push({ pos: [0, 1, 0], uv: [0, 1] });
  const baseCenter = verts.length;
  verts.push({ pos: [0, 0, 0], uv: [0.5, 0.5] });

  const at = (k: number, s: number): number => ring[k]?.[s % STAL_SEG] ?? 0;
  // Side quads (outward winding — see the geometry note in the plan).
  for (let k = 0; k < STAL_RINGS - 1; k++)
    for (let s = 0; s < STAL_SEG; s++) {
      const a = at(k, s);
      const b = at(k + 1, s);
      const c = at(k + 1, s + 1);
      const d = at(k, s + 1);
      tris.push([a, b, c], [a, c, d]);
    }
  // Top ring → apex.
  for (let s = 0; s < STAL_SEG; s++)
    tris.push([at(STAL_RINGS - 1, s), apex, at(STAL_RINGS - 1, s + 1)]);
  // Base cap (normal points down).
  for (let s = 0; s < STAL_SEG; s++)
    tris.push([baseCenter, at(0, s), at(0, s + 1)]);

  return finalizeMesh(verts, tris);
}

/** The catalog mesh set: 3 rock variants + 2 stalagmite variants, per-variant
 *  seeds. `name` is the `.fmesh` basename the catalog references. */
export const CATALOG_MESHES: { name: string; build: () => RenderBlock }[] = [
  { name: "rock.0", build: () => buildRock(ROCK_SEED_BASE + 0) },
  { name: "rock.1", build: () => buildRock(ROCK_SEED_BASE + 1) },
  { name: "rock.2", build: () => buildRock(ROCK_SEED_BASE + 2) },
  { name: "stalagmite.0", build: () => buildStalagmite(STAL_SEED_BASE + 0) },
  { name: "stalagmite.1", build: () => buildStalagmite(STAL_SEED_BASE + 1) },
];

/** Bakes every catalog mesh to its `.fmesh` blob bytes (pure — no I/O). The
 *  determinism the snapshot test rests on lives here: same seeds → same bytes. */
export function bakeCatalogMeshes(): { name: string; bytes: Uint8Array }[] {
  return CATALOG_MESHES.map((m) => ({
    name: m.name,
    bytes: new Uint8Array(encodeMeshBlob({ render: m.build() })),
  }));
}

if (import.meta.main) {
  const outDir = resolve(import.meta.dir, "../catalog/meshes");
  for (const m of bakeCatalogMeshes()) {
    const path = resolve(outDir, `${m.name}.fmesh`);
    await Bun.write(path, m.bytes);
    console.log(`baked ${m.name}.fmesh (${m.bytes.byteLength} bytes)`);
  }
}
