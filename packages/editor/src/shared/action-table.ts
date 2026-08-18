// The tool table: THE one place a tool fact is stated. Six literals stated them before —
// spread across four files, keyed on two discriminators with no join — and T3b2 Task 5
// switched every consumer onto the derivations below and deleted all six. Nothing else in
// the editor says what a brush effect is called, which params it has, what its keys do, or
// which members a rail column cycles.
//
// Row data and pure derivations, nothing else. No React (the chrome renders these), no
// engine, no `field-host` import at all: `src/shared/` is the neutral floor both arrows
// point at, machine-enforced from both sides.
//
// Why this exists, what the six tables were, which two written non-derivation decisions it
// overrules, and how the equality was PROVEN before anything switched (the derive-and-diff
// gate, which stood across three commits — `c7caa42c`, `3caab726`, `55f6b93c` — and was
// deleted by the fourth): `docs/learnings/seals/2026-08-07-foundations-t1a-t3c-backfill.md`;
// `docs/reference/editor/tools.md` "One table states a tool fact" for the as-built.
// `tests/shared/action-table.test.ts` is what holds the rows now — shape pins, not a diff.
import type { BrushEffect } from "./field-brush.ts";
import { LATTICE } from "./field-brush.ts";
import { MAX_SEGMENT_M, SELECTION_UI_BUDGET } from "./field-limits.ts";

// --- the two discriminators --------------------------------------------------
//
// DECLARED HERE RATHER THAN IMPORTED, and it is the layer that forces it: the homes of
// `ViewportGesture` (`field-host/field-host.ts`) and `ParamId`
// (`frontend/components/shell/tool-params.tsx`) both sit ABOVE this floor, so importing
// either would point the arrow backwards. That leaves one union spelled twice — the defect
// this module exists to remove — so it is closed by a PIN instead of by an import:
// `tests/shared/action-table.test.ts` asserts both directions of assignability against the
// originals, and a member added to one side alone fails `bun run typecheck` (NOT `bun test`,
// which transpiles without checking). `BrushEffect` needs none of this: it already lives on
// this floor, which is what the gesture union should eventually look like.

/** The three CELL-selection gestures: a lattice-snapped box span, and the two floods.
 *  Mirrors the host's `SelectionMode`; pinned equal to it by the table's test. */
export type CellSelectId = "box" | "material" | "void";

/** What an LMB click DOES in the viewport — the first of the table's two discriminators.
 *  Mirrors the host's `ViewportGesture`, built the same way out of {@link CellSelectId} so
 *  the two cannot drift in shape either; pinned equal to it by the table's test.
 *
 *  `null` is not a member: the host spells "the brush strokes" as a null gesture, and at
 *  that point the armed EFFECT is what LMB is doing — which is the second discriminator,
 *  and the reason this table has two. */
export type GestureId = CellSelectId | "segment" | "pointer";

/** One knob on the brush strip. Mirrors `tool-params.tsx`'s `ParamId`; pinned equal by the
 *  table's test. */
export type ParamId =
  | "radius"
  | "mask"
  | "material"
  | "hollow"
  | "strength"
  | "iterations"
  | "mode";

/** The four tool families the rail renders as columns. */
export type FamilyId = "pointer" | "brush" | "select" | "stamp";

/** The action ids a family dispatches. Named as a union rather than `string` so a family
 *  row cannot point at an action that was never written; that the id RESOLVES is a separate
 *  claim, and the table's test makes it against the registry itself. */
type ToolActionId =
  | "tool.pointer"
  | "tool.brush"
  | "tool.brushCycle"
  | "tool.select"
  | "tool.selectCycle"
  | "tool.stamp"
  | "tool.stampCycle";

// --- the status line, as fragments -------------------------------------------

/** A runtime value a status fragment leaves a hole for. FIVE holes, and every one of them
 *  is a value no table can hold: the two session verbs come from `SESSION_VERBS` (a
 *  different single source, shared with the session card and the session strip), the stamp
 *  name is the armed generator's, the measurement is a live push, and the steering clause
 *  is the one branch on a session's `moving` flag. Everything ELSE on every line — every
 *  keycap, every verb, every word — is row data. */
type StatusSlot =
  | "sessionSteer"
  | "sessionPrimary"
  | "sessionSecondary"
  | "stampName"
  | "segmentMeasure";

/** One clause of a status line: a constant the row states, or one runtime value with a
 *  constant lead-in. Every line the editor shows is a `" · "`-joined list of them.
 *
 *  TWO kinds is what today's fourteen lines need, and no third has been added — no
 *  conditionals, no nesting, no formatting directives — which is what keeps a row's line
 *  readable as prose in the source. That is the case FOR the shape, not a proof it is the
 *  right one: the model is the least-earned abstraction in this module, it has never been
 *  pushed by a line it could not express, and a third kind is on the table if one arrives
 *  (see the keycap verdict above, where a `keycap` kind is the option that was declined for
 *  a different reason). Do not read the count as settled. */
