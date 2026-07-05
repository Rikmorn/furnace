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
import { LOCUS_SAMPLES, pairFeasible, sampleSeatLoci } from "./locus.ts";
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
  expansions: Map<number, DoglegExpansion>;
  /** Edges committed while placing each node (for rollback). */
  nodeEdges: Map<NodeId, number[]>;
  attempts: number;
  failCounts: Map<NodeId, Map<string, number>>;
  adj: Map<NodeId, NodeId[]>;
  depth: Map<NodeId, number>;
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
): boolean {
  const committed: number[] = [];
  const usedPortals: [NodeId, number][] = [];
  const rollback = (): void => {
    for (const ei of committed) {
      ctx.occ.remove(`edge:${ei}`);
      ctx.committedConnectors.delete(ei);
      ctx.edgeBindings.delete(ei);
    }
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
): Map<number, EdgeBinding> | null {
  const reservedNode = new Set<number>([seatBind.node]);
  const reservedByPartner = new Map<NodeId, Set<number>>([
    [seatParentId, new Set<number>([seatBind.parent])],
  ]);
  const otherBinds = new Map<number, EdgeBinding>();
  for (const oe of others) {
    const found = firstFeasibleBinding(
      ctx,
      oe,
      id,
      placement,
      reservedNode,
      reservedByPartner,
    );
    if (!found) {
      countFail(ctx, id, `edge[fwd]:facing:${oe.i}`);
      return null;
    }
    otherBinds.set(oe.i, found.binding);
    reservedNode.add(found.nodePortal);
    const partnerId = oe.e.a === id ? oe.e.b : oe.e.a;
    const set = reservedByPartner.get(partnerId) ?? new Set<number>();
    set.add(found.partnerPortal);
    reservedByPartner.set(partnerId, set);
  }
  return otherBinds;
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
    return [
      pp.position[0] + pp.facing[0] * reach,
      pp.position[1] + pp.facing[1] * reach,
      pp.position[2] + pp.facing[2] * reach,
    ];
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
      // Closure steering: bias the NON-canonical samples toward the steering target by stable
      // XZ-distance sort (nearest-first), keeping the canonical sample FIRST. The candidate's
      // implied room CENTRE (seat portal projected outward by the node's radius) is compared, so
      // a centre-space target stays inside the reachable annulus. Replaces the shuffle/align for
      // steered nodes; the explicit `idx` tiebreak keeps it deterministic regardless of sort
      // stability. Reorders the SAME candidate set — never shrinks it.
      // Boundary cast: sampleSeatLoci always returns the canonical sample at index 0.
      const head = loci[0] as (typeof loci)[number];
      const centreOf = (t: Connection): Vec3 => [
        t.position[0] + t.facing[0] * nodeHalf,
        t.position[1] + t.facing[1] * nodeHalf,
        t.position[2] + t.facing[2] * nodeHalf,
      ];
      const ranked = loci
        .slice(1)
        .map((cand, idx) => ({
          cand,
          idx,
          d: xzDist(centreOf(cand.target), steer),
        }))
        .sort((a, b) => a.d - b.d || a.idx - b.idx);
      loci.length = 0;
      loci.push(head, ...ranked.map((rk) => rk.cand));
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
    // edges (each must have >= 1 free spec-matching binding that is pairFeasible under this
    // placement) ONCE, up front. Then INTERSECTION-BY-FILTRATION for a member with >= 2 active
    // edges (a cycle-closing seat): a STABLE partition puts candidates feasible for ALL other
    // edges first — the configuration-space intersection of both partners — before any that
    // fail, in original (align/explore) order otherwise. This changes SEARCH EFFICIENCY ONLY,
    // NOT which candidate commits nor the placement result: the loop below skips infeasible
    // candidates via `continue` and returns on the first COMMITTABLE one, so a stable partition
    // over an UNCHANGED candidate set cannot change the outcome — it only front-loads the
    // committable candidate so it is reached in fewer wasted attempts on tight/closing members
    // (that is precisely why it is not, and cannot be, a pass/fail lever — see the Task-5
    // investigation). Single-edge members (`others` empty) keep their order untouched.
    const evaluated = loci.map((cand) => {
      const target: Connection = {
        ...cand.target,
        width: nodePortalLocal.width,
        height: nodePortalLocal.height,
      };
      const placement = join(target, nodePortalLocal);
      const otherBinds = forwardCheckOthers(
        ctx,
        id,
        placement,
        seatBind,
        seatParentId,
        others,
      );
      return { placement, otherBinds };
    });
    const ordered =
      others.length > 0
        ? [
            ...evaluated.filter((e) => e.otherBinds),
            ...evaluated.filter((e) => !e.otherBinds),
          ]
        : evaluated;

    for (const { placement, otherBinds } of ordered) {
      if (++ctx.attempts > MAX_ATTEMPTS) return false;
      if (!otherBinds) continue;

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
      if (commitEdges(ctx, id, seat, seatBind, others, otherBinds)) return true;
      // commitEdges rolled back the speculative piece + any committed edges on failure.
    }
  }
  return false;
}

