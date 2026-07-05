// packages/dungeon/src/dogleg.ts
// Dogleg closure for cycle-closing edges: `straight connector → corner room-let →
// straight connector`. No bent-tube geometry anywhere — the corner is a tiny flat box
// ROOM (box-room wall construction, two door-class portals, standard threshold plates
// via route's ends), so seam discipline is the proven room↔connector case.
import type { Rng } from "@furnace/core/rng";
import {
  type ConnectorKind,
  minWalkableRun,
  type Placement,
  placePiece,
  route,
} from "./connect.ts";
import { FACING_MIN, MAX_BEARING_OFF, pairFeasible } from "./locus.ts";
import type { Connection, RegionData, Vec3 } from "./region.ts";
import { GENERATOR_VERSION } from "./region.ts";
import { boxRoom, type DoorSpec, type Side } from "./themes/box-room.ts";

const CORNER_WALL_T = 0.3;
const CORNER_FLOOR_T = 0.3;
const CORNER_MARGIN = 0.5; // inner clearance beyond the widest doorway — GATE-TUNE
/** Each straight segment's minimum run (m). GATE-TUNE. Exported: the placement engine
 *  samples corner candidates over `[MIN_SEG_RUN, edge-length-upper]`, so geometry and the
 *  placer's search window share one floor. */
export const MIN_SEG_RUN = 1.5;

/** One viable corner seating: predicted world door portals (centre of each wall face),
 *  the room placement that realizes them, and segment B's walkable-run floor. */
export type CornerCandidate = {
  door1: Connection; // receives segment A (faces back toward `a`)
  door2: Connection; // launches segment B (faces toward `b`)
  place: Placement;
  side2: Side;
  size: number; // square inner width
  minRunB: number;
};

/** Local outward facings per side (box-room convention). */
const SIDE_FACING: Record<Side, Vec3> = {
  N: [0, 0, 1],
  S: [0, 0, -1],
  E: [1, 0, 0],
  W: [-1, 0, 0],
};

const heading = (v: Vec3): number => Math.atan2(-v[2], v[0]);
const bear = (f: Vec3, off: number): Vec3 => {
  const c = Math.cos(off);
  const s = Math.sin(off);
  return [f[0] * c + f[2] * s, 0, -f[0] * s + f[2] * c];
};
const rotY = (v: Vec3, yaw: number): Vec3 => bear(v, yaw);

/** Seeded corner-position candidates for a dogleg a→b: sample the annulus reachable
 *  from `a` (bearing ±MAX_BEARING_OFF, run within segment-A limits), keep corners whose
 *  predicted door portals make BOTH segments cone+range feasible, with the full height
 *  delta (and its arrival landing) carried by segment B. Corner floor sits at `a`'s
 *  level — the descent lands at `b` through route's own landing rule. */
