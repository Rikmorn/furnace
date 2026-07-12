// src/world-build.ts — the deterministic (search-free) realize step: turns a WorldSpec
// into placed region + connector RegionData plus a computed player start. Runs at bake
// time (browser), so its placement trig is BAKED and never regenerated cross-engine.
//
// Two-phase realize (D-W2-6/7): (1) STAMP + PLACE — interior algorithms emit fields
// (caves) or grid stamps (halls) + local portals; every region's PLACEMENT resolves as
// W1 (grid placements snapped). (2) CONNECT + FINALIZE — connectors build their volumes
// and register mutations (open-door / carve) on the regions they touch; each grid region
// then rasterizes → carves → skins → collars → patches → collides into its final
// RegionData and is placed. Cave regions keep the W1 single-step path (place at generate).
import { join, placeConnection, placePiece } from "./connect.ts";
import { organicTunnel } from "./connector.ts";
import {
  buildCorridor,
  CORRIDOR_DEFAULT_LENGTH,
  collarBore,
  collarBoreCarve,
  worldToLocal,
} from "./connector-built.ts";
import { voxelProxyPosition } from "./proxy.ts";
import type {
  Aabb,
  Connection,
  MaterialDescriptor,
  RegionData,
  RegionMesh,
  Vec3,
} from "./region.ts";
import { GENERATOR_VERSION } from "./region.ts";
import type { CarveVolume } from "./substrate/carve.ts";
import { prepareCarve } from "./substrate/carve.ts";
import { collarInstances } from "./substrate/collar.ts";
import { fineProxy } from "./substrate/collider.ts";
import {
  AIR,
  CELL,
  type CoarseGrid,
  coarseSet,
  fineGridConfig,
  rasterize,
} from "./substrate/grid.ts";
import { KIT_MATERIALS } from "./substrate/pieces.ts";
import { type DoorSpec, faceKey, skinGrid } from "./substrate/skin.ts";
import { carvedCells, suppressedFaces } from "./substrate/suppress.ts";
import { cave } from "./themes/cave.ts";
import { type HallParams, type HallStamp, hall } from "./themes/hall.ts";
import {
  DEFAULT_TUNNEL_LENGTH,
  snapGridPlacement,
  validateWorldSpec,
  type WorldConnectorKind,
  type WorldConnectorSpec,
  type WorldPlacement,
  type WorldRegionSpec,
  type WorldSpec,
} from "./world-spec.ts";

/** How far inside the start region's portal (along its INWARD facing) the player spawns (m). */
const PLAYER_START_INSET = 2.0;
/** Player spawn height above the portal floor (m): 0.9 capsule rest + 0.2 drop-in (main.ts). */
const PLAYER_SPAWN_RISE = 1.1;

/** Rock for the carve patch — matches the connector bore stone (connector.ts). */
const PATCH_ROCK: MaterialDescriptor = {
  color: [0.5, 0.5, 0.52, 1],
  specular: [0.02, 0.02, 0.02, 8],
};
export const SUBSTRATE_MATERIALS = [...KIT_MATERIALS, PATCH_ROCK];
export const MAT_PATCH_ROCK = KIT_MATERIALS.length;

/** Coincidence tolerance for an aperture's two portals (m) and their anti-parallel facings. */
const APERTURE_COINCIDE_EPS = 1e-6;
const APERTURE_FACING_EPS = 1e-6;

/** The fully realized world: the resolved spec (derived placements baked in), the placed
 *  region + connector geometry, and where/which-way the player starts. */
export type RealizedWorld = {
  /** The input spec with every derived placement written back (world.json bakes this). */
  spec: WorldSpec;
  /** Region id → placed RegionData. */
  regions: Map<string, RegionData>;
  /** Connector id → RegionData. */
  connectors: Map<string, RegionData>;
  /** World-space player spawn position. */
  playerStart: Vec3;
  /** Player yaw (FpController convention) orienting them to face the start portal. */
  playerYaw: number;
};

/** An interior algorithm's phase-1 output. Field-organic (cave) already IS its final
 *  local RegionData; grid-built (hall) is a SEALED stamp finalized in phase 2 once its
 *  connectors' mutations are known. */