/** Reverse of a node's commit: drop its committed edges (clearance air + connectors +
 *  bindings + BOTH-endpoint portal uses + expansions), then the piece itself. */
function undoNode(ctx: Ctx, id: NodeId): void {
  for (const ei of ctx.nodeEdges.get(id) ?? []) {
    ctx.occ.remove(`edge:${ei}`);
    ctx.committedConnectors.delete(ei);
    ctx.expansions.delete(ei);
    const binding = ctx.edgeBindings.get(ei);
    const edge = ctx.graph.edges[ei];
    if (binding && edge) {
      freePortal(ctx, edge.a, binding.aPortal);
      freePortal(ctx, edge.b, binding.bPortal);
    }
    ctx.edgeBindings.delete(ei);
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
  const half = extentXZ(parentRegion);
  const pos: Vec3 = [
    portal.position[0] - portal.facing[0] * half,
    portal.position[1] - portal.facing[1] * half,
    portal.position[2] - portal.facing[2] * half,
  ];
  return { member, pos, heading: portal.facing };
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
 *  member carrying the most accumulated candidate failures (deterministic id tiebreak). */
function unitFailingNode(ctx: Ctx, unit: PlacedUnit): NodeId {
  if (unit.kind === "node") return unit.id;
  const members = unit.unit.members;
  let best = members[0] ?? unit.unit.members.join("");
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
  for (const ei of [...ctx.committedConnectors.keys()].sort((a, b) => a - b)) {
    for (const c of mustGet(ctx.committedConnectors, ei, "connector"))
      connectors.push(c);
  }
  const edgeBindings = ctx.graph.edges.map((_, i) =>
    mustGet(ctx.edgeBindings, i, "edge binding"),
  );
  return {
    placements: ctx.placements,
    regions,
    connectors,
    edgeBindings,
    expansions: ctx.expansions,
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
    expansions: new Map(),
    nodeEdges: new Map(),
    attempts: 0,
    failCounts: new Map(),
    adj: buildAdjacency(graph),
    depth: depthFromPins(graph),
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
 *  forward checking → occupancy-hard-accept → unit backtracking → seeded restarts). Pure:
 *  no GPU, no Rapier, no wall-clock. Throws setup-loud with per-node diagnostics after
 *  exhausting all restarts. */
export function layoutWorld(graph: WorldGraph, seed: string): LayoutResult {
  validateGraph(graph);
  const nodesById = new Map<NodeId, WorldNode>(
    graph.nodes.map((n) => [n.id, n]),
  );
  const decomposition = deriveChains(graph);
  // Consumed by Task 8's dogleg hook — a closing edge that fails straight routing gets
  // tryDogleg (via `ctx.closingEdges.has(i)`) before the node fails.
  const closingEdges = new Set(decomposition.cycles.map((c) => c.closingEdge));

  for (let restart = 0; restart < MAX_RESTARTS; restart++) {
    const rng = makeRng(seed).derive(`restart:${restart}`);
    const attempt = tryLayout(
      graph,
      nodesById,
      decomposition,
      closingEdges,
      rng,
    );
    if ("result" in attempt) return attempt.result;
    if (restart === MAX_RESTARTS - 1) {
      throw new Error(
        `layout: could not place node "${attempt.failing}" after ${MAX_RESTARTS} restarts (${attempt.detail})`,
      );
    }
  }
  throw new Error("layout: unreachable");
}
