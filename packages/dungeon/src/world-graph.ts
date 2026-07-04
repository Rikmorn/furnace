// packages/dungeon/src/world-graph.ts
// The world-graph contract: nodes = region instances, edges = connections. Verticality
// and (future) directionality live on EDGES; nodes stay orientation-agnostic. `directed`
// and `requiredVerbs` are typed from day one (cheap now, expensive to retrofit) but
// rejected setup-loud until traversal verbs beyond walking exist.
import type { ConnectorKind, Placement } from "./connect.ts";
import type { RegionData } from "./region.ts";

export type NodeId = string;

export type WorldNode = {
  id: NodeId;
  /** Local-frame piece (theme output, or the authored phantom). */
  region: RegionData;
  /** Frozen world placement — authored landmarks; later, sector anchors. */
  pinned?: Placement;
  /** Annotation only in 2.2.5a (pass-through); gates generators in 2.2.5b. */
  theme?: string;
};

export type WorldEdge = {
  a: NodeId;
  b: NodeId;
  /** Indices into each region's `connections`. */
  aPortal: number;
  bPortal: number;
  /** Connector length sampling window (m). Default [2, 10]. */
  lengthRange?: [number, number];
  /** Desired height delta, b above a (m). Default 0 (coplanar). */
  heightDelta?: number;
  /** Force the connector kind (route opts pass-through); absent = chooseKind auto. */
  kind?: ConnectorKind;
  /** Connector enclosure style (route opts pass-through); absent = fully enclosed tube
   *  (walls + ceiling). `"open"` = guardrail-height walls, no ceiling — an authored
   *  open-air bridge. Never affects placement: clearance volumes are style-blind, and
   *  the style-DEPENDENT enclosure solids sit inside the connector's committed
   *  clearance air, which every later occupancy check already tests against. */
  enclosure?: "open";
  /** RESERVED for fall edges — validation throws if true (no fall verbs yet). */
  directed?: boolean;
  /** RESERVED — only "walk" exists; validation throws on anything else. */
  requiredVerbs?: "walk"[];
};

export type WorldGraph = { nodes: WorldNode[]; edges: WorldEdge[] };

/** Setup-loud structural validation. Throws on: duplicate ids, dangling endpoints or
 *  portal indices, a non-door portal (built-interface doctrine — edges join door-class
 *  portals only), a portal used by more than one edge, no pinned node, a disconnected
 *  graph, reserved edge features (`directed`, non-walk verbs). */
export function validateGraph(graph: WorldGraph): void {
  const first = graph.nodes[0];
  if (!first) throw new Error("world-graph: empty graph");
  const byId = new Map<NodeId, WorldNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.id))
      throw new Error(`world-graph: duplicate node id "${n.id}"`);
    byId.set(n.id, n);
  }
  const usedPortals = new Set<string>();
  const usePortal = (id: NodeId, portal: number): void => {
    const n = byId.get(id);
    if (!n)
      throw new Error(`world-graph: edge references unknown node "${id}"`);
    if (portal < 0 || portal >= n.region.connections.length) {
      throw new Error(
        `world-graph: portal index ${portal} out of range on "${id}"`,
      );
    }
    const conn = n.region.connections[portal];
    const key = `${id}:${portal}`;
    if (conn && conn.kind !== "door") {
      throw new Error(
        `world-graph: edge portal ${key} is kind "${conn.kind}" — edges join door-class portals only (built-interface doctrine)`,
      );
    }
    if (usedPortals.has(key)) {
      throw new Error(
        `world-graph: portal ${key} already used by another edge`,
      );
    }
    usedPortals.add(key);
  };
  for (const e of graph.edges) {
    if (e.directed) {
      throw new Error(
        "world-graph: directed edges are reserved (no fall verbs yet)",
      );
    }
    if (e.requiredVerbs?.some((v) => v !== "walk")) {
      throw new Error("world-graph: only the walk verb exists");
    }
    usePortal(e.a, e.aPortal);
    usePortal(e.b, e.bPortal);
  }
  if (!graph.nodes.some((n) => n.pinned)) {
    throw new Error("world-graph: at least one node must be pinned");
  }
  // Connectivity: every node must be reachable from the pinned skeleton. Pinned nodes are
  // the BFS roots (a lone pinned obstacle landmark is its own root); an unpinned node with
  // no edge path to any pin is unplaceable → disconnected.
  const adj = new Map<NodeId, NodeId[]>();
  for (const e of graph.edges) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  const pinnedIds = graph.nodes.filter((n) => n.pinned).map((n) => n.id);
  const seen = new Set<NodeId>(pinnedIds);
  const queue = [...pinnedIds];
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const nb of adj.get(id) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  if (seen.size !== graph.nodes.length) {
    throw new Error("world-graph: disconnected graph");
  }
}