export function cornerCandidates(
  a: Connection,
  b: Connection,
  segRange: [number, number],
  rng: Rng,
  n: number,
): CornerCandidate[] {
  const dh = b.position[1] - a.position[1];
  const kindB: ConnectorKind | undefined = undefined; // auto (chooseKind per segment)
  const minRunB = Math.max(minWalkableRun(dh, kindB), MIN_SEG_RUN);
  const size = Math.max(a.width, b.width) + 2 * CORNER_MARGIN;
  const out: CornerCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const off =
      -MAX_BEARING_OFF + ((i % 6) + rng.float()) * ((2 * MAX_BEARING_OFF) / 6);
    const runA =
      Math.max(segRange[0], MIN_SEG_RUN) +
      rng.float() * (segRange[1] - Math.max(segRange[0], MIN_SEG_RUN));
    const dirA = bear(a.facing, off);
    // Corner CENTRE sits half-a-room past the door-1 wall along dirA.
    const d1: Vec3 = [
      a.position[0] + dirA[0] * runA,
      a.position[1],
      a.position[2] + dirA[2] * runA,
    ];
    const centre: Vec3 = [
      d1[0] + dirA[0] * (size / 2 + CORNER_WALL_T / 2),
      a.position[1],
      d1[2] + dirA[2] * (size / 2 + CORNER_WALL_T / 2),
    ];
    // Room yaw: door 1 lives on side S (local facing [0,0,-1]) and must face −dirA.
    const yaw = heading([-dirA[0], 0, -dirA[2]]) - heading(SIDE_FACING.S);
    // Door 2: pick the remaining side whose world facing is nearest the bearing to b.
    const toB: Vec3 = [b.position[0] - centre[0], 0, b.position[2] - centre[2]];
    const runB = Math.hypot(toB[0], toB[2]) - (size / 2 + CORNER_WALL_T / 2);
    if (runB < minRunB || runB > segRange[1]) continue;
    const dirB: Vec3 = [
      toB[0] / Math.hypot(toB[0], toB[2]),
      0,
      toB[2] / Math.hypot(toB[0], toB[2]),
    ];
    let side2: Side | null = null;
    let best = -Infinity;
    for (const s of ["N", "E", "W"] as Side[]) {
      const wf = rotY(SIDE_FACING[s], yaw);
      const dot = wf[0] * dirB[0] + wf[2] * dirB[2];
      if (dot > best) {
        best = dot;
        side2 = s;
      }
    }
    if (side2 === null || best < FACING_MIN) continue;
    const wf2 = rotY(SIDE_FACING[side2], yaw);
    const d2: Vec3 = [
      centre[0] + wf2[0] * (size / 2 + CORNER_WALL_T / 2),
      a.position[1],
      centre[2] + wf2[2] * (size / 2 + CORNER_WALL_T / 2),
    ];
    const door1: Connection = {
      position: d1,
      facing: [-dirA[0], 0, -dirA[2]],
      width: a.width,
      height: a.height,
      kind: "door",
    };
    const door2: Connection = {
      position: d2,
      facing: wf2,
      width: b.width,
      height: b.height,
      kind: "door",
    };
    if (!pairFeasible(a, door1, [MIN_SEG_RUN, segRange[1]])) continue;
    if (!pairFeasible(door2, b, [minRunB, segRange[1]])) continue;
    out.push({
      door1,
      door2,
      place: { yaw, translation: [centre[0], a.position[1], centre[2]] },
      side2,
      size,
      minRunB,
    });
  }
  return out;
}

/** The three dogleg pieces plus the corner's LOCAL (pre-placement) region, which the
 *  placement engine needs for the EXACT corner envelope (`envelopeObbs`) — the placed
 *  corner only carries its conservative rotated-AABB `bounds`. */
export type Dogleg = {
  corner: RegionData;
  segA: RegionData;
  segB: RegionData;
  cornerLocal: RegionData;
};

/** Assemble the three dogleg pieces for one accepted corner candidate. The corner is a
 *  real (placer-owned) room: box-room walls/floor/ceiling, two doors, connector-family
 *  provenance — realization treats it like any connector piece. */
export function buildDogleg(
  a: Connection,
  b: Connection,
  c: CornerCandidate,
  opts: { enclosure?: "open" },
): Dogleg {
  const headroom = Math.max(a.height, b.height);
  const doors: DoorSpec[] = [
    { side: "S", offset: 0, width: a.width, height: a.height },
    { side: c.side2, offset: 0, width: b.width, height: b.height },
  ];
  const room = boxRoom(
    {
      width: c.size,
      depth: c.size,
      height: headroom + 0.4,
      wallThick: CORNER_WALL_T,
      floorThick: CORNER_FLOOR_T,
      doors,
    },
    [],
  );
  const cornerLocal: RegionData = {
    meshes: room.meshes,
    colliders: room.colliders,
    materials: [
      { color: [0.5, 0.5, 0.52, 1], specular: [0.02, 0.02, 0.02, 8] },
    ],
    connections: room.connections,
    instances: [],
    origin: [0, 0, 0],
    bounds: room.bounds,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "connector",
      seed: "dogleg-corner",
    },
  };
  const corner = placePiece(cornerLocal, c.place);
  const d1 = corner.connections[0] as Connection;
  const d2 = corner.connections[1] as Connection;
  const segOpts = opts.enclosure ? { enclosure: opts.enclosure } : {};
  return {
    corner,
    segA: route(a, d1, segOpts),
    segB: route(d2, b, segOpts),
    cornerLocal,
  };
}
