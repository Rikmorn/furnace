// The flags state machine, driven with no host and no GPU — which is most of
// what Task 10 added, because everything except the marker upload is pure.
import { expect, test } from "bun:test";
import type {
  ChunkKey,
  FieldFlag,
  FlagKind,
  FlagSeverity,
} from "@furnace/core/field";
import type { VerifyVerdictWire } from "../../src/frontend/lib/analyzer-protocol.ts";
import {
  CANDIDATE_TINT,
  createFlagStore,
  DEFAULT_FLAG_FILTERS,
  flagKey,
  flagTint,
  INFO_TINT,
  VERIFIED_CLEAR_TINT,
  VERIFIED_TRAPPED_TINT,
} from "../../src/viewport-host/field-flags.ts";

const CELL = 0.25;

/** One flag, with `world` derived from `cell` so the fixtures stay short. The
 *  advisor's own `world` is the floor surface under the cell; nothing here reads
 *  it except the marker packer, which this file does not exercise. */
function flag(
  kind: FlagKind,
  severity: FlagSeverity,
  cell: [number, number, number],
  chunk: ChunkKey,
  unreachable?: boolean,
): FieldFlag {
  return {
    kind,
    severity,
    cell,
    world: [cell[0] * CELL, cell[1] * CELL, cell[2] * CELL],
    chunk,
    ...(unreachable === undefined ? {} : { unreachable }),
  };
}

const verdict = (outcome: VerifyVerdictWire["outcome"]): VerifyVerdictWire => ({
  outcome,
  lanes: [],
  ms: 1,
});

/** `applyFlags`' first argument, from a flat list grouped by owner chunk — the
 *  shape the worker's `flags` response carries. */
function byOwner(
  flags: readonly FieldFlag[],
): { key: ChunkKey; flags: FieldFlag[] }[] {
  const out = new Map<ChunkKey, FieldFlag[]>();
  for (const f of flags) {
    const list = out.get(f.chunk);
    if (list === undefined) out.set(f.chunk, [f]);
    else list.push(f);
  }
  return [...out].map(([key, list]) => ({ key, flags: list }));
}

test("the default filters show candidates and hide info + demoted flags", () => {
  const store = createFlagStore();
  expect(store.filters()).toEqual({
    candidates: true,
    info: false,
    unreachable: false,
  });
  expect(DEFAULT_FLAG_FILTERS).toEqual(store.filters());

  store.applyFlags(
    byOwner([
      flag("narrow", "candidate", [1, 0, 0], "0,0,0"),
      flag("ledge", "info", [2, 0, 0], "0,0,0"),
      flag("narrow", "candidate", [3, 0, 0], "0,0,0", true),
    ]),
  );
  const s = store.summary();
  expect(s.total).toBe(3);
  expect(s.visible.map(flagKey)).toEqual(["narrow@1,0,0"]);
});

test("each filter admits exactly its own band", () => {
  const store = createFlagStore();
  store.applyFlags(
    byOwner([
      flag("narrow", "candidate", [1, 0, 0], "0,0,0"),
      flag("ledge", "info", [2, 0, 0], "0,0,0"),
      flag("narrow", "candidate", [3, 0, 0], "0,0,0", true),
    ]),
  );
  store.setFilters({ candidates: true, info: true, unreachable: false });
  expect(store.summary().visible.map(flagKey)).toEqual([
    "ledge@2,0,0",
    "narrow@1,0,0",
  ]);
  store.setFilters({ candidates: true, info: false, unreachable: true });
  expect(store.summary().visible.map(flagKey)).toEqual([
    "narrow@1,0,0",
    "narrow@3,0,0",
  ]);
  store.setFilters({ candidates: false, info: false, unreachable: true });
  expect(store.summary().visible).toEqual([]);
  // Hiding everything filters the VIEW and nothing else — the findings stand.
  expect(store.summary().total).toBe(3);
});

test("only `unreachable === true` is demoted — `undefined` is the normal mixed-vintage state", () => {
  const store = createFlagStore();
  store.applyFlags(
    byOwner([
      flag("narrow", "candidate", [1, 0, 0], "0,0,0"), // never flooded
      flag("narrow", "candidate", [2, 0, 0], "0,0,0", false), // flooded, reached
      flag("narrow", "candidate", [3, 0, 0], "0,0,0", true), // flooded, not reached
    ]),
  );
  // Teeth: a filter written as `unreachable === false` would show only 2,0,0
  // and silently hide every flag no reachability pass has visited yet.
  expect(store.summary().visible.map(flagKey)).toEqual([
    "narrow@1,0,0",
    "narrow@2,0,0",
  ]);
});

