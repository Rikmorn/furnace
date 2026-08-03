// The pure half of the host-state mirror: the value-equality comparators that guard
// its push effects, the literals its state opens at, and the schema-tolerant filter
// restore that seeds one of them. Nothing here touches React or a host handle: the
// functions are value→value and the rest are literals, which is what makes each one
// directly testable, where a mounted provider was the only way to reach them before.
//
// The SUBSCRIPTIONS deliberately did not come along. Every FieldHost seam is a single
// slot (a second subscriber silently steals the first's callback), so they stay
// centralized in `../hooks/useFieldHostState.tsx` — that one-file rule is what makes
// a stolen callback checkable, and splitting them is what it forbids.
import type {
  FieldEntityInfo,
  FieldHistory,
  FieldMaskChoice,
  FieldStats,
  FieldTool,
  FlagFilters,
  FlagsSummary,
  PlacedArchetype,
  ViewportGesture,
} from "../../viewport-host/index.ts"; // type-only: erased
// The row's own param renderer, so the push guard below compares exactly the
// string the `<dl>` shows (see `sameParams`) — one function, so a row and its
// guard cannot disagree about what "same param" means.
import { formatParam } from "./field-entity.ts";
import type { UiState } from "./persist.ts";

/** Value-equality for the subscribeStats push guard (the host fires it every rAF; an
 *  idle field must not re-render the shell 60×/s). The destructure is a compiler
 *  backstop: a future FieldStats field lands in `rest`, fails the never-check and
 *  forces this comparator to learn it — a missed field would silently WEAKEN the guard
 *  (a changed value comparing equal → a stale readout). */
export function statsEqual(a: FieldStats, b: FieldStats): boolean {
  const {
    chunks,
    lastRemeshMs,
    remeshVersion,
    totalOps,
    liveGenerators,
    compactableOps,
    undoDepth,
    redoDepth,
    lastReconfigureMs,
    analyzerPending,
    voidCastPending,
    ...rest
  } = a;
  void (rest satisfies Record<string, never>);
  return (
    chunks === b.chunks &&
    lastRemeshMs === b.lastRemeshMs &&
    remeshVersion === b.remeshVersion &&
    totalOps === b.totalOps &&
    liveGenerators === b.liveGenerators &&
    compactableOps === b.compactableOps &&
    undoDepth === b.undoDepth &&
    redoDepth === b.redoDepth &&
    lastReconfigureMs === b.lastReconfigureMs &&
    analyzerPending === b.analyzerPending &&
    // The one BOOLEAN in the readout, and the one the fields above cannot cover for:
    // dropping this term does not stale a number, it costs the status bar a whole chip.
    // A cast that starts and ends between two otherwise-identical readings would compare
    // equal, the mirror would keep `prev`, and the long-job readout would never appear.
    voidCastPending === b.voidCastPending
  );
}

// Entity-list identity for the refresh guard: everything a ROW can display —
// id + generator + seed + opSpan + the two state flags + the `placed` counts.
//
// `placed` is compared DIRECTLY rather than inferred from opSpan, and the reason
// is a fact that is easy to get wrong: op ids do NOT only ever grow. Core hands
// them out monotonically WITHIN a session, but `loadWorld` recomputes
// `log.nextId` from the loaded ops' own maximum (field-host.ts, the parseOps
// path), so ids — and with them every opSpan — RESTART across a world switch.
// Two worlds whose rows agree on id/generator/seed/span/flags and differ only in
// what a scatter placed are therefore reachable from the world drawer's Open,
// which calls loadWorld under the same host-state provider mount
// (`../hooks/useFieldHostState.tsx`): no remount, no state reset, just an entity
// tick. Without the `placed` comparison this guard returns `prev` and the row
// keeps the PREVIOUS world's count.
//
// `params` is the same hole one field over, and F4.5b Task 4 closed it: two
// worlds can hold records agreeing on every other compared field and differing
// only in their params, and an EXPANDED row renders those as a `<dl>`. It is
// compared through `formatParam` — the row's own renderer — rather than by
// value, because what must not go stale is the STRING on screen: two params that
// render identically (7 and "7") cannot make the row look different, and a
// deep-equality walk over arbitrary schema values would be doing more work to
// answer a question the row never asks.
//
// The flags DO need their own comparison too — freeze and bake rewrite the
// record and nothing else, so without them a frozen badge would never appear.
// Index-wise, not set-wise: `rowSummary` renders `placed` in ARRAY order, so a
// reordering changes the row string and must re-render.
export const samePlaced = (
  a: readonly PlacedArchetype[],
  b: readonly PlacedArchetype[],
): boolean =>
  a.length === b.length &&
  a.every((p, i) => {
    const o = b[i];
    return (
      o !== undefined && p.archetypeId === o.archetypeId && p.count === o.count
    );
  });