type StatusFragment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "slot";
      readonly slot: StatusSlot;
      /** Words that lead straight into the value, INSIDE the clause: `⏎ ` before the
       *  session's primary verb, `click ×2 to span a region for ` before the stamp name.
       *  A separate clause would put a `·` between them. */
      readonly prefix?: string;
    };

/** Sugar for the common fragment, so a row's line reads as the list of words it is. */
const text = (t: string): StatusFragment => ({ kind: "text", text: t });

// THE KEYCAPS INSIDE THESE FRAGMENTS — the verdict T3b2 Task 5 was asked to reach, here
// because this is where a reader meets the question.
//
// A status clause spells its own key (`"⌫ delete"`, `"R rotate ¼"`, the `"⏎ "` lead-in), and
// TEN of the 27 distinct clauses below lead with a cap that `action-registry/keys.ts`'
// `keycap()` also derives from the binding rows. So it is a REAL duplication, not the
// prose-legitimately-spells-its-own-keys reading — though only for those ten: the rest is
// canvas-owned vocabulary the registry does not carry (`[ ] radius`, `⇧ smooth`, `⌃ dig`,
// the arrow nudge) or names a mouse gesture rather than a key, which is the half the retired
// objection in `status-keymap.ts` got right.
//
// NOT CLOSED HERE, and the reason is the layer rather than the effort: `keycap()` lives ABOVE
// this floor, so importing it would reverse the import arrow and `no-chrome-leakage.test.ts`
// would refuse it — and the shape that keeps the arrow costs {@link StatusFragment}'s two-kind
// model. Filed with the measurement, the per-cap table and the option analysis:
// `docs/backlog/editor-and-tooling/status-line-respells-derived-keycaps.md`.

/** What separates two clauses of a status line. Stated once because the line is assembled
 *  in three places (the row's own fragments, the effect's modifier tail, and the two
 *  transient states) and a second spelling would put a different gap in one of them. */
const STATUS_SEPARATOR = " · ";

/** How a live session is STEERED — the one clause that branches on `moving`. A move is
 *  dragged, everything else is nudged, and the arrow keys are canvas-owned: this is the
 *  vocabulary the derivation decision moved into the table. */
const SESSION_STEER = {
  dragged: "drag ghost move",
  nudged: "← → ↑ ↓ nudge",
} as const;

/** The pending segment's length against the cap it is measured by, in the ONE format the
 *  editor prints it in.
 *
 *  BOTH numbers, not just the length: "42.5 m" alone leaves the reader to remember what it
 *  is being compared with, and the pair is what makes the over-cap state legible WITHOUT
 *  its colour (`61.0 m / 60 m` says it plainly).
 *
 *  One decimal, which is what the host's own refusal prints (`segmentClick` formats the
 *  same measurement with `toFixed(1)`): the number a user watched climb is the number
 *  quoted back at them if they push past it, and two roundings of one measurement is how
 *  those would come to disagree at the boundary. */
const formatSegmentMeasure = (r: SegmentReadout): string =>
  `${r.lenM.toFixed(1)} m / ${r.capM} m`;

/** A live segment measurement: how long the pending capsule has reached, and the cap the
 *  second click will be measured by. `capM` rides with the measurement rather than being
 *  read from {@link MAX_SEGMENT_M} here, because the host applied ITS number to THIS
 *  length and the readout must not be able to quote a different one. */
type SegmentReadout = { readonly lenM: number; readonly capM: number };

/** Is this measurement one the next click will REFUSE?
 *
 *  Strictly `>`, matching the host's own refusal (`len > MAX_SEGMENT_M`): a segment of
 *  exactly the cap COMMITS, so `>=` would paint a legal click as a doomed one. The only
 *  thing in the editor that can set a status line's tone, and since T3b2 Task 5 the only
 *  place the predicate is spelled — `status-keymap.ts`'s `segmentLine` spelled it too, and
 *  went with the rest of that cascade. */
const overSegmentCap = (r: SegmentReadout): boolean => r.lenM > r.capM;

/** The strip's note for a BUDGETED flood gesture, from the host's own budget. Thousands
 *  rather than the raw 200000: the note is a reassurance about scale, not a number anyone
 *  counts against. Shared by the two flood rows so neither reads the other's copy. */
const FLOOD_BUDGET_NOTE = `budget ${SELECTION_UI_BUDGET / 1000}k`;

// --- the modifier clauses ----------------------------------------------------

/** One live override under an armed effect — a key, and what holding or pressing it GIVES.
 *
 *  These are DERIVED facts made explicit, and the derivation is the host's: `deriveMomentary`
 *  swaps dig↔fill SYMMETRICALLY (so under fill ⌃ gives *dig*), passes ⌃ through entirely
 *  under paint and smooth, and derives smooth from whatever is armed (so ⇧ under smooth is a
 *  no-op). `tool.swapEffect.enabled` is the same two-effect rule read from the registry. A
 *  row lists exactly the clauses that are LIVE under it, which is the point: a static clause
 *  naming ⌃ and X under paint named two dead keys, and no test that pinned the string could
 *  have caught it. */
