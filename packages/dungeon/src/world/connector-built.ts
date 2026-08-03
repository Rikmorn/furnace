// src/connector-built.ts — the three BUILT connector kinds (spec §4). All own
// their volume (D-W1-2 carried); all may MUTATE joined regions (D-W2-7):
//   aperture    → open-door on both end regions (pure mutation, no volume)
//   corridor    → own world-frame grid tube (+ fine-grid stairs, D-W2-8)
//                 + open-door on both ends
//   collar-bore → W1 organicTunnel bore + a CARVE on the built region
//                 (D-W2-4: one authoritative grid on the built side)
// Corridors are always axis-aligned between anti-parallel cardinal door
// portals (grid placements are quarter-turn-exact, D-W2-10).

import { voxelProxyPosition } from "../field/proxy.ts";
import type { CarveVolume } from "../substrate/carve.ts";
import { fineProxy } from "../substrate/collider.ts";
import {
  AIR,
  CELL,
  coarseSet,
  createCoarse,
  FINE,
  fineGridConfig,
  fineSet,
  MASONRY,
  rasterize,
  SUB,
} from "../substrate/grid.ts";
import { KIT_MATERIALS, PIECE_BOX } from "../substrate/pieces.ts";
import { bucket, skinGrid } from "../substrate/skin.ts";
import { organicTunnel, TUNNEL_OVERSHOOT, TUNNEL_RADIUS } from "./connector.ts";
import type { Connection, RegionData, Vec3 } from "./region.ts";
import { GENERATOR_VERSION } from "./region.ts";
import type { WorldPlacement } from "./world-spec.ts";

/** Default corridor length (m) when a derived placement needs one. */
export const CORRIDOR_DEFAULT_LENGTH = 6;
/** How far the collar-bore carve punches INTO the built region past the door
 *  plane (m): the 0.5 shell + proud pieces (0.06 panels / 0.14 collar) + margin.
 *  FLAT-ended (cylinder), so this is the TOTAL interior reach — at the gate-failed
 *  1.0 the old capsule's spherical end swept `radius` further and ate pillars. */
export const CARVE_DEPTH = 0.7;
/** How far the carve extends OUTWARD past the door plane (m): pushes the
 *  cylinder through the region's grid edge so the patch field's off-grid
 *  inside-the-carve rule reads the opening as continuing air (no lid). */
export const CARVE_OUTER = 0.5;
/** How far the collar-bore TUNNEL's grid extends past the door plane into the
 *  built shell band (m) = exactly the 0.5 wall: the tube wall renders through
 *  the wall thickness and buries into the carve patch (interpenetration seals
 *  the seam ring — the W1 mouth pattern applied to the built side). Exactly the
 *  shell and no more: in that band the tunnel's rock-outside-tube coincides
 *  with hall masonry (or the carved opening, whose cylinder radius equals the
 *  tube's on the same lattice), so no invisible collision and no W1-class
 *  pinch; one cell further would put tunnel rock inside interior room air. */
export const BORE_SHELL_EXTENSION = 0.5;
/** The proven riser height (m) = one FINE cell — the tread render box caps
 *  exactly `lift` fine cells of collision fill, so the riser MUST be FINE. */
export const STAIR_RISE = FINE;

/** A connector's effect on a joined region, applied at finalize (world-build). */
export type GridMutation =
  | { kind: "open-door"; regionId: string; portalIndex: number }
  | { kind: "carve"; regionId: string; volume: CarveVolume /* WORLD frame */ };

/** Inverse of a quarter-turn placement, exactly (integer sin/cos table — no
 *  trig calls, no dust): local = Ry(-yaw)·(world - t). */
