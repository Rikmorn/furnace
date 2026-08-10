// THE TOOL TABLE'S SHAPE PINS — what is left to prove once the six literals are gone.
//
// This file WAS the derive-and-diff gate (T3b2 Task 2): every one of the six tables the
// editor stated was derived from `src/shared/action-table.ts`'s rows and asserted deep-equal
// to the literal still standing in its own home, side by side for exactly one commit. Six
// derivations, zero mismatches. Task 5 switched the consumers and deleted the literals, and
// the diff half went with them — a derivation compared against a derivation is a tautology
// wearing an assertion's clothes, and leaving those cases in place would have been six green
// tests that could no longer fail.
//
// WHAT REPLACED THEM, and what each kind is for:
//   (0) the type-identity pins, which OUTLIVE the literals — the table declares unions whose
//       homes are above the floor it sits on, and only `bun run typecheck` catches drift.
//   (1) the two JOINS the module does not make, which is the same claim it always was.
//   (2)–(3) the CHROME's half: the ids resolve in the registry, and the live `TOOL_FAMILIES`
//       closures follow the rule fields the rows state.
//   (4) the STATUS LINE, string for string — the precedence, the tone, and one full line per
//       armed state. These are golden strings on purpose: they are the one surface whose
//       whole content is words, they are not rendered anywhere a DOM test can read them
//       cheaply, and the diff gate they replace is the only thing that has ever held them.
//   (5)–(8) the row invariants and the three host constants.
//
// NEVER WEAKEN AN ASSERTION HERE TO MAKE IT PASS. A failure means the rows changed; decide
// whether the change was intended, and if it was, change the pin deliberately.
import { expect, test } from "bun:test";
import type {
  FieldTool,
  PendingStamp,
  SegmentHud,
  StampSession,
  ViewportGesture,
} from "../../src/field-host/index.ts";
import { armedKeymap } from "../../src/frontend/components/shell/status-keymap.ts";
import { byId, TOOL_FAMILIES } from "../../src/frontend/lib/actions.ts";
import { SESSION_VERBS } from "../../src/frontend/lib/field-session.ts";
import type {
  CellSelectId,
  DerivedFamily,
  FamilyId,
  FamilyRow,
  GestureId,
} from "../../src/shared/action-table.ts";
import {
  deriveFamilies,
  deriveModifierParts,
  deriveSelectModes,
  deriveStripParamsMin,
  deriveToolOptions,
  EFFECT_ROWS,
  FAMILY_ROWS,
  GESTURE_ROWS,
  memberRefId,
  STATUS_PRECEDENCE,
} from "../../src/shared/action-table.ts";
import type { BrushEffect } from "../../src/shared/field-brush.ts";
import { LATTICE } from "../../src/shared/field-brush.ts";
import {
  MAX_SEGMENT_M,
  SELECTION_UI_BUDGET,
} from "../../src/shared/field-limits.ts";
import { makeCtx } from "../_actions-fixture.ts";

const EFFECTS: readonly BrushEffect[] = ["dig", "fill", "paint", "smooth"];
const GESTURES: readonly GestureId[] = [
  "pointer",
  "box",
  "material",
  "void",
  "segment",
];

const DIG_TOOL: FieldTool = {
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
};

const SESSION: StampSession = {
  generator: "hall",
  params: {},
  seed: 7,
  policy: "replace",
  region: { min: [0, 0, 0], max: [4, 4, 4] },
  phase: "configuring",
  run: 0,
  opCount: null,
  placementCount: null,
  error: null,
  truncatedSelection: false,
  mode: "stamp",
  entityId: null,
};

const PENDING: PendingStamp = { id: "hall", name: "Hall" };

/** A family row BY ID, throwing when it is gone. Every lookup in this file goes through one
 *  of these two rather than through `find(...)` + `?.`: a missing subject must stop the run,
 *  not leave a case asserting something else (the `native-select-key-gate.test.tsx`
 *  precedent — `SITES.at(-1)` retargeting itself is the failure this shape prevents). */