type ModifierClause = {
  /** The keycap, in the editor's own spelling (⇧ ⌃ ⌥ ⌘ ⏎ ⌫ and bare letters) — two
   *  spellings of one key reads as two different keys. */
  readonly key: string;
  /** What it gives: an effect id under the two MOMENTARY keys (⇧, ⌃ — held), a verb under
   *  the STICKY swap (`X` — pressed). Rendered as `${key} ${gives}`.
   *
   *  Which of the two a clause is follows from its `key` and is deliberately not a field:
   *  a discriminant that is a pure function of a sibling is one fact spelled twice. What
   *  makes dig's `⌃ fill` and `X swap` two clauses rather than one restated is that they
   *  differ in BOTH fields already. */
  readonly gives: string;
};

/** ⇧ derives smooth from whatever is armed. Shared by the three effects it is live under
 *  rather than written three times — it is one key doing one thing. */
const SHIFT_SMOOTH: ModifierClause = { key: "⇧", gives: "smooth" };

/** The sticky half of the dig↔fill swap (`X`), live under exactly the two carving effects.
 *  It names the ACT rather than the destination because it is symmetric — one keycap that
 *  means "the other one" whichever one you are on. */
const SWAP_STICKY: ModifierClause = { key: "X", gives: "swap" };

// --- the rows ----------------------------------------------------------------

/** Everything the editor knows about one brush EFFECT.
 *
 *  Six of the editor's tables used to answer some part of this question and none of them
 *  answered all of it. */
export type EffectRow = {
  readonly id: BrushEffect;
  /** The MEMBER register: what the rail's flyout, the ⇧ cycle and the ⌘K palette call it. */
  readonly label: string;
  /** The one sentence this member needs and its family cannot give it — the momentary
   *  modifier, the organic-only clamp. Read by the rail flyout, the ⌘K keywords and the
   *  action chip. */
  readonly hint: string;
  readonly params: {
    /** The WHOLE option list in priority order — what the ⋯ popover renders. */
    readonly all: readonly ParamId[];
    /** How many of them the strip carries (D-6's ≤4 cap); the strip renders this prefix. */
    readonly onStrip: number;
    /** The container-query class that hides the param group under width pressure (D-6's
     *  degraded state), PER EFFECT rather than one worst case: a single fill-sized
     *  threshold blanked dig — two params — at a width where both still fitted.
     *
     *  A LITERAL class, and it has to be: Tailwind generates CSS by scanning source text
     *  for class-shaped strings, so a threshold carried as a number and templated into
     *  `@max-[${n}rem]/strip:hidden` would emit no rule at all. The figures are COMPUTED
     *  from the declared control widths in `tool-params.tsx`, not measured. */
    readonly stripMinClass: string;
  };
  /** What the keys do while this effect is armed and LMB is on the stroke, before the
   *  modifier tail. Every clause is canvas-owned vocabulary the action registry does not
   *  carry — which is exactly what the derivation decision moved here. */
  readonly statusLine: readonly StatusFragment[];
  /** The overrides that are LIVE under this effect — the status line's tail, and the
   *  rail's momentary hints. */
  readonly modifiers: readonly ModifierClause[];
};

/** Everything the editor knows about one viewport GESTURE. */
export type GestureRow = {
  readonly id: GestureId;
  /** The MEMBER register — "Box". */
  readonly label: string;
  /** The STRIP register — "BOX". A third spelling of one thing, kept because the 40 px bar
   *  wants a shouted short name where a flyout wants a word; stated beside the label so the
   *  two cannot drift, which they could when they lived in different files. */
  readonly stripName: string;
  /** The one static fact that BOUNDS this gesture, shown beside its strip name — or `null`
   *  for a gesture whose strip renders something else entirely (the pointer shows a
   *  selection readout, the segment shows the armed effect's params). A note on `box` would
   *  name a budget that cannot fire, so the three that have one are the two floods (which
   *  really are budgeted) and box (which is snapped instead). */
  readonly note: string | null;
  /** The per-member sentence — rail flyout, ⌘K keywords, action chip. */
  readonly hint: string;
  /** What the keys do while this gesture is armed. */
  readonly statusLine: readonly StatusFragment[];
  /** The line this gesture shows once it has a live READOUT — `segment`'s pending capsule
   *  measured against its cap (D-25). `null` for the four gestures with nothing to measure.
   *
   *  `[ ] radius` survives into this state because the keys DO (`applyRadius` re-fattens a
   *  pending capsule); `click ×2` does not, because with a point down only one click is
   *  left. */
  readonly readoutLine: readonly StatusFragment[] | null;
};

/** A family member, as a REFERENCE into one of the two sub-tables above. The union is the
 *  join the six tables never had: a family is an ordered list of members drawn from BOTH
 *  discriminators, which is why the brush family can end in a gesture (`segment` strokes). */
export type FamilyMemberRef =
  | { readonly effect: BrushEffect }
  | { readonly gesture: GestureId };

