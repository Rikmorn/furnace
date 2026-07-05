// packages/dungeon/src/layout.ts
// The collision-aware placement engine (2.2.5b-B2c "toolbox placer"): a deterministic
// incremental graph embedder rebuilt around CONTINUOUS seeded loci (locus.ts), PORTAL
// freedom (permute spec-identical portals on both endpoints), FORWARD CHECKING (validate
// every incident placed edge at candidate time), exact-OBB envelopes (aabb.ts), CHAIN
// scheduling (cycles first — chains.ts), unit backtracking, and seeded restarts. Replaces
// the B2-era 5-length × 7-yaw grid whose position poverty was the measured placement-wall
// root cause. Pure: no GPU, no Rapier, no wall-clock (perf logging aside).
import { create as makeRng, type Rng } from "@furnace/core/rng";
import { aabbOfBoxes, type Obb, obbFromLocalAabb } from "./aabb.ts";
import { type CycleUnit, deriveChains } from "./chains.ts";
import {
  type ConnectorKind,
  connectorSection,
  ENCLOSURE_TOP_PAD,
  join,
  type Placement,
  placeConnection,
  placePiece,
  route,
  SHOULDER,
  walkLineAt,
} from "./connect.ts";
import { buildDogleg, cornerCandidates, MIN_SEG_RUN } from "./dogleg.ts";
import {
  FACING_MIN,
  LOCUS_SAMPLES,
  pairFeasible,
  type SeatCandidate,
  sampleSeatLoci,
} from "./locus.ts";
import { Occupancy, type Solid, voxelCellsOf } from "./occupancy.ts";
import type {
  Aabb,
  Connection,
  RegionCollider,
  RegionData,
  Vec3,
} from "./region.ts";
import {
  type NodeId,
  validateGraph,
  type WorldEdge,
  type WorldGraph,
  type WorldNode,
} from "./world-graph.ts";

const DEFAULT_LENGTH_RANGE: [number, number] = [2, 10];
const MAX_ATTEMPTS = 25_000; // occupancy-checked candidates per restart — GATE-TUNE
const MAX_RESTARTS = 8; // seeded restarts before the setup-loud throw — GATE-TUNE
const MAX_UNIT_REVISIONS = 3; // re-seatings of a placed unit under backtracking — GATE-TUNE
const MAX_BACKJUMP_POPS = 4; // units undone per blame-directed backjump — GATE-TUNE
const MAX_SA_LAYOUT_RESTARTS = 2; // SA-enabled whole-layout restarts after greedy fully fails — GATE-TUNE
const MAX_SA_MOVES = 400; // best-response moves per SA restart (bounded — always terminates) — GATE-TUNE
const MAX_SA_RESTARTS = 4; // seeded fresh-init restarts per SA call — GATE-TUNE
const MAX_SA_FIRES_PER_CYCLE = 4; // SA calls per cycle per attempt (rev-0..3 seed diversity; caps
// the cross-unit-backtracking re-fire multiplier that made a multi-cycle world's SA explode) — GATE-TUNE
const SA_T_HI = 0.6; // SA start temperature — GATE-TUNE
const SA_T_LO = 0.2; // SA end temperature — GATE-TUNE
const SA_CLEARANCE_WEIGHT = 4; // energy per clearance-solid violation (m-equivalent) — GATE-TUNE
const SA_FEASIBLE_EPS = 1e-2; // energy below which a state is heuristically feasible → try commit
const SA_COINCIDENT_PENALTY = 1e3; // energy for a degenerate (near-coincident) portal pair
export const CLEARANCE_SEGMENT = 2; // m — climb clearance follows the slope in segments
const PORTAL_EXEMPT_DEPTH = 2.5; // m — clearance-vs-solid exemption reach around a portal
const PORTAL_EXEMPT_PAD = 0.3; // m — exemption box cross-section pad
const PORTAL_EXEMPT_BELOW = 1; // m — exemption box reach below the portal floor
const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];

/** Final portal binding of one edge (indices into each region's `connections`) — the
 *  placer may permute spec-identical portals, so the graph's nominal aPortal/bPortal
 *  are a labelling, not geometry; THIS is what actually mated. */
export type EdgeBinding = { aPortal: number; bPortal: number };

/** A dogleg expansion: indices into `connectors` for the two straight segments and the
 *  corner room-let a cycle-closing edge was routed through (Task 8; empty until then). */
export type DoglegExpansion = { segA: number; corner: number; segB: number };

/** The placer's output: the world placement per node, the placed regions (in graph-node
 *  order), the committed connector pieces (in edge order), the final per-edge portal
 *  bindings, and any dogleg expansions (edge index → its pieces; empty this slice). */
export type LayoutResult = {
  placements: Map<NodeId, Placement>;
  regions: RegionData[];
  /** ALL connector pieces in commit order (dogleg edges contribute 3 entries). */
  connectors: RegionData[];
  /** Per-edge final binding, in graph.edges order. */
  edgeBindings: EdgeBinding[];
  /** Edge index → dogleg piece indices (absent = straight connector). */
  expansions: Map<number, DoglegExpansion>;
};

function placedPortal(region: RegionData, index: number): Connection {
  // Boundary cast: every caller passes an index the graph validated in-range (validateGraph
  // rejects out-of-range edge portals) or one derived from this same region's connections, so
  // the read is never undefined under noUncheckedIndexedAccess.
  return region.connections[index] as Connection;
}

/** Read a map entry that an invariant guarantees is present, failing loud if it ever isn't —
 *  turns a future invariant break into a clear error instead of a cryptic `undefined` read. */
function mustGet<K, V>(map: Map<K, V>, key: K, ctx: string): V {
  const v = map.get(key);
  if (v === undefined)
    throw new Error(`layout: ${ctx} "${String(key)}" not found`);
  return v;
}

/** Lower a placed region's colliders into occupancy `Solid`s — cuboids to conservative
 *  world AABBs, voxel grids to exact yaw-rotatable cell sets. */
function solidsOf(region: RegionData): Solid[] {
  return region.colliders.map((c: RegionCollider): Solid => {
    if ("cuboid" in c.shape) {
      const h = c.shape.cuboid;
      return {
        kind: "box",
        aabb: aabbOfBoxes([
          {
            center: c.position,
            size: [h[0] * 2, h[1] * 2, h[2] * 2],
            rotation: c.rotation,
          },
        ]),
      };
    }
    if ("voxels" in c.shape) {
      const q: [number, number, number, number] = c.rotation ?? IDENTITY_QUAT;
      const yaw = 2 * Math.atan2(q[1], q[3]);
      const size = c.shape.voxels.size;
      return {
        kind: "voxels",
        position: c.position,
        yaw,
        size: [size[0], size[1], size[2]],
        cells: voxelCellsOf(c.shape.voxels.coords),
      };
    }
    throw new Error("layout: unsupported collider shape on a placed region");
  });
}

/** Exact world Obbs of a piece's claim boxes under a placement — the LOCAL region's
 *  envelopes (or bounds, if it declares no compound envelopes) transformed by the
 *  placement's yaw+translation WITHOUT `transformAabb`'s conservative corner-envelope
 *  inflation (a measured false-reject class for pieces yawed 30–45°). */
function envelopeObbs(region: RegionData, place: Placement): Obb[] {
  const locals = region.envelopes ?? [region.bounds];
  return locals.map((e) => obbFromLocalAabb(e, place.yaw, place.translation));
}

/** The reserved walking air between two portals, as axis-aligned segments that follow the
 *  connector's {@link walkLineAt} profile — landing included — so the reserved air matches the
 *  built floor, NOT a straight linear run. A headroom clearance volume, not just a floor slab.
 *  Cross-section comes from {@link connectorSection}, and the top is padded by
 *  ENCLOSURE_TOP_PAD so the reserved air covers the connector's enclosure (ceiling slab
 *  + ring quantization wobble). Exported: the layout↔connect containment contract is
 *  unit-tested against it. */
export function clearanceBoxes(from: Connection, to: Connection): Aabb[] {
  const { width: w, headroom } = connectorSection(from, to);
  const dx = to.position[0] - from.position[0];
  const dz = to.position[2] - from.position[2];
  const run = Math.hypot(dx, dz);
  const dh = to.position[1] - from.position[1];
  const segments = Math.max(1, Math.ceil(run / CLEARANCE_SEGMENT));
  const out: Aabb[] = [];
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const x0 = from.position[0] + dx * t0;
    const x1 = from.position[0] + dx * t1;
    const z0 = from.position[2] + dz * t0;
    const z1 = from.position[2] + dz * t1;
    const y0 = walkLineAt(dh, run, t0 * run);
    const y1 = walkLineAt(dh, run, t1 * run);
    const yLo = from.position[1] + Math.min(y0, y1);
    const yHi =
      from.position[1] + Math.max(y0, y1) + headroom + ENCLOSURE_TOP_PAD;
    out.push({
      min: [Math.min(x0, x1) - w / 2, yLo, Math.min(z0, z1) - w / 2],
      max: [Math.max(x0, x1) + w / 2, yHi, Math.max(z0, z1) + w / 2],
    });
  }
  return out;
}

// The exemption's vertical reach used to be `headroom + ENCLOSURE_TOP_PAD` — the
// CONNECTOR's own clearance height. But the exemption answers a DIFFERENT question
// ("how far does THIS portal's own built/organic structure reach above its floor"),
// which is NOT bounded by the connector's headroom: a cave's rock overhang above a
// mouth reaches the HUB's ceiling (~7m) and a greatHall's lintel reaches its own room
// ceiling (up to 9m) — both far above a 2.8m door + 0.55m pad. Verified empirically
// (2026-07-04 placement investigation): even a single-mouth cave's ENTRY edge, at
// candidate yaw=0, rejected via `clearance-solid` against the cave's OWN rock or its
// OWN collar lintel — candidate/yaw-INVARIANT. Floored at a constant covering every
// current theme's worst case (greatHall height <= 9) with margin; never SMALLER than
// the prior headroom-derived reach.
const PORTAL_EXEMPT_ABOVE = 10; // m above portal floor — GATE-TUNE

/** The exemption box around a portal — the connector is allowed to bore through its own
 *  endpoint pieces' solids here (a mouth necessarily pierces its own wall). The box
 *  reaches at least PORTAL_EXEMPT_ABOVE above the portal floor — never less than the
 *  connector's own headroom + ENCLOSURE_TOP_PAD, so its ceiling band always stays inside
 *  the exemption at the portal; PORTAL_EXEMPT_PAD is the LATERAL cross-section pad only. */
function portalExemption(portal: Connection, headroom: number): Aabb {
  const w = portal.width / 2 + SHOULDER + PORTAL_EXEMPT_PAD;
  const d = PORTAL_EXEMPT_DEPTH;
  const above = Math.max(headroom + ENCLOSURE_TOP_PAD, PORTAL_EXEMPT_ABOVE);
  return {
    min: [
      portal.position[0] - w - d,
      portal.position[1] - PORTAL_EXEMPT_BELOW,
      portal.position[2] - w - d,
    ],
    max: [
      portal.position[0] + w + d,
      portal.position[1] + above,
      portal.position[2] + w + d,
    ],
  };
}

// ---------------------------------------------------------------------------------------
// Scheduling primitives
// ---------------------------------------------------------------------------------------

/** Undirected adjacency (node id → neighbour ids, with edge multiplicity). */
function buildAdjacency(graph: WorldGraph): Map<NodeId, NodeId[]> {
  const adj = new Map<NodeId, NodeId[]>();
  for (const e of graph.edges) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  return adj;
}

/** BFS depth of every node from the pinned skeleton (pins = 0), for the placement-order
 *  tie-break. Unreachable nodes never appear (the graph is validated connected). */
function depthFromPins(graph: WorldGraph): Map<NodeId, number> {
  const adj = buildAdjacency(graph);
  const pinned = graph.nodes.filter((n) => n.pinned).map((n) => n.id);
  const depth = new Map<NodeId, number>(pinned.map((id) => [id, 0]));
  const queue = [...pinned];
  while (queue.length) {
    // Boundary cast: the `while (queue.length)` guard proves the queue is non-empty.
    const id = queue.shift() as NodeId;
    for (const nb of adj.get(id) ?? []) {
      if (!depth.has(nb)) {
        depth.set(nb, mustGet(depth, id, "depth") + 1);
        queue.push(nb);
      }
    }
  }
  return depth;
}

