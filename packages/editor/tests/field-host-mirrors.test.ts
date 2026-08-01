// The host-state mirror's pure half, tested DIRECTLY — the whole reason it was
// lifted out of `useFieldHostState.tsx`. Every one of these comparators guards a
// push effect, and the failure a weak comparator produces is silence: a changed
// value compares equal, the state keeps `prev`, and a surface shows a stale
// reading with nothing thrown and nothing logged. Behaviour through a mounted
// provider can only reach them one push at a time; here each answer is one call.
//
// What is NOT testable here, and is deliberately not faked: the `satisfies
// Record<string, never>` destructures inside `statsEqual`, `sameEntities` and
// `toolsEqual` are COMPILE-time backstops. They fail `bun run typecheck`, never a
// test — a runtime assertion cannot notice a field nobody has written yet.
import { expect, test } from "bun:test";
import {
  DEFAULT_FLAG_FILTERS,
  DEFAULT_GESTURE,
  DEFAULT_RADIUS,
  DEFAULT_TOOL,
  deserializeFilters,
  NO_FLAGS,
  NO_HISTORY,
  sameEntities,
  sameParams,
  samePlaced,
  statsEqual,
  toolsEqual,
} from "../src/frontend/lib/field-host-mirrors.ts";
import type {
  FieldEntityInfo,
  FieldStats,
  FieldTool,
  PlacedArchetype,
} from "../src/viewport-host/index.ts"; // type-only: erased

/** Every field `statsEqual` compares, all numeric — the list the loop below walks
 *  so no compared field is trusted on the strength of its neighbours passing. */
const STATS_FIELDS = [
  "chunks",
  "lastRemeshMs",
  "remeshVersion",
  "totalOps",
  "liveGenerators",
  "compactableOps",
  "undoDepth",
  "redoDepth",
  "lastReconfigureMs",
  "analyzerPending",
] as const;

const stats = (over: Partial<FieldStats> = {}): FieldStats => ({
  chunks: 3,
  lastRemeshMs: 4,
  remeshVersion: 5,
  totalOps: 6,
  liveGenerators: 7,
  compactableOps: 8,
  undoDepth: 9,
  redoDepth: 10,
  lastReconfigureMs: 11,
  analyzerPending: 1,
  ...over,
});

const entity = (over: Partial<FieldEntityInfo> = {}): FieldEntityInfo => ({
  entityId: 1,
  type: "generator",
  generator: "cavern",
  params: { radius: 4, tag: "a" },
  seed: 99,
  region: { min: [0, 0, 0], max: [10, 10, 10] },
  opSpan: [3, 7],
  placed: [{ archetypeId: "torch", count: 2 }],
  ...over,
});

const tool = (over: Partial<FieldTool> = {}): FieldTool => ({
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
  ...over,
});

// ---------------------------------------------------------------- statsEqual

test("statsEqual calls two identical readings equal", () => {
  expect(statsEqual(stats(), stats())).toBe(true);
});

test("statsEqual answers false on EVERY field it compares", () => {
  // One field at a time. A comparator that dropped ONE term still passes a test
  // that changes several at once — which is the shape of the bug this guards.
  for (const key of STATS_FIELDS) {
    const a = stats();
    const b = stats();
    b[key] = a[key] + 1;
    expect(statsEqual(a, b)).toBe(false);
  }
});

// ---------------------------------------------------------------- samePlaced

const TORCH: PlacedArchetype = { archetypeId: "torch", count: 2 };
const URN: PlacedArchetype = { archetypeId: "urn", count: 5 };

test("samePlaced compares archetype id and count, index-wise", () => {
  const a = [TORCH, URN];
  expect(samePlaced(a, structuredClone(a))).toBe(true);
  expect(samePlaced(a, [TORCH])).toBe(false);
  expect(samePlaced(a, [TORCH, { ...URN, count: 6 }])).toBe(false);
  expect(samePlaced(a, [TORCH, { ...URN, archetypeId: "pot" }])).toBe(false);
});