/** One rail column: a family, how it is named, what it dispatches, and its members. */
export type FamilyRow = {
  readonly id: FamilyId;
  /** The family's STABLE name, for surfaces that name the SET rather than the press — the
   *  rail's member flyout, the ⌘K composed label. A third register again, and distinct from
   *  the arm action's contextual label, which may name a MEMBER ("Stamp Hall"): a flyout
   *  headed "Stamp Hall tools" would be named after one of the things it lists. */
  readonly name: string;
  /** Where the members come from — and, because the two follow from each other, which of
   *  the two NAMING rules the rail's button obeys.
   *
   *  `"rows"` — the refs below, and the button takes the arm action's own label.
   *
   *  `"generators"` — the host's stamp registry, which no table can hold; and the button
   *  names whatever is RUNNING (pending arm ▸ live session ▸ the arm action's label). ONE
   *  field for both, because it is one distinction: a family whose members are GENERATORS is
   *  a family whose members are SESSIONS, and while a session stands the column reads as
   *  pressed (a session IS the staged grammar running, D-7) — so it must name the generator
   *  the SESSION is on rather than the ⇧S cursor `tool.stamp`'s own label reports. That is
   *  the bug it exists for: a `maze` reconfigure under a `hall` cursor made the rail say
   *  "Stamp Hall" beside a session strip saying `maze #3`.
   *
   *  A SEPARATE `labelRule` field stood here for one commit and was deleted in T3b2 Task 5:
   *  it agreed with this one on all four rows, which is two spellings of one fact — the
   *  smell this module exists to remove, found inside the module that removes it.
   *
   *  Stated rather than inferred from an empty `members` list, because "empty means look
   *  elsewhere" is a convention a reader has to be told. */
  readonly memberSource: "rows" | "generators";
  /** Its members in CYCLE order — the order ⇧ steps through and the flyout lists. Empty
   *  when `memberSource` is `"generators"`. */
  readonly members: readonly FamilyMemberRef[];
  /** What a click on the family BUTTON runs: arm the family's CURRENT member (the
   *  bare-letter press). Deliberately not the cycle — the rail is a mode selector, and
   *  pressing the mode you are already in is idempotent. */
  readonly arm: ToolActionId;
  /** The ⇧ chord that steps to the next member; `null` for a one-member family, where a
   *  cycle key would be a keycap that does nothing. */
  readonly cycle: ToolActionId | null;
};

/** The four brush effects. Keyed on the discriminator itself, so a fifth effect cannot
 *  reach any surface without reaching this table first. */
export const EFFECT_ROWS: Record<BrushEffect, EffectRow> = {
  // Dig writes air: no class, no shell band. Its full set and its strip set are the same
  // two, so its ⋯ is a reachability guarantee rather than a drawer.
  dig: {
    id: "dig",
    label: "Dig",
    hint: "carve air — momentary: hold ⌃",
    params: {
      all: ["radius", "mask"],
      onStrip: 2,
      stripMinClass: "@max-[32rem]/strip:hidden",
    },
    statusLine: [text("LMB dig"), text("[ ] radius")],
    modifiers: [SHIFT_SMOOTH, { key: "⌃", gives: "fill" }, SWAP_STICKY],
  },
  fill: {
    id: "fill",
    label: "Fill",
    hint: "solidify + write the material",
    params: {
      all: ["radius", "mask", "material", "hollow"],
      onStrip: 4,
      stripMinClass: "@max-[46rem]/strip:hidden",
    },
    statusLine: [text("LMB fill"), text("[ ] radius")],
    modifiers: [
      SHIFT_SMOOTH,
      // SYMMETRIC: under fill the momentary swap gives DIG. A static clause that said
      // "⌃ fill" here named the effect the user is already on.
      { key: "⌃", gives: "dig" },
      SWAP_STICKY,
    ],
  },
  paint: {
    id: "paint",
    label: "Paint",
    hint: "retint solid cells — organic classes only",
    params: {
      all: ["radius", "mask", "material"],
      onStrip: 3,
      stripMinClass: "@max-[38rem]/strip:hidden",
    },
    statusLine: [text("LMB paint"), text("[ ] radius")],
    // ⌃ passes through entirely here and `tool.swapEffect` is disabled, so neither key is
    // live — one clause, not three.
    modifiers: [SHIFT_SMOOTH],
  },
  // The only effect whose list is longer than its strip: iterations and the mask are the
  // two a user sets once and leaves, so they live behind the ⋯.
  smooth: {
    id: "smooth",
    label: "Smooth",
    hint: "relax the surface — momentary: hold ⇧",
    params: {
      all: ["radius", "strength", "mode", "iterations", "mask"],
      onStrip: 3,
      stripMinClass: "@max-[41rem]/strip:hidden",
    },
    statusLine: [text("LMB smooth"), text("[ ] radius")],
    // NOTHING is live: ⇧ derives smooth from whatever is armed, so under smooth it is a
    // no-op, and the swap keys are off the carving pair.
    modifiers: [],
  },
};