// ---------------------------------------------------------------------------------------
// Placer state
// ---------------------------------------------------------------------------------------

/** All mutable + precomputed state for ONE placement attempt (a restart is a clean slate).
 *  `adj`/`depth` are precomputed immutable for the attempt; everything else mutates as the
 *  scheduler places, backtracks, and rolls back. */
type Ctx = {
  graph: WorldGraph;
  nodesById: Map<NodeId, WorldNode>;
  closingEdges: Set<number>;
  rng: Rng;
  occ: Occupancy;
  placements: Map<NodeId, Placement>;
  placedRegions: Map<NodeId, RegionData>;
  /** node id → portal indices consumed by committed edge bindings. */
  portalUse: Map<NodeId, Set<number>>;
  edgeBindings: Map<number, EdgeBinding>;
  committedConnectors: Map<number, RegionData[]>;
  /** Edges committed while placing each node (for rollback). */
  nodeEdges: Map<NodeId, number[]>;
  attempts: number;
  failCounts: Map<NodeId, Map<string, number>>;
  adj: Map<NodeId, NodeId[]>;
  depth: Map<NodeId, number>;
  /** Whether the SA cycle-repair fallback (Task 8B) may fire. FALSE for the pure-greedy
   *  restarts (so any graph greedy can place returns byte-identical to the pre-8B placer);
   *  TRUE only for the fallback restarts reached when greedy fully fails. */
  saEnabled: boolean;
  /** Per-cycle (closing-edge id → count) SA-call tally this attempt. Capped at
   *  MAX_SA_FIRES_PER_CYCLE: the initial rev-0..3 fires get distinct seeds (real diversity —
   *  the same cycle can close on a rev-1 seed when rev-0's search misses), but the unbounded
   *  cross-unit-backtracking re-fires (which made a 30-room world's SA blow up) are cut off. */
  saAttempted: Map<number, number>;
};

/** A schedulable unit and the revision stream that placed it — cycles carry their unit,
 *  tree nodes carry their id; `rev` reseeds the candidate stream under backtracking. */
type PlacedUnit =
  | { kind: "cycle"; unit: CycleUnit; rev: number }
  | { kind: "node"; id: NodeId; rev: number };

/** An edge one of whose endpoints is the node being placed, with its graph.edges index. */
type ActiveEdge = { e: WorldEdge; i: number };

/** A binding pair local to the node being placed: which PARENT-side portal (index into the
 *  already-placed endpoint's connections) and which NODE-side portal serve the edge. */
type BindPair = { parent: number; node: number };

function neighbours(ctx: Ctx, id: NodeId): NodeId[] {
  return ctx.adj.get(id) ?? [];
}

function countFail(ctx: Ctx, id: NodeId, key: string): void {
  const m = ctx.failCounts.get(id) ?? new Map<string, number>();
  m.set(key, (m.get(key) ?? 0) + 1);
  ctx.failCounts.set(id, m);
}

function usePortal(ctx: Ctx, id: NodeId, portal: number): void {
  const s = ctx.portalUse.get(id) ?? new Set<number>();
  s.add(portal);
  ctx.portalUse.set(id, s);
}

function freePortal(ctx: Ctx, id: NodeId, portal: number): void {
  const s = ctx.portalUse.get(id);
  if (!s) return;
  s.delete(portal);
  if (s.size === 0) ctx.portalUse.delete(id);
}

/** In-place Fisher–Yates shuffle over a seeded stream (int is inclusive-min, exclusive-max). */
function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    // Boundary cast: i (loop-bounded < arr.length) and j (rng.int(0, i+1) ∈ [0, i]) are both
    // valid indices of arr, so these reads are never undefined.
    const t = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = t;
  }
}

const specMatch = (a: Connection, b: Connection): boolean =>
  a.width === b.width && a.height === b.height && a.kind === b.kind;

/** The length window a NOW-both-placed edge must satisfy to be realizable, distinct from the
 *  SEAT sampling window (`e.lengthRange ?? DEFAULT`, which bounds where the seat samples
 *  positions). An edge's `lengthRange` is a sampling window authored for the seat; for a
 *  forward-checked / cycle-closing edge whose run is EMERGENT from two already-fixed pieces
 *  (not sampled), an arbitrary DEFAULT upper cap would force needless backtracking (the hand
 *  world's ~10 m flat closer). So: honour an EXPLICIT range fully, but when the edge relies
 *  on the default, keep only the lower bound (route-buildability) and leave the upper open —
 *  matching the pre-B2c closing-edge check, which never length-capped non-seat edges. */
function feasRange(e: WorldEdge): [number, number] {
  if (e.lengthRange) return e.lengthRange;
  return [DEFAULT_LENGTH_RANGE[0], Number.POSITIVE_INFINITY];
}

/** Midpoint of an edge's SEAT sampling window (not `feasRange`, whose default upper bound is
 *  ∞) — the nominal connector length a steering estimate assumes. */
function midLength(e: WorldEdge): number {
  const [lo, hi] = e.lengthRange ?? DEFAULT_LENGTH_RANGE;
  return (lo + hi) / 2;
}

/** Mean XZ half-extent of a region's local bounds — a rough radius used to space polygon
 *  vertices so adjacent rooms don't overlap (each vertex sits ~one connector + both radii). */
function extentXZ(region: RegionData): number {
  const b = region.bounds;
  return (b.max[0] - b.min[0] + (b.max[2] - b.min[2])) / 4;
}

/** Horizontal (XZ) distance between two world points. */
function xzDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** Project a point along a direction by a signed scalar: `base + dir · dist` (a negative
 *  `dist` steps opposite the direction — e.g. a portal position back to its room centre). */
function projectAlong(base: Vec3, dir: Vec3, dist: number): Vec3 {
  return [
    base[0] + dir[0] * dist,
    base[1] + dir[1] * dist,
    base[2] + dir[2] * dist,
  ];
}

// ---------------------------------------------------------------------------------------
// Edge realizability + commit
// ---------------------------------------------------------------------------------------

/** Realizability of a NOW-both-placed edge with a chosen a/b portal binding: facings mate
 *  within range (`pairFeasible`), `route` builds, and the connector's clearance volume is
 *  unobstructed (portal-exempted at both ends). Returns the connector or a fail reason. */
function realizeEdge(
  ctx: Ctx,
  e: WorldEdge,
  pa: Connection,
  pb: Connection,
): { connector: RegionData } | { fail: string } {
  if (!pairFeasible(pa, pb, feasRange(e))) return { fail: "facing" };
  let connector: RegionData;
  try {
    const opts: { kind?: ConnectorKind; enclosure?: "open" } = {};
    if (e.kind) opts.kind = e.kind;
    if (e.enclosure) opts.enclosure = e.enclosure;
    connector = route(pa, pb, opts);
  } catch {
    return { fail: "route-throw" };
  }
  const { headroom } = connectorSection(pa, pb);
  const clearance = clearanceBoxes(pa, pb);
  const exemptions = [
    portalExemption(pa, headroom),
    portalExemption(pb, headroom),
  ];
  const rej = ctx.occ.checkClearance(clearance, [e.a, e.b], exemptions);
  if (rej) return { fail: `${rej.rule}:${rej.against}` };
  return { connector };
}

/** Remove every occupancy entry a committed edge may own — a straight connector's clearance
 *  (`edge:i`) OR a dogleg's three (`edge:i:corner` piece + `edge:i:segA`/`:segB` clearances) —
 *  plus its committed-connector + binding records. Non-existent ids no-op, so one call covers
 *  both the straight and dogleg cases; callers that need the binding must read it FIRST. */
function removeEdgeOccupancy(ctx: Ctx, ei: number): void {
  ctx.occ.remove(`edge:${ei}`);
  ctx.occ.remove(`edge:${ei}:corner`);
  ctx.occ.remove(`edge:${ei}:segA`);
  ctx.occ.remove(`edge:${ei}:segB`);
  ctx.committedConnectors.delete(ei);
  ctx.edgeBindings.delete(ei);
}

/** Route a cycle-closing edge that cannot mate straight through a corner room-let (`dogleg.ts`):
 *  try each seeded corner seating; the first whose corner PIECE and both straight segment
 *  CLEARANCES clear occupancy (portal-exempted at all four portals) registers the three pieces
 *  (corner via `addPiece`, each segment's air via `addClearance`) and is returned. Every partial
 *  occupancy add is rolled back before the next candidate, so a `fail` leaves the ledger clean. */
function tryDogleg(
  ctx: Ctx,
  edgeIdx: number,
  pa: Connection,
  pb: Connection,
  e: WorldEdge,
): { pieces: RegionData[] } | { fail: string } {
  const hi = (e.lengthRange ?? DEFAULT_LENGTH_RANGE)[1];
  const cornerId = `edge:${edgeIdx}:corner`;
  const cands = cornerCandidates(
    pa,
    pb,
    [MIN_SEG_RUN, hi],
    ctx.rng.derive(`dog:${edgeIdx}`),
    24,
  );
  const opts: { enclosure?: "open" } = {};
  if (e.enclosure) opts.enclosure = e.enclosure;
  for (const cand of cands) {
    let dog: ReturnType<typeof buildDogleg>;
    try {
      dog = buildDogleg(pa, pb, cand, opts);
    } catch {
      continue; // a corner whose segments route-throw (unwalkable pitch) — try the next
    }
    const cornerEnvs = envelopeObbs(dog.cornerLocal, cand.place);
    if (ctx.occ.checkPieceEnvelope(cornerEnvs)) continue;
    ctx.occ.addPiece(cornerId, cornerEnvs, solidsOf(dog.corner));

    const door1 = placedPortal(dog.corner, 0);
    const door2 = placedPortal(dog.corner, 1);
    const clearA = clearanceBoxes(pa, door1);
    const clearB = clearanceBoxes(door2, pb);
    const hA = connectorSection(pa, door1).headroom;
    const hB = connectorSection(door2, pb).headroom;
    const exemptions = [
      portalExemption(pa, hA),
      portalExemption(door1, hA),
      portalExemption(door2, hB),
      portalExemption(pb, hB),
    ];
    // Both segments check against the SAME ledger state (corner added, neither segment clearance
    // added yet) so their reserved air can't false-reject against each other at the corner seam.
    const rejA = ctx.occ.checkClearance(clearA, [e.a, cornerId], exemptions);
    const rejB = ctx.occ.checkClearance(clearB, [cornerId, e.b], exemptions);
    if (rejA || rejB) {
      ctx.occ.remove(cornerId);
      continue;
    }
    ctx.occ.addClearance(
      `edge:${edgeIdx}:segA`,
      clearA,
      [e.a, cornerId],
      [],
      solidsOf(dog.segA),
    );
    ctx.occ.addClearance(
      `edge:${edgeIdx}:segB`,
      clearB,
      [cornerId, e.b],
      [],
      solidsOf(dog.segB),
    );
    return { pieces: [dog.segA, dog.corner, dog.segB] };
  }
  return { fail: "no-corner" };
}

/** Map a BindPair (parent/node portal) to an EdgeBinding (a/b portal) via edge orientation. */
function toEdgeBinding(
  e: WorldEdge,
  nodeId: NodeId,
  bind: BindPair,
): EdgeBinding {
  return e.a === nodeId
    ? { aPortal: bind.node, bPortal: bind.parent }
    : { aPortal: bind.parent, bPortal: bind.node };
}

/** Commit the seat edge and every other active edge of the just-placed node `id` using the
 *  chosen bindings: each realizes via `route` + clearance and, on success, its clearance +
 *  connector join the ledger and its portals + binding are recorded. On ANY edge failing,
 *  the whole node placement (its committed edges, portal uses, and the speculative piece
 *  already added by `placeNode`) rolls back and this returns false. */
