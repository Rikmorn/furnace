// THE DERIVE-AND-DIFF GATE — foundations T3b2 Task 2's whole point.
//
// `src/shared/action-table.ts` claims to be the ONE place a tool fact is stated. This file
// is the proof, taken BEFORE anything switched onto it: every one of the six tables the
// editor states today is DERIVED from the new rows and asserted deep-equal to the literal
// still standing in its own home. Both exist side by side for exactly one commit, which is
// what makes the comparison meaningful — a derivation checked against a transcription of
// the literal proves only that the transcription was faithful.
//
// WHAT A FAILURE HERE MEANS, in the order to check it: (1) the row model is missing a fact
// the literal carries, or (2) two of today's tables disagree with each other and the source
// had to pick one. (2) is the drift class the slice exists to kill and is a FINDING, not a
// formatting problem — never weaken an assertion to make it pass.
//
// Task 5 switches the six consumers onto the derivations and deletes the literals. When it
// does, most of this file goes with them: a gate comparing a derivation against a deleted
// literal has nothing left to say. What SURVIVES is the type-identity pin below, which is
// the standing guard over the one duplication this task could not remove.
import { expect, test } from "bun:test";
import type {
  FieldTool,
  PendingStamp,
  SegmentHud,
  StampSession,
  ViewportGesture,
} from "../../src/field-host/index.ts";
import { armedKeymap } from "../../src/frontend/components/shell/status-keymap.ts";
import {
  SELECT_MODES,
  STRIP_PARAMS_MIN,
} from "../../src/frontend/components/shell/ToolStrip.tsx";
import type {
  BrushEffect as BrushEffectToday,
  ParamId as ParamIdToday,
} from "../../src/frontend/components/shell/tool-params.tsx";
import { TOOL_OPTIONS } from "../../src/frontend/components/shell/tool-params.tsx";
import type { ActionCtx } from "../../src/frontend/lib/actions.ts";
import { byId, TOOL_FAMILIES } from "../../src/frontend/lib/actions.ts";
import {
  SESSION_VERBS,
  sessionStateTag,
} from "../../src/frontend/lib/field-session.ts";
import type {
  CellSelectId,
  DerivedFamily,
  FamilyId,
  FamilyRow,
  GestureId,
  KeymapInput,
  ParamId,
} from "../../src/shared/action-table.ts";
import {
  deriveArmedKeymap,
  deriveFamilies,
  deriveModifierParts,
  deriveSelectModes,
  deriveStripParamsMin,
  deriveToolOptions,
  EFFECT_ROWS,
  FAMILY_ROWS,
  GESTURE_ROWS,
  STATUS_SEPARATOR,
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

// ---------------------------------------------------------------------------
// (0) The type-identity pin — the ONE duplication this task could not remove.
// ---------------------------------------------------------------------------

/** Mutual assignability, which for unions is equality. Written as a conditional rather than
 *  as two `satisfies` lines because a union is assignable to a WIDER one in one direction:
 *  only checking both directions catches a member added to one side alone. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// `shared/` sits BELOW both `field-host/` and `frontend/`, so the table cannot import the
// unions it keys on — their homes are above it. It declares its own and this pin closes the
// gap: a sixth gesture, or a param renamed on one side, fails `bun run typecheck` here.
// This is the one assertion in the file that OUTLIVES Task 5.
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
const paramsAreOneUnion: Exact<ParamId, ParamIdToday> = true;
const effectsAreOneUnion: Exact<BrushEffect, BrushEffectToday> = true;

test("the table's ids and the host's are ONE union, in both directions", () => {
  // THE GATE FOR THIS ONE IS `bun run typecheck`, NOT `bun test`. The four `Exact<>`
  // annotations above are the assertion, and bun TRANSPILES rather than type-checks — a
  // violated `Exact<>` is a TS2322 that runs green here (verified, not assumed). This case
  // exists so the constants are not dead code and so a reader arrives at them; it cannot
  // detect union drift on its own, and a green `bun test` does not clear it.
  expect([
    gesturesAreOneUnion,
    cellSelectIsOneUnion,
    paramsAreOneUnion,
    effectsAreOneUnion,
  ]).toEqual([true, true, true, true]);
});

// ---------------------------------------------------------------------------
// (1)–(3), (6) The four literal tables.
// ---------------------------------------------------------------------------

test("deriveToolOptions() === TOOL_OPTIONS (tool-params.tsx)", () => {
  expect(deriveToolOptions()).toEqual(TOOL_OPTIONS);
});

test("deriveStripParamsMin() === STRIP_PARAMS_MIN (ToolStrip.tsx)", () => {
  expect(deriveStripParamsMin()).toEqual(STRIP_PARAMS_MIN);
});

test("deriveSelectModes() === SELECT_MODES (ToolStrip.tsx)", () => {
  expect(deriveSelectModes()).toEqual(SELECT_MODES);
});

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

/** The DATA half of `TOOL_FAMILIES`, projected out of the literal so the two shapes can be
 *  compared at all. The four `(ctx) => …` predicates are not data and are not derivable —
 *  `labelRule` and `memberSource` are the table's half of them, asserted separately below.
 *
 *  `members(ctx)` is resolved against a ctx with NO generators, which is what makes the
 *  stamp family's member list empty on both sides: its members are the host's registry, and
 *  a table cannot hold them. That the stamp family is the only one whose emptiness is a
 *  SOURCE fact rather than an empty fixture is what `memberSource` states.
 *
 *  `arm`/`cycle` come out as plain `string` because `ActionDef.id` is one — the registry
 *  does not name its own ids as a union today, which is why the table's `ToolActionId` is
 *  pinned to it by RESOLUTION (`byId` throws) rather than by assignment. */
type FamilyData = {
  id: string;
  name: string;
  arm: string;
  cycle: string | null;
  members: { id: string; label: string; hint: string }[];
};

function familyDataToday(ctx: ActionCtx): FamilyData[] {
  return TOOL_FAMILIES.map((family) => ({
    id: family.id,
    name: family.name,
    arm: family.arm.id,
    cycle: family.cycle?.id ?? null,
    members: family.members(ctx).map((m) => ({
      id: m.id,
      label: m.label,
      hint: m.hint,
    })),
  }));
}

test("deriveFamilies() === TOOL_FAMILIES' data half (actions.ts)", () => {
  const ctx = makeCtx({ generators: [] });
  const derived: FamilyData[] = deriveFamilies().map((f) => ({
    id: f.id,
    name: f.name,
    arm: f.arm,
    cycle: f.cycle,
    members: f.members.map((m) => ({ id: m.id, label: m.label, hint: m.hint })),
  }));
  expect(derived).toEqual(familyDataToday(ctx));
});

test("every family's arm and cycle id RESOLVES in the action registry", () => {
  // `deriveFamilies` hands surfaces an id to dispatch; `byId` throws on a miss, so this is
  // the claim that the ids are live rather than merely well-typed.
  for (const family of FAMILY_ROWS) {
    expect(byId(family.arm).id).toBe(family.arm);
    if (family.cycle !== null) expect(byId(family.cycle).id).toBe(family.cycle);
  }
});

test("the contextual-label rule and the member source match TOOL_FAMILIES", () => {
  // The two facts the projection above cannot compare, because on the literal's side they
  // are closures. `stamp` is the family that diverges on BOTH, and that divergence is the
  // reason the row carries them as data rather than the rail re-deriving it.
  const rules = FAMILY_ROWS.map((f) => [f.id, f.labelRule, f.memberSource]);
  expect(rules).toEqual([
    ["pointer", "arm", "rows"],
    ["brush", "arm", "rows"],
    ["select", "arm", "rows"],
    ["stamp", "running", "generators"],
  ]);
  // …and the literal agrees about which one it is. Measured where the two rules can be
  // TOLD APART, which is the only place they differ: with a `maze` session standing while
  // the ⇧S cursor is still on `hall`, `"arm"` says "Stamp Hall" and `"running"` says "Stamp
  // Maze". Idle, all four families agree — a fact worth stating, since it is why an
  // idle-ctx assertion here passed for the wrong reason and had to be replaced.
  const idle = makeCtx();
  for (const family of TOOL_FAMILIES)
    expect([family.id, family.label(idle)]).toEqual([
      family.id,
      family.arm.label(idle),
    ]);

  // BOTH branches of the `running` chain, which is `pendingStamp ▸ session ▸ arm-label`
  // (`actions.ts`): driving only the session half would pass an implementation that dropped
  // the pending-arm one, and a stamp picked with nothing selected is the state a first-time
  // user meets FIRST.
  //
  // BOTH name `maze` while the ⇧S cursor sits on `hall` (the fixture's `stampCursor` is
  // null, so `stampMember` falls to the first generator). The mismatch is load-bearing, and
  // measured: with `PENDING` — which IS `hall` — the two rules return the SAME string, so
  // `takesArmLabel` is true against a `"running"` row expecting false, and this case goes
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
        row.labelRule === "arm",
      ]);
    }
});