type Pending =
  | { kind: "field"; data: RegionData }
  | { kind: "grid"; stamp: HallStamp };

/** A connector's pending effect on a joined region, collected in the connect pass and
 *  applied when the region finalizes. `openPortals` index the region's local portals;
 *  `carves` are WORLD-frame (transformed to local at finalize). */
type RegionMutation = { openPortals: number[]; carves: CarveVolume[] };

/** Generate a region's unplaced (local-frame, origin [0,0,0]) phase-1 output from its
 *  spec: field-organic → the final cave RegionData; grid-built → a sealed hall stamp. */
function generateRegion(region: WorldRegionSpec): Pending {
  if (region.class === "field-organic") {
    return {
      kind: "field",
      data: cave({
        theme: "cave",
        seed: region.seed,
        origin: [0, 0, 0],
        mouths: region.params.mouths,
        capped: region.params.capped,
      }),
    };
  }
  return { kind: "grid", stamp: hall(region.params, region.seed) };
}

/** The local (unplaced) portals of a phase-1 output — a cave's connections or a hall
 *  stamp's door-portal metadata. Placement transforms these to world via placeConnection. */
function localPortals(p: Pending): Connection[] {
  return p.kind === "field" ? p.data.connections : p.stamp.portals;
}

/** The grid finalize (phase 2): open consumed doors → rasterize → carve → skin
 *  (door + suppression aware) → collar → patch → collide. LOCAL frame; the caller
 *  places the result. Exported for the loader (Task 9) — bake and load MUST run
 *  this same function (single source, D-W2-6/7). */
export function expandGridRegion(
  stamp: HallStamp,
  openPortals: number[],
  carves: CarveVolume[], // already LOCAL frame
  seed: string,
): RegionData {
  // Work on a COPY of the stamp's coarse grid: openDoorCells mutates it, and this
  // function is exported for reuse (Task 9's loader re-expands from a stamp too),
  // so a cached/re-expanded stamp must not accumulate opened doors. Matches the
  // prepareCarve "input is not mutated" precedent in this subsystem.
  const coarse: CoarseGrid = {
    min: [...stamp.coarse.min] as Vec3,
    dims: [...stamp.coarse.dims] as [number, number, number],
    cells: new Uint8Array(stamp.coarse.cells),
  };
  const doors: DoorSpec[] = [];
  for (const idx of openPortals) {
    const spec = stamp.doorSpecs[idx];
    if (!spec) throw new Error(`world: portal ${idx} has no door spec`);
    doors.push(spec);
    openDoorCells(coarse, spec);
  }
  const fine = rasterize(coarse);
  const carve = prepareCarve(fine, carves);
  const suppressed = suppressedFaces(coarse, carve);
  // Whole-owner-cell conservative suppression for small pieces rides through
  // skinGrid's suppressed set too: add every face of a carved cell.
  for (const cellKey of carvedCells(carve)) {
    const [i, j, k] = parseCellKey(cellKey);
    for (let f = 0; f < 6; f++) suppressed.add(faceKey(i, j, k, f));
  }
  const instances = [
    ...skinGrid(coarse, doors, seed, suppressed),
    ...(suppressed.size > 0 ? [collarInstances(coarse, suppressed, seed)] : []),
  ];
  const meshes: RegionMesh[] = carve.patch
    ? [
        {
          geometry: { custom: carve.patch },
          material: MAT_PATCH_ROCK,
          position: [0, 0, 0],
        },
      ]
    : [];
  const cfg = fineGridConfig(carve.fine);
  return {
    meshes,
    colliders: [
      {
        shape: { voxels: fineProxy(carve.fine) },
        position: voxelProxyPosition(cfg, [0, 0, 0]),
      },
    ],
    materials: SUBSTRATE_MATERIALS,
    connections: stamp.portals,
    instances,
    origin: [0, 0, 0],
    bounds: gridStampBounds(coarse),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "hall",
      seed,
    },
  };
}