function commitEdges(
  ctx: Ctx,
  id: NodeId,
  seat: ActiveEdge,
  seatBind: BindPair,
  others: ActiveEdge[],
  otherBinds: Map<number, EdgeBinding>,
  doglegEdges: Set<number>,
): boolean {
  const committed: number[] = [];
  const usedPortals: [NodeId, number][] = [];
  const rollback = (): void => {
    for (const ei of committed) removeEdgeOccupancy(ctx, ei);
    for (const [nid, p] of usedPortals) freePortal(ctx, nid, p);
    ctx.occ.remove(id);
    ctx.placements.delete(id);
    ctx.placedRegions.delete(id);
  };

  const plan: { ae: ActiveEdge; bind: EdgeBinding }[] = [
    { ae: seat, bind: toEdgeBinding(seat.e, id, seatBind) },
  ];
  for (const oe of others) {
    const bind = otherBinds.get(oe.i);
    if (!bind) {
      rollback();
      return false;
    }
    plan.push({ ae: oe, bind });
  }

  for (const { ae, bind } of plan) {
    const e = ae.e;
    const aRegion = mustGet(ctx.placedRegions, e.a, "placed region");
    const bRegion = mustGet(ctx.placedRegions, e.b, "placed region");
    const pa = placedPortal(aRegion, bind.aPortal);
    const pb = placedPortal(bRegion, bind.bPortal);
    if (doglegEdges.has(ae.i)) {
      const res = tryDogleg(ctx, ae.i, pa, pb, e);
      if ("fail" in res) {
        countFail(ctx, id, `dogleg:${res.fail}:${ae.i}`);
        rollback();
        return false;
      }
      ctx.committedConnectors.set(ae.i, res.pieces);
    } else {
      const res = realizeEdge(ctx, e, pa, pb);
      if ("fail" in res) {
        countFail(ctx, id, `edge[commit]:${res.fail}:${ae.i}`);
        rollback();
        return false;
      }
      ctx.occ.addClearance(
        `edge:${ae.i}`,
        clearanceBoxes(pa, pb),
        [e.a, e.b],
        [],
        solidsOf(res.connector),
      );
      ctx.committedConnectors.set(ae.i, [res.connector]);
    }
    ctx.edgeBindings.set(ae.i, bind);
    usePortal(ctx, e.a, bind.aPortal);
    usedPortals.push([e.a, bind.aPortal]);
    usePortal(ctx, e.b, bind.bPortal);
    usedPortals.push([e.b, bind.bPortal]);
    committed.push(ae.i);
  }

  ctx.nodeEdges.set(id, committed);
  return true;
}

// ---------------------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------------------

/** THE spec-match-free-portal enumeration: portal indices on a region spec-matching `nom`
 *  and not already used or reserved, in connection (source) order. Shared by the seat binder
 *  and the forward-check binder so the idiom lives in one place; the seat binder relies on the
 *  source order (its downstream shuffle is order-sensitive). */
function matchingFreePortals(
  conns: readonly Connection[],
  nom: Connection,
  used: Set<number>,
  reserved: Set<number>,
): number[] {
  return conns
    .map((c, i): [Connection, number] => [c, i])
    .filter(([c, i]) => !used.has(i) && !reserved.has(i) && specMatch(c, nom))
    .map(([, i]) => i);
}

/** {@link matchingFreePortals} reordered nominal-index-first, so the canonical binding is
 *  tried before its spec-identical alternatives. */
function freePortals(
  conns: readonly Connection[],
  nom: Connection,
  used: Set<number>,
  reserved: Set<number>,
  nomIndex: number,
): number[] {
  const idx = matchingFreePortals(conns, nom, used, reserved);
  return [
    ...idx.filter((i) => i === nomIndex),
    ...idx.filter((i) => i !== nomIndex),
  ];
}

/** All valid (parent-portal, node-portal) binding pairs for the SEAT edge of `id`:
 *  parent-side = free portals on the placed endpoint spec-matching the edge's nominal
 *  parent portal; node-side = free portals on `id` spec-matching the nominal node portal.
 *  Ordered nominal-pair-first, the rest seeded-shuffled — so simple worlds stay stable and
 *  retries explore. */
function bindingCandidates(
  ctx: Ctx,
  ae: ActiveEdge,
  id: NodeId,
  rng: Rng,
): BindPair[] {
  const e = ae.e;
  const nodeIsA = e.a === id;
  const parentId = nodeIsA ? e.b : e.a;
  const nomNode = nodeIsA ? e.aPortal : e.bPortal;
  const nomParent = nodeIsA ? e.bPortal : e.aPortal;
  const parentRegion = mustGet(ctx.placedRegions, parentId, "placed region");
  const nodeRegion = mustGet(ctx.nodesById, id, "node").region;
  const parentUse = ctx.portalUse.get(parentId) ?? new Set<number>();
  const nodeUse = ctx.portalUse.get(id) ?? new Set<number>();
  const noReserve = new Set<number>();
  const parentPorts = matchingFreePortals(
    parentRegion.connections,
    placedPortal(parentRegion, nomParent),
    parentUse,
    noReserve,
  );
  const nodePorts = matchingFreePortals(
    nodeRegion.connections,
    placedPortal(nodeRegion, nomNode),
    nodeUse,
    noReserve,
  );

  const pairs: BindPair[] = [];
  for (const p of parentPorts)
    for (const n of nodePorts) pairs.push({ parent: p, node: n });
  const isNominal = (b: BindPair): boolean =>
    b.parent === nomParent && b.node === nomNode;
  const nominal = pairs.filter(isNominal);
  const rest = pairs.filter((b) => !isNominal(b));
  shuffle(rest, rng);
  return [...nominal, ...rest];
}

/** Forward-check ONE other active edge of `id` at a candidate placement: find the first free
 *  spec-matching (partner-portal, node-portal) binding whose two world portals are
 *  `pairFeasible` within the edge's range, honouring portals already reserved by the seat
 *  and earlier siblings. Returns the binding plus the two portal indices it consumes. */
function firstFeasibleBinding(
  ctx: Ctx,
  oe: ActiveEdge,
  id: NodeId,
  placement: Placement,
  reservedNode: Set<number>,
  reservedByPartner: Map<NodeId, Set<number>>,
): { binding: EdgeBinding; nodePortal: number; partnerPortal: number } | null {
  const e = oe.e;
  const nodeIsA = e.a === id;
  const partnerId = nodeIsA ? e.b : e.a;
  const nomNode = nodeIsA ? e.aPortal : e.bPortal;
  const nomPartner = nodeIsA ? e.bPortal : e.aPortal;
  const partnerRegion = mustGet(ctx.placedRegions, partnerId, "placed region");
  const nodeRegion = mustGet(ctx.nodesById, id, "node").region;
  const partnerUse = ctx.portalUse.get(partnerId) ?? new Set<number>();
  const nodeUse = ctx.portalUse.get(id) ?? new Set<number>();
  const partnerReserved = reservedByPartner.get(partnerId) ?? new Set<number>();
  const partnerNom = placedPortal(partnerRegion, nomPartner);
  const nodeNom = placedPortal(nodeRegion, nomNode);
  const range = feasRange(e);

  const partnerPorts = freePortals(
    partnerRegion.connections,
    partnerNom,
    partnerUse,
    partnerReserved,
    nomPartner,
  );
  const nodePorts = freePortals(
    nodeRegion.connections,
    nodeNom,
    nodeUse,
    reservedNode,
    nomNode,
  );

  for (const pj of nodePorts) {
    const nodeWorld = placeConnection(placedPortal(nodeRegion, pj), placement);
    for (const pp of partnerPorts) {
      const partnerWorld = placedPortal(partnerRegion, pp);
      const [aW, bW] = nodeIsA
        ? [nodeWorld, partnerWorld]
        : [partnerWorld, nodeWorld];
      if (pairFeasible(aW, bW, range)) {
        const binding: EdgeBinding = nodeIsA
          ? { aPortal: pj, bPortal: pp }
          : { aPortal: pp, bPortal: pj };
        return { binding, nodePortal: pj, partnerPortal: pp };
      }
    }
  }
  return null;
}

/** The dogleg counterpart of {@link firstFeasibleBinding} for a CLOSING edge with no straight
 *  binding: same free spec-matching portal enumeration, but a pair is "viable" when a corner
 *  room-let can bridge it (`cornerCandidates` non-empty over `[MIN_SEG_RUN, edge-upper]`) rather
 *  than when its facings mate straight. Pure existence trig — the actual corner is placed at
 *  commit (`tryDogleg`). Same edge-orientation (a→b) as commit, so a viable forward-check pair
 *  is the pair commit will try. */
