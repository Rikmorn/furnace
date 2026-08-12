// The flags state machine, driven with no host and no GPU — which is most of
// what Task 10 added, because everything except the marker upload is pure.
import { expect, test } from "bun:test";
import type {
  ChunkKey,
  FieldFlag,
  FlagKind,
  FlagSeverity,
} from "@furnace/core/field";
import type { VerifyVerdictWire } from "../../src/field-host/analyzer-protocol.ts";
import type {
  FlagRow,
  FlagsSummary,
} from "../../src/field-host/field-flags.ts";
import {
  CANDIDATE_TINT,
  createFlagStore,
  DEFAULT_FLAG_FILTERS,
  FLAG_SELECTED_SCALE,
  flagCellBox,
  flagMarkerCenter,
  flagMarkerStyle,
  flagTint,
  INFO_TINT,
  VERIFIED_CLEAR_TINT,
  VERIFIED_TRAPPED_TINT,
} from "../../src/field-host/field-flags.ts";

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

/** The visible rows' keys — the identity the store hands out, which a consumer
 *  passes back and never builds. */
const keysOf = (s: FlagsSummary): string[] => s.visible.map((r) => r.key);

/** The verdict carried on the row for `key`, if that row is visible at all. */
const verdictOf = (
  s: FlagsSummary,
  key: string,
): VerifyVerdictWire | undefined =>
  s.visible.find((r) => r.key === key)?.verdict;

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
    pits: true,
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
  expect(keysOf(s)).toEqual(["narrow@1,0,0"]);
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
  store.setFilters({
    candidates: true,
    info: true,
    unreachable: false,
    pits: true,
  });
  expect(keysOf(store.summary())).toEqual(["ledge@2,0,0", "narrow@1,0,0"]);
  store.setFilters({
    candidates: true,
    info: false,
    unreachable: true,
    pits: true,
  });
  expect(keysOf(store.summary())).toEqual(["narrow@1,0,0", "narrow@3,0,0"]);
  store.setFilters({
    candidates: false,
    info: false,
    unreachable: true,
    pits: true,
  });
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
  expect(keysOf(store.summary())).toEqual(["narrow@1,0,0", "narrow@2,0,0"]);
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
  expect(keysOf(store.summary())).toEqual(["narrow@20,0,0"]);
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
  expect(keysOf(store.summary())).toEqual(["narrow@1,0,0"]);
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
  expect(keysOf(s)).toEqual(["low-clearance@16,0,0"]);
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
  expect(keysOf(store.summary())).toEqual(["low-clearance@16,0,0"]);
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
  expect(keysOf(other.summary())).toEqual(["low-clearance@16,0,0"]);
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
  expect(keysOf(store.summary())).toEqual(["pit@4,0,4"]);

  // An INCREMENTAL response carries no pit field: the whole-world pass did not
  // run, so it has nothing to say about traps and must not clear them.
  store.applyFlags(byOwner([flag("narrow", "candidate", [1, 0, 0], "0,0,0")]));
  expect(keysOf(store.summary())).toEqual(["narrow@1,0,0", "pit@4,0,4"]);

  // A whole-world response with an EMPTY pit list is the trap being fixed.
  store.applyFlags([], []);
  expect(keysOf(store.summary())).toEqual(["narrow@1,0,0"]);
});

test("a verdict rides its own row, and is cleared when its owner chunk re-analyses", () => {
  const store = createFlagStore();
  const narrow = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  const elsewhere = flag("narrow", "candidate", [20, 0, 0], "1,0,0");
  store.applyFlags(byOwner([narrow, elsewhere]));
  store.setVerdict(narrow, verdict("trapped"));
  store.setVerdict(elsewhere, verdict("clear"));
  // Already joined onto the row: a consumer never indexes a map with a key it
  // would have had to spell itself.
  expect(verdictOf(store.summary(), "narrow@1,0,0")?.outcome).toBe("trapped");
  expect(verdictOf(store.summary(), "narrow@20,0,0")?.outcome).toBe("clear");

  // "0,0,0" re-analysed: whatever the mover proved about that chunk was proved
  // against a field that has since moved.
  store.applyFlags([{ key: "0,0,0", flags: [narrow] }]);
  expect(verdictOf(store.summary(), "narrow@1,0,0")).toBeUndefined();
  expect(verdictOf(store.summary(), "narrow@20,0,0")?.outcome).toBe("clear");
});