/** The five viewport gestures. */
export const GESTURE_ROWS: Record<GestureId, GestureRow> = {
  pointer: {
    id: "pointer",
    label: "Select",
    stripName: "SELECT",
    // Direct manipulation's parameter IS the selection, so the pointer strip reports what
    // is selected instead of stating a bound.
    note: null,
    hint: "click a stamp, a prop or a marker; bare rock deselects",
    statusLine: [
      text("LMB select"),
      text("G grab"),
      text("F frame"),
      text("⌫ delete"),
    ],
    readoutLine: null,
  },
  box: {
    id: "box",
    label: "Box",
    stripName: "BOX",
    // A box span is SNAPPED, not budgeted — `truncated` is "always false for regions", so a
    // budget note here would name a limit that cannot fire.
    note: `snaps to ${LATTICE} m`,
    hint: "two clicks span a snapped region",
    // "click ×2", NOT "drag": the mechanism takes two separate presses — `onPointerUp` has
    // no region branch, so a press-drag-release anchors at the PRESS and throws the release
    // away, making the user's next click anywhere corner two.
    statusLine: [text("click ×2 spans a region"), text("Esc clears")],
    readoutLine: null,
  },
  material: {
    id: "material",
    label: "Wand",
    stripName: "WAND",
    note: FLOOD_BUDGET_NOTE,
    hint: "flood-select the clicked material",
    statusLine: [text("LMB floods the clicked material"), text("Esc clears")],
    readoutLine: null,
  },
  void: {
    id: "void",
    label: "Room",
    stripName: "ROOM",
    note: FLOOD_BUDGET_NOTE,
    hint: "flood-select an air pocket",
    statusLine: [text("LMB floods an air pocket"), text("Esc clears")],
    readoutLine: null,
  },
  segment: {
    id: "segment",
    label: "Segment",
    stripName: "SEGMENT",
    // The segment strip shows the ARMED EFFECT's params — a segment click builds a brush op
    // from the armed effect and material — so it has no bound of its own to state here. The
    // cap lives in the hint, where it is read before the gesture starts.
    note: null,
    hint: `two clicks sweep the brush between them — max ${MAX_SEGMENT_M} m; Esc drops the point`,
    statusLine: [
      text("click ×2 sweeps the brush"),
      text("[ ] radius"),
      text("Esc drops the point"),
    ],
    readoutLine: [
      text("segment"),
      { kind: "slot", slot: "segmentMeasure" },
      text("[ ] radius"),
      text("Esc drops the point"),
    ],
  },
};

/** The four rail columns, in column order. */
export const FAMILY_ROWS: readonly FamilyRow[] = [
  {
    id: "pointer",
    name: "Select",
    memberSource: "rows",
    // A family of ONE, spelled as a family anyway so the rail renders four things the same
    // way and "how many members has it?" is the single question that decides whether a
    // corner flyout appears.
    members: [{ gesture: "pointer" }],
    arm: "tool.pointer",
    cycle: null,
  },
  {
    id: "brush",
    name: "Brush",
    memberSource: "rows",
    // Both discriminators in one list: four effects and a gesture. `segment` is a gesture
    // that STROKES, and it is the reason a family member had to be a union.
    members: [
      { effect: "dig" },
      { effect: "fill" },
      { effect: "paint" },
      { effect: "smooth" },
      { gesture: "segment" },
    ],
    arm: "tool.brush",
    cycle: "tool.brushCycle",
  },
  {
    id: "select",
    name: "Cell select",
    memberSource: "rows",
    members: [{ gesture: "box" }, { gesture: "material" }, { gesture: "void" }],
    arm: "tool.select",
    cycle: "tool.selectCycle",
  },
  {
    id: "stamp",
    name: "Stamp",
    // A stamp "member" is a GENERATOR, and the registry is the host's — picking one OPENS a
    // session rather than arming a mode. ⇧S POINTS the S key at the next generator without
    // opening anything, so this family's cycle is a cursor move rather than an arm.
    memberSource: "generators",
    members: [],
    arm: "tool.stamp",
    cycle: "tool.stampCycle",
  },
];

/** EVERY family, exactly once — checked at MODULE INIT.
 *
 *  `FAMILY_ROWS` has to be an ARRAY because its order is the rail's column order, and an
 *  array cannot prove it covers {@link FamilyId} the way a `Record` would. Without this a
 *  dropped row compiles AND imports, and the miss surfaces as `familyOf` throwing inside a
 *  `B` keydown — the latest possible moment, in a handler, on a key the user just pressed.
 *
 *  A RUNTIME check, and deliberately not claimed as more: the `Record` below restates the
 *  four ids, so TypeScript checks that IT is exhaustive and cannot see the array at all —
 *  measured, a dropped row leaves `bun run typecheck` clean and throws here at import. That
 *  is early enough to be the right trade (the chrome fails before first paint, and
 *  `node-door.test.ts` fails in CI) and it is the most an ordered array can buy.
 *
 *  It also catches the array carrying a family TWICE, which coverage alone would not: two
 *  rows with one id would quietly give the rail five columns. Both cases are
 *  sabotage-verified and both name the offending list in the message. */
