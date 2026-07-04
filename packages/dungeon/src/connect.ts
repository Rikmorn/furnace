// packages/dungeon/src/connect.ts
import { mat4, quat, vec3 } from "@furnace/core/transform";
import { aabbOfBoxes, transformAabb } from "./aabb.ts";
import type {
  Connection,
  InstanceData,
  MaterialDescriptor,
  RegionCollider,
  RegionData,
  RegionMesh,
  Vec3,
} from "./region.ts";
import { GENERATOR_VERSION } from "./region.ts";
import { type Box, stepBoxes } from "./themes/box-room.ts";
import { SLOPE_LIMIT_RAD, STEP_HEIGHT, STEP_MARGIN } from "./walkability.ts";

/** A rigid placement: a yaw rotation about world-up, then a world translation. */
export type Placement = { yaw: number; translation: Vec3 };

/** Heading angle φ of a horizontal vector under the engine yaw convention
 *  (`Ry(θ)·[1,0,0] = [cosθ, 0, −sinθ]`), so `v = [cosφ, 0, −sinφ]`. */
function headingAngle(v: Vec3): number {
  return Math.atan2(-v[2], v[0]);
}

/** Rotate a Vec3 by yaw θ about world-up: `Ry(θ)·[x,y,z]`. */
function rotateY(v: Vec3, c: number, s: number): Vec3 {
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** The yaw+height transform that seats portal B onto portal A: B's opening coincides with
 *  A's and B's outward facing becomes A's INWARD facing (−A.facing). Continuous yaw — the
 *  general case of the retired cardinal-snap. */
export function join(a: Connection, b: Connection): Placement {
  const target: Vec3 = [-a.facing[0], a.facing[1], -a.facing[2]];
  const yaw = headingAngle(target) - headingAngle(b.facing);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rb = rotateY(b.position, c, s);
  return {
    yaw,
    translation: [
      a.position[0] - rb[0],
      a.position[1] - rb[1],
      a.position[2] - rb[2],
    ],
  };
}

/** Apply a Placement to a whole region: positions rotated+translated, per-piece rotation
 *  composed with the placement yaw, connection facings rotated, instance transforms +
 *  placements transformed. Generalizes the retired compose.ts placeRoom for ANY yaw. */
export function placePiece(region: RegionData, place: Placement): RegionData {
  const { yaw, translation: t } = place;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const xf = (p: Vec3): Vec3 => {
    const r = rotateY(p, c, s);
    return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
  };
  const rotDir = (v: Vec3): Vec3 => rotateY(v, c, s);
  const qYaw = quat.fromAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), yaw);
  const compose = (
    existing?: [number, number, number, number],
  ): [number, number, number, number] => {
    if (!existing)
      return [qYaw[0], qYaw[1], qYaw[2], qYaw[3]] as [
        number,
        number,
        number,
        number,
      ];
    const out = quat.multiply(
      quat.create(),
      qYaw,
      quat.fromValues(existing[0], existing[1], existing[2], existing[3]),
    );
    return [out[0], out[1], out[2], out[3]] as [number, number, number, number];
  };

  const meshes: RegionMesh[] = region.meshes.map((m) => ({
    ...m,
    position: xf(m.position),
    rotation: compose(m.rotation),
  }));
  const colliders: RegionCollider[] = region.colliders.map((col) => ({
    ...col,
    position: xf(col.position),
    rotation: compose(col.rotation),
  }));
  const connections: Connection[] = region.connections.map((cn) => ({
    ...cn,
    position: xf(cn.position),
    facing: rotDir(cn.facing),
  }));
  const placementMat = buildPlacementMat(c, s, t);
  const scratch = mat4.create();
  const instances = region.instances.map((g) => {
    const out = new Float32Array(g.transforms.length);
    for (let i = 0; i < g.transforms.length; i += 16) {
      mat4.multiply(scratch, placementMat, g.transforms.subarray(i, i + 16));
      out.set(scratch, i);
    }
    const placements = g.placements?.map(
      (p): InstanceData => ({
        ...p,
        position: xf(p.position),
        rotation: compose(p.rotation),
      }),
    );
    return { ...g, transforms: out, placements };
  });

  return {
    ...region,
    meshes,
    colliders,
    connections,
    instances,
    origin: xf(region.origin),
    bounds: transformAabb(region.bounds, yaw, t),
  };
}