test("a pit verdict is cleared by the next pit replacement", () => {
  const store = createFlagStore();
  const pit = flag("pit", "candidate", [4, 0, 4], "0,0,0");
  store.applyFlags([], [pit]);
  store.setVerdict(pit, verdict("trapped"));
  expect(verdictOf(store.summary(), "pit@4,0,4")?.outcome).toBe("trapped");
  // Pits have no owner chunk to replace by — `chunk` is the anchor's alone and
  // a region can span more — so the wholesale replacement clears them wholesale.
  store.applyFlags([], [pit]);
  expect(verdictOf(store.summary(), "pit@4,0,4")).toBeUndefined();
});

test("clear() empties findings, pits and verdicts but keeps the filters", () => {
  const store = createFlagStore();
  const f = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  store.applyFlags(byOwner([f]), [
    flag("pit", "candidate", [4, 0, 4], "0,0,0"),
  ]);
  store.setVerdict(f, verdict("clear"));
  store.setFilters({
    candidates: true,
    info: true,
    unreachable: true,
    pits: true,
  });

  store.clear();
  const s = store.summary();
  expect(s.total).toBe(0);
  expect(s.visible).toEqual([]);
  // Filters are a VIEW preference, like the layer flags: a world load must not
  // silently re-hide what the user chose to see.
  expect(store.filters()).toEqual({
    candidates: true,
    info: true,
    unreachable: true,
    pits: true,
  });
});

test("the tint reads the verdict first and the severity band second", () => {
  const row = (
    flag: FieldFlag,
    outcome?: VerifyVerdictWire["outcome"],
  ): FlagRow => ({
    key: "k",
    flag,
    ...(outcome === undefined ? {} : { verdict: verdict(outcome) }),
  });
  const candidate = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  const info = flag("ledge", "info", [2, 0, 0], "0,0,0");
  expect(flagTint(row(candidate))).toEqual(CANDIDATE_TINT);
  expect(flagTint(row(info))).toEqual(INFO_TINT);
  expect(flagTint(row(candidate, "trapped"))).toEqual(VERIFIED_TRAPPED_TINT);
  expect(flagTint(row(candidate, "clear"))).toEqual(VERIFIED_CLEAR_TINT);
  // "inconclusive" proved nothing, so the finding keeps its own colour.
  expect(flagTint(row(candidate, "inconclusive"))).toEqual(CANDIDATE_TINT);
  expect(flagTint(row(info, "inconclusive"))).toEqual(INFO_TINT);
});

// --- rowByKey: the inverse of the private key format (F4 Task 12) -----------
//
// Lives here rather than in the host because `flagKey` is private to this
// module: a lookup written anywhere else would be re-spelling a format it
// cannot see. `FieldHost.verifyFlag` is the caller — it resolves the row the
// panel handed a key for, and posts stage 2 at that row's flag.

test("rowByKey resolves a key the summary handed out, and returns its verdict", () => {
  const store = createFlagStore();
  const narrow = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  store.applyFlags([{ key: "0,0,0", flags: [narrow] }]);
  const key = keysOf(store.summary())[0];
  if (key === undefined) throw new Error("test: no visible row");

  expect(store.rowByKey(key)?.flag).toBe(narrow);
  expect(store.rowByKey("narrow@9,9,9")).toBeUndefined();

  // The row carries its verdict, like the summary's own — both are built by one
  // joiner, so a row resolved by key and the same row read off the summary can
  // never disagree about what stage 2 proved.
  store.setVerdict(narrow, verdict("trapped"));
  expect(store.rowByKey(key)?.verdict).toEqual(verdict("trapped"));
  expect(store.rowByKey(key)?.verdict).toEqual(verdictOf(store.summary(), key));
});

test("rowByKey is scoped to VISIBLE rows — a filtered-out finding is unaddressable", () => {
  // The keys a consumer can hold come from `summary().visible` and nowhere else,
  // so a hidden finding is one nothing has a key for. Resolving it anyway would
  // let a verify run on a finding the user cannot see, and land a verdict on a
  // row that is not on screen to show it.
  const store = createFlagStore();
  const info = flag("ledge", "info", [2, 0, 0], "0,0,0");
  store.setFilters({
    candidates: true,
    info: true,
    unreachable: false,
    pits: true,
  });
  store.applyFlags([{ key: "0,0,0", flags: [info] }]);
  const key = keysOf(store.summary())[0];
  if (key === undefined) throw new Error("test: no visible row");
  expect(store.rowByKey(key)?.flag).toBe(info);

  // Hide the band it is in: the finding STANDS (a filter never deletes) but the
  // key stops resolving.
  store.setFilters(DEFAULT_FLAG_FILTERS); // candidates only
  expect(store.summary().total).toBe(1);
  expect(store.rowByKey(key)).toBeUndefined();
});