/** A baked connector entry as seen by the loader's grid re-expansion: the fields
 *  {@link expandGridRegionFromEntry} needs off `WorldConnectorEntry` (kept structural so
 *  world-build stays free of a bake.ts manifest-type import). `radius` is optional — only
 *  the bore kinds carry it; a collar-bore always does. */
type TouchingConnector = {
  kind: WorldConnectorKind;
  aRef: [string, number];
  bRef: [string, number];
  a: Connection;
  b: Connection;
  radius?: number;
};

/** The loader's grid re-expansion (Task 9): rebuild a baked hall's LOCAL RegionData from
 *  its manifest entry plus the connector entries touching it — the SAME `expandGridRegion`
 *  bake's finalize runs, so load reproduces the live geometry byte-for-byte. Corridor/
 *  aperture ends contribute an OPEN door; each collar-bore end re-derives its cut through
 *  the shared {@link collarBoreCarve} (single-sourced with bake finalize's carve; NO drift),
 *  transformed WORLD→local by the region's placement. The caller places the result. */
export function expandGridRegionFromEntry(
  entry: { params: HallParams; seed: string; placement: WorldPlacement },
  touching: TouchingConnector[],
  regionId: string,
): RegionData {
  const stamp = hall(entry.params, entry.seed);
  const open: number[] = [];
  const carves: CarveVolume[] = [];
  for (const c of touching) {
    for (const end of ["aRef", "bRef"] as const) {
      const [rid, portalIndex] = c[end];
      if (rid !== regionId) continue;
      if (c.kind === "corridor" || c.kind === "aperture") {
        open.push(portalIndex);
      }
      if (c.kind === "collar-bore") {
        const door = end === "aRef" ? c.a : c.b;
        const carve = collarBoreCarve(door, { radius: c.radius });
        carves.push({
          ...carve,
          a: worldToLocal(carve.a, entry.placement),
          b: worldToLocal(carve.b, entry.placement),
        });
      }
    }
  }
  return expandGridRegion(stamp, open, carves, entry.seed);
}

/** Parse a `i,j,k` cell key (from carvedCells) into coarse ints. Mirrors collar.ts's
 *  parseFaceKey — a switch/parse returning `number` directly, not a tuple cast that
 *  fights noUncheckedIndexedAccess. */
