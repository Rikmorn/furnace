import { describe, expect, test } from "bun:test";
import { deriveChains } from "../src/chains.ts";

const graph = (
  nodes: string[],
  pinned: string[],
  edges: [string, string][],
) => ({
  nodes: nodes.map((id) => ({ id, pinned: pinned.includes(id) })),
  edges: edges.map(([a, b]) => ({ a, b })),
});

describe("deriveChains", () => {
  test("pure tree → no cycle units, all nodes in tree order", () => {
    const g = graph(
      ["p", "a", "b", "c"],
      ["p"],
      [
        ["p", "a"],
        ["a", "b"],
        ["a", "c"],
      ],
    );
    const d = deriveChains(g);
    expect(d.cycles).toEqual([]);
    expect(new Set(d.treeNodes)).toEqual(new Set(["a", "b", "c"]));
  });
  test("one ring → one cycle unit containing the ring members, smallest-first ordering", () => {
    const g = graph(
      ["p", "a", "b", "c", "d", "e", "f"],
      ["p"],
      [
        ["p", "a"],
        ["a", "b"],
        ["b", "c"],
        ["c", "a"], // 3-cycle a-b-c
        ["a", "d"],
        ["d", "e"],
        ["e", "f"],
        ["f", "d"], // 3-cycle d-e-f, deeper
      ],
    );
    const d = deriveChains(g);
    expect(d.cycles.length).toBe(2);
    for (const cyc of d.cycles) expect(cyc.members.length).toBe(3);
    // every cycle's edge list includes its own closing edge
    for (const cyc of d.cycles) expect(cyc.edges).toContain(cyc.closingEdge);
    // tree nodes = everything not in a cycle
    expect(d.treeNodes).toEqual([]);
  });
  test("loop edge whose tree path passes through the pin: cycle excludes pinned nodes from members", () => {
    const g = graph(
      ["p", "a", "b"],
      ["p"],
      [
        ["p", "a"],
        ["p", "b"],
        ["a", "b"],
      ],
    );
    const d = deriveChains(g);
    expect(d.cycles.length).toBe(1);
    expect(new Set(d.cycles[0]?.members)).toEqual(new Set(["a", "b"]));
  });
  test("cycle edge indices partition the edge set", () => {
    const g = graph(
      ["p", "a", "b", "c"],
      ["p"],
      [
        ["p", "a"],
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ],
    );
    const d = deriveChains(g);
    const cyc = d.cycles[0];
    expect(cyc).toBeDefined();
    expect(cyc?.edges.sort()).toEqual([1, 2, 3]);
  });
});