// --- the marker's standing place (F4.5b Task 3) -----------------------------

test("flagMarkerCenter LIFTS the marker half a cell out of the floor", () => {
  // `flag.world` is the floor surface under the anchor cell. The marker stands
  // in the CELL, not in the floor — and the two consumers of that fact (the
  // host's instanced marker matrices, and the pointer pick's clickable cell box)
  // read it here rather than each adding cellSize/2 of their own. Spelled twice
  // they drift by half a cell and every marker becomes unclickable while still
  // looking right on screen.
  expect(flagMarkerCenter([2, 1, -3], 0.5)).toEqual([2, 1.25, -3]);
  // Cell-relative, because the lift is: X and Z are untouched, Y scales.
  expect(flagMarkerCenter([2, 1, -3], CELL)).toEqual([2, 1.125, -3]);
});

// --- the `pits` band (F4.5b Task 13, D-F4.5-15's third chip) ----------------

test("the `pits` filter is a KIND veto, and it is ON by default", () => {
  const store = createFlagStore();
  const pit = flag("pit", "candidate", [4, 0, 4], "0,0,0");
  const narrow = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  store.applyFlags(byOwner([narrow]), [pit]);

  // Default-ON, deliberately: a pit is candidate-severity, so the `candidates`
  // chip already claims to be showing it. A second chip that defaulted OFF would
  // make the first one lie about the most serious finding the advisor has.
  expect(DEFAULT_FLAG_FILTERS.pits).toBe(true);
  expect(keysOf(store.summary()).length).toBe(2);

  store.setFilters({ ...DEFAULT_FLAG_FILTERS, pits: false });
  // ONE-SIDED like `unreachable`: it removes pits and touches nothing else, so
  // the narrow finding beside it is unaffected.
  expect(keysOf(store.summary())).toEqual(["narrow@1,0,0"]);
  // …and it HIDES rather than deletes — the header still counts it.
  expect(store.summary().total).toBe(2);
});

// --- the selected finding (F4.5b Task 13, D-F4.5-15) ------------------------

test("`selected` publishes a key only while it resolves to a VISIBLE row", () => {
  const store = createFlagStore();
  const info = flag("ledge", "info", [2, 0, 0], "0,0,0");
  store.setFilters({ ...DEFAULT_FLAG_FILTERS, info: true });
  store.applyFlags(byOwner([info]));
  const key = keysOf(store.summary())[0];
  if (key === undefined) throw new Error("test: no visible row");

  store.setSelected(key);
  expect(store.summary().selected).toBe(key);

  // A filter that HIDES the selected row publishes null — nothing on screen may
  // highlight a row that is not there — but the store keeps the key, so ticking
  // the band back on restores the selection. The two cases a passive validation
  // could not tell apart are exactly these: hidden (must come back) and
  // re-analyzed away (must not), and retaining is what makes the first one work.
  store.setFilters(DEFAULT_FLAG_FILTERS);
  expect(store.summary().selected).toBeNull();
  store.setFilters({ ...DEFAULT_FLAG_FILTERS, info: true });
  expect(store.summary().selected).toBe(key);
});

test("a re-analysis that retires the selected finding publishes no selection", () => {
  const store = createFlagStore();
  store.applyFlags(byOwner([flag("narrow", "candidate", [1, 0, 0], "0,0,0")]));
  store.setSelected("narrow@1,0,0");
  expect(store.summary().selected).toBe("narrow@1,0,0");

  // The chunk re-analyses to nothing — the advisor changed its mind, which is the
  // one way a finding really disappears. Unlike the filter case there is nothing
  // to come back TO, so the seam stops claiming it.
  //
  // Precisely what is claimed: `selected` is null for as long as nothing VISIBLE
  // answers to that key. NOT "for the rest of the session" — the key is retained,
  // so a later re-analysis finding the same kind at the same cell republishes it.
  // That is the design rather than a hole in it (the key IS the finding's identity)
  // and it is the same retention the filter case above depends on.
  store.applyFlags([{ key: "0,0,0", flags: [] }]);
  expect(store.summary().selected).toBeNull();
});

