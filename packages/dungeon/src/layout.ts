// packages/dungeon/src/layout.ts
// The collision-aware placement engine: deterministic incremental graph embedding
// (the Ma-2014/Edgar shape — see docs/research/2026-07-01-dungeon-2.2.5-layout-
// placement-and-megastructure.md). Pins frozen → most-constrained-first order →
// candidates by portal-mating (join) at seeded lengths/yaw-offsets → hard accept
// (occupancy rules + closing-edge realizability) → bounded backtracking → throw
// setup-loud. Pure: no GPU, no Rapier, no wall-clock.
import { create as makeRng } from "@furnace/core/rng";
import { aabbOfBoxes } from "./aabb.ts";
import {
  type ConnectorKind,
  connectorSection,
  ENCLOSURE_TOP_PAD,
  join,
  type Placement,
  placePiece,
  route,
  SHOULDER,
} from "./connect.ts";
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
const N_LENGTHS = 5; // candidate lengths sampled across lengthRange — GATE-TUNE
// ±45° yaw jitter on the seating direction — lets a connector route AROUND an obstacle. GATE-TUNE
const YAW_OFFSETS = [
  0,
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 4,
  -Math.PI / 4,
];
const MAX_ATTEMPTS = 10_000; // total candidate evaluations — GATE-TUNE
const FACING_MIN = Math.cos(Math.PI / 3); // closing-edge portals must face within 60°
export const CLEARANCE_SEGMENT = 2; // m — climb clearance follows the slope in segments
const PORTAL_EXEMPT_DEPTH = 2.5; // m — clearance-vs-solid exemption reach around a portal
const PORTAL_EXEMPT_PAD = 0.3; // m — exemption box cross-section pad
const PORTAL_EXEMPT_BELOW = 1; // m — exemption box reach below the portal floor
const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];

/** The placer's output: the world placement per node, the placed regions (in graph-node
 *  order), and the committed connector pieces (in edge order). */
export type LayoutResult = {
  placements: Map<NodeId, Placement>;
  regions: RegionData[];
  connectors: RegionData[];
};

