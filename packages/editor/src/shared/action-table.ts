// The tool table: what CLAIMS to be the one place a tool fact is stated. Six literals still
// stand at head — T3b2 Task 5 switches their consumers here and deletes them, and until it
// does, `tests/shared/action-table.test.ts` is what holds the two sides equal.
//
// Row data and pure derivations, nothing else. No React (the chrome renders these), no
// engine, no `field-host` import at all: `src/shared/` is the neutral floor both arrows
// point at, machine-enforced from both sides.
//
// Why this exists, what the six tables were, and which two written non-derivation decisions
// it overrules: editor-architecture §22.
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
export type ToolActionId =
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
export type StatusSlot =
  | "sessionSteer"
  | "sessionPrimary"
  | "sessionSecondary"
  | "stampName"
  | "segmentMeasure";

/** One clause of a status line. TWO kinds, and the count is the model's whole claim: every
 *  line the editor shows is a `" · "`-joined list of clauses, and a clause is either a
 *  constant the row states or one runtime value with a constant lead-in. There is no third
 *  shape — no conditionals, no nesting, no formatting directives — which is what makes a
 *  row's line readable as prose in the source. */
export type StatusFragment =
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

/** What separates two clauses of a status line. Stated once because the line is assembled
 *  in three places (the row's own fragments, the effect's modifier tail, and the two
 *  transient states) and a second spelling would put a different gap in one of them. */
export const STATUS_SEPARATOR = " · ";

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
export type SegmentReadout = { readonly lenM: number; readonly capM: number };

/** Is this measurement one the next click will REFUSE?
 *
 *  Strictly `>`, matching the host's own refusal (`len > MAX_SEGMENT_M`): a segment of
 *  exactly the cap COMMITS, so `>=` would paint a legal click as a doomed one. The only
 *  thing in the editor that can set a status line's tone.
 *
 *  MIGRATION (until T3b2 Task 5): NOT yet the one place the predicate is spelled —
 *  `status-keymap.ts`'s `segmentLine` still spells `lenM > capM` beside it. The gate holds
 *  the two equal until Task 5 deletes that one. */
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
export type ModifierClause = {
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
  /** Which of the TWO naming rules the rail's button follows right now.
   *
   *  `"arm"` — the arm action's own label, which is what three of the four families want.
   *  `"running"` — name whatever is RUNNING (pending arm ▸ live session ▸ the arm action's
   *  label), which the stamp family alone wants: while a session stands it reads as pressed
   *  (a session IS the staged grammar running, D-7), so it must name the generator the
   *  SESSION is on. `tool.stamp`'s own label names the ⇧S cursor, which a session does not
   *  move — a `maze` reconfigure under a `hall` cursor made the rail say "Stamp Hall" beside
   *  a session strip saying `maze #3`. */
  readonly labelRule: "arm" | "running";
  /** Where the members come from: `"rows"` = the refs below, `"generators"` = the host's
   *  stamp registry, which no table can hold. Stated rather than inferred from an empty
   *  `members` list, because "empty means look elsewhere" is a convention a reader has to
   *  be told. */
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
    labelRule: "arm",
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
    labelRule: "arm",
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
    labelRule: "arm",
    memberSource: "rows",
    members: [{ gesture: "box" }, { gesture: "material" }, { gesture: "void" }],
    arm: "tool.select",
    cycle: "tool.selectCycle",
  },
  {
    id: "stamp",
    name: "Stamp",
    labelRule: "running",
    // A stamp "member" is a GENERATOR, and the registry is the host's — picking one OPENS a
    // session rather than arming a mode. ⇧S POINTS the S key at the next generator without
    // opening anything, so this family's cycle is a cursor move rather than an arm.
    memberSource: "generators",
    members: [],
    arm: "tool.stamp",
    cycle: "tool.stampCycle",
  },
];

// --- the transient states, and the order they shadow in ----------------------

/** The two armed states that belong to no ROW: they are properties of the staged grammar
 *  (D-7), not of anything the user armed. */
export type TransientStateId = "session" | "pendingStamp";

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
export const TRANSIENT_STATUS = {
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
 *  {@link deriveArmedKeymap} walks it. The tone leaves with the text for the same reason a
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
 *  THROWS on a slot the caller did not fill, which is the guard that keeps the two-kind
 *  fragment model honest: without it a fragment naming a slot its branch does not resolve
 *  would render the word `undefined` into a status line and nothing would fail. */
function renderParts(
  fragments: readonly StatusFragment[],
  slots: Partial<Record<StatusSlot, string>>,
): string[] {
  return fragments.map((f) => {
    if (f.kind === "text") return f.text;
    const value = slots[f.slot];
    if (value === undefined)
      throw new Error(`action-table: no value for status slot "${f.slot}"`);
    return `${f.prefix ?? ""}${value}`;
  });
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

/** One family member, resolved from its ref. */
export type DerivedMember = {
  /** Stable within its family — the member label, which is what the rail keys its flyout
   *  rows and its cycle position on. */
  readonly id: string;
  readonly label: string;
  readonly hint: string;
};

/** A family with its member refs resolved — everything about a rail column that is DATA.
 *
 *  What is not here is what cannot be: the four `(ctx) => …` predicates the rail evaluates
 *  per render (`armed`, the contextual label, the stamp family's generator members). Those
 *  are functions of live state; {@link FamilyRow.labelRule} and
 *  {@link FamilyRow.memberSource} are the table's half of them. */
export type DerivedFamily = {
  readonly id: FamilyId;
  readonly name: string;
  readonly labelRule: FamilyRow["labelRule"];
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
    labelRule: family.labelRule,
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
  return { id: row.label, label: row.label, hint: row.hint };
}