function firstDoglegBinding(
  ctx: Ctx,
  oe: ActiveEdge,
  id: NodeId,
  placement: Placement,
  reservedNode: Set<number>,
  reservedByPartner: Map<NodeId, Set<number>>,
): { binding: EdgeBinding; nodePortal: number; partnerPortal: number } | null {
  const e = oe.e;
  const nodeIsA = e.a === id;
  const partnerId = nodeIsA ? e.b : e.a;
  const nomNode = nodeIsA ? e.aPortal : e.bPortal;
  const nomPartner = nodeIsA ? e.bPortal : e.aPortal;
  const partnerRegion = mustGet(ctx.placedRegions, partnerId, "placed region");
  const nodeRegion = mustGet(ctx.nodesById, id, "node").region;
  const partnerUse = ctx.portalUse.get(partnerId) ?? new Set<number>();
  const nodeUse = ctx.portalUse.get(id) ?? new Set<number>();
  const partnerReserved = reservedByPartner.get(partnerId) ?? new Set<number>();
  const partnerNom = placedPortal(partnerRegion, nomPartner);
  const nodeNom = placedPortal(nodeRegion, nomNode);
  const hi = (e.lengthRange ?? DEFAULT_LENGTH_RANGE)[1];
  const rng = ctx.rng.derive(`fwd-dog:${id}:${oe.i}`);

  const partnerPorts = freePortals(
    partnerRegion.connections,
    partnerNom,
    partnerUse,
    partnerReserved,
    nomPartner,
  );
  const nodePorts = freePortals(
    nodeRegion.connections,
    nodeNom,
    nodeUse,
    reservedNode,
    nomNode,
  );

  for (const pj of nodePorts) {
    const nodeWorld = placeConnection(placedPortal(nodeRegion, pj), placement);
    for (const pp of partnerPorts) {
      const partnerWorld = placedPortal(partnerRegion, pp);
      const [pa, pb] = nodeIsA
        ? [nodeWorld, partnerWorld]
        : [partnerWorld, nodeWorld];
      const viable =
        cornerCandidates(
          pa,
          pb,
          [MIN_SEG_RUN, hi],
          rng.derive(`${pj}:${pp}`),
          12,
        ).length > 0;
      if (viable) {
        const binding: EdgeBinding = nodeIsA
          ? { aPortal: pj, bPortal: pp }
          : { aPortal: pp, bPortal: pj };
        return { binding, nodePortal: pj, partnerPortal: pp };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Node placement
// ---------------------------------------------------------------------------------------

/** The active edges of `id` (each with the other endpoint already placed), in graph order. */
function activeEdges(ctx: Ctx, id: NodeId): ActiveEdge[] {
  return ctx.graph.edges
    .map((e, i): ActiveEdge => ({ e, i }))
    .filter(
      ({ e }) =>
        (e.a === id && ctx.placements.has(e.b)) ||
        (e.b === id && ctx.placements.has(e.a)),
    );
}

/** The WORLD Connection of the seat edge's already-placed parent under the chosen binding. */
function boundParentPortal(
  ctx: Ctx,
  seat: ActiveEdge,
  id: NodeId,
  seatBind: BindPair,
): Connection {
  const parentId = seat.e.a === id ? seat.e.b : seat.e.a;
  const parentRegion = mustGet(ctx.placedRegions, parentId, "placed region");
  return placedPortal(parentRegion, seatBind.parent);
}

/** Seat one node against its already-placed neighbours. Its FIRST active edge is the seat
 *  (drives position via continuous loci off the bound parent portal); every OTHER active
 *  edge is forward-checked for a feasible binding BEFORE occupancy, then the piece is
 *  speculatively committed and all edges realized. Tries binding permutations × loci samples
 *  until one clears every rule; returns false when exhausted (the caller backtracks).
 *
 *  `explore` (a re-seating under backtracking) drops the canonical seat locus from the front
 *  of the list and seeded-shuffles the whole locus set: a node whose OWN placement is never
 *  blocked (only its unplaced descendants are) would otherwise re-take the exact canonical
 *  seat every revision, so backtracking to it could never move it — the reseeded shuffle is
 *  what actually lets an ancestor swing off-axis to clear a descendant. */
/** Forward-check every OTHER active edge of `id` at a candidate placement: assign each a free
 *  spec-matching binding that is `pairFeasible`, threading the reservations so no two edges
 *  (including the seat) double-use a portal. Returns the per-edge bindings, or `null` the
 *  moment any edge has no feasible binding (recording the `edge[fwd]:facing` diagnostic). */
function forwardCheckOthers(
  ctx: Ctx,
  id: NodeId,
  placement: Placement,
  seatBind: BindPair,
  seatParentId: NodeId,
  others: ActiveEdge[],
): { binds: Map<number, EdgeBinding>; doglegEdges: Set<number> } | null {
  const reservedNode = new Set<number>([seatBind.node]);
  const reservedByPartner = new Map<NodeId, Set<number>>([
    [seatParentId, new Set<number>([seatBind.parent])],
  ]);
  const binds = new Map<number, EdgeBinding>();
  const doglegEdges = new Set<number>();
  for (const oe of others) {
    let found = firstFeasibleBinding(
      ctx,
      oe,
      id,
      placement,
      reservedNode,
      reservedByPartner,
    );
    // Dogleg-aware forward-checking: a CLOSING edge that cannot mate straight does NOT fail the
    // candidate if a corner room-let can bridge it (a pure-trig existence check) — without this
    // the commit-time dogleg is unreachable (forward-checking would reject the candidate first).
    // Only closing edges get this slack; every other edge stays straight-only.
    let dogleg = false;
    if (!found && ctx.closingEdges.has(oe.i)) {
      found = firstDoglegBinding(
        ctx,
        oe,
        id,
        placement,
        reservedNode,
        reservedByPartner,
      );
      if (found) dogleg = true;
    }
    if (!found) {
      countFail(ctx, id, `edge[fwd]:facing:${oe.i}`);
      return null;
    }
    binds.set(oe.i, found.binding);
    if (dogleg) doglegEdges.add(oe.i);
    reservedNode.add(found.nodePortal);
    const partnerId = oe.e.a === id ? oe.e.b : oe.e.a;
    const set = reservedByPartner.get(partnerId) ?? new Set<number>();
    set.add(found.partnerPortal);
    reservedByPartner.set(partnerId, set);
  }
  return { binds, doglegEdges };
}

/** Obligation points folded into a node's steering target: for each OTHER active edge, the
 *  partner's nominal portal projected outward by a mid-length connector PLUS the node's own
 *  radius — i.e. where the node's CENTRE would sit if it mated that partner. Kept in the same
 *  room-centre space as the polygon target so the two average cleanly. Pulls a multi-edge node
 *  toward satisfying all its partners at once. */
function obligationPoints(
  ctx: Ctx,
  id: NodeId,
  others: ActiveEdge[],
  nodeHalf: number,
): Vec3[] {
  return others.map((oe): Vec3 => {
    const e = oe.e;
    const nodeIsA = e.a === id;
    const partnerId = nodeIsA ? e.b : e.a;
    const nomPartner = nodeIsA ? e.bPortal : e.aPortal;
    const pp = placedPortal(
      mustGet(ctx.placedRegions, partnerId, "placed region"),
      nomPartner,
    );
    const reach = midLength(e) + nodeHalf;
    return projectAlong(pp.position, pp.facing, reach);
  });
}

/** Component-wise mean of world points, or `undefined` for an empty set (no steering). */
function averagePoint(pts: Vec3[]): Vec3 | undefined {
  if (pts.length === 0) return undefined;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / pts.length, y / pts.length, z / pts.length];
}

/** Reorder a node's seat loci to bias the search toward a steering target: the canonical sample
 *  (index 0) stays first; the rest are stable-sorted nearest-first by the XZ distance of their
 *  implied room CENTRE (seat portal projected outward by the node's radius `nodeHalf`) to
 *  `target` — a centre-space target so it stays inside the reachable annulus. The explicit `idx`
 *  tiebreak keeps it deterministic regardless of sort stability. Mutates `loci` in place,
 *  reordering the SAME set — never drops a candidate, so completeness is preserved. */
function rankLociTowardTarget(
  loci: SeatCandidate[],
  target: Vec3,
  nodeHalf: number,
): void {
  // Boundary cast: sampleSeatLoci always returns the canonical sample at index 0.
  const head = loci[0] as SeatCandidate;
  const ranked = loci
    .slice(1)
    .map((cand, idx) => ({
      cand,
      idx,
      d: xzDist(
        projectAlong(cand.target.position, cand.target.facing, nodeHalf),
        target,
      ),
    }))
    .sort((a, b) => a.d - b.d || a.idx - b.idx);
  loci.length = 0;
  loci.push(head, ...ranked.map((rk) => rk.cand));
}

function placeNode(
  ctx: Ctx,
  id: NodeId,
  stream: string,
  explore = false,
  polygonTarget?: Vec3,
): boolean {
  const node = mustGet(ctx.nodesById, id, "node");
  const active = activeEdges(ctx, id);
  if (active.length === 0)
    throw new Error(`layout: node "${id}" has no placed neighbour`);
  // Boundary cast: the `active.length === 0` throw above proves `active` is non-empty, so it
  // structurally matches the [head, ...tail] tuple.
  const [seat, ...others] = active as [ActiveEdge, ...ActiveEdge[]];
  const r = ctx.rng.derive(`cand:${stream}`);

  // The steering target: the polygon-target vertex (cycle members) averaged with the obligation
  // points of every OTHER active edge. Absent for a plain tree node (single active edge, no
  // polygon) — those keep the canonical align / explore shuffle below. Steering only REORDERS
  // the candidate loci (canonical stays first); it never drops one, so completeness is preserved.
  // All steering targets live in ROOM-CENTRE space (see `cycleAttachFrame`), so a candidate is
  // ranked by the distance of its implied room centre — the seat portal projected outward by the
  // node's radius — to the target.
  const nodeHalf = extentXZ(node.region);
  const steer = averagePoint([
    ...(polygonTarget ? [polygonTarget] : []),
    ...obligationPoints(ctx, id, others, nodeHalf),
  ]);

  for (const seatBind of bindingCandidates(ctx, seat, id, r.derive("bind"))) {
    const parentPortal = boundParentPortal(ctx, seat, id, seatBind);
    const nodePortalLocal = placedPortal(node.region, seatBind.node);
    const dhSigned = (seat.e.heightDelta ?? 0) * (seat.e.b === id ? 1 : -1);
    const range = seat.e.lengthRange ?? DEFAULT_LENGTH_RANGE;
    const seatParentId = seat.e.a === id ? seat.e.b : seat.e.a;

    const loci = sampleSeatLoci(
      parentPortal,
      range,
      dhSigned,
      r.derive(`loci:${seatBind.parent}:${seatBind.node}`),
      LOCUS_SAMPLES,
    );
    if (steer && !explore) {
      // Closure steering: bias the canonical first-try candidate order toward the steering
      // target (see `rankLociTowardTarget`). Skipped on a backtracking (`explore`) re-seat
      // BECAUSE the ranking is DETERMINISTIC: re-applying it reproduces the same locus order →
      // the same foreclosure → no progress. The shuffle branch owns repair — its diversification
      // is what escapes the trap.
      rankLociTowardTarget(loci, steer, nodeHalf);
    } else if (explore) {
      shuffle(loci, r.derive(`explore:${seatBind.parent}:${seatBind.node}`));
    } else {
      // Canonical pass: prefer the STRAIGHTEST connectors (bearing nearest the parent
      // portal's outward normal) first, so a node whose dead-ahead short seating is rejected
      // (e.g. its envelope clips the parent near the seam) falls back to a straight LONGER
      // seating before a yawed one — keeping tree rooms axis-aligned instead of cocked off at
      // a bearing. `explore` still shuffles, so backtracking can escape a straight-only trap.
      const align = (c: (typeof loci)[number]): number =>
        c.target.facing[0] * parentPortal.facing[0] +
        c.target.facing[2] * parentPortal.facing[2];
      loci.sort((a, b) => align(b) - align(a));
    }

    // Evaluate each candidate's placement + cheap geometric forward-check of the OTHER active
    // edges (each must have >= 1 free spec-matching binding under this placement) ONCE, up front.
    // Then a STABLE THREE-WAY partition for a member with >= 2 active edges (a cycle-closing seat):
    //   1. candidates whose every other edge mates STRAIGHT (doglegEdges empty),
    //   2. candidates that need a dogleg on some closing edge (doglegEdges non-empty),
    //   3. candidates with no feasible binding at all,
    // in original (align/explore) order within each band. Bands 1 vs 2 make STRAIGHT-FIRST a hard
    // rule: a fully-straight closure is always committed before any dogleg is attempted, so a
    // world that CAN close straight always does (`expansions` stays empty). Band 1 is bit-identical
    // to the pre-dogleg feasible set/order, so the straight-closable regression anchor is preserved.
    // Single-edge members (`others` empty) keep their order untouched.
    const evaluated = loci.map((cand) => {
      const target: Connection = {
        ...cand.target,
        width: nodePortalLocal.width,
        height: nodePortalLocal.height,
      };
      const placement = join(target, nodePortalLocal);
      const fc = forwardCheckOthers(
        ctx,
        id,
        placement,
        seatBind,
        seatParentId,
        others,
      );
      return { placement, fc };
    });
    const ordered =
      others.length > 0
        ? [
            ...evaluated.filter((e) => e.fc && e.fc.doglegEdges.size === 0),
            ...evaluated.filter((e) => e.fc && e.fc.doglegEdges.size > 0),
            ...evaluated.filter((e) => !e.fc),
          ]
        : evaluated;

    for (const { placement, fc } of ordered) {
      if (++ctx.attempts > MAX_ATTEMPTS) return false;
      if (!fc) continue;

      const envs = envelopeObbs(node.region, placement);
      const envRej = ctx.occ.checkPieceEnvelope(envs);
      if (envRej) {
        countFail(ctx, id, `${envRej.rule}:${envRej.against}`);
        continue;
      }

      // Commit the piece speculatively, then realize every active edge (seat first).
      const placed = placePiece(node.region, placement);
      ctx.placements.set(id, placement);
      ctx.placedRegions.set(id, placed);
      ctx.occ.addPiece(id, envs, solidsOf(placed));
      if (
        commitEdges(ctx, id, seat, seatBind, others, fc.binds, fc.doglegEdges)
      )
        return true;
      // commitEdges rolled back the speculative piece + any committed edges on failure.
    }
  }
  return false;
}

/** Reverse of a node's commit: drop its committed edges (clearance air + connectors + a dogleg's
 *  corner piece + bindings + BOTH-endpoint portal uses), then the piece itself. The binding is
 *  read BEFORE {@link removeEdgeOccupancy} clears it (freeing both endpoints' portals). */
function undoNode(ctx: Ctx, id: NodeId): void {
  for (const ei of ctx.nodeEdges.get(id) ?? []) {
    const binding = ctx.edgeBindings.get(ei);
    const edge = ctx.graph.edges[ei];
    if (binding && edge) {
      freePortal(ctx, edge.a, binding.aPortal);
      freePortal(ctx, edge.b, binding.bPortal);
    }
    removeEdgeOccupancy(ctx, ei);
  }
  ctx.nodeEdges.delete(id);
  ctx.occ.remove(id);
  ctx.placements.delete(id);
  ctx.placedRegions.delete(id);
}

// ---------------------------------------------------------------------------------------
// Cycle placement
// ---------------------------------------------------------------------------------------

/** MRV comparator: most placed neighbours first, ties by BFS depth from pins, then id.
 *  `placed` is any set-of-ids membership test (a `Set` of ids, or the `placements` Map). */
function compareMrv(
  ctx: Ctx,
  placed: { has(id: NodeId): boolean },
  x: NodeId,
  y: NodeId,
): number {
  const px = neighbours(ctx, x).filter((nb) => placed.has(nb)).length;
  const py = neighbours(ctx, y).filter((nb) => placed.has(nb)).length;
  if (px !== py) return py - px;
  const dx = ctx.depth.get(x) ?? Number.POSITIVE_INFINITY;
  const dy = ctx.depth.get(y) ?? Number.POSITIVE_INFINITY;
  if (dx !== dy) return dx - dy;
  return x < y ? -1 : 1;
}

/** Static placement order for a cycle's members: greedy most-already-placed-neighbours-first
 *  (pinned + earlier-unit placements count), ties by BFS depth from pins, then id — the same
 *  MRV comparator as the tree scheduler, frozen once so the in-cycle backtracking has a
 *  stable order to walk. */
function cycleMemberOrder(ctx: Ctx, cyc: CycleUnit): NodeId[] {
  const placedSim = new Set<NodeId>(ctx.placements.keys());
  const order: NodeId[] = [];
  const remaining = [...cyc.members];
  while (remaining.length) {
    remaining.sort((x, y) => compareMrv(ctx, placedSim, x, y));
    // Boundary cast: the `while (remaining.length)` guard proves it is non-empty.
    const next = remaining.shift() as NodeId;
    order.push(next);
    placedSim.add(next);
  }
  return order;
}

/** The attachment frame a cycle's polygon steers from: the walk-start member plus the world
 *  position + outward heading of its already-placed parent portal. */
type AttachFrame = { member: NodeId; pos: Vec3; heading: Vec3 };

/** Order a cycle's members as the ring walk from `attach`, following member-to-member edges in
 *  `cyc.edges`; each step records the graph-edge index taken (so the height chain can read its
 *  `heightDelta`). Members the walk can't reach (degenerate adjacency) are appended in
 *  `cyc.members` order — targets are a bias, so a partial ring still yields useful hints. */
function cycleRingWalk(
  cyc: CycleUnit,
  edges: readonly WorldEdge[],
  attach: NodeId,
): { member: NodeId; viaEdge: number }[] {
  const memberSet = new Set(cyc.members);
  const adj = new Map<NodeId, { to: NodeId; edge: number }[]>();
  // Process the tree edges before the closing edge, so each node's adjacency lists its tree
  // neighbours first: the walk then follows the tree path (the SAME progression as the
  // cycleMemberOrder placement) and treats the closing edge as the implicit wrap. Walking the
  // closing edge first would traverse the ring in REVERSE of the placement direction, handing
  // each member the polygon vertex on the wrong side — steering that fights the natural seat.
  const ordered = [...cyc.edges].sort(
    (a, b) => (a === cyc.closingEdge ? 1 : 0) - (b === cyc.closingEdge ? 1 : 0),
  );
  for (const ei of ordered) {
    const e = edges[ei];
    if (!e || !memberSet.has(e.a) || !memberSet.has(e.b)) continue;
    adj.set(e.a, [...(adj.get(e.a) ?? []), { to: e.b, edge: ei }]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), { to: e.a, edge: ei }]);
  }
  // Boundary cast: a CycleUnit always has >= 1 member, so members[0] is defined.
  const start = memberSet.has(attach) ? attach : (cyc.members[0] as NodeId);
  const out: { member: NodeId; viaEdge: number }[] = [
    { member: start, viaEdge: -1 },
  ];
  const visited = new Set<NodeId>([start]);
  const usedEdges = new Set<number>();
  let cur = start;
  while (out.length < cyc.members.length) {
    const next = (adj.get(cur) ?? []).find(
      (nb) => !usedEdges.has(nb.edge) && !visited.has(nb.to),
    );
    if (!next) break;
    usedEdges.add(next.edge);
    visited.add(next.to);
    out.push({ member: next.to, viaEdge: next.edge });
    cur = next.to;
  }
  for (const m of cyc.members)
    if (!visited.has(m)) out.push({ member: m, viaEdge: -1 });
  return out;
}

/** Rough closure-steering targets: lay a cycle's members out as a regular closed n-gon so the
 *  ring curls back toward its own closing window instead of drifting off. Ordered as the ring
 *  walk from `attach.member`, the polygon starts one step out from `attach.pos` along
 *  `attach.heading` and turns `curl · 2π/n` per vertex; per-member Y accumulates the signed edge
 *  `heightDelta` chain. Uses the MEAN of the per-edge `distances` for EVERY step — a regular
 *  n-gon closes to fp precision, whereas an irregular polygon under uniform turning would not —
 *  so `distances` (keyed by cycle-edge index) only sets the overall scale. A BIAS on candidate
 *  ORDER only, never a constraint on the candidate SET. Exported for the closure test. */
export function _cycleTargets(
  cyc: CycleUnit,
  edges: readonly WorldEdge[],
  attach: AttachFrame,
  curl: number,
  distances: Map<number, number>,
): Map<NodeId, Vec3> {
  const walk = cycleRingWalk(cyc, edges, attach.member);
  const n = walk.length;
  const targets = new Map<NodeId, Vec3>();
  if (n === 0) return targets;
  const ds = [...distances.values()];
  const step = ds.length > 0 ? ds.reduce((a, b) => a + b, 0) / ds.length : 1;
  const turn = (curl * 2 * Math.PI) / n;
  const c = Math.cos(turn);
  const s = Math.sin(turn);

  const hLen = Math.hypot(attach.heading[0], attach.heading[2]) || 1;
  let hx = attach.heading[0] / hLen;
  let hz = attach.heading[2] / hLen;
  let x = attach.pos[0] + hx * step;
  let z = attach.pos[2] + hz * step;
  let y = attach.pos[1];
  // Boundary cast: n = walk.length > 0 (guarded above), so walk[0] exists.
  const first = walk[0] as { member: NodeId; viaEdge: number };
  targets.set(first.member, [x, y, z]);
  for (let k = 1; k < n; k++) {
    const nx = hx * c + hz * s;
    const nz = -hx * s + hz * c;
    hx = nx;
    hz = nz;
    x += hx * step;
    z += hz * step;
    // Boundary cast: k < n = walk.length, so walk[k] is in-bounds.
    const seg = walk[k] as { member: NodeId; viaEdge: number };
    if (seg.viaEdge >= 0) {
      const e = edges[seg.viaEdge];
      if (e) y += (e.heightDelta ?? 0) * (e.b === seg.member ? 1 : -1);
    }
    targets.set(seg.member, [x, y, z]);
  }
  return targets;
}

/** The polygon target scale per cycle edge: `mid(lengthRange) + extent(a) + extent(b)`, so
 *  adjacent vertices sit roughly one connector plus both room radii apart. */
function cycleDistances(ctx: Ctx, cyc: CycleUnit): Map<number, number> {
  const out = new Map<number, number>();
  for (const ei of cyc.edges) {
    const e = ctx.graph.edges[ei];
    if (!e) continue;
    const ra = ctx.nodesById.get(e.a)?.region;
    const rb = ctx.nodesById.get(e.b)?.region;
    const ext = (ra ? extentXZ(ra) : 0) + (rb ? extentXZ(rb) : 0);
    out.set(ei, midLength(e) + ext);
  }
  return out;
}

/** The attachment frame for a cycle whose members are about to place: the MRV-first member and
 *  the seat parent's ROOM CENTRE + outward heading — the fixed point the steering polygon curls
 *  away from. The centre (portal position pulled back behind the door by the parent's radius) is
 *  used so the polygon walks CENTRE-to-CENTRE distances that stay inside each member's reachable
 *  annulus; anchoring at the door would overshoot every vertex by a room radius, pushing every
 *  seat to max length and inflating the ring. `null` if the first member has no placed neighbour
 *  yet (no anchor — the caller then skips steering). */
function cycleAttachFrame(
  ctx: Ctx,
  order: readonly NodeId[],
): AttachFrame | null {
  const member = order[0];
  if (member === undefined) return null;
  const seat = activeEdges(ctx, member)[0];
  if (!seat) return null;
  const parentId = seat.e.a === member ? seat.e.b : seat.e.a;
  const parentRegion = ctx.placedRegions.get(parentId);
  if (!parentRegion) return null;
  const nomParent = seat.e.a === member ? seat.e.bPortal : seat.e.aPortal;
  const portal = placedPortal(parentRegion, nomParent);
  // Room centre = portal pulled BACK behind its outward-facing door by the parent's radius.
  const pos = projectAlong(
    portal.position,
    portal.facing,
    -extentXZ(parentRegion),
  );
  return { member, pos, heading: portal.facing };
}

// ---------------------------------------------------------------------------------------
// Joint chain repair — bounded seeded annealing per cycle unit (Task 8B)
// ---------------------------------------------------------------------------------------
//
// Fired ONLY as a fallback when placeCycle's greedy+steering pass fails to place a cycle's
// members (Gate A′ measured 0/8 default even with doglegs; the classified failures are cycle
// members whose blame is facing + envelope-envelope + clearance-solid — none of which a
// sequential first-accept greedy can escape when the members must JOINTLY orient to close).
// SA searches the whole cycle's seatings at once; its energy is a heuristic to FIND a
// zero-violation config, then the members commit through the REAL hard-rule occupancy path.

/** A SA search state: the current world Placement of each cycle member. Portal bindings are
 *  DERIVED at energy time (the best-mating spec-matching pair per edge), so the state stays
 *  minimal and never has to be threaded through moves. */
type SaState = Map<NodeId, Placement>;

/** Run-invariant SA context: the frozen member order, the member set, the edges whose
 *  violation the energy sums (every graph edge with BOTH endpoints seated — a member or an
 *  already-placed fixed piece), the fixed pieces' exact envelope Obbs (they never move during
 *  a repair, so precompute once), and the closure-steering targets. */
type SaRun = {
  ctx: Ctx;
  order: readonly NodeId[];
  memberSet: Set<NodeId>;
  incident: ActiveEdge[];
  fixedObbs: Obb[];
  targets: Map<NodeId, Vec3>;
};

/** Penetration depth (m) of two yaw-about-Y OBBs: the minimum overlap across the SAT axes (the
 *  Y interval + the four XZ face normals), 0 when separated. A smooth stand-in for the boolean
 *  `obbIntersects` (same projection math) so the SA envelope-overlap term has a gradient that
 *  guides members apart, not just a step. */
function obbPenetration(a: Obb, b: Obb): number {
  const yOverlap = a.half[1] + b.half[1] - Math.abs(a.center[1] - b.center[1]);
  if (yOverlap <= 0) return 0;
  const dx = b.center[0] - a.center[0];
  const dz = b.center[2] - a.center[2];
  const axes: [number, number][] = [
    [Math.cos(a.yaw), -Math.sin(a.yaw)],
    [Math.sin(a.yaw), Math.cos(a.yaw)],
    [Math.cos(b.yaw), -Math.sin(b.yaw)],
    [Math.sin(b.yaw), Math.cos(b.yaw)],
  ];
  const project = (o: Obb, ax: [number, number]): number => {
    const cA = Math.cos(o.yaw);
    const sA = Math.sin(o.yaw);
    return (
      o.half[0] * Math.abs(ax[0] * cA + ax[1] * -sA) +
      o.half[2] * Math.abs(ax[0] * sA + ax[1] * cA)
    );
  };
  let minPen = yOverlap;
  for (const ax of axes) {
    const dist = Math.abs(dx * ax[0] + dz * ax[1]);
    const overlap = project(a, ax) + project(b, ax) - dist;
    if (overlap <= 0) return 0;
    if (overlap < minPen) minPen = overlap;
  }
  return minPen;
}

/** Continuous shortfall (m) by which two placed portals miss `pairFeasible`: the facing-cone
 *  gap projected to metres (cosine gap × chord run) plus the range overshoot. Exactly 0 when
 *  the pair is feasible (fa,fb ≥ FACING_MIN and run ∈ range) — so an all-edges-feasible state
 *  contributes 0 to the energy. Heuristic only; the real commit re-checks with `pairFeasible`. */
function edgeViolation(
  a: Connection,
  b: Connection,
  range: [number, number],
): number {
  const dx = b.position[0] - a.position[0];
  const dz = b.position[2] - a.position[2];
  const run = Math.hypot(dx, dz);
  if (run < 1e-6) return SA_COINCIDENT_PENALTY;
  const dirX = dx / run;
  const dirZ = dz / run;
  const fa = a.facing[0] * dirX + a.facing[2] * dirZ;
  const fb = -(b.facing[0] * dirX + b.facing[2] * dirZ);
  const facingGap = Math.max(0, FACING_MIN - fa) + Math.max(0, FACING_MIN - fb);
  const rangeGap = Math.max(0, range[0] - run) + Math.max(0, run - range[1]);
  return run * facingGap + rangeGap;
}

/** Whether endpoint `id` currently has a seating the SA can read: a member already assigned a
 *  placement in `state`, or a fixed piece (pin / earlier unit — always in `ctx.placements`,
 *  never a member during a repair). */
function isSeatedForSa(run: SaRun, state: SaState, id: NodeId): boolean {
  return state.has(id) || run.ctx.placements.has(id);
}

/** The WORLD Connection of endpoint `id`'s portal `p` under the SA state: a member (by
 *  `memberSet`) is its LOCAL portal transformed by its state placement; a fixed piece reads its
 *  already-placed region. Only ever called for an already-seated endpoint. */
function saWorldPortal(
  run: SaRun,
  state: SaState,
  id: NodeId,
  p: number,
): Connection {
  if (run.memberSet.has(id)) {
    const region = mustGet(run.ctx.nodesById, id, "node").region;
    // Boundary cast: saWorldPortal is only called for a member already seated in `state` (a
    // moved member's neighbours, and every member at energy time), so `place` is defined.
    return placeConnection(placedPortal(region, p), state.get(id) as Placement);
  }
  return placedPortal(mustGet(run.ctx.placedRegions, id, "placed region"), p);
}

/** The spec-matching portal indices of endpoint `id` (matching its nominal portal for an edge):
 *  a member (by `memberSet`) offers ALL such portals off its LOCAL region — nothing of it is
 *  committed during a repair, and this must work for the member being seated (not yet in state);
 *  a fixed piece offers those on its placed region not already consumed by a committed binding. */
function saPortals(run: SaRun, id: NodeId, nominal: number): number[] {
  const isMember = run.memberSet.has(id);
  const region = isMember
    ? mustGet(run.ctx.nodesById, id, "node").region
    : mustGet(run.ctx.placedRegions, id, "placed region");
  const used = isMember
    ? new Set<number>()
    : (run.ctx.portalUse.get(id) ?? new Set<number>());
  return matchingFreePortals(
    region.connections,
    placedPortal(region, nominal),
    used,
    new Set<number>(),
  );
}

/** The min-violation spec-matching portal pair for an edge under the SA state, plus its two
 *  WORLD portals — shared by the facing-violation term and the clearance term so both judge the
 *  same (best) binding the real commit's portal freedom could pick. */
function saBestMate(
  run: SaRun,
  state: SaState,
  edge: WorldEdge,
): { violation: number; pa: Connection; pb: Connection } {
  const aPorts = saPortals(run, edge.a, edge.aPortal);
  const bPorts = saPortals(run, edge.b, edge.bPortal);
  const range = feasRange(edge);
  // Boundary cast: an endpoint's nominal portal always spec-matches itself and (during a repair)
  // is free, so both lists are non-empty and index 0 exists.
  let pa = saWorldPortal(run, state, edge.a, aPorts[0] as number);
  let pb = saWorldPortal(run, state, edge.b, bPorts[0] as number);
  let violation = edgeViolation(pa, pb, range);
  for (const ia of aPorts) {
    const wa = saWorldPortal(run, state, edge.a, ia);
    for (const ib of bPorts) {
      const wb = saWorldPortal(run, state, edge.b, ib);
      const v = edgeViolation(wa, wb, range);
      if (v < violation) {
        violation = v;
        pa = wa;
        pb = wb;
      }
    }
  }
  return { violation, pa, pb };
}

/** A per-member cache of world envelope Obbs, so a move recomputes only the moved member's. */
type ObbCache = Map<NodeId, Obb[]>;

/** One edge's energy under the state: its best-mate facing/range violation (m) plus, IF that
 *  best mate is feasible, SA_CLEARANCE_WEIGHT when its connector clearance hits a fixed solid
 *  (checked cheaply against fixed occupancy — members aren't registered during a repair). */
function saEdgeEnergy(run: SaRun, state: SaState, e: WorldEdge): number {
  const { violation, pa, pb } = saBestMate(run, state, e);
  if (violation > SA_FEASIBLE_EPS) return violation;
  const { headroom } = connectorSection(pa, pb);
  const rej = run.ctx.occ.checkClearance(
    clearanceBoxes(pa, pb),
    [e.a, e.b],
    [portalExemption(pa, headroom), portalExemption(pb, headroom)],
  );
  return rej ? violation + SA_CLEARANCE_WEIGHT : violation;
}

/** Total SA energy of a state: Σ edge facing/range violation (m) + Σ pairwise envelope
 *  penetration depth (m — member×member and member×fixed) + SA_CLEARANCE_WEIGHT × (count of
 *  otherwise-feasible edges whose connector clearance hits a fixed solid). A search heuristic:
 *  0 ⇒ every edge mates, no envelopes overlap, and every clearance clears the fixed geometry.
 *  The real commit is the hard arbiter — this only tells the search which way is downhill.
 *  Full recompute: seeds the running total and re-syncs it (guarding incremental drift). */
function saEnergy(run: SaRun, state: SaState, cache: ObbCache): number {
  let energy = 0;
  for (const { e } of run.incident) energy += saEdgeEnergy(run, state, e);
  const ids = run.order;
  // Boundary cast: i and j are loop-bounded < ids.length, so ids[i]/ids[j] are in-bounds.
  for (let i = 0; i < ids.length; i++) {
    const oi = mustGet(cache, ids[i] as NodeId, "obb cache");
    for (let j = i + 1; j < ids.length; j++) {
      for (const a of oi) {
        for (const b of mustGet(cache, ids[j] as NodeId, "obb cache"))
          energy += obbPenetration(a, b);
      }
    }
    for (const a of oi) {
      for (const f of run.fixedObbs) energy += obbPenetration(a, f);
    }
  }
  return energy;
}

/** The energy contribution of member `id` (its envelope Obbs given as `idObbs`, its portals read
 *  from `state`), holding the rest fixed: its incident edges' energy + its envelope penetration
 *  against every OTHER seated member (via `cache`) and fixed piece. Endpoints/members not yet
 *  seated are skipped (so this is safe during the incremental init). Because a move changes ONLY
 *  `id`, ΔE = localEnergy(after) − localEnergy(before) is the exact total-energy delta — so
 *  best-response moves anneal on cheap local recomputes instead of a full O(members²) sweep. */
function saLocalEnergy(
  run: SaRun,
  state: SaState,
  cache: ObbCache,
  id: NodeId,
  idObbs: Obb[],
): number {
  let energy = 0;
  for (const { e } of run.incident) {
    if (e.a !== id && e.b !== id) continue;
    const other = e.a === id ? e.b : e.a;
    if (isSeatedForSa(run, state, other)) energy += saEdgeEnergy(run, state, e);
  }
  for (const other of run.order) {
    if (other === id) continue;
    const oobbs = cache.get(other);
    if (!oobbs) continue; // not yet seated (init) — no envelope pair yet
    for (const a of idObbs) {
      for (const b of oobbs) energy += obbPenetration(a, b);
    }
  }
  for (const a of idObbs) {
    for (const f of run.fixedObbs) energy += obbPenetration(a, f);
  }
  return energy;
}

/** The world envelope Obbs of member `id` under its state placement. */
function saMemberObbs(run: SaRun, state: SaState, id: NodeId): Obb[] {
  // Boundary cast: saInitialState seats every member, so each carries a state placement.
  return envelopeObbs(
    mustGet(run.ctx.nodesById, id, "node").region,
    state.get(id) as Placement,
  );
}

/** The candidate seatings of member `id` off `edge`'s already-seated OTHER endpoint: a seeded
 *  spec-matching portal pair (which door of each mates), then the full reachable locus fan
 *  (`sampleSeatLoci`) each `join`ed into a Placement. The MOVE evaluates every candidate and
 *  best-responds; the INIT best-responds against already-seated members. `[]` if degenerate. */
function saSeatCandidates(
  run: SaRun,
  state: SaState,
  id: NodeId,
  edge: WorldEdge,
  rng: Rng,
): Placement[] {
  const nodeIsA = edge.a === id;
  const nbId = nodeIsA ? edge.b : edge.a;
  const nbPorts = saPortals(run, nbId, nodeIsA ? edge.bPortal : edge.aPortal);
  const nodePorts = saPortals(run, id, nodeIsA ? edge.aPortal : edge.bPortal);
  if (nbPorts.length === 0 || nodePorts.length === 0) return [];
  const parentWorld = saWorldPortal(run, state, nbId, rng.pick(nbPorts));
  const region = mustGet(run.ctx.nodesById, id, "node").region;
  const nodeLocal = placedPortal(region, rng.pick(nodePorts));
  const dhSigned = (edge.heightDelta ?? 0) * (nodeIsA ? -1 : 1);
  const range = edge.lengthRange ?? DEFAULT_LENGTH_RANGE;
  const loci = sampleSeatLoci(
    parentWorld,
    range,
    dhSigned,
    rng.derive("loci"),
    LOCUS_SAMPLES,
  );
  return loci.map((cand) =>
    join(
      { ...cand.target, width: nodeLocal.width, height: nodeLocal.height },
      nodeLocal,
    ),
  );
}

/** The first incident edge of `id` whose OTHER endpoint is already seated (a fixed piece, or an
 *  earlier member) — the neighbour a seat/move samples loci off. `null` when none is seated yet. */
function saSeatEdge(run: SaRun, state: SaState, id: NodeId): ActiveEdge[] {
  return run.incident.filter(
    ({ e }) =>
      (e.a === id && isSeatedForSa(run, state, e.b)) ||
      (e.b === id && isSeatedForSa(run, state, e.a)),
  );
}

/** Pick, among `cands`, the placement of `id` minimising its local energy against the members
 *  already in `state`/`cache` (ties → lowest index, deterministic). Returns the placement, its
 *  world Obbs, and that local energy — the best-response step shared by init and move. */
function saBestResponse(
  run: SaRun,
  state: SaState,
  cache: ObbCache,
  id: NodeId,
  cands: Placement[],
): { place: Placement; obbs: Obb[]; local: number } {
  // Boundary cast: callers only pass a non-empty `cands`, so the loop runs and sets `best*`
  // on its first iteration (bestLocal starts +∞); index 0 seeds `best` until then.
  let best = cands[0] as Placement;
  let bestObbs: Obb[] = [];
  let bestLocal = Number.POSITIVE_INFINITY;
  const scratch = new Map(state);
  for (const c of cands) {
    scratch.set(id, c);
    const obbs = saMemberObbs(run, scratch, id);
    const local = saLocalEnergy(run, scratch, cache, id, obbs);
    if (local < bestLocal) {
      bestLocal = local;
      best = c;
      bestObbs = obbs;
    }
  }
  return { place: best, obbs: bestObbs, local: bestLocal };
}

/** Seed the SA by a greedy best-response construction: walk the member order, seating each off a
 *  seeded neighbour at the candidate minimising its local energy against the members already
 *  placed. No occupancy hard-checks — a strong start the annealing then refines. Returns the
 *  state and its per-member Obb cache. */
function saInitialState(
  run: SaRun,
  rng: Rng,
): { state: SaState; cache: ObbCache } {
  const state: SaState = new Map();
  const cache: ObbCache = new Map();
  for (const id of run.order) {
    const seatEdges = saSeatEdge(run, state, id);
    if (seatEdges.length === 0) continue; // order guarantees a seated neighbour — unreachable
    // Boundary cast: the `length === 0` continue above proves seatEdges is non-empty.
    const seat = seatEdges[0] as ActiveEdge;
    const cands = saSeatCandidates(
      run,
      state,
      id,
      seat.e,
      rng.derive(`init:${id}`),
    );
    if (cands.length === 0) continue;
    const { place, obbs } = saBestResponse(run, state, cache, id, cands);
    state.set(id, place);
    cache.set(id, obbs);
  }
  return { state, cache };
}

/** One SA move (mutating `state`/`cache` on accept): re-seat a single seeded-random member — its
 *  candidate loci off a seeded seated neighbour, best-responded to the min-local-energy placement
 *  — then Metropolis-accept the change at temperature `t`. ΔE (= local after − before, the exact
 *  total delta since only one member moves) is returned via the updated running `energy`. */
function saMove(
  run: SaRun,
  state: SaState,
  cache: ObbCache,
  energy: number,
  t: number,
  rng: Rng,
): number {
  // Boundary cast: rng.int(0, n) returns an index in [0, n), so both reads are in-bounds
  // (run.order is non-empty for any cycle; seatEdges is guarded non-empty just below).
  const id = run.order[rng.int(0, run.order.length)] as NodeId;
  const seatEdges = saSeatEdge(run, state, id);
  if (seatEdges.length === 0) return energy;
  const seat = seatEdges[rng.int(0, seatEdges.length)] as ActiveEdge;
  const cands = saSeatCandidates(run, state, id, seat.e, rng.derive("cand"));
  if (cands.length === 0) return energy;
  const oldLocal = saLocalEnergy(
    run,
    state,
    cache,
    id,
    mustGet(cache, id, "obb cache"),
  );
  const best = saBestResponse(run, state, cache, id, cands);
  const dE = best.local - oldLocal;
  if (dE <= 0 || rng.derive("accept").float() < Math.exp(-dE / t)) {
    state.set(id, best.place);
    cache.set(id, best.obbs);
    return energy + dE;
  }
  return energy;
}

/** A parent/node portal binding for the seat edge feasible at `placement` — the SA state fixes
 *  the member's position, so the real commit must find which spec-matching binding realizes it. */
function findSeatBind(
  ctx: Ctx,
  node: WorldNode,
  id: NodeId,
  seat: ActiveEdge,
  placement: Placement,
): BindPair | null {
  for (const cand of bindingCandidates(
    ctx,
    seat,
    id,
    ctx.rng.derive(`sa-seat:${id}`),
  )) {
    const parentWorld = boundParentPortal(ctx, seat, id, cand);
    const nodeWorld = placeConnection(
      placedPortal(node.region, cand.node),
      placement,
    );
    const [aW, bW] =
      seat.e.a === id ? [nodeWorld, parentWorld] : [parentWorld, nodeWorld];
    if (pairFeasible(aW, bW, feasRange(seat.e))) return cand;
  }
  return null;
}

/** Commit ONE cycle member at its SA-found placement through the real occupancy path: find a
 *  feasible seat binding, forward-check the other active edges, then addPiece + commitEdges
 *  (which itself rolls back on any edge failing). Returns true only if every hard rule genuinely
 *  passes — the SA energy was only a heuristic to FIND this seating, not a proof of legality. */
function commitMemberAt(ctx: Ctx, id: NodeId, placement: Placement): boolean {
  const node = mustGet(ctx.nodesById, id, "node");
  const active = activeEdges(ctx, id);
  if (active.length === 0) return false;
  const [seat, ...others] = active as [ActiveEdge, ...ActiveEdge[]];
  const seatParentId = seat.e.a === id ? seat.e.b : seat.e.a;
  const seatBind = findSeatBind(ctx, node, id, seat, placement);
  if (!seatBind) return false;
  const fc = forwardCheckOthers(
    ctx,
    id,
    placement,
    seatBind,
    seatParentId,
    others,
  );
  if (!fc) return false;
  const envs = envelopeObbs(node.region, placement);
  if (ctx.occ.checkPieceEnvelope(envs)) return false;
  const placed = placePiece(node.region, placement);
  ctx.placements.set(id, placement);
  ctx.placedRegions.set(id, placed);
  ctx.occ.addPiece(id, envs, solidsOf(placed));
  return commitEdges(ctx, id, seat, seatBind, others, fc.binds, fc.doglegEdges);
}

/** Realize a heuristically-feasible SA state through the real occupancy path, in the frozen
 *  member order so each member's active edges see its already-committed predecessors. Rolls every
 *  committed member back and returns false if any member's hard-rule commit fails (E can reach 0
 *  on the heuristic yet miss a real rule — a member×member connector clip or a portal double-use
 *  the energy under-models — in which case the caller keeps annealing). */
function saCommit(ctx: Ctx, order: readonly NodeId[], state: SaState): boolean {
  const committed: NodeId[] = [];
  for (const id of order) {
    const placement = state.get(id);
    if (placement && commitMemberAt(ctx, id, placement)) {
      committed.push(id);
      continue;
    }
    for (const m of [...committed].reverse()) undoNode(ctx, m);
    return false;
  }
  return true;
}

/** One SA restart: greedy best-response init, then MAX_SA_MOVES best-response moves under a
 *  geometric SA_T_HI→SA_T_LO cooling. The running `energy` is maintained by exact per-move ΔE;
 *  whenever it dips to feasible (≤ SA_FEASIBLE_EPS) a FULL recompute re-syncs it (guarding
 *  incremental drift) and, if still feasible, the state commits through the REAL occupancy path
 *  — succeeding only if every hard rule passes. Returns true iff a commit succeeded. */
function saAnneal(run: SaRun, rng: Rng): boolean {
  const { state, cache } = saInitialState(run, rng.derive("init"));
  let energy = saEnergy(run, state, cache);
  const tryFeasibleCommit = (): boolean => {
    if (energy > SA_FEASIBLE_EPS) return false;
    energy = saEnergy(run, state, cache); // re-sync against drift before trusting E≈0
    return energy <= SA_FEASIBLE_EPS && saCommit(run.ctx, run.order, state);
  };
  if (tryFeasibleCommit()) return true;
  for (let step = 0; step < MAX_SA_MOVES; step++) {
    const t = SA_T_HI * (SA_T_LO / SA_T_HI) ** (step / MAX_SA_MOVES);
    energy = saMove(run, state, cache, energy, t, rng.derive(`step:${step}`));
    if (tryFeasibleCommit()) return true;
  }
  return false;
}

/** Joint chain repair (Task 8B): bounded, seeded, deterministic simulated annealing over the
 *  whole cycle's member seatings, fired ONLY when placeCycle's greedy+steering pass fails. State
 *  = each member's placement; a best-response move re-seats one member (candidate loci off a
 *  seated neighbour → the min-local-energy one); energy = facing/range violation + envelope
 *  penetration depth + clearance-solid count (a search heuristic). MAX_SA_RESTARTS seeded restarts
 *  × MAX_SA_MOVES moves ⇒ always terminates; on reaching a feasible state it commits through the
 *  REAL occupancy path (the hard arbiter). All randomness derives from `sa:${closingEdge}:${rev}`
 *  so the SA never perturbs the greedy stream and same seed → identical result. */
function repairCycleBySA(
  ctx: Ctx,
  cyc: CycleUnit,
  rev: number,
  order: readonly NodeId[],
  targets: Map<NodeId, Vec3>,
): boolean {
  const memberSet = new Set(cyc.members);
  const seatedStatic = (id: NodeId): boolean =>
    memberSet.has(id) || ctx.placements.has(id);
  const incident = ctx.graph.edges
    .map((e, i): ActiveEdge => ({ e, i }))
    .filter(
      ({ e }) =>
        (memberSet.has(e.a) || memberSet.has(e.b)) &&
        seatedStatic(e.a) &&
        seatedStatic(e.b),
    );
  const fixedObbs: Obb[] = [];
  for (const [id, place] of ctx.placements) {
    if (memberSet.has(id)) continue;
    const region = ctx.nodesById.get(id)?.region;
    if (region) for (const o of envelopeObbs(region, place)) fixedObbs.push(o);
  }
  const run: SaRun = { ctx, order, memberSet, incident, fixedObbs, targets };
  const rng = ctx.rng.derive(`sa:${cyc.closingEdge}:${rev}`);
  for (let restart = 0; restart < MAX_SA_RESTARTS; restart++) {
    if (saAnneal(run, rng.derive(`restart:${restart}`))) return true;
  }
  return false;
}

/** Place a whole cycle unit with bounded in-cycle backtracking over a frozen member order:
 *  place each member via `placeNode`; on a member failing, undo the previous member and
 *  retry it with a bumped sub-revision (up to MAX_UNIT_REVISIONS total re-seatings), else
 *  undo every member placed here and fail. `placeNode`'s forward checking + `commitEdges`
 *  close the cycle's loop edge when the last incident member is placed. Closure steering biases
 *  each member toward its polygon-target vertex; `curl` flips per revision (the cheap second
 *  hypothesis — an odd revision mirrors the ring). */
function placeCycle(ctx: Ctx, cyc: CycleUnit, rev: number): boolean {
  const order = cycleMemberOrder(ctx, cyc);
  const attach = cycleAttachFrame(ctx, order);
  const curl = rev % 2 === 0 ? 1 : -1;
  const targets = attach
    ? _cycleTargets(
        cyc,
        ctx.graph.edges,
        attach,
        curl,
        cycleDistances(ctx, cyc),
      )
    : new Map<NodeId, Vec3>();
  const placedHere: NodeId[] = [];
  const memberRev = new Map<NodeId, number>();
  let sweeps = 0;
  let idx = 0;
  while (idx < order.length) {
    // Boundary cast: the `idx < order.length` loop guard proves `order[idx]` is in-bounds.
    const id = order[idx] as NodeId;
    const mrev = memberRev.get(id) ?? 0;
    // The cycle ANCHOR (order[0], seated off a pin) does not explore under an OUTER
    // revision: a cross-unit backtrack re-places the cycle to move a LATER member (e.g. an
    // elevated room a tree node collides with), and yawing the whole subtree's root off its
    // canonical pin seating to achieve that would move every unrelated descendant for
    // nothing. It still explores when IN-CYCLE backtracking re-seats it (`mrev > 0`) — the
    // case where the anchor genuinely must move to close the loop.
    const explore = mrev > 0 || (rev > 0 && idx > 0);
    const ok = placeNode(
      ctx,
      id,
      `c:${cyc.closingEdge}:${rev}:${id}:${mrev}`,
      explore,
      targets.get(id),
    );
    if (ok) {
      placedHere.push(id);
      idx++;
      continue;
    }
    const stuck =
      placedHere.length === 0 ||
      sweeps >= MAX_UNIT_REVISIONS ||
      ctx.attempts > MAX_ATTEMPTS;
    if (stuck) {
      for (const m of [...placedHere].reverse()) undoNode(ctx, m);
      // Fallback: joint chain repair by bounded seeded annealing (Task 8B). Gated on
      // `ctx.saEnabled` — OFF for the pure-greedy restarts (so any graph greedy can place is
      // byte-for-byte identical to the pre-8B placer), ON only for the fallback restarts reached
      // when greedy fully fails — and capped at MAX_SA_FIRES_PER_CYCLE per cycle (`saAttempted`).
      // SA searches all members' seatings jointly, then commits through the real occupancy path.
      const fires = ctx.saAttempted.get(cyc.closingEdge) ?? 0;
      if (ctx.saEnabled && fires < MAX_SA_FIRES_PER_CYCLE) {
        ctx.saAttempted.set(cyc.closingEdge, fires + 1);
        if (repairCycleBySA(ctx, cyc, rev, order, targets)) return true;
      }
      return false;
    }
    sweeps++;
    // Boundary cast: `stuck` (checked+returned above) includes `placedHere.length === 0`, so
    // reaching here proves `placedHere` is non-empty and `pop()` returns a real id.
    const prev = placedHere.pop() as NodeId;
    undoNode(ctx, prev);
    memberRev.set(prev, (memberRev.get(prev) ?? 0) + 1);
    memberRev.set(id, 0); // the failed member retries fresh next time
    idx = order.indexOf(prev);
  }
  return true;
}

// ---------------------------------------------------------------------------------------
// Attempt driver
// ---------------------------------------------------------------------------------------

/** The most-constrained pending tree node (dynamic MRV over the current placement front). */
function mostConstrainedTree(ctx: Ctx, pendingTree: Set<NodeId>): NodeId {
  const ids = [...pendingTree];
  ids.sort((x, y) => compareMrv(ctx, ctx.placements, x, y));
  // Boundary cast: the sole caller gates this on `pendingTree.size > 0`, so `ids[0]` exists.
  return ids[0] as NodeId;
}

/** The failing-node diagnostics: the node with the most accumulated candidate failures plus
 *  its `reason×count` histogram (the `could not place` message the diagnostics tests read). */
function fail(ctx: Ctx): { failing: NodeId; detail: string } {
  let failing: NodeId = "?";
  let max = -1;
  for (const [id, m] of ctx.failCounts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (total > max) {
      max = total;
      failing = id;
    }
  }
  const hist = ctx.failCounts.get(failing) ?? new Map<string, number>();
  const detail =
    [...hist].map(([k, v]) => `${k}×${v}`).join(", ") || "no candidates";
  return { failing, detail };
}

/** Whether a node is a frozen pin — a backjump can never pop it. */
function isPinned(ctx: Ctx, id: NodeId): boolean {
  return ctx.nodesById.get(id)?.pinned !== undefined;
}

/** Resolve one fail-histogram key to the PLACED piece it blames, or null. An
 *  `envelope-envelope:<id>` key blames `<id>`; an `edge[fwd]:*` / `edge[commit]:*` key blames the
 *  placed partner of its trailing edge index (relative to `failing`). Other keys (clearance
 *  rules against connectors, route throws) don't name a poppable piece. */
function resolveBlame(ctx: Ctx, failing: NodeId, key: string): NodeId | null {
  const EE = "envelope-envelope:";
  if (key.startsWith(EE)) return key.slice(EE.length);
  if (key.startsWith("edge[fwd]:") || key.startsWith("edge[commit]:")) {
    const parts = key.split(":");
    const ei = Number(parts[parts.length - 1]);
    if (!Number.isInteger(ei)) return null;
    const edge = ctx.graph.edges[ei];
    if (!edge) return null;
    return edge.a === failing ? edge.b : edge.a;
  }
  return null;
}

/** The most-blamed PLACED, non-pinned piece in a node's fail histogram — the conflict a
 *  backjump should target — or null when no key resolves to a poppable placed piece. Ties break
 *  by count, then id, so the choice is deterministic. */
function blamePiece(ctx: Ctx, failing: NodeId): NodeId | null {
  const hist = ctx.failCounts.get(failing);
  if (!hist) return null;
  let best: NodeId | null = null;
  let bestCount = -1;
  for (const [key, count] of hist) {
    const blamed = resolveBlame(ctx, failing, key);
    if (blamed === null || blamed === failing) continue;
    if (!ctx.placements.has(blamed) || isPinned(ctx, blamed)) continue;
    const better =
      count > bestCount ||
      (count === bestCount && (best === null || blamed < best));
    if (better) {
      bestCount = count;
      best = blamed;
    }
  }
  return best;
}

/** The node whose foreclosure a just-failed unit blames: a tree node's own id, or the cycle
 *  member carrying the most accumulated candidate failures (ties keep the first member in ring
 *  order). */
function unitFailingNode(ctx: Ctx, unit: PlacedUnit): NodeId {
  if (unit.kind === "node") return unit.id;
  const members = unit.unit.members;
  let best = members[0] ?? "";
  let bestTotal = -1;
  for (const m of members) {
    const total = [...(ctx.failCounts.get(m)?.values() ?? [])].reduce(
      (a, b) => a + b,
      0,
    );
    if (total > bestTotal) {
      bestTotal = total;
      best = m;
    }
  }
  return best;
}

/** Whether a placed unit holds a given node id. */
function unitHolds(u: PlacedUnit, id: NodeId): boolean {
  return u.kind === "node" ? u.id === id : u.unit.members.includes(id);
}

/** The `unitHistory` index of the unit holding the piece most blamed for `unit`'s failure, or
 *  -1 when nothing poppable is blamed — feeds blame-directed backjumping (jump straight back to
 *  the conflict source instead of only popping the immediately-previous unit). */
function blameUnitIndex(
  ctx: Ctx,
  unit: PlacedUnit,
  history: PlacedUnit[],
): number {
  const blamed = blamePiece(ctx, unitFailingNode(ctx, unit));
  if (blamed === null) return -1;
  return history.findIndex((u) => unitHolds(u, blamed));
}

function assembleResult(ctx: Ctx): LayoutResult {
  const regions = ctx.graph.nodes.map((n) =>
    mustGet(ctx.placedRegions, n.id, "placed region"),
  );
  const connectors: RegionData[] = [];
  const expansions = new Map<number, DoglegExpansion>();
  for (const ei of [...ctx.committedConnectors.keys()].sort((a, b) => a - b)) {
    const pieces = mustGet(ctx.committedConnectors, ei, "connector");
    const base = connectors.length;
    for (const c of pieces) connectors.push(c);
    // A dogleg edge contributes exactly its three pieces (segA, corner, segB, in that order) —
    // record their flat indices into `connectors`. A straight edge contributes one.
    if (pieces.length === 3) {
      expansions.set(ei, { segA: base, corner: base + 1, segB: base + 2 });
    }
  }
  const edgeBindings = ctx.graph.edges.map((_, i) =>
    mustGet(ctx.edgeBindings, i, "edge binding"),
  );
  return {
    placements: ctx.placements,
    regions,
    connectors,
    edgeBindings,
    expansions,
  };
}

/** One placement attempt from a clean slate: seat the pins, then schedule cycles-first with
 *  cross-unit backtracking (deterministic revision-by-reseeding, no snapshot machinery),
 *  returning the result or the failing-node diagnostics. */
function tryLayout(
  graph: WorldGraph,
  nodesById: Map<NodeId, WorldNode>,
  decomposition: ReturnType<typeof deriveChains>,
  closingEdges: Set<number>,
  rng: Rng,
  saEnabled: boolean,
): { result: LayoutResult } | { failing: NodeId; detail: string } {
  const ctx: Ctx = {
    graph,
    nodesById,
    closingEdges,
    rng,
    occ: new Occupancy(),
    placements: new Map(),
    placedRegions: new Map(),
    portalUse: new Map(),
    edgeBindings: new Map(),
    committedConnectors: new Map(),
    nodeEdges: new Map(),
    attempts: 0,
    failCounts: new Map(),
    adj: buildAdjacency(graph),
    depth: depthFromPins(graph),
    saEnabled,
    saAttempted: new Map<number, number>(),
  };

  for (const n of graph.nodes) {
    if (!n.pinned) continue;
    const placed = placePiece(n.region, n.pinned);
    ctx.placements.set(n.id, n.pinned);
    ctx.placedRegions.set(n.id, placed);
    ctx.occ.addPiece(n.id, envelopeObbs(n.region, n.pinned), solidsOf(placed));
  }

  const pendingCycles = [...decomposition.cycles];
  const pendingTree = new Set(decomposition.treeNodes);
  const unitHistory: PlacedUnit[] = [];

  const sortCycles = (): void => {
    pendingCycles.sort(
      (x, y) =>
        x.members.length - y.members.length || x.closingEdge - y.closingEdge,
    );
  };
  const undoUnit = (prev: PlacedUnit): void => {
    if (prev.kind === "node") {
      undoNode(ctx, prev.id);
      pendingTree.add(prev.id);
    } else {
      for (const m of prev.unit.members) undoNode(ctx, m);
      pendingCycles.push(prev.unit);
      sortCycles();
    }
  };
  const removeFromPending = (prev: PlacedUnit): void => {
    if (prev.kind === "node") pendingTree.delete(prev.id);
    else {
      const i = pendingCycles.indexOf(prev.unit);
      if (i >= 0) pendingCycles.splice(i, 1);
    }
  };

  while (pendingCycles.length > 0 || pendingTree.size > 0) {
    if (ctx.attempts > MAX_ATTEMPTS) return fail(ctx);
    const adjacent = pendingCycles.filter((c) =>
      c.members.some((m) =>
        neighbours(ctx, m).some((nb) => ctx.placements.has(nb)),
      ),
    );
    let placedOk: boolean;
    let unit: PlacedUnit;
    if (adjacent.length > 0) {
      // Boundary cast: the `adjacent.length > 0` branch guard proves `adjacent[0]` exists
      // (and `pendingCycles` is smallest-first, so it is the smallest adjacent cycle).
      const cyc = adjacent[0] as CycleUnit;
      unit = { kind: "cycle", unit: cyc, rev: 0 };
      placedOk = placeCycle(ctx, cyc, 0);
      if (placedOk) pendingCycles.splice(pendingCycles.indexOf(cyc), 1);
    } else if (pendingTree.size > 0) {
      const id = mostConstrainedTree(ctx, pendingTree);
      unit = { kind: "node", id, rev: 0 };
      placedOk = placeNode(ctx, id, `n:${id}:0`);
      if (placedOk) pendingTree.delete(id);
    } else {
      return fail(ctx); // only non-adjacent cycles remain — unreachable for valid inputs
    }
    // Exhaust the CURRENT unit's own revisions (fresh explore samples) before disturbing any
    // ancestor — standard backtracking discipline. A node with a narrow feasible window
    // (e.g. a tall stair connector threading past fixed authored walls) often just needs
    // more samples at the SAME ancestor layout; re-placing an ancestor first would move
    // already-good, unrelated pieces (yawing them off their canonical seatings) for nothing.
    for (let rev = 1; rev <= MAX_UNIT_REVISIONS && !placedOk; rev++) {
      if (ctx.attempts > MAX_ATTEMPTS) return fail(ctx);
      placedOk =
        unit.kind === "cycle"
          ? placeCycle(ctx, unit.unit, rev)
          : placeNode(ctx, unit.id, `n:${unit.id}:${rev}`, true);
      if (placedOk) {
        unit = { ...unit, rev };
        removeFromPending(unit);
      }
    }
    if (placedOk) {
      unitHistory.push(unit);
      continue;
    }

    // Cross-unit backtracking: undo the previous unit and re-place it with a bumped revision
    // stream, popping further when a unit's revisions exhaust. Blame-directed backjumping: on
    // the FIRST backtrack for this failure, if the piece most blamed for the foreclosure sits
    // DEEPER in the history than the immediately-previous unit, pop the intervening units
    // straight down to it (re-queuing them into pending) so the normal pop + bumped re-seat
    // below moves the ACTUAL conflict source — a 1-step pop-previous can never reach a cross-unit
    // foreclosure. Bounded to MAX_BACKJUMP_POPS undone units per failure (the deepest reached
    // stays; the rest re-place fresh via the outer loop).
    let revised = false;
    let firstBacktrack = true;
    while (unitHistory.length > 0 && !revised) {
      if (firstBacktrack) {
        firstBacktrack = false;
        const target = blameUnitIndex(ctx, unit, unitHistory);
        if (target >= 0 && target < unitHistory.length - 1) {
          const above = unitHistory.length - 1 - target;
          const intermediate = Math.min(above, MAX_BACKJUMP_POPS - 1);
          for (let k = 0; k < intermediate; k++) {
            // Boundary cast: k < intermediate <= unitHistory.length-1, so pop() returns a unit.
            undoUnit(unitHistory.pop() as PlacedUnit);
          }
        }
      }
      // Boundary cast: the `unitHistory.length > 0` loop guard proves `pop()` returns a unit.
      const prev = unitHistory.pop() as PlacedUnit;
      undoUnit(prev);
      for (let rev = prev.rev + 1; rev <= MAX_UNIT_REVISIONS; rev++) {
        const ok =
          prev.kind === "cycle"
            ? placeCycle(ctx, prev.unit, rev)
            : placeNode(ctx, prev.id, `n:${prev.id}:${rev}`, true);
        if (ok) {
          unitHistory.push({ ...prev, rev });
          removeFromPending(prev);
          revised = true;
          break;
        }
        if (ctx.attempts > MAX_ATTEMPTS) return fail(ctx);
      }
    }
    if (!revised && unitHistory.length === 0) return fail(ctx);
  }

  return { result: assembleResult(ctx) };
}

/** Place a world graph: deterministic collision-aware incremental embedding (pins frozen →
 *  cycles-first, most-constrained order → continuous-loci candidates with portal freedom +
 *  forward checking → occupancy-hard-accept → unit backtracking → seeded restarts). Two phases:
 *  PURE-GREEDY restarts first (the pre-8B placer, byte-for-byte — so any graph greedy can place
 *  is unchanged), then, ONLY if greedy fully fails AND the graph has cycles, SA-fallback restarts
 *  (Task 8B joint chain repair) before the setup-loud throw. Pure: no GPU, no Rapier, no
 *  wall-clock. Throws setup-loud with per-node diagnostics after exhausting all restarts. */
export function layoutWorld(graph: WorldGraph, seed: string): LayoutResult {
  validateGraph(graph);
  const nodesById = new Map<NodeId, WorldNode>(
    graph.nodes.map((n) => [n.id, n]),
  );
  const decomposition = deriveChains(graph);
  // Consumed by Task 8's dogleg hook — a closing edge that fails straight routing gets
  // tryDogleg (via `ctx.closingEdges.has(i)`) before the node fails.
  const closingEdges = new Set(decomposition.cycles.map((c) => c.closingEdge));
  const attemptAt = (
    stream: string,
    saEnabled: boolean,
  ): ReturnType<typeof tryLayout> =>
    tryLayout(
      graph,
      nodesById,
      decomposition,
      closingEdges,
      makeRng(seed).derive(stream),
      saEnabled,
    );

  let last: { failing: NodeId; detail: string } = { failing: "?", detail: "" };
  for (let restart = 0; restart < MAX_RESTARTS; restart++) {
    const attempt = attemptAt(`restart:${restart}`, false);
    if ("result" in attempt) return attempt.result;
    last = attempt;
  }
  // SA fallback — only reachable when every greedy restart failed. Skipped for cycle-free graphs
  // (SA repairs cycles only), so a tree-only impossible graph throws without the extra passes.
  if (decomposition.cycles.length > 0) {
    for (let restart = 0; restart < MAX_SA_LAYOUT_RESTARTS; restart++) {
      const attempt = attemptAt(`sa-restart:${restart}`, true);
      if ("result" in attempt) return attempt.result;
      last = attempt;
    }
  }
  throw new Error(
    `layout: could not place node "${last.failing}" after ${MAX_RESTARTS} restarts (${last.detail})`,
  );
}