function placedPortal(region: RegionData, index: number): Connection {
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

/** Rotate a Vec3 by yaw θ about world-up: `Ry(θ)·[x,y,z]` (connect.ts convention). */
function rotateY(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
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

/** The reserved walking air between two portals, as axis-aligned segments that follow
 *  the (possibly climbing) straight run — a headroom clearance volume, not just a floor
 *  slab. Cross-section comes from {@link connectorSection}, and the top is padded by
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
    const yLo = from.position[1] + Math.min(dh * t0, dh * t1);
    const yHi =
      from.position[1] +
      Math.max(dh * t0, dh * t1) +
      headroom +
      ENCLOSURE_TOP_PAD;
    out.push({
      min: [Math.min(x0, x1) - w / 2, yLo, Math.min(z0, z1) - w / 2],
      max: [Math.max(x0, x1) + w / 2, yHi, Math.max(z0, z1) + w / 2],
    });
  }
  return out;
}

/** The exemption box around a portal — the connector is allowed to bore through its own
 *  endpoint pieces' solids here (a mouth necessarily pierces its own wall). The box
 *  reaches ENCLOSURE_TOP_PAD above the headroom (the connector may build its ceiling band
 *  there, and the padded clearance column must stay inside the exemption at the portal);
 *  PORTAL_EXEMPT_PAD is the LATERAL cross-section pad only. */
function portalExemption(portal: Connection, headroom: number): Aabb {
  const w = portal.width / 2 + SHOULDER + PORTAL_EXEMPT_PAD;
  const d = PORTAL_EXEMPT_DEPTH;
  return {
    min: [
      portal.position[0] - w - d,
      portal.position[1] - PORTAL_EXEMPT_BELOW,
      portal.position[2] - w - d,
    ],
    max: [
      portal.position[0] + w + d,
      portal.position[1] + headroom + ENCLOSURE_TOP_PAD,
      portal.position[2] + w + d,
    ],
  };
}

/** Do two portals face each other closely enough (within 60° of the line between them) for
 *  a straight connector to mate them? A cheap pre-filter before `route`. */
function facingsCompatible(from: Connection, to: Connection): boolean {
  const dx = to.position[0] - from.position[0];
  const dz = to.position[2] - from.position[2];
  const run = Math.hypot(dx, dz);
  if (run < 1e-6) return false;
  const dirX = dx / run;
  const dirZ = dz / run;
  const a = from.facing[0] * dirX + from.facing[2] * dirZ;
  const b = -(to.facing[0] * dirX + to.facing[2] * dirZ);
  return a >= FACING_MIN && b >= FACING_MIN;
}

/** Most-constrained-first order over the NON-pinned nodes: BFS depth from the pinned set,
 *  then repeatedly pick the node with the most already-placed neighbours (ties broken by
 *  BFS depth, then id) — Edgar's placement order. Pinned nodes are pre-seated obstacles. */
function placementOrder(graph: WorldGraph): NodeId[] {
  const neighbours = new Map<NodeId, NodeId[]>();
  for (const e of graph.edges) {
    neighbours.set(e.a, [...(neighbours.get(e.a) ?? []), e.b]);
    neighbours.set(e.b, [...(neighbours.get(e.b) ?? []), e.a]);
  }
  const pinned = graph.nodes.filter((n) => n.pinned).map((n) => n.id);
  const depth = new Map<NodeId, number>(pinned.map((id) => [id, 0]));
  const queue = [...pinned];
  while (queue.length) {
    const id = queue.shift() as NodeId;
    for (const nb of neighbours.get(id) ?? []) {
      if (!depth.has(nb)) {
        depth.set(nb, mustGet(depth, id, "depth") + 1);
        queue.push(nb);
      }
    }
  }
  const placed = new Set<NodeId>(pinned);
  const order: NodeId[] = [];
  const remaining = graph.nodes.filter((n) => !n.pinned).map((n) => n.id);
  while (remaining.length) {
    remaining.sort((x, y) => {
      const px = (neighbours.get(x) ?? []).filter((nb) =>
        placed.has(nb),
      ).length;
      const py = (neighbours.get(y) ?? []).filter((nb) =>
        placed.has(nb),
      ).length;
      if (px !== py) return py - px;
      const dd = (depth.get(x) ?? Infinity) - (depth.get(y) ?? Infinity);
      if (dd !== 0) return dd;
      return x < y ? -1 : 1;
    });
    const next = remaining.shift() as NodeId;
    order.push(next);
    placed.add(next);
  }
  return order;
}

type Candidate = { len: number; yawOff: number };

/** All (length, yaw-offset) candidates for seating a node on an edge, in a deterministic
 *  seeded order: the canonical candidate (shortest length, no yaw) first, the rest shuffled
 *  by a seed-derived stream so retries explore without ever using wall-clock randomness. */
function candidatesFor(
  id: NodeId,
  e: WorldEdge,
  rng: ReturnType<typeof makeRng>,
): Candidate[] {
  const [lo, hi] = e.lengthRange ?? DEFAULT_LENGTH_RANGE;
  const lens = Array.from(
    { length: N_LENGTHS },
    (_, i) => lo + ((hi - lo) * i) / Math.max(1, N_LENGTHS - 1),
  );
  const pairs: Candidate[] = [];
  for (const len of lens)
    for (const yawOff of YAW_OFFSETS) pairs.push({ len, yawOff });
  const [first, ...rest] = pairs;
  const r = rng.derive(`cand:${id}`);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = r.int(0, i + 1);
    const tmp = rest[i] as Candidate;
    rest[i] = rest[j] as Candidate;
    rest[j] = tmp;
  }
  return [first as Candidate, ...rest];
}

/** The state a placement frame tracks so it can be revised (backtracked) later. */
type Frame = {
  id: NodeId;
  candidates: Candidate[];
  next: number;
  committedEdges: number[];
};

export function layoutWorld(graph: WorldGraph, seed: string): LayoutResult {
  validateGraph(graph);
  const rng = makeRng(seed);
  const nodesById = new Map<NodeId, WorldNode>(
    graph.nodes.map((n) => [n.id, n]),
  );
  const occ = new Occupancy();
  const placements = new Map<NodeId, Placement>();
  const placedRegions = new Map<NodeId, RegionData>();
  const committedConnectors = new Map<number, RegionData>();

  for (const n of graph.nodes) {
    if (!n.pinned) continue;
    const placed = placePiece(n.region, n.pinned);
    placements.set(n.id, n.pinned);
    placedRegions.set(n.id, placed);
    occ.addPiece(n.id, placed.bounds, solidsOf(placed));
  }

  const order = placementOrder(graph);
  const edgeIndex = (e: WorldEdge): number => graph.edges.indexOf(e);

  /** The already-placed edge this node seats onto (its parent link). */
  function seatingEdge(id: NodeId): WorldEdge {
    const es = graph.edges.filter(
      (e) =>
        (e.a === id && placements.has(e.b)) ||
        (e.b === id && placements.has(e.a)),
    );
    if (es.length === 0) {
      throw new Error(
        `layout: node "${id}" has no placed neighbour when its turn came`,
      );
    }
    return es[0] as WorldEdge;
  }

  /** Realizability check for a NOW-both-placed edge: facings mate, `route` builds, and the
   *  connector's clearance volume is unobstructed. Returns the connector or a fail reason. */
  function tryEdge(e: WorldEdge): { connector: RegionData } | { fail: string } {
    const aRegion = mustGet(placedRegions, e.a, "placed region");
    const bRegion = mustGet(placedRegions, e.b, "placed region");
    const pa = placedPortal(aRegion, e.aPortal);
    const pb = placedPortal(bRegion, e.bPortal);
    if (!facingsCompatible(pa, pb)) return { fail: "facing" };
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
    const rej = occ.checkClearance(clearance, [e.a, e.b], exemptions);
    if (rej) return { fail: `${rej.rule}:${rej.against}` };
    return { connector };
  }

  /** Commit an accepted edge's clearance + connector floor into the occupancy ledger. */
  function commitEdge(e: WorldEdge, connector: RegionData): void {
    const aRegion = mustGet(placedRegions, e.a, "placed region");
    const bRegion = mustGet(placedRegions, e.b, "placed region");
    const pa = placedPortal(aRegion, e.aPortal);
    const pb = placedPortal(bRegion, e.bPortal);
    occ.addClearance(
      `edge:${edgeIndex(e)}`,
      clearanceBoxes(pa, pb),
      [e.a, e.b],
      [],
      solidsOf(connector),
    );
    committedConnectors.set(edgeIndex(e), connector);
  }

  const failCounts = new Map<string, Map<string, number>>();
  const countFail = (id: NodeId, reason: string): void => {
    const m = failCounts.get(id) ?? new Map<string, number>();
    m.set(reason, (m.get(reason) ?? 0) + 1);
    failCounts.set(id, m);
  };

  const stack: (Frame | undefined)[] = [];
  let attempts = 0;
  let cursor = 0;

  while (cursor < order.length) {
    const id = order[cursor] as NodeId;
    const node = mustGet(nodesById, id, "node");
    let frame = stack[cursor];
    if (!frame) {
      frame = {
        id,
        candidates: candidatesFor(id, seatingEdge(id), rng),
        next: 0,
        committedEdges: [],
      };
      stack[cursor] = frame;
    }
    const e = seatingEdge(id);
    const parentId = placements.has(e.a) && e.a !== id ? e.a : e.b;
    const parentRegion = mustGet(placedRegions, parentId, "placed region");
    const parentPortal = placedPortal(
      parentRegion,
      e.a === parentId ? e.aPortal : e.bPortal,
    );
    const nodePortalIndex = e.a === id ? e.aPortal : e.bPortal;
    // heightDelta is "b above a"; when the node being placed IS `a`, the climb sign flips.
    const dhSigned = (e.heightDelta ?? 0) * (e.b === id ? 1 : -1);

    let placedThis = false;
    while (frame.next < frame.candidates.length) {
      if (++attempts > MAX_ATTEMPTS) break;
      const cand = frame.candidates[frame.next] as Candidate;
      frame.next++;
      const facing = rotateY(parentPortal.facing, cand.yawOff);
      const nodePortal = placedPortal(node.region, nodePortalIndex);
      const target: Connection = {
        position: [
          parentPortal.position[0] + facing[0] * cand.len,
          parentPortal.position[1] + dhSigned,
          parentPortal.position[2] + facing[2] * cand.len,
        ],
        facing,
        width: nodePortal.width,
        height: nodePortal.height,
        kind: "door",
      };
      const placement = join(target, nodePortal);
      const placed = placePiece(node.region, placement);
      const envRej = occ.checkPieceEnvelope(placed.bounds);
      if (envRej) {
        countFail(id, `${envRej.rule}:${envRej.against}`);
        continue;
      }
      placements.set(id, placement);
      placedRegions.set(id, placed);
      occ.addPiece(id, placed.bounds, solidsOf(placed));
      // Every edge whose OTHER endpoint is already placed must now close (tree seating + any
      // loop-closing edges to already-placed neighbours).
      const myEdges = graph.edges.filter(
        (ed) =>
          (ed.a === id && placements.has(ed.b) && ed.b !== id) ||
          (ed.b === id && placements.has(ed.a) && ed.a !== id),
      );
      const committed: number[] = [];
      let ok = true;
      for (const ed of myEdges) {
        const res = tryEdge(ed);
        if ("fail" in res) {
          countFail(id, `edge:${res.fail}`);
          ok = false;
          break;
        }
        commitEdge(ed, res.connector);
        committed.push(edgeIndex(ed));
      }
      if (!ok) {
        for (const ei of committed) {
          occ.remove(`edge:${ei}`);
          committedConnectors.delete(ei);
        }
        occ.remove(id);
        placements.delete(id);
        placedRegions.delete(id);
        continue;
      }
      frame.committedEdges = committed;
      placedThis = true;
      break;
    }

    if (placedThis) {
      cursor++;
      continue;
    }
    if (attempts > MAX_ATTEMPTS) break;
    // Exhausted this node's candidates: pop it and revise the PREVIOUS frame's choice.
    stack[cursor] = undefined;
    cursor--;
    if (cursor < 0) break;
    const prev = stack[cursor] as Frame;
    for (const ei of prev.committedEdges) {
      occ.remove(`edge:${ei}`);
      committedConnectors.delete(ei);
    }
    occ.remove(prev.id);
    placements.delete(prev.id);
    placedRegions.delete(prev.id);
  }

  if (placements.size !== graph.nodes.length) {
    const failing = order.find((id) => !placements.has(id)) ?? "?";
    const detail = [...(failCounts.get(failing) ?? new Map<string, number>())]
      .map(([k, v]) => `${k}×${v}`)
      .join(", ");
    throw new Error(
      `layout: could not place node "${failing}" within ${attempts} attempts (${detail || "no candidates"})`,
    );
  }

  return {
    placements,
    regions: graph.nodes.map((n) =>
      mustGet(placedRegions, n.id, "placed region"),
    ),
    connectors: [...committedConnectors.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([, r]) => r),
  };
}