function familyRow(id: FamilyId): FamilyRow {
  const row = FAMILY_ROWS.find((f) => f.id === id);
  if (row === undefined)
    throw new Error(`no family row "${id}"; this case has no subject`);
  return row;
}

function derivedFamily(id: FamilyId): DerivedFamily {
  const family = deriveFamilies().find((f) => f.id === id);
  if (family === undefined)
    throw new Error(
      `deriveFamilies() dropped "${id}"; this case has no subject`,
    );
  return family;
}

/** The armed state, in the shape the CHROME hands it over — host objects and all. Every
 *  status-line case below goes through `armedKeymap` rather than through
 *  `deriveArmedKeymap` directly, and that is deliberate: since Task 5 the derivation is the
 *  only implementation, so the only thing left worth testing on this path is the ADAPTER —
 *  the session verbs resolved by state tag, the `moving` flag, the four fields flattened. A
 *  case written against the derivation would skip exactly the code that is still here. */
function armed(
  state: Partial<Omit<Parameters<typeof armedKeymap>[0], "tool">> & {
    effect?: BrushEffect;
  },
): { text: string; overCap: boolean } {
  return armedKeymap({
    tool: { ...DIG_TOOL, effect: state.effect ?? "dig" },
    gesture: state.gesture ?? null,
    session: state.session ?? null,
    pendingStamp: state.pendingStamp ?? null,
    segment: state.segment ?? null,
  });
}

const lineFor = (state: Parameters<typeof armed>[0]): string =>
  armed(state).text;

// ---------------------------------------------------------------------------
// (0) The type-identity pins — the duplications this slice could NOT remove.
// ---------------------------------------------------------------------------