test("a chunk's flags are REPLACED wholesale, empty list included", () => {
  const store = createFlagStore();
  store.applyFlags(
    byOwner([
      flag("narrow", "candidate", [1, 0, 0], "0,0,0"),
      flag("narrow", "candidate", [20, 0, 0], "1,0,0"),
    ]),
  );
  expect(store.summary().total).toBe(2);
  // "0,0,0" analysed to nothing; "1,0,0" was not in this response at all.
  store.applyFlags([{ key: "0,0,0", flags: [] }]);
  expect(store.summary().visible.map(flagKey)).toEqual(["narrow@20,0,0"]);
});

test("re-analysing a chunk clears the demotion tags it used to carry", () => {
  const store = createFlagStore();
  store.applyFlags(
    byOwner([flag("narrow", "candidate", [1, 0, 0], "0,0,0", true)]),
  );
  expect(store.summary().visible).toEqual([]);
  // The same finding, re-analysed by a pass that ran NO reachability flood: its
  // tag is `undefined`, and replacement is what makes the stale `true` go away.
  // `markUnreachable` leaves prior demotions standing on its own skip paths, so
  // a store that MERGED tags instead of replacing would hide this forever.
  store.applyFlags(byOwner([flag("narrow", "candidate", [1, 0, 0], "0,0,0")]));
  expect(store.summary().visible.map(flagKey)).toEqual(["narrow@1,0,0"]);
});

test("duplicate (kind, cell) findings from two owner chunks present once", () => {
  const store = createFlagStore();
  // A `low-clearance` anchors on the offending NEIGHBOUR cell, so a border cell
  // is emitted by BOTH owners' passes. Deliberate and miss-safe in core;
  // presenting it twice is the UI's problem to solve, not core's.
  store.applyFlags([
    {
      key: "0,0,0",
      flags: [flag("low-clearance", "candidate", [16, 0, 0], "0,0,0")],
    },
    {
      key: "1,0,0",
      flags: [flag("low-clearance", "candidate", [16, 0, 0], "1,0,0")],
    },
  ]);
  const s = store.summary();
  expect(s.total).toBe(1);
  expect(s.visible.map(flagKey)).toEqual(["low-clearance@16,0,0"]);
});

test("a duplicate that is NOT demoted wins over one that is", () => {
  const store = createFlagStore();
  // Two owners, different vintages: one pass flooded and demoted, the other has
  // not run yet. Presenting the demoted copy would hide a finding on the
  // strength of the older answer, so the least-demoted copy is the one kept.
  store.applyFlags([
    {
      key: "0,0,0",
      flags: [flag("low-clearance", "candidate", [16, 0, 0], "0,0,0", true)],
    },
    {
      key: "1,0,0",
      flags: [flag("low-clearance", "candidate", [16, 0, 0], "1,0,0")],
    },
  ]);
  expect(store.summary().visible.map(flagKey)).toEqual([
    "low-clearance@16,0,0",
  ]);
  // …and in the other arrival order.
  const other = createFlagStore();
  other.applyFlags([
    {
      key: "1,0,0",
      flags: [flag("low-clearance", "candidate", [16, 0, 0], "1,0,0")],
    },
    {
      key: "0,0,0",
      flags: [flag("low-clearance", "candidate", [16, 0, 0], "0,0,0", true)],
    },
  ]);
  expect(other.summary().visible.map(flagKey)).toEqual([
    "low-clearance@16,0,0",
  ]);
});

test("byKindSeverity counts the deduped, UNFILTERED set", () => {
  const store = createFlagStore();
  store.applyFlags(
    byOwner([
      flag("narrow", "candidate", [1, 0, 0], "0,0,0"),
      flag("narrow", "candidate", [2, 0, 0], "0,0,0", true),
      flag("ledge", "info", [3, 0, 0], "0,0,0"),
    ]),
  );
  const s = store.summary();
  // Rows in kind-then-severity order; a pair with no findings is absent, not 0.
  expect(s.byKindSeverity).toEqual([
    { kind: "ledge", severity: "info", count: 1 },
    { kind: "narrow", severity: "candidate", count: 2 },
  ]);
  // One of the two `narrow` is filtered out of the view; the count is not.
  expect(s.visible.length).toBe(1);
});