const FAMILY_IDS: Record<FamilyId, true> = {
  pointer: true,
  brush: true,
  select: true,
  stamp: true,
};
{
  const ids = FAMILY_ROWS.map((f) => f.id);
  const declared = Object.keys(FAMILY_IDS);
  if (ids.length !== declared.length || new Set(ids).size !== declared.length)
    throw new Error(
      `action-table: FAMILY_ROWS must carry each of ${declared.join(", ")} exactly once, got ${ids.join(", ")}`,
    );
  for (const id of declared)
    if (!ids.includes(id as FamilyId))
      throw new Error(`action-table: FAMILY_ROWS is missing "${id}"`);
}

// --- the transient states, and the order they shadow in ----------------------

/** The two armed states that belong to no ROW: they are properties of the staged grammar
 *  (D-7), not of anything the user armed. */
type TransientStateId = "session" | "pendingStamp";

/** The two transient states' lines — they shadow whatever is armed underneath.
 *
 *  A live session owns the interaction (the family keys refuse while it stands), so what is
 *  left to say is how it ENDS. A pending stamp shadows the armed GESTURE: LMB is drawing
 *  that stamp's region, whatever the gesture slot still says underneath (usually `pointer`,
 *  the arm most stamps are picked from) — and it NAMES the generator, because "a region"
 *  alone leaves the user to remember which stamp they pressed.
 *
 *  "click ×2", NOT "drag", for the same mechanical reason the box line says it: the region
 *  takes two separate presses. One mechanism with two verbs on one status line, with the
 *  wrong verb on the flow D-F4.5-7 exists to make discoverable, is worse than either. */
const TRANSIENT_STATUS = {
  session: [
    { kind: "slot", slot: "sessionSteer" },
    text("R rotate ¼"),
    { kind: "slot", slot: "sessionPrimary", prefix: "⏎ " },
    { kind: "slot", slot: "sessionSecondary", prefix: "Esc " },
  ],
  pendingStamp: [
    {
      kind: "slot",
      slot: "stampName",
      prefix: "click ×2 to span a region for ",
    },
    text("Esc cancels"),
  ],
} as const satisfies Record<TransientStateId, readonly StatusFragment[]>;

/** THE ORDER IS THE CONTRACT: a session shadows a pending stamp, which shadows the gesture,
 *  which shadows the armed effect.
 *
 *  A table-level constant rather than a row fact, because it is a statement about the rows
 *  rather than about any one of them — and it is LOAD-BEARING rather than documentary:
 *  {@link deriveArmedKeymap} walks it. **TWO readers since foundations T4c**, which is the
 *  reason to add a state HERE rather than in either of them: `frontend/lib/session-answerers.ts`'s
 *  `ARMED_STATE` walks this same tuple to answer `SessionState.armed` for an agent, so the
 *  keymap line the human reads and the payload the agent reads take their order from one
 *  declaration and a new member is a compile error in both tables. (A third site obeys the
 *  same rule and cannot be bound to it: `frontend/lib/actions.ts`'s `idle` is a boolean and
 *  carries the full instruction.) The tone leaves with the text for the same reason a
 *  renderer that re-derived "is this over the cap?" from the measurement alone toned lines
 *  the segment was not even the subject of — a session opening over a pending point painted
 *  "⏎ commit · Esc discard" as a refusal. One order, one answer, one tone. */
export const STATUS_PRECEDENCE = [
  "session",
  "pendingStamp",
  "gesture",
  "effect",
] as const;

// --- the derivations ---------------------------------------------------------

/** A status line, plus whether it is describing something the next click will REFUSE. */
export type StatusLine = { text: string; overCap: boolean };

/** A line with nothing to warn about — every branch but the segment readout's. */
const plain = (t: string): StatusLine => ({ text: t, overCap: false });

/** Render one fragment list into its clauses, filling each slot from `slots`.
 *
 *  LOGS AND SKIPS a slot the caller did not fill. The thing being prevented is a status
 *  line reading `undefined`, and dropping the clause does that while leaving the rest of the
 *  line on screen.
 *
 *  Not a throw, and the distinction is this repo's failure policy rather than taste: every
 *  caller of this reaches it from `StatusBar`'s render, so a throw here takes the whole shell
 *  down over one missing word. Setup-loud, runtime-quiet-with-a-log — and the two throws that
 *  DO stand in this module (`deriveSelectModes`, and `cycleOrder` one layer up) are correct
 *  precisely because they fire at module init, where loud is the whole point. */
function renderParts(
  fragments: readonly StatusFragment[],
  slots: Partial<Record<StatusSlot, string>>,
): string[] {
  return fragments
    .map((f) => {
      if (f.kind === "text") return f.text;
      const value = slots[f.slot];
      if (value === undefined) {
        console.error(`action-table: no value for status slot "${f.slot}"`);
        return null;
      }
      return `${f.prefix ?? ""}${value}`;
    })
    .filter((c): c is string => c !== null);
}

const render = (
  fragments: readonly StatusFragment[],
  slots: Partial<Record<StatusSlot, string>> = {},
): string => renderParts(fragments, slots).join(STATUS_SEPARATOR);