function parseCellKey(key: string): [number, number, number] {
  const parts = key.split(",");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Open a door's coarse cells to AIR (the shell was sealed at stamp time). */
function openDoorCells(coarse: CoarseGrid, d: DoorSpec): void {
  for (let w = 0; w < d.size[0]; w++)
    for (let h = 0; h < d.size[1]; h++) {
      const [i, j, k] = doorAirCell(d, w, h);
      coarseSet(coarse, i, j, k, AIR);
    }
}

/** The coarse AIR cell at door-local offset (w along the wall, h up), built by a switch
 *  on the door face (not variable-index compound assignment, which fails
 *  noUncheckedIndexedAccess). Mirrors skin.ts doorCell exactly. */
function doorAirCell(
  d: DoorSpec,
  w: number,
  h: number,
): [number, number, number] {
  const [x, y, z] = d.min;
  return d.face <= 1 ? [x, y + h, z + w] : [x + w, y + h, z];
}

/** The local-frame AABB of a coarse stamp (min corner → dims·CELL). */
function gridStampBounds(g: CoarseGrid): Aabb {
  return {
    min: [...g.min] as Vec3,
    max: [
      g.min[0] + g.dims[0] * CELL,
      g.min[1] + g.dims[1] * CELL,
      g.min[2] + g.dims[2] * CELL,
    ],
  };
}

function isZeroTranslation(t: Vec3): boolean {
  return t[0] === 0 && t[1] === 0 && t[2] === 0;
}

/** Map each DERIVED region (a `b`-end whose placement translation is the zero placeholder)
 *  to the connector its placement derives from. First such connector wins; W1 is one
 *  connector, so this is unambiguous. Regions absent from the map are placed explicitly. */
function identifyDerivedRegions(
  spec: WorldSpec,
  regionById: Map<string, WorldRegionSpec>,
): Map<string, WorldConnectorSpec> {
  const derivingConnector = new Map<string, WorldConnectorSpec>();
  for (const connector of spec.connectors) {
    const bId = connector.b[0];
    const bRegion = regionById.get(bId);
    if (
      bRegion &&
      isZeroTranslation(bRegion.placement.translation) &&
      !derivingConnector.has(bId)
    ) {
      derivingConnector.set(bId, connector);
    }
  }
  return derivingConnector;
}

/** The input spec with every region's resolved placement written back (derived `b`-ends
 *  carry their join-derived placement; everything else its explicit one). Fresh objects
 *  throughout — never aliases the input spec's own placement objects. */
function resolveSpec(
  spec: WorldSpec,
  resolvedPlacements: Map<string, WorldPlacement>,
): WorldSpec {
  return {
    ...spec,
    regions: spec.regions.map((region): WorldRegionSpec => {
      const placement = resolvedPlacements.get(region.id);
      if (!placement) throw new Error(`world: unplaced region ${region.id}`);
      // Reconstruct per-variant so the discriminated union survives the clone (a single
      // {...region} spread merges the class variants and loses the class↔params
      // correlation). The cave branch's `{ ...region.params }` is a full clone
      // (primitives); the hall branch is a shallow clone (HallParams has nested
      // size/pillars/doors that stay aliased) — harmless: nothing downstream mutates a
      // region's params (expandGridRegion mutates the derived coarse stamp, not params).
      if (region.class === "field-organic") {
        return { ...region, params: { ...region.params }, placement };
      }
      return { ...region, params: { ...region.params }, placement };
    }),
    connectors: spec.connectors.map(
      (connector): WorldConnectorSpec => ({
        ...connector,
        a: [connector.a[0], connector.a[1]],
        b: [connector.b[0], connector.b[1]],
      }),
    ),
  };
}

/** A phantom portal `length` out along a PLACED portal's OUTWARD facing (plus `deltaY`
 *  of vertical rise), keeping that facing. `join(phantom, b)` seats b's opening onto the
 *  phantom and makes b's placed facing `= −phantom.facing = −pA.facing`, so the two
 *  placed portals end up facing each other (dot ≈ −1) `length` apart (and `deltaY` up). */
function phantomTarget(pA: Connection, length: number, deltaY = 0): Connection {
  return {
    ...pA,
    position: [
      pA.position[0] + pA.facing[0] * length,
      pA.position[1] + pA.facing[1] * length + deltaY,
      pA.position[2] + pA.facing[2] * length,
    ],
  };
}

/** The tunnel length + vertical rise a connector seats its derived `b`-end at: a corridor
 *  reads its `params` (defaulting to CORRIDOR_DEFAULT_LENGTH / flat); every other kind
 *  uses the default tunnel length, flat. */
function derivationMetrics(connector: WorldConnectorSpec): {
  length: number;
  deltaY: number;
} {
  if (connector.kind === "corridor") {
    return {
      length: connector.params?.length ?? CORRIDOR_DEFAULT_LENGTH,
      deltaY: connector.params?.deltaY ?? 0,
    };
  }
  return { length: DEFAULT_TUNNEL_LENGTH, deltaY: 0 };
}

/** The player spawn + yaw from the (placed) start portal: stepped `PLAYER_START_INSET`
 *  along the INWARD facing (portal facing is OUTWARD → inward = −facing, horizontal only),
 *  raised `PLAYER_SPAWN_RISE` above the portal floor, and yawed to look OUT along +facing
 *  toward the tunnel. */
function playerSpawn(pStart: Connection): { start: Vec3; yaw: number } {
  return {
    start: [
      pStart.position[0] - pStart.facing[0] * PLAYER_START_INSET,
      pStart.position[1] + PLAYER_SPAWN_RISE,
      pStart.position[2] - pStart.facing[2] * PLAYER_START_INSET,
    ],
    // FpController: forwardVector(yaw,0) = [−sin yaw, 0, −cos yaw]; solving for +facing
    // gives yaw = atan2(−facing.x, −facing.z).
    yaw: Math.atan2(-pStart.facing[0], -pStart.facing[2]),
  };
}

/** Realize a WorldSpec (two-phase). Phase 1: generate every region + resolve every
 *  placement (deriving zero-translation `b`-ends from their already-placed `a` end via
 *  join-math; grid placements lattice-snapped). Phase 2: run every connector between the
 *  resolved placed portals — building its volume and registering open-door / carve
 *  mutations — then finalize each region (caves place directly; halls rasterize → carve →
 *  skin → collide) and compute the player start. Deterministic and search-free. Does NOT
 *  mutate `spec` — returns a resolved copy with derived placements. */
export function realizeWorldSpec(spec: WorldSpec): RealizedWorld {
  validateWorldSpec(spec);

  const regionById = new Map(spec.regions.map((r) => [r.id, r]));
  const pending = new Map<string, Pending>(
    spec.regions.map((r) => [r.id, generateRegion(r)]),
  );
  const derivingConnector = identifyDerivedRegions(spec, regionById);
  const resolvedPlacements = new Map<string, WorldPlacement>();

  // Phase 1a — explicitly placed regions (everything not derived). Grid placements snap
  // to the lattice; caves keep their exact authored placement.
  for (const region of spec.regions) {
    if (derivingConnector.has(region.id)) continue;
    const resolved: WorldPlacement =
      region.class === "grid-built"
        ? snapGridPlacement(region.placement)
        : {
            translation: [...region.placement.translation],
            yaw: region.placement.yaw,
          };
    resolvedPlacements.set(region.id, resolved);
  }

  // Phase 1b — derive each `b`-end placement from its (already-placed) `a` end.
  for (const [bId, connector] of derivingConnector) {
    const aId = connector.a[0];
    const resolvedA = resolvedPlacements.get(aId);
    if (!resolvedA) {
      throw new Error(
        `world: cannot derive ${bId} — its a-end ${aId} is not placed yet`,
      );
    }
    const pendingA = pending.get(aId);
    const pendingB = pending.get(bId);
    const bRegion = regionById.get(bId);
    if (!pendingA || !pendingB || !bRegion) {
      throw new Error(
        `world: connector ${connector.id} references a missing region`,
      );
    }
    const aLocal = localPortals(pendingA)[connector.a[1]];
    const bDoor = localPortals(pendingB)[connector.b[1]];
    if (!aLocal || !bDoor) {
      throw new Error(
        `world: connector ${connector.id} references a missing portal`,
      );
    }
    const pA = placeConnection(aLocal, resolvedA);
    const { length, deltaY } = derivationMetrics(connector);
    const placement = join(phantomTarget(pA, length, deltaY), bDoor);
    const resolvedB: WorldPlacement =
      bRegion.class === "grid-built"
        ? snapGridPlacement(placement)
        : { translation: placement.translation, yaw: placement.yaw };
    resolvedPlacements.set(bId, resolvedB);
  }

  // The placed world-frame portal for a resolved region end (no full RegionData needed).
  const placedPortal = (id: string, idx: number): Connection => {
    const p = pending.get(id);
    const place = resolvedPlacements.get(id);
    if (!p || !place) throw new Error(`world: region ${id} is not resolved`);
    const local = localPortals(p)[idx];
    if (!local) throw new Error(`world: region ${id} has no portal ${idx}`);
    return placeConnection(local, place);
  };

  // Phase 2a — connectors: build volumes + collect the mutations each end must apply.
  const connectors = new Map<string, RegionData>();
  const mutations = new Map<string, RegionMutation>();
  const mutationFor = (id: string): RegionMutation => {
    const existing = mutations.get(id);
    if (existing) return existing;
    const fresh: RegionMutation = { openPortals: [], carves: [] };
    mutations.set(id, fresh);
    return fresh;
  };
  for (const connector of spec.connectors) {
    const [aId, aIdx] = connector.a;
    const [bId, bIdx] = connector.b;
    const pA = placedPortal(aId, aIdx);
    const pB = placedPortal(bId, bIdx);
    switch (connector.kind) {
      case "organic-tunnel":
        connectors.set(connector.id, organicTunnel(pA, pB, connector.seed));
        break;
      case "corridor":
        connectors.set(connector.id, buildCorridor(pA, pB, connector.seed));
        mutationFor(aId).openPortals.push(aIdx);
        mutationFor(bId).openPortals.push(bIdx);
        break;
      case "aperture":
        assertApertureSeam(connector.id, pA, pB);
        mutationFor(aId).openPortals.push(aIdx);
        mutationFor(bId).openPortals.push(bIdx);
        break;
      case "collar-bore": {
        // Built↔organic (D-W2-4): the grid-built end is the carve target (its fine
        // grid gets the bore); the field-organic end supplies the mouth. Cave mouths
        // present as door-class portals too (mouthCollar), so the built/organic split
        // is by region CLASS, not portal.kind — exactly one of each.
        const aIsGrid = pending.get(aId)?.kind === "grid";
        if (aIsGrid === (pending.get(bId)?.kind === "grid")) {
          throw new Error(
            `world: collar-bore ${connector.id} needs one grid-built end + one field-organic end`,
          );
        }
        const doorPortal = aIsGrid ? pA : pB;
        const mouthPortal = aIsGrid ? pB : pA;
        const doorRegionId = aIsGrid ? aId : bId;
        const { tunnel, carve } = collarBore(
          doorPortal,
          mouthPortal,
          connector.seed,
        );
        connectors.set(connector.id, tunnel);
        mutationFor(doorRegionId).carves.push(carve);
        break;
      }
      default: {
        // Exhaustiveness guard: a new WorldConnectorKind must be handled here,
        // not silently no-op'd.
        const _never: never = connector.kind;
        throw new Error(`world: unhandled connector kind ${String(_never)}`);
      }
    }
  }

  // Phase 2b — finalize each region into placed RegionData.
  const placed = new Map<string, RegionData>();
  for (const region of spec.regions) {
    const p = pending.get(region.id);
    const resolved = resolvedPlacements.get(region.id);
    if (!p || !resolved) {
      throw new Error(`world: region ${region.id} is not resolved`);
    }
    if (p.kind === "field") {
      placed.set(region.id, placePiece(p.data, resolved));
      continue;
    }
    const m = mutations.get(region.id) ?? { openPortals: [], carves: [] };
    const localCarves = m.carves.map(
      (carve): CarveVolume => ({
        ...carve,
        a: worldToLocal(carve.a, resolved),
        b: worldToLocal(carve.b, resolved),
      }),
    );
    const local = expandGridRegion(
      p.stamp,
      m.openPortals,
      localCarves,
      region.seed,
    );
    placed.set(region.id, placePiece(local, resolved));
  }

  const startPlaced = placed.get(spec.startRegion);
  const pStart = startPlaced?.connections[0];
  if (!pStart) {
    throw new Error(
      `world: start region ${spec.startRegion} has no portal 0 to spawn at`,
    );
  }
  const { start: playerStart, yaw: playerYaw } = playerSpawn(pStart);

  return {
    spec: resolveSpec(spec, resolvedPlacements),
    regions: placed,
    connectors,
    playerStart,
    playerYaw,
  };
}

/** An aperture is a pure hole: its two placed portals must coincide and face each other
 *  (anti-parallel), else it is a spec error — throw setup-loud. */
function assertApertureSeam(id: string, pA: Connection, pB: Connection): void {
  const dist = Math.hypot(
    pA.position[0] - pB.position[0],
    pA.position[1] - pB.position[1],
    pA.position[2] - pB.position[2],
  );
  if (dist >= APERTURE_COINCIDE_EPS) {
    throw new Error(
      `world: aperture ${id} portals do not coincide (${dist.toFixed(4)} m apart)`,
    );
  }
  const facingDot =
    pA.facing[0] * pB.facing[0] +
    pA.facing[1] * pB.facing[1] +
    pA.facing[2] * pB.facing[2];
  if (facingDot > -1 + APERTURE_FACING_EPS) {
    throw new Error(
      `world: aperture ${id} portals are not anti-parallel (dot ${facingDot.toFixed(4)})`,
    );
  }
}