test("samePlaced answers false when the NEW list is the longer one", () => {
  // Both directions, because only one of them reaches the length check: a
  // SHORTER `b` is caught index-by-index (`b[i]` is undefined), so a comparator
  // that dropped `a.length === b.length` would still answer the case above —
  // and would silently call a row equal after a scatter added an archetype.
  expect(samePlaced([TORCH], [TORCH, URN])).toBe(false);
});

test("samePlaced is ORDER-sensitive — a reorder changes the row string", () => {
  // The comparator's own claim: `rowSummary` renders `placed` in ARRAY order, so
  // a set-wise comparison would freeze a row showing the previous ordering.
  expect(samePlaced([TORCH, URN], [URN, TORCH])).toBe(false);
});

// ---------------------------------------------------------------- sameParams

test("sameParams calls identical param sets equal", () => {
  expect(sameParams({ radius: 4, tag: "a" }, { radius: 4, tag: "a" })).toBe(
    true,
  );
  expect(sameParams({}, {})).toBe(true);
});

test("sameParams answers false on a changed value, key or arity", () => {
  expect(sameParams({ radius: 4 }, { radius: 5 })).toBe(false);
  expect(sameParams({ radius: 4 }, { girth: 4 })).toBe(false);
  expect(sameParams({ radius: 4 }, { radius: 4, tag: "a" })).toBe(false);
});