/** Everything {@link deriveArmedKeymap} needs about what is armed, as PLAIN data.
 *
 *  Structural rather than the host's own `StampSession`/`PendingStamp`/`SegmentHud`, and
 *  that is the layer rule rather than fastidiousness: this module sits below the host and
 *  may not import it. What the caller loses is nothing — it holds those objects and reads
 *  four fields off them. What it gains is that the two session VERBS arrive as values, so
 *  `SESSION_VERBS` stays the one source for them instead of being copied in here. */
export type KeymapInput = {
  /** The armed effect — the FLOOR of the precedence, the one branch that always answers. */
  readonly effect: BrushEffect;
  /** What holds LMB, or `null` while the brush strokes. */
  readonly gesture: GestureId | null;
  /** A live stamp session. `moving` picks the steering clause; the verbs are
   *  `SESSION_VERBS[sessionStateTag(session)]`. */
  readonly session: {
    readonly moving: boolean;
    readonly primary: string;
    readonly secondary: string;
  } | null;
  /** A stamp armed for region-draw, by display name. */
  readonly pendingStamp: { readonly name: string } | null;
  /** The segment readout, once a point is down. */
  readonly segment: SegmentReadout | null;
};

/** One resolver per state in {@link STATUS_PRECEDENCE}: the line, or `null` when this state
 *  is not the one the editor is in. */
const STATUS_STATE: Record<
  (typeof STATUS_PRECEDENCE)[number],
  (input: KeymapInput) => StatusLine | null
> = {
  session: (input) => {
    const s = input.session;
    if (s === null) return null;
    return plain(
      render(TRANSIENT_STATUS.session, {
        sessionSteer: s.moving ? SESSION_STEER.dragged : SESSION_STEER.nudged,
        sessionPrimary: s.primary,
        sessionSecondary: s.secondary,
      }),
    );
  },
  pendingStamp: (input) => {
    const p = input.pendingStamp;
    if (p === null) return null;
    return plain(render(TRANSIENT_STATUS.pendingStamp, { stampName: p.name }));
  },
  gesture: (input) => {
    const id = input.gesture;
    if (id === null) return null;
    const row = GESTURE_ROWS[id];
    const readout = input.segment;
    // A readout line only fires for the gesture that HAS one, so a stale measurement left
    // standing under another gesture cannot reach a line that is not about it.
    if (row.readoutLine === null || readout === null)
      return plain(render(row.statusLine));
    return {
      text: render(row.readoutLine, {
        segmentMeasure: formatSegmentMeasure(readout),
      }),
      overCap: overSegmentCap(readout),
    };
  },
  effect: (input) =>
    plain(
      [
        ...renderParts(EFFECT_ROWS[input.effect].statusLine, {}),
        ...deriveModifierParts(input.effect),
      ].join(STATUS_SEPARATOR),
    ),
};

/** The status bar's keymap line — what the keys do RIGHT NOW, plus its one bit of tone.
 *
 *  Answers the question a modal editor makes people ask constantly ("what does clicking do
 *  in this mode?") at the moment they ask it. Walks {@link STATUS_PRECEDENCE}, so the order
 *  written there is the order that runs. */
export function deriveArmedKeymap(input: KeymapInput): StatusLine {
  for (const state of STATUS_PRECEDENCE) {
    const line = STATUS_STATE[state](input);
    if (line !== null) return line;
  }
  // Unreachable: `effect` is the FLOOR and never returns null. A throw rather than a cast,
  // so a reordering that drops it off the end fails loudly instead of rendering nothing.
  throw new Error("action-table: no status line for the armed state");
}

/** Which momentary/sticky overrides are LIVE under `effect` — the status line's tail. */
export function deriveModifierParts(effect: BrushEffect): string[] {
  return EFFECT_ROWS[effect].modifiers.map((m) => `${m.key} ${m.gives}`);
}

/** Every effect, exactly once. The four keys are restated here and NOWHERE else in this
 *  module's derivations, and they are restated against `Record<BrushEffect, T>` — so a
 *  fifth effect fails to compile in one place instead of silently missing a table. */
const mapEffects = <T>(f: (row: EffectRow) => T): Record<BrushEffect, T> => ({
  dig: f(EFFECT_ROWS.dig),
  fill: f(EFFECT_ROWS.fill),
  paint: f(EFFECT_ROWS.paint),
  smooth: f(EFFECT_ROWS.smooth),
});

/** Per effect: the whole option list, and how many of them the strip carries. */
export function deriveToolOptions(): Record<
  BrushEffect,
  { all: readonly ParamId[]; onStrip: number }
> {
  return mapEffects((row) => ({
    all: row.params.all,
    onStrip: row.params.onStrip,
  }));
}

/** Per effect: the container-query class that hides its param group under width pressure. */
export function deriveStripParamsMin(): Record<BrushEffect, string> {
  return mapEffects((row) => row.params.stripMinClass);
}

/** What the strip calls each cell-selection gesture, and the one static fact that bounds it.
 *
 *  Keyed on {@link CellSelectId}, NOT joined against the select family's member list — so
 *  the two can in principle disagree, and the gate is what stops them: the table's test
 *  cross-checks these keys against `FAMILY_ROWS`' select members, because a mode the strip
 *  renders and `M` cannot reach is a control with no route to it.
 *
 *  THROWS on a member with no note: a cell-select mode whose strip has nothing to say would
 *  render an empty span, which is the dead-control defect in its quietest form. */