test("pits replace wholesale, and only when the response carries them", () => {
  const store = createFlagStore();
  const pit = flag("pit", "candidate", [4, 0, 4], "0,0,0");
  store.applyFlags([], [pit]);
  expect(store.summary().visible.map(flagKey)).toEqual(["pit@4,0,4"]);

  // An INCREMENTAL response carries no pit field: the whole-world pass did not
  // run, so it has nothing to say about traps and must not clear them.
  store.applyFlags(byOwner([flag("narrow", "candidate", [1, 0, 0], "0,0,0")]));
  expect(store.summary().visible.map(flagKey)).toEqual([
    "narrow@1,0,0",
    "pit@4,0,4",
  ]);

  // A whole-world response with an EMPTY pit list is the trap being fixed.
  store.applyFlags([], []);
  expect(store.summary().visible.map(flagKey)).toEqual(["narrow@1,0,0"]);
});

test("a verdict is keyed by kind@cell and cleared when its owner chunk re-analyses", () => {
  const store = createFlagStore();
  const narrow = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  const elsewhere = flag("narrow", "candidate", [20, 0, 0], "1,0,0");
  store.applyFlags(byOwner([narrow, elsewhere]));
  store.setVerdict(narrow, verdict("trapped"));
  store.setVerdict(elsewhere, verdict("clear"));
  expect([...store.summary().verdicts.keys()].sort()).toEqual([
    "narrow@1,0,0",
    "narrow@20,0,0",
  ]);

  // "0,0,0" re-analysed: whatever the mover proved about that chunk was proved
  // against a field that has since moved.
  store.applyFlags([{ key: "0,0,0", flags: [narrow] }]);
  const v = store.summary().verdicts;
  expect(v.has("narrow@1,0,0")).toBe(false);
  expect(v.get("narrow@20,0,0")?.outcome).toBe("clear");
});

test("a pit verdict is cleared by the next pit replacement", () => {
  const store = createFlagStore();
  const pit = flag("pit", "candidate", [4, 0, 4], "0,0,0");
  store.applyFlags([], [pit]);
  store.setVerdict(pit, verdict("trapped"));
  expect(store.summary().verdicts.size).toBe(1);
  // Pits have no owner chunk to replace by — `chunk` is the anchor's alone and
  // a region can span more — so the wholesale replacement clears them wholesale.
  store.applyFlags([], [pit]);
  expect(store.summary().verdicts.size).toBe(0);
});

test("clear() empties findings, pits and verdicts but keeps the filters", () => {
  const store = createFlagStore();
  const f = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  store.applyFlags(byOwner([f]), [
    flag("pit", "candidate", [4, 0, 4], "0,0,0"),
  ]);
  store.setVerdict(f, verdict("clear"));
  store.setFilters({ candidates: true, info: true, unreachable: true });

  store.clear();
  const s = store.summary();
  expect(s.total).toBe(0);
  expect(s.visible).toEqual([]);
  expect(s.verdicts.size).toBe(0);
  // Filters are a VIEW preference, like the layer flags: a world load must not
  // silently re-hide what the user chose to see.
  expect(store.filters()).toEqual({
    candidates: true,
    info: true,
    unreachable: true,
  });
});

test("the tint reads the verdict first and the severity band second", () => {
  const candidate = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  const info = flag("ledge", "info", [2, 0, 0], "0,0,0");
  expect(flagTint(candidate, undefined)).toEqual(CANDIDATE_TINT);
  expect(flagTint(info, undefined)).toEqual(INFO_TINT);
  expect(flagTint(candidate, verdict("trapped"))).toEqual(
    VERIFIED_TRAPPED_TINT,
  );
  expect(flagTint(candidate, verdict("clear"))).toEqual(VERIFIED_CLEAR_TINT);
  // "inconclusive" proved nothing, so the finding keeps its own colour.
  expect(flagTint(candidate, verdict("inconclusive"))).toEqual(CANDIDATE_TINT);
  expect(flagTint(info, verdict("inconclusive"))).toEqual(INFO_TINT);
});
