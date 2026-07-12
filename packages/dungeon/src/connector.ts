// src/connector.ts — organic↔organic tunnel: its own field volume between two
// placed portals. Regions stay pure (params, seed) re-expansions; this unit is
// re-expanded at load from the same inputs (deterministic, local ops + rng only).
import { capsuleCavern, type Field } from "./field.ts";
import { voxelProxyPosition, voxelsFromField } from "./proxy.ts";
import {
  type Aabb,
  type Connection,
  GENERATOR_VERSION,
  type MaterialDescriptor,
  type RegionData,
  type Vec3,
} from "./region.ts";
import { type GridConfig, surfaceNets } from "./surface-nets.ts";

const CELL = 0.5; // grid cell size (m) — mirrors themes/cave.ts
const PROXY_VOXEL_Y = 0.25; // anisotropic-Y voxel height (< STEP_HEIGHT 0.4) — mirrors themes/cave.ts
// PERPENDICULAR-axis grid margin around the bore, in radii: one radius spans the capsule
// wall (the tube's half-extent off its axis is exactly the radius) plus one radius of rock
// shell so the tube is fully enclosed by rock that meshes and voxelizes. The BORE axis is
// deliberately NOT padded — it clips to the door planes so the capsule's rock end-caps stay
// outside the grid and are never baked into the caves' walkable air (see `tunnelGrid`).
const GRID_PAD_RADII = 2;

/** The same stone the caves this bore joins are cut from (themes/cave.ts). */
const ROCK_MATERIAL: MaterialDescriptor = {
  color: [0.5, 0.5, 0.52, 1],
  specular: [0.02, 0.02, 0.02, 8],
};

export type OrganicTunnelOpts = {
  /** Bore radius (m). Default sized to pass the door-standard opening. */
  radius?: number;
  /** How far the bore overshoots past each portal plane into the neighbour (m). */
  overshoot?: number;
};

// Bore radius. Sized to MATCH the cave bore it joins (themes/cave.ts TUNNEL_R = 1.6, "sized for
// capsule + step-up headroom"), NOT the narrower door-standard opening. The W1 world-traversal
// probe (tests/world-traversal.gpu.test.ts) proved why: a connector and the cave it joins each
// voxelize their own bore, and their proxies OVERLAP for several metres where the cave's mouth
// bore overshoots into the gap. In that overlap the capsule needs air in BOTH proxies, so the
// walkable cross-section collapses to the NARROWER of the two bores. At the old 0.95 the connector
// bore — barely taller than the 1.8 m capsule and, once voxelised on the 0.5 m lattice, shorter
// than it — pinched the capsule against the ceiling and wedged it at the seam, even though the
// cave (1.6) and the connector each walked fine in isolation. Matching the cave bore keeps the
// overlap intersection at the cave's proven width. (The seam still leans on two independently
// voxelised proxies co-existing; a shared-lattice / carve-union composition is the durable fix —
// tracked for the world/region charter.)
export const TUNNEL_RADIUS = 1.6;
export const TUNNEL_OVERSHOOT = 1.2;

/** The bore's own field volume plus the grid bounding it, derived from two WORLD-frame
 *  portals. Exported narrowly so tests can assert air-along-centerline / rock-at-corners in
 *  the field and vertex-containment in the grid without re-deriving the extension math —
 *  the builder consumes this same helper, so a test inspects the ACTUAL geometry, not a
 *  parallel copy of it. Deterministic in (a, b, opts): pure local vector ops. */
export function tunnelGeometry(
  a: Connection,
  b: Connection,
  opts: OrganicTunnelOpts = {},
): { field: Field; grid: GridConfig } {
  const radius = opts.radius ?? TUNNEL_RADIUS;
  const overshoot = opts.overshoot ?? TUNNEL_OVERSHOOT;
  // The FIELD spans the OVERSHOT endpoints — each portal centre pushed `overshoot` past its
  // plane along −facing, so the bore is full-radius through the door plane and its rounded
  // end-cap buries into the neighbour cave's own bore air (interpenetration seals the seam,
  // no CSG). The GRID, by contrast, clips to the door planes (see `tunnelGrid`) so those
  // caps fall outside it — the overshoot lives only in the field.
  const extendedA = extendEndpoint(a, radius, overshoot);
  const extendedB = extendEndpoint(b, radius, overshoot);
  const field = capsuleCavern(
    extendedA[0],
    extendedA[1],
    extendedA[2],
    extendedB[0],
    extendedB[1],
    extendedB[2],
    radius,
  );
  // The grid bounds the door-plane-to-door-plane bore: the raised (un-overshot) door centres,
  // clipped at the doors along the bore axis and padded on the two perpendicular axes.
  const grid = tunnelGrid(
    raisedCenter(a, radius),
    raisedCenter(b, radius),
    radius,
    boreAxis(a),
  );
  return { field, grid };
}

/** The portal centre lifted to bore-centerline height (threshold y + radius) so the bore
 *  FLOOR lands on the cave floor. XZ is the door centre itself (no overshoot). */