test("clear() drops the selection with the findings", () => {
  const store = createFlagStore();
  store.applyFlags(byOwner([flag("narrow", "candidate", [1, 0, 0], "0,0,0")]));
  store.setSelected("narrow@1,0,0");
  store.clear();
  // A world reset, unlike a filter change: the key names a finding in a world
  // that is gone, so retaining it could only resurrect a selection in the NEXT
  // world if the analyzer happened to find the same kind at the same cell.
  store.applyFlags(byOwner([flag("narrow", "candidate", [1, 0, 0], "0,0,0")]));
  expect(store.summary().selected).toBeNull();
});

// --- what a selected marker looks like (D-F4.5-15) --------------------------

test("selection pops the marker's SIZE and leaves its colour alone", () => {
  const row: FlagRow = {
    key: "k",
    flag: flag("narrow", "candidate", [1, 0, 0], "0,0,0"),
    verdict: verdict("trapped"),
  };
  // The colour is the finding's own — its verdict here, its band otherwise. D-15
  // asks for "emphasis tiers on an outline treatment INDEPENDENT of surface
  // color" (the Blender model), and the reason is concrete: re-tinting the marker
  // would delete the trapped/clear/candidate signal from the one row the user is
  // looking at, which is the row they most need it on. The `--primary` emphasis
  // rides the cell OUTLINE the host draws beside it.
  expect(flagMarkerStyle(row, true).tint).toEqual(VERIFIED_TRAPPED_TINT);
  expect(flagMarkerStyle(row, false).tint).toEqual(flagTint(row));
  // The size is the whole of the marker-side emphasis, and it is a MULTIPLIER on
  // the host's metre constant rather than a second metre constant of its own.
  expect(flagMarkerStyle(row, true).scale).toBe(FLAG_SELECTED_SCALE);
  expect(flagMarkerStyle(row, false).scale).toBe(1);
  // The VALUE, not just the direction. `> 1` alone leaves the constant free to
  // become 1.01 — a pop nobody can see — with this file still green, which is the
  // unpinned-constant class this slice has now caught four times (STEPPER_MAX_STEPS,
  // HISTORY_TAIL, MAX_SEGMENT_M, SELECTION_DISPLAY_CAP). 1.6 is a deliberate choice:
  // big enough to read at a glance against its neighbours, small enough that a
  // selected marker in a dense cluster does not swallow the ones beside it.
  expect(FLAG_SELECTED_SCALE).toBe(1.6);
});

test("flagCellBox is the marker's own cell — the box the pick, the frame and the outline share", () => {
  // Centred on the LIFTED marker centre and one cell on a side, so it spans
  // exactly `world.y … world.y + cellSize`: the air cell the finding anchors on.
  // Three consumers read it (the pointer pick's click volume, `selectFlag`'s
  // camera frame, and the selected-flag outline batch) — written three times they
  // drift, and a frame that lands beside the box the user clicked is the f4 gate
  // finding this replaces, one order of magnitude smaller.
  expect(flagCellBox([2, 1, -3], 0.5)).toEqual({
    min: [1.75, 1, -3.25],
    max: [2.25, 1.5, -2.75],
  });
  const box = flagCellBox([2, 1, -3], CELL);
  expect(box.min[1]).toBe(1);
  expect(box.max[1]).toBe(1 + CELL);
  expect(box.max[0] - box.min[0]).toBeCloseTo(CELL, 12);
});

test("rows() is the UNFILTERED verdict-joined read — filters shape visible, never rows", () => {
  const store = createFlagStore();
  const a = flag("narrow", "candidate", [1, 0, 0], "0,0,0");
  const b = flag("low-clearance", "info", [2, 0, 0], "0,0,0");
  const c = flag("narrow", "candidate", [3, 0, 0], "0,0,0", true);
  const pit = flag("pit", "candidate", [9, 0, 0], "1,0,0");
  store.applyFlags(byOwner([a, b, c]), [pit]);
  store.setVerdict(a, verdict("trapped"));
  store.setFilters({
    candidates: false,
    info: false,
    unreachable: false,
    pits: false,
  });
  // The human's chips hide everything…
  expect(store.summary().visible).toEqual([]);
  // …and rows() still reports every deduped finding, in key order, verdicts joined.
  const rows = store.rows();
  expect(rows.map((r) => r.flag)).toEqual([b, a, c, pit]);
  expect(rows.find((r) => r.flag === a)?.verdict?.outcome).toBe("trapped");
});