/** Mutual assignability, which for unions is equality. Written as a conditional rather than
 *  as two `satisfies` lines because a union is assignable to a WIDER one in one direction:
 *  only checking both directions catches a member added to one side alone. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// `shared/` sits BELOW `field-host/`, so the table cannot import the gesture union it keys
// on — that union's home is above it. It declares its own and these pins close the gap: a
// sixth gesture, or one renamed on a single side, fails `bun run typecheck` here.
const gesturesAreOneUnion: Exact<GestureId, ViewportGesture> = true;
// The host's `SelectionMode` is DELIBERATELY absent from `field-host/index.ts` ("the chrome
// only names the wider union"), so it is not a name this file may import — surface
// membership, not path shape. Subtracting the two non-cell gestures off the barrel's own
// union reconstructs it without reaching past the declared surface, and pins the same fact:
// a `CellSelectId` that quietly grew `"pointer"` would satisfy the line above and fail here.
const cellSelectIsOneUnion: Exact<
  CellSelectId,
  Exclude<ViewportGesture, "segment" | "pointer">
> = true;
// TRUE BY CONSTRUCTION TODAY, and kept for the construction rather than for the equality:
// `field-host.ts` type-imports the floor's `BrushEffect` for `FieldTool.effect`, so what this
// catches is the host re-DECLARING the union locally instead of importing it — which is the
// shape the gesture union is in right now, one directory over. Read off the host barrel
// directly, ONE hop: it went through `tool-params.tsx`'s own `BrushEffect` alias until Task 5
// deleted that alias as a third spelling, and routing a pin through an alias measures the
// alias as much as the fact.
const effectsAreOneUnion: Exact<BrushEffect, FieldTool["effect"]> = true;

// `ParamId` HAD a fourth pin beside these and no longer needs one, for the same reason the
// alias above went: Task 5 moved the union's HOME to `action-table.ts` and `tool-params.tsx`
// re-exports it, so there is one declaration where there were two. Deleting a duplication is
// the fix a pin is a substitute for. It was available for the params and not for the gestures
// because the params are the TABLE's fact — the chrome renders them, it does not decide which
// exist — and `ViewportGesture`'s home is above this floor either way.

test("the table's ids and the host's are ONE union, in both directions", () => {
  // THE GATE FOR THIS ONE IS `bun run typecheck`, NOT `bun test`. The three `Exact<>`
  // annotations above are the assertion, and bun TRANSPILES rather than type-checks — a
  // violated `Exact<>` is a TS2322 that runs green here (verified, not assumed). This case
  // exists so the constants are not dead code and so a reader arrives at them; it cannot
  // detect union drift on its own, and a green `bun test` does not clear it.
  expect([
    gesturesAreOneUnion,
    cellSelectIsOneUnion,
    effectsAreOneUnion,
  ]).toEqual([true, true, true]);
});

// ---------------------------------------------------------------------------
// (1) The two joins the module does NOT make.
// ---------------------------------------------------------------------------

test("the cell-select strip renders exactly the modes M cycles", () => {
  // THE JOIN `deriveSelectModes` DOES NOT MAKE. It is keyed on `CellSelectId`; the `M` key
  // cycles the select family's member refs. Nothing in the module holds those two together,
  // so this does: drop `{gesture:"box"}` from the family and the strip would still render a
  // BOX mode the keyboard can no longer reach — a control with no route to it, which is the
  // dead-control defect the whole table is meant to make impossible.
  const cycled = familyRow("select").members.map((m) =>
    "gesture" in m ? m.gesture : `effect:${m.effect}`,
  );
  expect(cycled).toEqual(Object.keys(deriveSelectModes()));
});

test("the X clause is live exactly where tool.swapEffect is enabled", () => {
  // The one half of S8 that can be grounded in something other than a restatement of the
  // row. `tool.swapEffect.enabled` is the registry's own two-effect rule and is reachable;
  // the momentary half is not — `deriveMomentary` is a closure inside `createFieldHost`,
  // so "⌃ is momentary" can only be asserted by reading the row back to itself. That
  // asymmetry is why `ModifierClause` carries no `hold` discriminant: this assertion needs
  // only the KEY, and a field the data already determines is one fact spelled twice.
  const swap = byId("tool.swapEffect");
  for (const effect of EFFECTS) {
    const ctx = makeCtx({ tool: { ...DIG_TOOL, effect } });
    const hasSticky = EFFECT_ROWS[effect].modifiers.some((m) => m.key === "X");
    expect([effect, hasSticky]).toEqual([effect, swap.enabled(ctx)]);
  }
});

// ---------------------------------------------------------------------------
// (2)–(3) The chrome's half of the join.
// ---------------------------------------------------------------------------

test("every family's arm and cycle id RESOLVES in the action registry", () => {
  // The rows hand surfaces an id to dispatch; `byId` throws on a miss, so this is the claim
  // that the ids are live rather than merely well-typed. `TOOL_FAMILIES` now calls `byId` at
  // MODULE INIT, so a broken id takes the editor down at import — this case is what names
  // which one, before a reader has to read a stack trace to find out.
  for (const family of FAMILY_ROWS) {
    expect(byId(family.arm).id).toBe(family.arm);
    if (family.cycle !== null) expect(byId(family.cycle).id).toBe(family.cycle);
  }
});

test("the member source picks the naming rule, and TOOL_FAMILIES obeys it", () => {
  // The fact a data comparison cannot make, because on the chrome's side it is a CLOSURE.
  // `stamp` is the family that diverges, and that divergence is the reason the row carries
  // the source as data rather than the rail re-deriving it.
  //
  // TWO COLUMNS, not three. A separate `labelRule` stood beside `memberSource` for one commit
  // and agreed with it on all four rows — two spellings of one distinction, deleted in Task 5.
  // What that costs this case is nothing: `"generators"` IS the naming rule now, and the
  // loops below drive the rule through the live table rather than reading a second field.
  const rules = FAMILY_ROWS.map((f) => [f.id, f.memberSource]);
  expect(rules).toEqual([
    ["pointer", "rows"],
    ["brush", "rows"],
    ["select", "rows"],
    ["stamp", "generators"],
  ]);
  // …and the LIVE table agrees about which one it is. Measured where the two rules can be
  // TOLD APART, which is the only place they differ: with a `maze` session standing while
  // the ⇧S cursor is still on `hall`, a rows-family says "Stamp Hall" and the stamp family
  // says "Stamp Maze". Idle, all four agree — a fact worth stating, since it is why an
  // idle-ctx assertion here passed for the wrong reason and had to be replaced.
  const idle = makeCtx();
  for (const family of TOOL_FAMILIES)
    expect([family.id, family.label(idle)]).toEqual([
      family.id,
      family.arm.label(idle),
    ]);

  // BOTH branches of the generators chain, which is `pendingStamp ▸ session ▸ arm-label`:
  // driving only the session half would pass an implementation that dropped the pending-arm
  // one, and a stamp picked with nothing selected is the state a first-time user meets
  // FIRST.
  //
  // BOTH name `maze` while the ⇧S cursor sits on `hall` (the fixture's `stampCursor` is
  // null, so `stampMember` falls to the first generator). The mismatch is load-bearing, and
  // measured: with `PENDING` — which IS `hall` — the two rules return the SAME string, so
  // `takesArmLabel` is true against a `"generators"` row expecting false, and this case goes
  // RED. Not silently, and not because the branch is broken — because a fixture that cannot
  // make the rules diverge cannot satisfy an assertion about how they differ. A diverging
  // fixture is what turns the case from unsatisfiable into a test of the rule.
  //
  // (The failure mode one loop up is the OTHER one and is worth keeping distinct: an idle
  // ctx makes all four families agree, so an assertion written there passes VACUOUSLY. One
  // shape goes red on a bad fixture, the other goes green — hence both loops.)
  for (const live of [
    makeCtx({ session: { ...SESSION, generator: "maze" } }),
    makeCtx({ pendingStamp: { id: "maze", name: "Maze" } }),
  ])
    for (const family of TOOL_FAMILIES) {
      const row = familyRow(family.id);
      const takesArmLabel = family.label(live) === family.arm.label(live);
      expect([family.id, takesArmLabel]).toEqual([
        family.id,
        row.memberSource === "rows",
      ]);
    }
});

test("a member's ref is what ARMS it, and the rail keys its rows on the REF", () => {
  // `DerivedMember` carries the REF and no `id` — Task 5's deletion pass, because `id` was
  // `row.label` unconditionally and a second name for one string is what this module exists
  // to remove. The consequence worth pinning is that the two halves still line up: the
  // rail's member list (`ToolFamilyMember`) is keyed on `memberRefId` of the ref for a
  // rows-family, and every one of those members carries a ref the arm can act on.
  //
  // THIS ASSERTION READ `m.label` UNTIL T4C, which is the defect it was unknowingly
  // pinning: the key and the display string were the same value, so a relabelling silently
  // rewrote an id a caller had been told to use. Keying on the ref is what breaks that
  // coupling, and the test now says so in the direction the code does.
  const ctx = makeCtx();
  for (const row of FAMILY_ROWS) {
    if (row.memberSource !== "rows") continue;
    const derived = derivedFamily(row.id);
    const live = TOOL_FAMILIES.find((f) => f.id === row.id);
    if (live === undefined)
      throw new Error(`TOOL_FAMILIES dropped "${row.id}"`);
    expect(live.members(ctx).map((m) => m.id)).toEqual(
      derived.members.map((m) => memberRefId(m.ref)),
    );
    // The refs survive resolution in ORDER — the cycle steps this list, so a reordering
    // here is a reordering of what ⇧B does.
    expect(derived.members.map((m) => m.ref)).toEqual([...row.members]);
  }
});

test("a member id is DATA, not copy — the two ids that no longer echo their labels", () => {
  // THE WHOLE POINT OF THE MIGRATION, stated as the case that would have been impossible
  // before it. `material` is displayed "Wand" and `void` is displayed "Room": for those two
  // the id and the label are now different strings, so an assertion that they agree — which
  // is what the old `id: m.label` made true by construction — cannot pass by accident.
  //
  // LITERALS on both sides, deliberately. Deriving either half from the table would assert
  // that the table equals itself; the point is that these exact ids are a CONTRACT a caller
  // outside the chrome holds, and a rename of either the id or the label reds this.
  const ctx = makeCtx();
  const select = TOOL_FAMILIES.find((f) => f.id === "select");
  if (select === undefined) throw new Error("TOOL_FAMILIES dropped 'select'");
  expect(select.members(ctx).map((m) => [m.id, m.label])).toEqual([
    ["box", "Box"],
    ["material", "Wand"],
    ["void", "Room"],
  ]);
});

test("no effect id collides with a gesture id — a flat member id stays unambiguous", () => {
  // WHAT `memberRefId` DEPENDS ON. It flattens a two-armed union onto one string, which is
  // only unambiguous while the two key spaces are disjoint. A fifth brush effect named
  // after a gesture (`box`, say) would give two members of two different families the same
  // id — survivable — but would also make the flattening lossy for anything that later
  // wants to invert it, and it would do so silently. Cheap to assert, invisible otherwise.
  const effects = Object.keys(EFFECT_ROWS);
  const gestures = Object.keys(GESTURE_ROWS);
  expect(effects.filter((e) => gestures.includes(e))).toEqual([]);
});

// ---------------------------------------------------------------------------
// (4) The status line — the precedence, the tone, and one full line per state.
// ---------------------------------------------------------------------------

test("THE ORDER IS THE CONTRACT — the precedence is what runs, not just what is written", () => {
  expect([...STATUS_PRECEDENCE]).toEqual([
    "session",
    "pendingStamp",
    "gesture",
    "effect",
  ]);
  // Driven, one shadow at a time, from the floor up. Each state is added to the one below
  // it and must WIN: a resolver consulted out of order would leave one of these four
  // showing the line underneath it.
  const floor = { effect: "dig" as BrushEffect };
  expect(lineFor(floor)).toBe(
    "LMB dig · [ ] radius · ⇧ smooth · ⌃ fill · X swap",
  );
  expect(lineFor({ ...floor, gesture: "box" })).toBe(
    "click ×2 spans a region · Esc clears",
  );
  expect(lineFor({ ...floor, gesture: "box", pendingStamp: PENDING })).toBe(
    "click ×2 to span a region for Hall · Esc cancels",
  );
  expect(
    lineFor({
      ...floor,
      gesture: "box",
      pendingStamp: PENDING,
      session: SESSION,
    }),
  ).toBe(
    `← → ↑ ↓ nudge · R rotate ¼ · ⏎ ${SESSION_VERBS.STAMP.primary} · Esc ${SESSION_VERBS.STAMP.secondary}`,
  );
});

test("the segment readout is the ONLY thing that tones a line, and the cap is strictly >", () => {
  // At exactly the cap the click COMMITS (the host refuses on `len > MAX_SEGMENT_M`), so a
  // `>=` here would paint a legal click as a doomed one.
  const at = (lenM: number): boolean =>
    armed({ gesture: "segment", segment: { lenM, capM: MAX_SEGMENT_M } })
      .overCap;
  expect([at(0), at(MAX_SEGMENT_M - 0.1), at(MAX_SEGMENT_M)]).toEqual([
    false,
    false,
    false,
  ]);
  expect([at(MAX_SEGMENT_M + 0.1), at(MAX_SEGMENT_M * 2)]).toEqual([
    true,
    true,
  ]);

  // A measurement left standing under a gesture that is not the segment's must not tone the
  // line — and a session opening OVER a pending point with a live over-cap measurement must
  // not either. That second one was live: the tone was re-derived from `segment` alone and
  // painted "⏎ commit · Esc discard" as a refusal, which is why the tone now leaves the
  // precedence walk with the text rather than being worked out again downstream.
  const stale: SegmentHud = { lenM: MAX_SEGMENT_M * 2, capM: MAX_SEGMENT_M };
  expect(armed({ gesture: "box", segment: stale }).overCap).toBe(false);
  expect(
    armed({
      gesture: "segment",
      segment: stale,
      pendingStamp: PENDING,
      session: SESSION,
    }).overCap,
  ).toBe(false);
});

test("one full status line per armed state, string for string", () => {
  // GOLDEN STRINGS, and the reason they are worth the maintenance is that they are the only
  // thing holding these words at all: the line is rendered by one span in `StatusBar` and
  // its content is entirely row data, so a row edited by hand reaches a user through no
  // other gate. This is the case the derive-and-diff comparison used to be.
  //
  // Every one goes through `armedKeymap`, so the SESSION rows also exercise the adapter's
  // `SESSION_VERBS[sessionStateTag(...)]` lookup — the pair used to be re-derived from
  // `moving` alone, which collapsed STAMP into RECONFIGURE across three surfaces at once.
  const verbs = (tag: keyof typeof SESSION_VERBS): string =>
    `R rotate ¼ · ⏎ ${SESSION_VERBS[tag].primary} · Esc ${SESSION_VERBS[tag].secondary}`;

  expect({
    // the brush floor, one line per effect — the modifier tail is `deriveModifierParts`
    dig: lineFor({ effect: "dig" }),
    fill: lineFor({ effect: "fill" }),
    paint: lineFor({ effect: "paint" }),
    smooth: lineFor({ effect: "smooth" }),
    // the five gestures
    pointer: lineFor({ gesture: "pointer" }),
    box: lineFor({ gesture: "box" }),
    material: lineFor({ gesture: "material" }),
    void: lineFor({ gesture: "void" }),
    segment: lineFor({ gesture: "segment" }),
    // the segment's second state, once a point is down
    readout: lineFor({
      gesture: "segment",
      segment: { lenM: 42.5, capM: MAX_SEGMENT_M },
    }),
    // the two transient states, and all three session tags
    pending: lineFor({ pendingStamp: PENDING }),
    stamp: lineFor({ session: SESSION }),
    reconfigure: lineFor({
      session: { ...SESSION, mode: "reconfigure", entityId: 3 },
    }),
    move: lineFor({
      session: { ...SESSION, mode: "reconfigure", entityId: 3, moving: true },
    }),
  }).toEqual({
    dig: "LMB dig · [ ] radius · ⇧ smooth · ⌃ fill · X swap",
    // SYMMETRIC: under fill the momentary swap gives DIG. A static clause that said
    // "⌃ fill" here named the effect the user is already on.
    fill: "LMB fill · [ ] radius · ⇧ smooth · ⌃ dig · X swap",
    // ⌃ passes through entirely under paint and the sticky swap is disabled, so neither
    // key is live and the line ends at the radius rather than at a dangling separator.
    paint: "LMB paint · [ ] radius · ⇧ smooth",
    // NOTHING is live under smooth: ⇧ derives smooth from whatever is armed.
    smooth: "LMB smooth · [ ] radius",
    pointer: "LMB select · G grab · F frame · ⌫ delete",
    // "click ×2", NOT "drag": `onPointerUp` has no region branch, so a press-drag-release
    // anchors at the PRESS and throws the release away.
    box: "click ×2 spans a region · Esc clears",
    material: "LMB floods the clicked material · Esc clears",
    void: "LMB floods an air pocket · Esc clears",
    segment: "click ×2 sweeps the brush · [ ] radius · Esc drops the point",
    // BOTH numbers and one decimal, matching what the host's own refusal prints. The `60`
    // is a LITERAL here on purpose: this case is what would notice `MAX_SEGMENT_M` moving
    // under the readout, and reading the constant into the expectation would make the
    // number agree with itself. `click ×2` is gone (one click is left); `[ ] radius`
    // survives, because `applyRadius` re-fattens a pending capsule.
    readout: "segment · 42.5 m / 60 m · [ ] radius · Esc drops the point",
    pending: "click ×2 to span a region for Hall · Esc cancels",
    stamp: `← → ↑ ↓ nudge · ${verbs("STAMP")}`,
    reconfigure: `← → ↑ ↓ nudge · ${verbs("RECONFIGURE")}`,
    // A move is DRAGGED where everything else is nudged — the one clause that branches on
    // `moving`, and the flag the adapter passes through.
    move: `drag ghost move · ${verbs("MOVE")}`,
  });
});

test("deriveModifierParts is the tail those brush lines end in", () => {
  // Structural rather than a second transcription: whatever the modifier derivation says is
  // exactly what the line carries past its first two clauses, for every effect.
  for (const effect of EFFECTS) {
    const tail = lineFor({ effect }).split(" · ").slice(2);
    expect([effect, deriveModifierParts(effect)]).toEqual([effect, tail]);
  }
});

// ---------------------------------------------------------------------------
// (5)–(6) The row invariants.
// ---------------------------------------------------------------------------

test("every row's `id` is the key it is filed under", () => {
  // `Record<K, Row>` where `Row.id: K` is one fact written twice, and TypeScript cannot
  // prove they agree — `EFFECT_ROWS.dig.id = "fill"` compiles. The `id` earns its place
  // because a row is passed around WITHOUT its key (`resolveMember`, and every descriptor
  // built off these), so this is the pin that makes the redundancy safe rather than the
  // redundancy removed.
  for (const effect of EFFECTS) expect(EFFECT_ROWS[effect].id).toBe(effect);
  for (const gesture of GESTURES)
    expect(GESTURE_ROWS[gesture].id).toBe(gesture);
});

test("every effect row's status line NAMES its own id", () => {
  // The one invariant the move to literal row text could have dropped: the line is
  // `LMB ${effect}`, so the id and the word cannot drift.
  for (const effect of EFFECTS) {
    const first = EFFECT_ROWS[effect].statusLine[0];
    expect([effect, first]).toEqual([
      effect,
      { kind: "text", text: `LMB ${effect}` },
    ]);
  }
});

test("the strip carries a real PREFIX of each effect's option list, within D-6's cap", () => {
  // What is left to say about `deriveToolOptions` / `deriveStripParamsMin` once there is no
  // literal to diff: the two capacity invariants the strip's whole degradation story rests
  // on. `onStrip` is a slice length, so a figure past the list would silently render fewer
  // controls than it claims, and one past FOUR would break D-6's cap in a 40 px bar.
  const options = deriveToolOptions();
  const classes = deriveStripParamsMin();
  for (const effect of EFFECTS) {
    const { all, onStrip } = options[effect];
    expect({ effect, ok: onStrip > 0 && onStrip <= all.length }).toEqual({
      effect,
      ok: true,
    });
    expect({ effect, overCap: onStrip > 4 }).toEqual({
      effect,
      overCap: false,
    });
    // CLASS-SHAPED TEXT, which is the whole reason the breakpoint is carried as a string.
    // Tailwind generates CSS by scanning source for class-shaped strings, so a threshold
    // templated from a number would emit no rule and the group would never hide.
    expect({
      effect,
      classShaped: /^@max-\[\d+rem\]\/strip:hidden$/.test(classes[effect]),
    }).toEqual({ effect, classShaped: true });
  }
});

// ---------------------------------------------------------------------------
// (7) The three restated host constants, now read rather than restated.
// ---------------------------------------------------------------------------

test("the three host limits reach the chrome as VALUES, not as prose", () => {
  // WHAT THIS PIN CATCHES, precisely: the WORDS drifting. It does NOT catch a re-hardcoded
  // literal — `note: "snaps to 0.5 m"` written by hand passes while `LATTICE === 0.5`, and
  // pretending otherwise is the false-confidence version of this assertion. The coupling to
  // the constant is held elsewhere, by the cases that assert the RENDERED string against a
  // literal (`tests/chrome/tool-strip.test.tsx`, `tests/chrome/tool-rail.test.tsx`, and the
  // segment readout two cases up): change the constant and those go red, which is what
  // makes the two halves a pair.
  expect(deriveSelectModes().box.note).toBe(`snaps to ${LATTICE} m`);
  expect(deriveSelectModes().material.note).toBe(
    `budget ${SELECTION_UI_BUDGET / 1000}k`,
  );
  // BY ID, not by position: `deriveFamilies()[1]` retargets itself at whatever a future
  // column order puts second, and the throw is the point — a vanished family must stop the
  // run rather than let this case quietly assert something else.
  const brush = derivedFamily("brush");
  expect(brush.members.at(-1)?.hint).toBe(
    `two clicks sweep the brush between them — max ${MAX_SEGMENT_M} m; Esc drops the point`,
  );
  // …and they are the numbers the editor actually shipped, so the move did not quietly
  // change one. 60 m, 200 000 cells, a half-metre lattice.
  expect([MAX_SEGMENT_M, SELECTION_UI_BUDGET, LATTICE]).toEqual([
    60, 200_000, 0.5,
  ]);
});