test("sameParams is ORDER-sensitive over Object.entries", () => {
  // The `<dl>` maps over the same entries in the same order, so a reordered set
  // is a reordered key column — a change the row has to re-render for.
  expect(sameParams({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
});

test('sameParams compares what RENDERS, so 7 and "7" are the same param', () => {
  // Deliberate: `formatParam` is the row's own renderer, and two params that
  // print identically cannot make the row look different. Asserting this pins
  // the decision — a future deep-equality rewrite would fail here and have to
  // argue for itself.
  expect(sameParams({ n: 7 }, { n: "7" })).toBe(true);
  expect(sameParams({ v: [1, 2] }, { v: [1, 2] })).toBe(true);
  expect(sameParams({ v: { x: 1 } }, { v: { x: 2 } })).toBe(false);
});

// --------------------------------------------------------------- sameEntities

test("sameEntities calls two identical lists equal", () => {
  const a = [entity(), entity({ entityId: 2, generator: "shaft" })];
  expect(sameEntities(a, structuredClone(a))).toBe(true);
  expect(sameEntities([], [])).toBe(true);
});

test("sameEntities answers false on a length change", () => {
  expect(sameEntities([entity()], [])).toBe(false);
  expect(sameEntities([entity()], [entity(), entity({ entityId: 2 })])).toBe(
    false,
  );
});

test("sameEntities answers false on each field a ROW displays", () => {
  const base = entity();
  const differing: FieldEntityInfo[] = [
    entity({ entityId: 2 }),
    entity({ generator: "shaft" }),
    entity({ seed: 100 }),
    entity({ opSpan: [4, 7] }),
    entity({ opSpan: [3, 8] }),
    entity({ frozen: true }),
    entity({ baked: true }),
  ];
  for (const other of differing) {
    expect(sameEntities([base], [other])).toBe(false);
  }
});

test("sameEntities answers false on a `placed` count a world switch restarted", () => {
  // The hole the comparator's header names: op ids RESTART across `loadWorld`,
  // so two worlds can agree on id/generator/seed/span/flags and differ only in
  // what a scatter placed. Without this term the row keeps the previous world's
  // count under a live palette (Open does not remount the provider).
  const a = entity({ placed: [{ archetypeId: "torch", count: 2 }] });
  const b = entity({ placed: [{ archetypeId: "torch", count: 3 }] });
  expect(sameEntities([a], [b])).toBe(false);
  expect(sameEntities([a], [entity({ placed: [] })])).toBe(false);
});

test("sameEntities answers false on params an EXPANDED row renders", () => {
  // The same hole one field over (closed by F4.5b Task 4).
  const a = entity({ params: { radius: 4 } });
  const b = entity({ params: { radius: 5 } });
  expect(sameEntities([a], [b])).toBe(false);
});

test("sameEntities IGNORES region — no row reads one", () => {
  // A deliberate non-compare, asserted so it stays deliberate: the emphasis box
  // is drawn from the HOST's record off an id, never from a row.
  const a = entity();
  const b = entity({ region: { min: [-9, -9, -9], max: [9, 9, 9] } });
  expect(sameEntities([a], [b])).toBe(true);
});

// ---------------------------------------------------------------- toolsEqual

test("toolsEqual calls two identical tools equal", () => {
  expect(toolsEqual(tool(), tool())).toBe(true);
});

test("toolsEqual answers false on each top-level field", () => {
  expect(toolsEqual(tool(), tool({ effect: "fill" }))).toBe(false);
  expect(toolsEqual(tool(), tool({ materialId: 3 }))).toBe(false);
  expect(toolsEqual(tool(), tool({ hollow: 0.5 }))).toBe(false);
});

test("toolsEqual answers false on each nested smooth field", () => {
  // The one-level-down backstop, exercised: a top-level identity check would
  // pass all three of these on freshly cloned tool objects.
  expect(
    toolsEqual(tool(), tool({ smooth: { ...tool().smooth, strength: 8 } })),
  ).toBe(false);
  expect(
    toolsEqual(tool(), tool({ smooth: { ...tool().smooth, iterations: 2 } })),
  ).toBe(false);
  expect(
    toolsEqual(tool(), tool({ smooth: { ...tool().smooth, mode: "erode" } })),
  ).toBe(false);
});

test("toolsEqual compares mask KIND, and classId only within `class`", () => {
  expect(toolsEqual(tool(), tool({ mask: { kind: "kit-only" } }))).toBe(false);
  expect(
    toolsEqual(tool({ mask: { kind: "class", classId: 1 } }), tool()),
  ).toBe(false);
  expect(
    toolsEqual(
      tool({ mask: { kind: "class", classId: 1 } }),
      tool({ mask: { kind: "class", classId: 2 } }),
    ),
  ).toBe(false);
  expect(
    toolsEqual(
      tool({ mask: { kind: "class", classId: 1 } }),
      tool({ mask: { kind: "class", classId: 1 } }),
    ),
  ).toBe(true);
  expect(
    toolsEqual(
      tool({ mask: { kind: "selection" } }),
      tool({ mask: { kind: "selection" } }),
    ),
  ).toBe(true);
});

// ------------------------------------------------------------ the literals

test("the mirror opens on the host's own defaults", () => {
  // These are local literals BECAUSE the chrome cannot value-import the host, so
  // nothing machine-checks them against it — pinning the values here is what
  // makes a drift show up as a failing assertion rather than as a control that
  // silently describes a state the host is not in.
  expect(DEFAULT_TOOL).toEqual({
    effect: "dig",
    materialId: 0,
    mask: { kind: "none" },
    smooth: { strength: 16, iterations: 1, mode: "both" },
    hollow: null,
  });
  expect(DEFAULT_RADIUS).toBe(1.25);
  expect(DEFAULT_GESTURE).toBe("pointer");
  expect(DEFAULT_FLAG_FILTERS).toEqual({
    candidates: true,
    info: false,
    unreachable: false,
    pits: true,
  });
  expect(NO_FLAGS).toEqual({
    total: 0,
    byKindSeverity: [],
    visible: [],
    selected: null,
  });
  expect(NO_HISTORY).toEqual({
    undo: [],
    redo: [],
    undoDepth: 0,
    redoDepth: 0,
  });
});

// ---------------------------------------------------------- deserializeFilters

test("deserializeFilters returns the defaults for a blob that is not there", () => {
  expect(deserializeFilters(undefined)).toEqual(DEFAULT_FLAG_FILTERS);
});

test("deserializeFilters adopts the bands a blob does speak about", () => {
  expect(deserializeFilters({ info: true, pits: false })).toEqual({
    candidates: true, // untouched by the blob → the default
    info: true,
    unreachable: false,
    pits: false,
  });
});

test("deserializeFilters keeps the default for a non-boolean band", () => {
  // Schema-tolerant (D-F4.5-3): a hand-edited blob must degrade to the shipped
  // set rather than hand the host an object with a string in it.
  expect(
    deserializeFilters({
      candidates: "yes",
      info: 1,
      unreachable: null,
      pits: undefined,
    } as unknown as Record<string, boolean>),
  ).toEqual(DEFAULT_FLAG_FILTERS);
});

test("deserializeFilters ignores a band it does not know", () => {
  // A blob written after a band was retired, or hand-edited: only KNOWN keys are
  // adopted, so nothing extra reaches the host.
  const out = deserializeFilters({ candidates: false, ghosts: true });
  expect(out).toEqual({
    candidates: false,
    info: false,
    unreachable: false,
    pits: true,
  });
  expect(Object.keys(out).sort()).toEqual([
    "candidates",
    "info",
    "pits",
    "unreachable",
  ]);
});

test("deserializeFilters never hands back the shared default object", () => {
  // The result goes straight into React state and is spread into localStorage; a
  // shared reference would let one restore rewrite the constant every later
  // restore reads.
  const out = deserializeFilters({ info: true });
  expect(out).not.toBe(DEFAULT_FLAG_FILTERS);
  expect(deserializeFilters(undefined)).not.toBe(DEFAULT_FLAG_FILTERS);
  expect(DEFAULT_FLAG_FILTERS.info).toBe(false);
});

// --- the two shared empty defaults are IMMUTABLE ----------------------------
//
// `NO_FLAGS` and `NO_HISTORY` are `useState` INITIAL values, so every provider that has
// not taken a host push yet holds this exact object — not a copy. One `.push()` into
// `visible` or `undo` would therefore corrupt the default for every later mount in the
// process, including every subsequent test in the same file, with nothing thrown at the
// site that did it. Nothing mutates them today; this is what keeps that true without a
// future author having to know it matters.
test("the shared empty defaults are frozen THROUGH their arrays, not just at the top", () => {
  // The top-level freeze alone would stop `NO_FLAGS.visible = [...]` and leave
  // `NO_FLAGS.visible.push(...)` working, which is the mutation that actually happens.
  expect(Object.isFrozen(NO_FLAGS)).toBe(true);
  expect(Object.isFrozen(NO_FLAGS.visible)).toBe(true);
  expect(Object.isFrozen(NO_FLAGS.byKindSeverity)).toBe(true);
  expect(Object.isFrozen(NO_HISTORY)).toBe(true);
  expect(Object.isFrozen(NO_HISTORY.undo)).toBe(true);
  expect(Object.isFrozen(NO_HISTORY.redo)).toBe(true);

  // …and the refusal OBSERVED, not merely inferred from `isFrozen`. ESM is always
  // strict, so a push onto a frozen array throws rather than silently no-opping — which
  // is the difference between a bug that surfaces at its cause and one that surfaces
  // three tests later as an empty list that is not empty.
  expect(() => NO_FLAGS.visible.push({} as never)).toThrow();
  // Cast because `FieldHistory.undo` is `readonly string[]` — the compiler already
  // refuses this one, and the freeze is the RUNTIME backstop behind that. `FlagsSummary`
  // declares its arrays mutable (the host fills them), so the line above needs no cast
  // and the freeze is the only guard there. The asymmetry is the reason both are
  // asserted rather than just the weaker one.
  expect(() => (NO_HISTORY.undo as string[]).push("x")).toThrow();
});