// ---------------------------------------------------------------------------
// (4) armedKeymap — every branch, every state, string for string.
// ---------------------------------------------------------------------------

/** The same armed state, in the two shapes. `armedKeymap` takes the host's own objects;
 *  `deriveArmedKeymap` takes plain data, because `shared/` may not import the host — so the
 *  ONE fixture builds both and the diff cannot be an artefact of two hand-written states. */
function bothShapes(state: {
  effect: BrushEffect;
  gesture: GestureId | null;
  session: StampSession | null;
  pendingStamp: PendingStamp | null;
  segment: SegmentHud | null;
}): [Parameters<typeof armedKeymap>[0], KeymapInput] {
  const verbs =
    state.session === null
      ? null
      : SESSION_VERBS[sessionStateTag(state.session)];
  return [
    {
      tool: { ...DIG_TOOL, effect: state.effect },
      gesture: state.gesture,
      session: state.session,
      pendingStamp: state.pendingStamp,
      segment: state.segment,
    },
    {
      effect: state.effect,
      gesture: state.gesture,
      session:
        state.session === null || verbs === null
          ? null
          : {
              moving: state.session.moving === true,
              primary: verbs.primary,
              secondary: verbs.secondary,
            },
      pendingStamp: state.pendingStamp,
      segment: state.segment,
    },
  ];
}