export function deriveSelectModes(): Record<
  CellSelectId,
  { name: string; note: string }
> {
  const mode = (id: CellSelectId): { name: string; note: string } => {
    const row = GESTURE_ROWS[id];
    if (row.note === null)
      throw new Error(`action-table: cell-select gesture "${id}" has no note`);
    return { name: row.stripName, note: row.note };
  };
  return { box: mode("box"), material: mode("material"), void: mode("void") };
}

/** One family member, resolved from its ref.
 *
 *  IT CARRIES THE REF BACK, and that is the whole join: a member is a label and a sentence
 *  for the flyout, and a `{effect}` or `{gesture}` for the arm — the two halves the six
 *  tables kept in different files. `armMember` reads the ref and nothing else has to know
 *  which sub-table the row came out of.
 *
 *  There is no `id` beside `label`. There WAS, in Task 2, holding `id: row.label` so the
 *  derivation matched a literal that spelled both — and once the literal went, a second name
 *  for one string is the defect this module exists to remove. The one surface that needs a
 *  per-member KEY (`ToolFamilyMember.id`) spells that choice once, where the two cases meet;
 *  since T4c the non-generator half of it is {@link memberRefId} of this `ref` rather than
 *  this `label`, so the key survives a relabelling. */
export type DerivedMember = {
  /** WHICH row this is, and therefore what arming it DOES. */
  readonly ref: FamilyMemberRef;
  readonly label: string;
  readonly hint: string;
};

/** A family with its member refs resolved — everything about a rail column that is DATA.
 *
 *  What is not here is what cannot be: the four `(ctx) => …` predicates the rail evaluates
 *  per render (`armed`, the contextual label, the stamp family's generator members). Those
 *  are functions of live state; {@link FamilyRow.memberSource} is the table's half of both
 *  the member list and the naming rule. */
export type DerivedFamily = {
  readonly id: FamilyId;
  readonly name: string;
  readonly memberSource: FamilyRow["memberSource"];
  readonly members: readonly DerivedMember[];
  readonly arm: ToolActionId;
  readonly cycle: ToolActionId | null;
};

/** The four rail columns with their members resolved out of the two sub-tables. */
export function deriveFamilies(): readonly DerivedFamily[] {
  return FAMILY_ROWS.map((family) => ({
    id: family.id,
    name: family.name,
    memberSource: family.memberSource,
    members: family.members.map(resolveMember),
    arm: family.arm,
    cycle: family.cycle,
  }));
}

/** A member ref → the row it points at. The union is resolved by which key is present,
 *  which is how the two discriminators join. */
function resolveMember(ref: FamilyMemberRef): DerivedMember {
  const row =
    "effect" in ref ? EFFECT_ROWS[ref.effect] : GESTURE_ROWS[ref.gesture];
  return { ref, label: row.label, hint: row.hint };
}

/**
 * A member ref as a STABLE STRING — the id a caller outside the chrome names a member by.
 *
 * WHY IT EXISTS (foundations T4c). `ToolFamilyMember.id` was the member's LABEL for four of
 * the five families — `Dig`, `Fill`, `Paint`, `Smooth`, `Segment`, `Box`, `Wand`, `Room` —
 * which was harmless while an id was a React key and a cmdk `value`. T4b promoted it:
 * `runMember(family, memberId, ctx)` takes it as its caller-facing argument and quotes it
 * back in the refusal. So renaming a brush member from "Smooth" to "Blur" — a pure copy
 * change, the kind this editor makes freely — became a breaking change for exactly the
 * caller class that signature was introduced to serve, and nothing flagged it. That sits
 * against the rule the same tranche wrote into `action-registry/result.ts`: prose is free to
 * be reworded, which is WHY `because` exists as a separate machine-readable field. A member
 * id was the one place a display string was still load-bearing for a machine.
 *
 * THE DISCRIMINATOR ITSELF, unchanged. `dig`, `fill`, `paint`, `smooth` from the effect
 * arm; `box`, `material`, `void`, `segment` from the gesture arm. Those are DATA — they are
 * what `armMember` already switches on and what the two sub-tables are keyed by — so an id
 * derived from them is stable across any relabelling, and it reads the way the generator
 * half already does (a stamp member's id has always been its generator id).
 *
 * THE TWO ARMS CANNOT COLLIDE, which is what lets this be a flat string rather than a
 * namespaced one: `BrushEffect` is dig/fill/paint/smooth and `GestureId` is
 * box/material/void/segment/pointer, and the two sets are disjoint. A fifth effect named
 * after a gesture would break that silently, so it is asserted in `tests/shared/`.
 *
 * WHAT MOVED VISIBLY: two ids stopped matching their labels — `material` is displayed
 * "Wand" and `void` is displayed "Room". Every other member's id is its label lowercased,
 * which is a coincidence of the copy rather than a rule, and must not be relied on.
 */
export function memberRefId(ref: FamilyMemberRef): string {
  return "effect" in ref ? ref.effect : ref.gesture;
}