/** Column-major `T(t)·Ry(θ)` mat4 (gl-matrix layout) for transforming instance matrices. */
function buildPlacementMat(c: number, s: number, t: Vec3): Float32Array {
  const m = mat4.create();
  m[0] = c;
  m[2] = -s; // column 0: Ry(θ)·X̂ = [cosθ, 0, −sinθ]
  m[8] = s;
  m[10] = c; // column 2: Ry(θ)·Ẑ = [sinθ, 0, cosθ]
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

/** The three connector shapes the router can emit between two portals. */
export type ConnectorKind = "corridor" | "ramp" | "stairs";

const FLAT_EPS = 0.05; // |Δh| below this → a flat corridor
const RAMP_MARGIN = (3 * Math.PI) / 180; // keep ramp pitch this far below the slope limit
const WALL_T = 0.3; // enclosure wall thickness; must stay <= SHOULDER (walls live in the shoulder band)
const RAIL_H = 1.1; // "open" style guardrail height above the local floor
const SEAM_OVERLAP = 0.6; // connector floor pokes past each portal by >= 1 cell (CELL 0.5)
const FLOOR_THICK = 0.3; // connector slab thickness (m), matches the retired vestibule
/** A little shoulder past the clear walking width on each side. Exported so the placement
 *  engine's clearance/exemption math (layout.ts) uses the SAME footprint `route` builds —
 *  a divergence here would silently validate the wrong connector width. */
export const SHOULDER = 0.4;
/** Enclosure ceiling slab thickness (m). Part of the layout↔connect containment
 *  contract (see ENCLOSURE_TOP_PAD); exported for the seal-invariant assert. */
export const CEIL_T = 0.3;
/** Max floor rise per enclosure ring (m). MUST stay < CEIL_T so adjacent ring
 *  ceilings overlap vertically — the seal invariant, unit-asserted. */
export const RING_RISE = 0.25;
/** How far above the shared headroom a connector's enclosure can reach: the ceiling
 *  slab plus the ring quantization wobble. layout.ts grows every clearance volume's
 *  top by this, so the placer's reserved air covers the whole enclosure by
 *  construction. */
export const ENCLOSURE_TOP_PAD = CEIL_T + RING_RISE;

/** Flat-landing length at the LOW (arrival) end of a DESCENDING connector (m).
 *  >= layout.ts CLEARANCE_SEGMENT — the arrival clearance segment must be flat by
 *  construction; code bracket 0.76–1.83 m grounds the order of magnitude (IBC/OSHA
 *  stairs, ADA ramps — see docs/research/2026-07-03-dungeon-2.2.5b-b1-built-interfaces.md
 *  §2). Directional (user-authorized): only descending connectors get a landing — arriving
 *  level through a normal door is the lintel-clip fix; an ascending connector's low end is
 *  a free-floor departure where a landing only steepens the climb window. */
export const LANDING_LEN = 2.0;
/** Minimum climb-window run a DESCENDING connector needs beyond its arrival landing (m). */
export const MIN_CLIMB_RUN = 1.0;

/** THE reference walk-line profile: the y a walker's feet trace along a connector's local
 *  +Z. Directional: ascending (and flat/degenerate) runs are LINEAR over the full run (no
 *  landing — the low end is a departure); a DESCENDING run is linear from the high (z=0) end
 *  to (run − LANDING_LEN, dh), then FLAT y=dh across the arrival landing to z=run.
 *  `enclosureBoxes`' `floorAt` reads this profile directly, `floorBoxes` builds walking
 *  geometry that matches it by construction (ascending linear; descending landing), and
 *  layout.ts `clearanceBoxes` reserves its air along the same profile — so the built floor and
 *  the placer's reserved air are single-sourced and cannot drift. Clamps outside [0, run]. */
export function walkLineAt(dh: number, run: number, z: number): number {
  const zc = Math.min(Math.max(z, 0), run);
  if (run <= 1e-6) return 0;
  const climb = run - LANDING_LEN;
  // Descending arrivals get a flat landing at the LOW (z=run) end; everything else
  // (ascending departures, flat corridors, degenerate climb window) is linear.
  if (dh < -FLAT_EPS && climb > 1e-6) {
    return zc >= climb ? dh : dh * (zc / climb);
  }
  return dh * (zc / run);
}

/** A connector's outer cross-section: outer width (clear walking width + shoulders)
 *  and vertical headroom. */
export type ConnectorSection = { width: number; headroom: number };

/** THE single source for connector sizing — layout.ts clearance math and the
 *  enclosure/floor geometry here both read it, so the placer's reserved air and the
 *  built connector cannot drift apart. */
export function connectorSection(
  from: Connection,
  to: Connection,
): ConnectorSection {
  return {
    width: Math.max(from.width, to.width) + 2 * SHOULDER,
    headroom: Math.max(from.height, to.height),
  };
}
const CONNECTOR_MATERIAL: MaterialDescriptor = {
  color: [0.5, 0.5, 0.52, 1],
  specular: [0.02, 0.02, 0.02, 8],
};

/** Pick the connector kind for a height delta over a horizontal run. Pitch is measured over
 *  the EFFECTIVE climb window — the full run when ascending, `run − LANDING_LEN` when
 *  descending (its arrival landing eats that length, steepening the remaining climb). */
export function chooseKind(dh: number, run: number): ConnectorKind {
  if (Math.abs(dh) <= FLAT_EPS) return "corridor";
  const window = dh < -FLAT_EPS ? Math.max(run - LANDING_LEN, 1e-6) : run;
  const pitch = Math.atan2(Math.abs(dh), window);
  return pitch <= SLOPE_LIMIT_RAD - RAMP_MARGIN ? "ramp" : "stairs";
}

function boxToMesh(
  b: Box,
  rotation?: [number, number, number, number],
): RegionMesh {
  const mesh: RegionMesh = {
    geometry: { box: b.size },
    material: 0,
    position: b.center,
  };
  if (rotation) mesh.rotation = rotation;
  return mesh;
}

function boxToCollider(
  b: Box,
  rotation?: [number, number, number, number],
): RegionCollider {
  const collider: RegionCollider = {
    shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
    position: b.center,
  };
  if (rotation) collider.rotation = rotation;
  return collider;
}

/** A local-frame connector box, optionally rotated (the ramp case pitches about X). */
type ConnectorBox = Box & { rotation?: [number, number, number, number] };

/** Which portal kind each connector end meets: a `door` end stops flush at the portal
 *  plane; a `tunnel-mouth` end extends SEAM_OVERLAP past it into the neighbour's rock. */
type EndKinds = { from: Connection["kind"]; to: Connection["kind"] };

/** One pitched ramp slab climbing `dh` over `climbRun` horizontal metres, centred at `zMid`
 *  along Z, with SEAM_OVERLAP extensions past both ends. Throws setup-loud if the pitch
 *  exceeds the walkable slope limit (|pitch| — a steep DESCENT throws like a steep ascent). */
function pitchedRampSlab(
  dh: number,
  climbRun: number,
  w: number,
  zMid: number,
): ConnectorBox {
  const pitch = Math.atan2(dh, climbRun);
  if (Math.abs(pitch) > SLOPE_LIMIT_RAD - RAMP_MARGIN) {
    throw new Error(
      `route: forced ramp pitch ${(pitch * 180) / Math.PI}° exceeds the slope limit`,
    );
  }
  const rampLen = Math.hypot(dh, climbRun) + 2 * SEAM_OVERLAP;
  const qPitch = quat.fromAxisAngle(
    quat.create(),
    vec3.fromValues(1, 0, 0),
    -pitch,
  );
  const rot = [qPitch[0], qPitch[1], qPitch[2], qPitch[3]] as [
    number,
    number,
    number,
    number,
  ];
  const upY = Math.cos(pitch);
  const upZ = -Math.sin(pitch);
  return {
    center: [
      0,
      dh / 2 - (FLOOR_THICK / 2) * upY,
      zMid - (FLOOR_THICK / 2) * upZ,
    ],
    size: [w, FLOOR_THICK, rampLen],
    rotation: rot,
  };
}

/** Ascending stair treads (via box-room stepBoxes, +Z from y=0, tallest at frontZ=run) plus
 *  a flat apron at each end. `bottomLen` is the low-end apron length: 0 for an ascending run
 *  (a bare SEAM_OVERLAP apron), LANDING_LEN for a descending run (whose low apron becomes the
 *  arrival landing once floorBoxes mirrors the boxes). The top apron is skipped when the top
 *  tread already pokes >= SEAM_OVERLAP past the portal. */
function stairBoxes(
  rise: number,
  run: number,
  w: number,
  treadDepth: number,
  bottomLen: number,
): Box[] {
  const boxes: Box[] = stepBoxes(rise, run, w, treadDepth);
  boxes.push({
    center: [
      0,
      -FLOOR_THICK / 2,
      (bottomLen + treadDepth / 2 - SEAM_OVERLAP) / 2,
    ],
    size: [w, FLOOR_THICK, bottomLen + treadDepth / 2 + SEAM_OVERLAP],
  });
  if (treadDepth / 2 < SEAM_OVERLAP) {
    const z0 = run + treadDepth / 2;
    const z1 = run + SEAM_OVERLAP;
    boxes.push({
      center: [0, rise - FLOOR_THICK / 2, (z0 + z1) / 2],
      size: [w, FLOOR_THICK, z1 - z0],
    });
  }
  return boxes;
}

/** The connector's walking surface for one kind, in LOCAL frame (climbing +Z from the
 *  origin portal to [0, dh, run]): corridor emits one slab; ramp emits a pitched slab (plus
 *  a flat arrival landing when descending); stairs emit stepBoxes + aprons (mirrored for
 *  descents, with the low apron becoming the arrival landing). Enclosure walls/ceilings are
 *  added by enclosureBoxes. */
function floorBoxes(
  kind: ConnectorKind,
  w: number,
  dh: number,
  run: number,
): ConnectorBox[] {
  if (kind === "corridor") {
    const center: Vec3 = [0, -FLOOR_THICK / 2, run / 2];
    return [{ center, size: [w, FLOOR_THICK, run + 2 * SEAM_OVERLAP] }];
  }
  if (kind === "ramp") {
    // Descending: pitched over the climb window [0, run − LANDING_LEN] plus a flat arrival
    // landing at the LOW (z=run) end (the lintel-clip fix). Ascending (default): a single
    // pitched slab over the FULL run — NO landing (the low end is a free-floor departure).
    if (dh < -FLAT_EPS) {
      const climb = run - LANDING_LEN;
      const pitched = pitchedRampSlab(dh, climb, w, climb / 2);
      // Flat landing slab spanning [run − LANDING_LEN, run + SEAM_OVERLAP] at y = dh; the
      // pitched slab's own down-slope SEAM_OVERLAP extension covers the junction.
      const landing: ConnectorBox = {
        center: [0, dh - FLOOR_THICK / 2, (climb + run + SEAM_OVERLAP) / 2],
        size: [w, FLOOR_THICK, run + SEAM_OVERLAP - climb],
      };
      return [pitched, landing]; // pitched FIRST — tests find the pitched slab at meshes[0]
    }
    return [pitchedRampSlab(dh, run, w, run / 2)];
  }
  // stairs: reuse box-room stepBoxes (climbs +Z from y=0, tallest at frontZ=run).
  const rise = Math.abs(dh);
  if (rise <= FLAT_EPS) {
    throw new Error(
      "route: forced stairs on a ~flat span (|dh| <= FLAT_EPS) would emit zero steps — use a corridor",
    );
  }
  const n = Math.ceil(rise / (STEP_HEIGHT - STEP_MARGIN));
  if (dh < -FLAT_EPS) {
    // Descending: treads over the climb window [LANDING_LEN, run]; the low-end apron IS the
    // LANDING_LEN landing. The mirror (z ↔ run−z, y shifted by dh) then lands that landing at
    // the descent ARRIVAL (z=run), level with the lower `to` floor — the lintel-clip fix.
    const climb = run - LANDING_LEN;
    return stairBoxes(rise, run, w, climb / n, LANDING_LEN).map(
      (b): Box => ({
        center: [b.center[0], b.center[1] + dh, run - b.center[2]],
        size: b.size,
      }),
    );
  }
  // Ascending (default): original Phase-A — treads over the FULL run, bare aprons, no landing.
  return stairBoxes(rise, run, w, run / n, 0);
}

/** Enclosure boxes — side walls + (tube-style) ceilings — as vertical-walled rings
 *  quantized along the climb (≤ RING_RISE floor rise per ring). Pitched slabs cannot
 *  end flush against a vertical door plane (their end faces lean along-climb), so every
 *  ring is axis-aligned: walls rise from the ring's floor MIN, the flat ceiling sits at
 *  the ring's floor MAX + headroom. Adjacent ring ceilings overlap vertically because
 *  RING_RISE < CEIL_T — sealed by construction. `open` = rail-top walls, no ceilings. */
function enclosureBoxes(
  section: ConnectorSection,
  dh: number,
  run: number,
  ends: EndKinds,
  open: boolean,
): ConnectorBox[] {
  const { width: w, headroom: h } = section;
  const z0 = ends.from === "tunnel-mouth" ? -SEAM_OVERLAP : 0;
  const z1 = run + (ends.to === "tunnel-mouth" ? SEAM_OVERLAP : 0);
  const floorAt = (z: number): number => walkLineAt(dh, run, z);
  // Ring count follows the EFFECTIVE climb-window slope — ascending spreads the rise over the
  // full run, a descent concentrates it in [0, run − LANDING_LEN] (its landing is flat). Using
  // |dh|/run for a descent would under-count and break the seal invariant (per-ring rise <=
  // RING_RISE < CEIL_T); the flat landing rings are level and get full headroom above portal.
  const slopeClimb =
    Math.abs(dh) <= FLAT_EPS
      ? 0
      : dh < -FLAT_EPS
        ? Math.abs(dh) / Math.max(run - LANDING_LEN, 1e-6)
        : Math.abs(dh) / run;
  const nRings = Math.max(1, Math.ceil((slopeClimb * (z1 - z0)) / RING_RISE));
  const wallX = w / 2 - WALL_T / 2;
  const out: ConnectorBox[] = [];
  for (let i = 0; i < nRings; i++) {
    const zA = z0 + ((z1 - z0) * i) / nRings;
    const zB = z0 + ((z1 - z0) * (i + 1)) / nRings;
    const zc = (zA + zB) / 2;
    const len = zB - zA;
    const fLo = Math.min(floorAt(zA), floorAt(zB));
    const fHi = Math.max(floorAt(zA), floorAt(zB));
    const top = open ? fHi + RAIL_H : fHi + h + CEIL_T;
    const wallH = top - fLo;
    out.push(
      { center: [-wallX, fLo + wallH / 2, zc], size: [WALL_T, wallH, len] },
      { center: [wallX, fLo + wallH / 2, zc], size: [WALL_T, wallH, len] },
    );
    if (!open) {
      out.push({
        center: [0, fHi + h + CEIL_T / 2, zc],
        size: [w, CEIL_T, len],
      });
    }
  }
  return out;
}

/** Build the whole connector in LOCAL frame — walking floor plus enclosure. The caller
 *  (`route`) yaw-aligns +Z to the real direction and translates to `from.position`.
 *  Also returns the raw `boxes` so `route` can envelope them for `bounds`. */
function buildConnectorLocal(
  kind: ConnectorKind,
  section: ConnectorSection,
  dh: number,
  run: number,
  ends: EndKinds,
  open: boolean,
): {
  meshes: RegionMesh[];
  colliders: RegionCollider[];
  boxes: ConnectorBox[];
} {
  const boxes = [
    ...floorBoxes(kind, section.width, dh, run),
    ...enclosureBoxes(section, dh, run, ends, open),
  ];
  return {
    meshes: boxes.map((b) => boxToMesh(b, b.rotation)),
    colliders: boxes.map((b) => boxToCollider(b, b.rotation)),
    boxes,
  };
}

/** A connector RegionData bridging two portals, walkable by construction. Auto-derives
 *  the kind from the geometry unless `opts.kind` forces it (setup-loud throw if a forced
 *  kind can't satisfy the walkability constraints). The connector floor spans the join
 *  and overlaps both endpoints by >= 1 cell, and the connector is ENCLOSED — ringed side
 *  walls plus a ceiling (`opts.enclosure: "open"` swaps the tube for guardrail-height
 *  walls with no ceiling). Enclosure ends stop flush at `door` portal planes and embed
 *  SEAM_OVERLAP into the rock at `tunnel-mouth` ends.
 *
 *  Direction-sensitive for descents: only a DESCENDING run (`to` below `from`) gets a flat
 *  arrival landing at its low (`to`) end — an ascending run's low end is a free-floor
 *  departure. The placer always routes edges a→b, so graph edge orientation deliberately
 *  controls which end (if either) carries the landing. */
export function route(
  from: Connection,
  to: Connection,
  opts?: { kind?: ConnectorKind; enclosure?: "open" },
): RegionData {
  const dx = to.position[0] - from.position[0];
  const dz = to.position[2] - from.position[2];
  const run = Math.hypot(dx, dz);
  const dh = to.position[1] - from.position[1];
  const dir: Vec3 =
    run > 1e-6 ? [dx / run, 0, dz / run] : [from.facing[0], 0, from.facing[2]];
  const kind = opts?.kind ?? chooseKind(dh, run);
  if (dh < -FLAT_EPS && run < LANDING_LEN + MIN_CLIMB_RUN) {
    throw new Error(
      `route: descending connector needs run >= ${LANDING_LEN + MIN_CLIMB_RUN} m for its arrival landing (got ${run.toFixed(2)})`,
    );
  }
  const local = buildConnectorLocal(
    kind,
    connectorSection(from, to),
    dh,
    run,
    { from: from.kind, to: to.kind },
    opts?.enclosure === "open",
  );
  const yaw = Math.atan2(dir[0], dir[2]);
  const region: RegionData = {
    meshes: local.meshes,
    colliders: local.colliders,
    materials: [CONNECTOR_MATERIAL],
    connections: [],
    instances: [],
    origin: [0, 0, 0],
    bounds: aabbOfBoxes(local.boxes),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "connector",
      seed: "connector",
    },
  };
  return placePiece(region, { yaw, translation: from.position });
}