/** Every armed state the status line has a branch for, and the ones it deliberately does
 *  NOT branch on — a stale segment measurement under `box`, a session standing over a
 *  pending point — because those are exactly where a re-derived answer went wrong before. */
function keymapMatrix(): {
  effect: BrushEffect;
  gesture: GestureId | null;
  session: StampSession | null;
  pendingStamp: PendingStamp | null;
  segment: SegmentHud | null;
}[] {
  const base = {
    session: null,
    pendingStamp: null,
    segment: null,
  } as const;
  const rows = [];
  // The brush floor: four effects, four modifier tails.
  for (const effect of EFFECTS)
    rows.push({ ...base, effect, gesture: null as GestureId | null });
  // Every gesture, under every effect — the gesture must win, and for `segment` the effect
  // must still be irrelevant to the words.
  for (const gesture of GESTURES)
    for (const effect of EFFECTS) rows.push({ ...base, effect, gesture });
  // The segment READOUT, including both sides of the strictly-`>` cap rule and the boundary
  // itself: at exactly the cap the click still COMMITS, so `>=` must not pass here.
  for (const segment of [
    { lenM: 0, capM: MAX_SEGMENT_M },
    { lenM: 42.5, capM: MAX_SEGMENT_M },
    { lenM: MAX_SEGMENT_M, capM: MAX_SEGMENT_M },
    { lenM: MAX_SEGMENT_M + 1, capM: MAX_SEGMENT_M },
  ])
    rows.push({
      ...base,
      effect: "dig" as BrushEffect,
      gesture: "segment" as GestureId | null,
      segment,
    });
  // A measurement left standing under a gesture that is not the segment's: the line must be
  // the box's, untoned.
  rows.push({
    ...base,
    effect: "dig" as BrushEffect,
    gesture: "box" as GestureId | null,
    segment: { lenM: MAX_SEGMENT_M + 15, capM: MAX_SEGMENT_M },
  });
  // A pending stamp SHADOWS the gesture slot it was picked from.
  for (const gesture of [null, "pointer", "box"] as (GestureId | null)[])
    rows.push({
      ...base,
      effect: "dig" as BrushEffect,
      gesture,
      pendingStamp: PENDING,
    });
  // A session shadows everything, in all three of its state tags and both steerings — and
  // once OVER a pending point with a live over-cap measurement, which is the state that
  // proved the tone had to travel with the text.
  for (const session of [
    SESSION,
    { ...SESSION, mode: "reconfigure" as const, entityId: 3 },
    {
      ...SESSION,
      mode: "reconfigure" as const,
      entityId: 3,
      moving: true as const,
    },
  ])
    rows.push({
      ...base,
      effect: "dig" as BrushEffect,
      gesture: "pointer" as GestureId | null,
      session,
    });
  rows.push({
    effect: "dig" as BrushEffect,
    gesture: "segment" as GestureId | null,
    session: SESSION,
    pendingStamp: PENDING,
    segment: { lenM: 75, capM: MAX_SEGMENT_M },
  });
  return rows;
}