function raisedCenter(portal: Connection, radius: number): Vec3 {
  return [portal.position[0], portal.position[1] + radius, portal.position[2]];
}

/** One bore endpoint for the FIELD: the raised centre pushed `overshoot` past its portal
 *  plane along −facing (into the neighbour). Door facings are horizontal cardinals, so
 *  −facing shifts only XZ; the raise sets Y. */
function extendEndpoint(
  portal: Connection,
  radius: number,
  overshoot: number,
): Vec3 {
  const c = raisedCenter(portal, radius);
  return [
    c[0] - portal.facing[0] * overshoot,
    c[1],
    c[2] - portal.facing[2] * overshoot,
  ];
}

/** The bore's horizontal axis: the DOMINANT cardinal of the door facing (join-
 *  placed portals carry float dust in the near-zero component — `!== 0` would
 *  misread [6e-17, 0, -1] as an X bore; dominant-component is exact for clean
 *  cardinals and robust to dust). */
function boreAxis(portal: Connection): 0 | 2 {
  return Math.abs(portal.facing[0]) > Math.abs(portal.facing[2]) ? 0 : 2;
}

/** Grid box for the door-plane-to-door-plane bore, from the two raised (un-overshot) door
 *  centres. Along the BORE axis it clips to `[min door, max door]` with NO pad, so the
 *  capsule's rounded rock end-caps — which the FIELD overshoots ~`overshoot + radius` past
 *  each door — fall OUTSIDE the grid and are never meshed/voxelized: each tube end reads
 *  OPEN via voxelsFromField's off-grid-as-solid shell rule, exactly as `themes/cave.ts`
 *  buildGrid keeps its capsule cap outside the grid by bounding at the mouth. The two
 *  PERPENDICULAR axes (including Y) pad by `GRID_PAD_RADII × radius` to enclose the tube
 *  wall plus a rock shell. `grid.min` snaps DOWN to a `CELL` multiple (the lattice alignment
 *  voxelsFromField's shell rule relies on at the seam); `dims` covers min → high per axis. */
function tunnelGrid(
  rA: Vec3,
  rB: Vec3,
  radius: number,
  axis: 0 | 2,
): GridConfig {
  const pad = GRID_PAD_RADII * radius;
  const lo = (ax: 0 | 1 | 2): number =>
    Math.min(rA[ax], rB[ax]) - (ax === axis ? 0 : pad);
  const hi = (ax: 0 | 1 | 2): number =>
    Math.max(rA[ax], rB[ax]) + (ax === axis ? 0 : pad);
  const min: Vec3 = [
    Math.floor(lo(0) / CELL) * CELL,
    Math.floor(lo(1) / CELL) * CELL,
    Math.floor(lo(2) / CELL) * CELL,
  ];
  const dims: [number, number, number] = [
    Math.ceil((hi(0) - min[0]) / CELL),
    Math.ceil((hi(1) - min[1]) / CELL),
    Math.ceil((hi(2) - min[2]) / CELL),
  ];
  return { min, cellSize: CELL, dims };
}

/** World-space AABB of the connector's lattice-aligned grid. Connectors are ALWAYS emitted
 *  in the world frame (`origin` = [0,0,0], matching `voxelProxyPosition(grid, [0,0,0])`), so
 *  the grid's local extent `[grid.min, grid.min + dims·cellSize]` IS its world envelope — no
 *  origin offset. */
function gridBounds(grid: GridConfig): Aabb {
  return {
    min: [grid.min[0], grid.min[1], grid.min[2]],
    max: [
      grid.min[0] + grid.dims[0] * grid.cellSize,
      grid.min[1] + grid.dims[1] * grid.cellSize,
      grid.min[2] + grid.dims[2] * grid.cellSize,
    ],
  };
}

/** Build the tunnel's RegionData-shaped payload (connections empty — a connector
 *  presents no further portals) from two WORLD-frame portals. Deterministic in
 *  (a, b, seed, opts): a single air-positive capsule bore in a rock-by-construction grid,
 *  meshed via Surface-Nets and collided via the field-derived anisotropic-Y voxel proxy —
 *  no noise (a smooth, maximally-walkable bore). */
export function organicTunnel(
  a: Connection,
  b: Connection,
  seed: string,
  opts: OrganicTunnelOpts = {},
): RegionData {
  const { field, grid } = tunnelGeometry(a, b, opts);
  const mesh = surfaceNets(field, grid);
  const proxy = voxelsFromField(field, grid, [CELL, PROXY_VOXEL_Y, CELL]);
  const origin: Vec3 = [0, 0, 0];
  return {
    meshes: [{ geometry: { custom: mesh }, material: 0, position: origin }],
    colliders: [
      { shape: { voxels: proxy }, position: voxelProxyPosition(grid, origin) },
    ],
    materials: [ROCK_MATERIAL],
    connections: [],
    instances: [],
    origin,
    bounds: gridBounds(grid),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "connector",
      seed,
    },
  };
}