/** Do two param sets RENDER the same `<dl>`? Index-wise over `Object.entries`,
 *  which is exactly what the row maps over — a reordered set is a reordered
 *  list, and the key column moving is a change the row must re-render for. */
export const sameParams = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean => {
  const entriesA = Object.entries(a);
  const entriesB = Object.entries(b);
  return (
    entriesA.length === entriesB.length &&
    entriesA.every(([key, value], i) => {
      const other = entriesB[i];
      return (
        other !== undefined &&
        other[0] === key &&
        formatParam(value) === formatParam(other[1])
      );
    })
  );
};

export const sameEntities = (
  a: readonly FieldEntityInfo[],
  b: readonly FieldEntityInfo[],
): boolean =>
  a.length === b.length &&
  a.every((e, i) => {
    const o = b[i];
    if (o === undefined) return false;
    // Compiler backstop — the toolsEqual/statsEqual rider, and the one THIS
    // comparator was missing when the `placed` hole shipped. FieldEntityInfo is
    // an intersection over CORE's GeneratorEntity, so a field added there lands
    // here silently and no test can exist for a field nobody knew to compare;
    // destructuring every one makes the compiler force the question.
    //
    // The two voided below are deliberate non-compares: `type` is the constant
    // literal "generator", and `region` is never rendered by a row (the emphasis
    // box is drawn from the HOST's own record, off an id, and the drift badge off
    // the drift push — no row reads a region).
    const {
      entityId,
      type,
      generator,
      params,
      seed,
      region,
      opSpan,
      frozen,
      baked,
      placed,
      ...rest
    } = e;
    void (rest satisfies Record<string, never>);
    void type;
    void region;
    return (
      entityId === o.entityId &&
      generator === o.generator &&
      seed === o.seed &&
      opSpan[0] === o.opSpan[0] &&
      opSpan[1] === o.opSpan[1] &&
      frozen === o.frozen &&
      baked === o.baked &&
      samePlaced(placed, o.placed) &&
      sameParams(params, o.params)
    );
  });

// Value-equality for the subscribeTool echo guard (see the mirror effect in
// `../hooks/useFieldHostState.tsx`).
const masksEqual = (a: FieldMaskChoice, b: FieldMaskChoice): boolean =>
  a.kind === "class" && b.kind === "class"
    ? a.classId === b.classId
    : a.kind === b.kind;

export const toolsEqual = (a: FieldTool, b: FieldTool): boolean => {
  // Compiler backstop (F2b rider): destructure EVERY FieldTool field — a
  // future field lands in `rest` and fails the never-check, forcing this
  // comparator to learn it. A missed field would silently WEAKEN the
  // subscribeTool echo guard: differing tools would compare equal and the
  // mirror would drop host-initiated changes.
  const { effect, materialId, hollow, mask, smooth, ...rest } = a;
  void (rest satisfies Record<string, never>);
  // The same backstop one level down: `smooth` is a nested shape whose future
  // fields would slip past the top-level destructure unseen.
  const { strength, iterations, mode, ...smoothRest } = smooth;
  void (smoothRest satisfies Record<string, never>);
  return (
    effect === b.effect &&
    materialId === b.materialId &&
    hollow === b.hollow &&
    masksEqual(mask, b.mask) &&
    strength === b.smooth.strength &&
    iterations === b.smooth.iterations &&
    mode === b.smooth.mode
  );
};

/** The brush the chrome opens on — a mirror of the host's own `defaultTool()` (dig into
 *  rock, unmasked, core SMOOTH_DEFAULTS-equivalent smooth, solid fill). A local literal
 *  because the chrome cannot value-import core or the host
 *  (frontend-no-engine-leakage), and `subscribeTool` pushes only when the tool or the
 *  radius CHANGES — including for the chrome's own writes, since the F4.5 gate's W-2 made
 *  the radius two-way — never as a catch-up at subscribe time. So there is still nothing
 *  to seed from at mount, which is what this literal is for. */