test("deriveArmedKeymap() === armedKeymap() over every armed state", () => {
  // Compared as a LIST of labelled pairs rather than case by case: a per-row `expect` stops
  // at the first mismatch and reports one, where the finding this gate exists to produce is
  // the WHOLE set of places two tables disagree.
  const rows = keymapMatrix();
  const derived = rows.map((row) => {
    const [, input] = bothShapes(row);
    return deriveArmedKeymap(input);
  });
  const today = rows.map((row) => {
    const [state] = bothShapes(row);
    return armedKeymap(state);
  });
  expect(derived).toEqual(today);
});

test("deriveModifierParts() === the tail armedKeymap joins onto the brush line", () => {
  // `modifierParts` is module-private in `status-keymap.ts`, so it is read where it is
  // USED: the brush line is `LMB <effect> · [ ] radius · <the tail>`, and the tail is
  // everything past the second clause. Structural, not a transcription of the strings.
  for (const effect of EFFECTS) {
    const [state] = bothShapes({
      effect,
      gesture: null,
      session: null,
      pendingStamp: null,
      segment: null,
    });
    const tail = armedKeymap(state).text.split(STATUS_SEPARATOR).slice(2);
    expect([effect, deriveModifierParts(effect)]).toEqual([effect, tail]);
  }
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

test("every row's `id` is the key it is filed under", () => {
  // `Record<K, Row>` where `Row.id: K` is one fact written twice, and TypeScript cannot
  // prove they agree — `EFFECT_ROWS.dig.id = "fill"` compiles. The `id` earns its place
  // because a row is passed around WITHOUT its key (`resolveMember`, and every descriptor
  // Task 3 will build off these), so this is the pin that makes the redundancy safe rather
  // than the redundancy removed.
  for (const effect of EFFECTS) expect(EFFECT_ROWS[effect].id).toBe(effect);
  for (const gesture of GESTURES)
    expect(GESTURE_ROWS[gesture].id).toBe(gesture);
});

test("every effect row's status line NAMES its own id", () => {
  // The one invariant the move to literal row text could have dropped: today's line is
  // `LMB ${effect}`, so the id and the word cannot drift. Stated as a rule now that the row
  // states the words, so it outlives the literal this gate diffs against.
  for (const effect of EFFECTS) {
    const first = EFFECT_ROWS[effect].statusLine[0];
    expect([effect, first]).toEqual([
      effect,
      { kind: "text", text: `LMB ${effect}` },
    ]);
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
  // literal (`tests/chrome/tool-strip.test.tsx`, `tests/chrome/tool-rail.test.tsx`): change
  // the constant and those go red, which is what makes the two halves a pair.
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