export function worldToLocal(p: Vec3, placement: WorldPlacement): Vec3 {
  const q = ((Math.round(placement.yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const c = [1, 0, -1, 0][q] as number; // cos(yaw) for quarter q
  const s = [0, 1, 0, -1][q] as number; // sin(yaw)
  const t = placement.translation;
  const x = p[0] - t[0];
  const y = p[1] - t[1];
  const z = p[2] - t[2];
  // Ry(-yaw): [x·c - z·s, y, x·s + z·c]  (inverse of placement.ts rotateY)
  return [x * c - z * s, y, x * s + z * c];
}

/** Corridor tube between two placed, facing, door-class portals. World-frame
 *  grid (portals are cardinal + lattice-snapped → the tube is axis-aligned).
 *  ΔY ≠ 0 → a fine-grid staircase (one STAIR_RISE per CELL of run) + tread
 *  render instances. Throws if ΔY is not an exact riser multiple or the run
 *  cannot fit the riser count (setup-loud — bake-time validation). */
export function buildCorridor(
  a: Connection,
  b: Connection,
  seed: string,
): RegionData {
  const axis: 0 | 2 = Math.abs(a.facing[0]) > Math.abs(a.facing[2]) ? 0 : 2;
  const cross: 0 | 2 = axis === 0 ? 2 : 0;
  const low = a.position[1] <= b.position[1] ? a : b;
  const high = low === a ? b : a;
  const deltaY = high.position[1] - low.position[1];
  const risers = Math.round(deltaY / STAIR_RISE);
  if (Math.abs(risers * STAIR_RISE - deltaY) > 1e-6) {
    throw new Error(`corridor: ΔY ${deltaY} is not an exact riser multiple`);
  }
  const runCells = Math.round(
    Math.abs(b.position[axis] - a.position[axis]) / CELL,
  );
  // Full height is first reached at the run cell with fromLow === risers (the
  // bottom cell is pinned flush at lift 0), so the stair needs at least one MORE
  // run cell than risers or it tops out a riser short of the high door — a silent
  // lip AT the region seam. Require runCells > risers.
  if (risers >= runCells) {
    throw new Error(
      `corridor: ${risers} risers need more than ${runCells} run cells (a flush landing cell)`,
    );
  }
  // Interior: door standard 4 cells wide; height INTERIOR_HEIGHT_CELLS above the
  // HIGHEST floor point → vertical interior = that + ceil(risers·RISE / CELL).
  const wCells = 4;
  const INTERIOR_HEIGHT_CELLS = 6; // 3.0 m clear above the top landing (door height)
  const hCells =
    INTERIOR_HEIGHT_CELLS + Math.ceil((risers * STAIR_RISE) / CELL);
  const dims: [number, number, number] = [0, hCells + 2, 0];
  dims[axis] = runCells; // OPEN ends: no shell cells along the bore axis
  dims[cross] = wCells + 2;
  const min: Vec3 = [0, low.position[1] - CELL, 0];
  min[axis] = Math.min(a.position[axis], b.position[axis]);
  min[cross] = a.position[cross] - (wCells / 2 + 1) * CELL;
  const g = createCoarse(min, dims, MASONRY);
  const interior = (run: number, up: number, side: number): void => {
    const c: [number, number, number] = [0, up, 0];
    c[axis] = run;
    c[cross] = side;
    coarseSet(g, c[0], c[1], c[2], AIR);
  };
  for (let run = 0; run < dims[axis]; run++)
    for (let up = 1; up <= hCells; up++)
      for (let side = 1; side <= wCells; side++) interior(run, up, side);
  const fine = rasterize(g);
  // Staircase: run cell r (counted from the LOW end) gains a solid fine fill up
  // to riserFor(r)·STAIR_RISE above the low floor. Risers spread from the low
  // end; remaining run stays at the top level (a landing before the high door).
  const lowIsMinSide = low.position[axis] <= high.position[axis];
  const riserFor = (r: number): number => Math.min(risers, r);
  const emits: Parameters<typeof bucket>[0] = [];
  for (let run = 0; run < dims[axis]; run++) {
    const fromLow = lowIsMinSide ? run : dims[axis] - 1 - run;
    const lift = riserFor(fromLow);
    if (lift === 0) continue;
    fillColumn(fine, axis, cross, run, wCells, lift);
    emits.push(treadEmit(g.min, axis, cross, run, wCells, lift));
  }
  const doors = [] as Parameters<typeof skinGrid>[1];
  const instances = [
    ...skinGrid(g, doors, seed),
    ...(emits.length > 0 ? bucket(emits) : []),
  ];
  const proxy = fineProxy(fine);
  const cfg = fineGridConfig(fine);
  return {
    meshes: [],
    colliders: [
      {
        shape: { voxels: proxy },
        position: voxelProxyPosition(cfg, [0, 0, 0]),
      },
    ],
    materials: KIT_MATERIALS,
    connections: [],
    instances,
    origin: [0, 0, 0],
    bounds: {
      min: [...g.min] as Vec3,
      max: [
        g.min[0] + dims[0] * CELL,
        g.min[1] + dims[1] * CELL,
        g.min[2] + dims[2] * CELL,
      ],
    },
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "connector",
      seed,
    },
  };
}

/** Solid fine cells from the floor top up `lift` risers across one run cell. */
function fillColumn(
  fine: ReturnType<typeof rasterize>,
  axis: 0 | 2,
  cross: 0 | 2,
  run: number,
  wCells: number,
  lift: number,
): void {
  // Fine indices: floor top is coarse j=1's bottom → fine j = SUB.
  for (let dj = 0; dj < lift; dj++)
    for (let side = SUB; side < (wCells + 1) * SUB; side++)
      for (let da = 0; da < SUB; da++) {
        const c: [number, number, number] = [0, SUB + dj, 0];
        c[axis === 0 ? 0 : 2] = run * SUB + da;
        c[cross === 0 ? 0 : 2] = side;
        fineSet(fine, c[0], c[1], c[2], 1);
      }
}

/** One tread render box capping a lifted run cell (top surface of the fill). */
function treadEmit(
  min: Vec3,
  axis: 0 | 2,
  cross: 0 | 2,
  run: number,
  wCells: number,
  lift: number,
): { piece: "tread"; pos: Vec3; yaw: number; mat: number; v: number } {
  // Lower the tread centre by half its box height so its TOP surface caps the
  // fill top (min[1] + CELL + lift·STAIR_RISE) exactly — render sits on collision.
  const treadHalfHeight = PIECE_BOX.tread[1] / 2;
  const pos: Vec3 = [0, min[1] + CELL + lift * STAIR_RISE - treadHalfHeight, 0];
  pos[axis] = min[axis] + (run + 0.5) * CELL;
  pos[cross] = min[cross] + ((wCells + 2) / 2) * CELL;
  return {
    piece: "tread",
    pos,
    // Seat the tread's local +X (run, 0.5) along the bore/travel axis and its
    // local +Z (door width, 2.0) ACROSS the corridor: an X-bore needs no yaw; a
    // Z-bore rotates a quarter-turn so the 2.0 width lands on world-X.
    yaw: axis === 0 ? 0 : Math.PI / 2,
    mat: 1,
    v: 0.5,
  };
}

/** The world-frame carve a collar-bore punches into the built region's fine grid: a
 *  FLAT-ended CYLINDER centred `radius` above the door threshold, spanning from
 *  `CARVE_OUTER` past the door plane (through the region's grid edge, so the patch
 *  field's off-grid rule keeps the opening open — no manufactured lid) to `CARVE_DEPTH`
 *  inward (just past the 0.5 shell + proud pieces — flat end, so it cannot sweep
 *  `radius` into the room and eat pillars/floor the way the gate-failed capsule did).
 *  `clipBelowY` at the threshold keeps the floor un-grooved. Depends ONLY on the door
 *  portal + radius (NOT the mouth or seed), so bake (world-build finalize) and load
 *  (world-loader re-expand) compute the IDENTICAL carve from the same door portal +
 *  radius and cannot drift — the W2 byte-determinism contract. `collarBore` builds its
 *  tunnel then calls this. */
export function collarBoreCarve(
  doorPortal: Connection,
  opts: { radius?: number } = {},
): CarveVolume {
  const radius = opts.radius ?? TUNNEL_RADIUS;
  const centre: Vec3 = [
    doorPortal.position[0],
    doorPortal.position[1] + radius,
    doorPortal.position[2],
  ];
  const outward: Vec3 = [
    centre[0] + doorPortal.facing[0] * CARVE_OUTER,
    centre[1],
    centre[2] + doorPortal.facing[2] * CARVE_OUTER,
  ];
  const inward: Vec3 = [
    centre[0] - doorPortal.facing[0] * CARVE_DEPTH,
    centre[1],
    centre[2] - doorPortal.facing[2] * CARVE_DEPTH,
  ];
  return {
    kind: "cylinder",
    a: outward,
    b: inward,
    radius,
    clipBelowY: doorPortal.position[1],
  };
}

/** A carve volume transformed into a region's LOCAL frame (exact for the
 *  quarter-turn placements grid regions allow). Single source for BOTH
 *  localization sites (bake finalize + loader re-expand): yaw is about +Y and
 *  translation is subtracted, so the Y-clip translates by −t[1]. */
export function carveToLocal(
  v: CarveVolume,
  placement: WorldPlacement,
): CarveVolume {
  const a = worldToLocal(v.a, placement);
  const b = worldToLocal(v.b, placement);
  if (v.kind === "cylinder" && v.clipBelowY !== undefined) {
    return { ...v, a, b, clipBelowY: v.clipBelowY - placement.translation[1] };
  }
  return { ...v, a, b };
}

/** Built↔organic (D-W2-4): the W1 bore between the door and the mouth (floor
 *  flush at the door threshold via organicTunnel's raisedCenter) PLUS the
 *  world-frame carve capsule that opens the built region's fine grid — the
 *  carve IS the opening (no door stamp; the collar frames the cut). The carve is
 *  single-sourced with the loader via {@link collarBoreCarve}. */
export function collarBore(
  doorPortal: Connection,
  mouth: Connection,
  seed: string,
  opts: { radius?: number; overshoot?: number } = {},
): { tunnel: RegionData; carve: CarveVolume } {
  const radius = opts.radius ?? TUNNEL_RADIUS;
  const overshoot = opts.overshoot ?? TUNNEL_OVERSHOOT;
  const tunnel = organicTunnel(doorPortal, mouth, seed, {
    radius,
    overshoot,
    extendA: BORE_SHELL_EXTENSION,
  });
  return { tunnel, carve: collarBoreCarve(doorPortal, { radius }) };
}