export const DEFAULT_TOOL: FieldTool = {
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
};

/** Mirrors FieldHost's default digRadius (the slider's range lives in `tool-params.tsx`,
 *  which is where the radius control went when `BrushInspector` was deleted). */
export const DEFAULT_RADIUS = 1.25;

/** What a fresh host is ALREADY armed with (D-F4.5-7) — a local literal for the
 *  DEFAULT_TOOL reason. A mirror that opened at `null` would show the brush inspector
 *  beside an LMB that selects. */
export const DEFAULT_GESTURE: ViewportGesture | null = "pointer";

/** The advisor bands the chrome asks for at boot — candidates only, mirroring the host's
 *  own DEFAULT_FLAG_FILTERS. A local literal for the DEFAULT_TOOL reason. */
export const DEFAULT_FLAG_FILTERS: FlagFilters = {
  candidates: true,
  info: false,
  unreachable: false,
  // ON, unlike the other two off-by-default bands: a pit carries candidate
  // severity, so the candidates chip beside it already claims to show it (the
  // store's own DEFAULT_FLAG_FILTERS says the same thing, and this literal exists
  // only because the chrome cannot value-import it).
  pits: true,
};

/** The band names a persisted blob may speak about (useView's LAYER_KEYS twin). */
// Boundary cast: `Object.keys` is typed `string[]` because a VALUE can structurally
// carry keys its type never declared — but the argument here is an object literal
// checked against `FlagFilters`, which cannot. Deriving the list (rather than writing
// it out) is what keeps a new band restorable without a second edit here.
const FILTER_KEYS = Object.keys(DEFAULT_FLAG_FILTERS) as (keyof FlagFilters)[];

/** Schema-tolerant restore (D-F4.5-3): only KNOWN bands are adopted, and anything
 *  missing or non-boolean keeps its default — so a hand-edited blob, or one written
 *  before a band existed, degrades to the shipped set rather than handing the host an
 *  object with a hole in it. */
export function deserializeFilters(
  stored: UiState["flagFilters"],
): FlagFilters {
  const filters = { ...DEFAULT_FLAG_FILTERS };
  if (!stored) return filters;
  for (const key of FILTER_KEYS) {
    const value = stored[key];
    if (typeof value === "boolean") filters[key] = value;
  }
  return filters;
}

/** Nothing found yet — what the flags surface renders between mount and the host's first
 *  push, after which every summary is the host's.
 *
 *  FROZEN, and shallowly is not enough: this is a `useState` INITIAL value, so every
 *  provider that has not taken a push yet shares this one object. One `.push()` into
 *  `visible` or `byKindSeverity` would corrupt the default for every subsequent mount in
 *  the process, including every later test in the same file — a mutation with no thrown
 *  error and no obvious author. Nothing mutates it today; the freeze is what keeps that
 *  true without anyone having to know it matters. */
// Boundary cast: `FlagsSummary`'s arrays are mutable because the HOST fills them; this
// particular value is the immutable empty default, and the two facts cannot both be
// expressed by the one type. Through `unknown` because `readonly never[]` and
// `FlagCount[]` do not overlap — the cast is asserting that a frozen empty array is a
// safe stand-in for a list nobody may write to, which is exactly the guarantee the freeze
// provides.
export const NO_FLAGS: FlagsSummary = Object.freeze({
  total: 0,
  byKindSeverity: Object.freeze([]),
  visible: Object.freeze([]),
  selected: null,
}) as unknown as FlagsSummary;

/** Nothing done yet. Also the FieldHistoryContext default (`useFieldHostState.tsx`) —
 *  see there for why an empty history is a truthful reading outside the provider rather
 *  than a wiring hole. */
// Boundary cast: `NO_FLAGS`' reason, verbatim.
export const NO_HISTORY: FieldHistory = Object.freeze({
  undo: Object.freeze([]),
  redo: Object.freeze([]),
  undoDepth: 0,
  redoDepth: 0,
}) as unknown as FieldHistory;
