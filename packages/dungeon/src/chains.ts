// Pure chain decomposition for the placement engine (the Ma-2014/Edgar ordering): walk
// the edge list with union-find — an edge joining two already-connected components is a
// CYCLE-CLOSING edge, and its chain is the cycle it forms with the tree path between its
// endpoints. Cycles place FIRST (smallest member-count first); everything else is tree.
// Works for ANY structurally valid graph shape — only ids, `pinned`, and edge endpoint
// pairs are read (no regions, no portals), so fixtures stay tiny.

type ChainNode = { id: string; pinned?: unknown };
type ChainEdge = { a: string; b: string };
/** Minimal structural graph shape `deriveChains` reads — ids, pinned flag, and edge
 *  endpoint pairs only (no regions, no portals); a real `WorldGraph` satisfies it
 *  structurally, so callers pass one directly and fixtures stay tiny. */
export type ChainGraph = { nodes: ChainNode[]; edges: ChainEdge[] };

/** One cycle unit: the closing (non-tree) edge, every edge on the cycle (indices into
 *  graph.edges, closing edge included), and the cycle's UNPINNED member node ids. */
export type CycleUnit = {
  closingEdge: number;
  edges: number[];
  members: string[];
};

/** The cycles-first placement decomposition of a graph: its cycle units plus the
 *  remaining tree nodes. */
export type ChainDecomposition = {
  /** Cycle units, smallest member-count first (ties: lowest closing-edge index). */
  cycles: CycleUnit[];
  /** Non-cycle, non-pinned node ids (placement order decided dynamically by the placer). */
  treeNodes: string[];
};

/** Decompose a graph into placement chains via union-find: each edge that joins two
 *  already-connected components is a cycle-closing edge whose cycle (that edge plus the
 *  tree path between its endpoints) becomes a cycle unit; every other node is a tree
 *  node. Cycles are returned smallest-member-count-first (cycles place before tree). */
export function deriveChains(graph: ChainGraph): ChainDecomposition {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    // Boundary cast: `parent` is seeded with an entry for every node id, so
    // parent.get(r) is never undefined while r ranges over reachable ids.
    while (parent.get(r) !== r) r = parent.get(r) as string;
    // path-compress
    let c = x;
    while (parent.get(c) !== r) {
      // Boundary cast: same `parent`-has-every-id invariant as above.
      const next = parent.get(c) as string;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const n of graph.nodes) parent.set(n.id, n.id);

  // Tree adjacency (only union edges), so cycle paths can be recovered by BFS.
  const treeAdj = new Map<string, { to: string; edge: number }[]>();
  const addAdj = (a: string, b: string, edge: number): void => {
    treeAdj.set(a, [...(treeAdj.get(a) ?? []), { to: b, edge }]);
    treeAdj.set(b, [...(treeAdj.get(b) ?? []), { to: a, edge }]);
  };
  const closing: number[] = [];
  graph.edges.forEach((e, i) => {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) {
      closing.push(i);
    } else {
      parent.set(ra, rb);
      addAdj(e.a, e.b, i);
    }
  });

  /** Tree path a→b as edge indices + interior node ids (BFS over union edges). */
  const treePath = (
    a: string,
    b: string,
  ): { edges: number[]; nodes: string[] } => {
    const prev = new Map<string, { from: string; edge: number }>();
    const q = [a];
    const seen = new Set([a]);
    while (q.length) {
      // Boundary cast: the `while (q.length)` guard proves the queue is non-empty.
      const cur = q.shift() as string;
      if (cur === b) break;
      for (const { to, edge } of treeAdj.get(cur) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        prev.set(to, { from: cur, edge });
        q.push(to);
      }
    }
    const edges: number[] = [];
    const nodes: string[] = [];
    let cur = b;
    while (cur !== a) {
      const p = prev.get(cur);
      if (!p)
        throw new Error(`chains: no tree path ${a} → ${b} (disconnected?)`);
      edges.push(p.edge);
      nodes.push(cur);
      cur = p.from;
    }
    nodes.push(a);
    return { edges, nodes };
  };

  const pinned = new Set(graph.nodes.filter((n) => n.pinned).map((n) => n.id));
  const cycles: CycleUnit[] = closing.map((ci) => {
    // Boundary cast: `ci` comes from `closing`, which only collects valid indices
    // into `graph.edges`, so the indexed read is never undefined.
    const e = graph.edges[ci] as ChainEdge;
    const path = treePath(e.a, e.b);
    return {
      closingEdge: ci,
      edges: [ci, ...path.edges],
      members: path.nodes.filter((id) => !pinned.has(id)),
    };
  });
  cycles.sort(
    (x, y) =>
      x.members.length - y.members.length || x.closingEdge - y.closingEdge,
  );

  const inCycle = new Set(cycles.flatMap((c) => c.members));
  const treeNodes = graph.nodes
    .filter((n) => !n.pinned && !inCycle.has(n.id))
    .map((n) => n.id);
  return { cycles, treeNodes };
}
