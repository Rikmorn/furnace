// THE DERIVE-AND-DIFF GATE for the descriptor rows — foundations T3b2 Task 3's proof,
// taken while both sides are standing.
//
// `src/action-registry/descriptors.ts` claims to carry the whole SERIALIZABLE half of the
// editor's action table. This file is what makes that a proof rather than a hope: every one
// of the seven data fields is asserted against the live `frontend/lib/actions.ts` table,
// and the binding rows are asserted against the 22 live `match` CLOSURES over a 640-press
// cross-product — not against a transcription of them.
//
// WHAT A FAILURE HERE MEANS, in the order to check it: (1) a descriptor row drifted from
// the action it describes, or (2) the `KeyBinding` union cannot express a binding the
// closure expresses. (2) is a FINDING about the SCHEMA — the schema is what bends, never the
// behaviour. That is not hypothetical: this gate found one, `named`'s two ⇧ policies, and
// the union grew a `ShiftPolicy` field to hold both rather than the rows being talked into
// one. There is no exception list here and there must never be one; a divergence means the
// union is short a way to say something.
//
// Task 4 moves the five closures across and deletes the `frontend/lib/actions.ts` table.
// Most of this file goes with it: a derivation compared against a deleted literal has
// nothing left to say. What should SURVIVE is the shape half — every keyed row has a gate,
// ids are unique, keycaps are unique — which is about the table rather than about the move.
import { expect, test } from "bun:test";
import {
  ACTION_DESCRIPTORS,
  type ActionDescriptor,
  keycap,
  matchBinding,
} from "../../src/action-registry/index.ts";
import type { ActionDef } from "../../src/frontend/lib/actions.ts";
import { ACTIONS } from "../../src/frontend/lib/actions.ts";

/** A synthetic keydown, filled the way `tests/keybindings.test.ts` fills one and for its
 *  reason: a real `KeyboardEvent` always carries all four modifier flags as booleans, and a
 *  matcher comparing `e.shiftKey === false` would pass against a real event and fail against
 *  a sloppy literal. */
const ev = (o: Partial<KeyboardEvent> & { key: string }) =>
  ({
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...o,
  }) as KeyboardEvent;

/** The dispatcher's job, in one line — the ONLY translation from a DOM event to facts, and
 *  the reason `matchBinding` never sees one. `useGlobalKeybindings` grows this same call in
 *  Task 4; here it stands in for it so the comparison below is between the two MATCHERS
 *  rather than between two ways of reading an event. */
const factsOf = (e: KeyboardEvent) => ({
  key: e.key,
  mod: e.metaKey || e.ctrlKey,
  shift: e.shiftKey,
  alt: e.altKey,
});

// --- the seven data fields ---------------------------------------------------
//
// MIGRATION (until T3b2 Task 4): everything from here to the end of the cross-product case
// compares the rows against the LIVE `frontend/lib/actions.ts` table. Task 4 deletes that
// table, and every assertion that reads `ACTIONS` dies with it — `liveRow`, the ordered
// field diff, and the 640-press equivalence. What must SURVIVE the move is the shape half
// (keyed ⟺ gated, unique ids, unique keycaps, the MCP-projection membership) and the two-⇧-
// policies pin, none of which mention `ACTIONS`.

/** Every action's serializable half, read off the LIVE table. `keys` is the printed cap
 *  here (that is what `ActionDef` carries); the descriptor side derives its own from the
 *  binding, which is what makes the comparison worth making. */
const liveRow = (a: ActionDef) => ({
  id: a.id,
  group: a.group,
  keys: a.keys ?? null,
  hint: a.hint ?? null,
  gate: a.gate ?? null,
  armsTool: a.armsTool ?? null,
  flyLetter: a.flyLetter ?? null,
});

const descriptorRow = (d: ActionDescriptor) => ({
  id: d.id,
  group: d.group,
  keys: d.keys === undefined ? null : keycap(d.keys),
  hint: d.hint ?? null,
  gate: d.gate ?? null,
  armsTool: d.armsTool ?? null,
  flyLetter: d.flyLetter ?? null,
});

test("every action has a descriptor, in the same ORDER, with the same seven data fields", () => {
  // Order is data, not incident: the burger's submenus, the shortcuts overlay's sections
  // and the ⌘K palette all render the table in the order it is written. One assertion over
  // both arrays so a drifted row reports its neighbours rather than only its index.
  expect(ACTION_DESCRIPTORS.map(descriptorRow)).toEqual(ACTIONS.map(liveRow));
});

test("the counts the digest measured still hold — 39 rows, 22 of them keyed", () => {
  // A spot-check on the assertion above, and cheap insurance against it being satisfied by
  // two empty arrays.
  expect({
    rows: ACTION_DESCRIPTORS.length,
    keyed: ACTION_DESCRIPTORS.filter((d) => d.keys !== undefined).length,
    hints: ACTION_DESCRIPTORS.filter((d) => d.hint !== undefined).length,
    armsTool: ACTION_DESCRIPTORS.filter((d) => d.armsTool === true).length,
    flyLetter: ACTION_DESCRIPTORS.filter((d) => d.flyLetter === true).length,
  }).toEqual({ rows: 39, keyed: 22, hints: 27, armsTool: 8, flyLetter: 2 });
});

test("a keycap and a gate are declared exactly where a binding is", () => {
  for (const d of ACTION_DESCRIPTORS)
    expect({ id: d.id, keyed: d.keys !== undefined }).toEqual({
      id: d.id,
      keyed: d.gate !== undefined,
    });
});

test("ids and keycaps are both unique across the table", () => {
  const ids = ACTION_DESCRIPTORS.map((d) => d.id);
  expect(new Set(ids).size).toBe(ids.length);
  const caps = ACTION_DESCRIPTORS.flatMap((d) =>
    d.keys === undefined ? [] : [keycap(d.keys)],
  );
  expect(new Set(caps).size).toBe(caps.length);
});

test("only the six axis views carry an MCP projection, and each names its own pair", () => {
  // The settled decision (2026-08-06): the chrome keeps six literal, greppable ids — they
  // are the WCAG 2.5.8 equivalent affordance for `AxisTriad`'s six sub-minimum tips — while
  // the agent surface T4 builds wants ONE `view.snap {axis, sign}` tool. Recorded as data
  // here, built there. The pair is checked against the id so a copy-paste `NegZ` carrying
  // `sign: 1` cannot read correctly in review and send the camera to the far side of the
  // world, which is the slip the `AxisViewId` type rules out on the chrome side.
  const projected = ACTION_DESCRIPTORS.filter(
    (d) => d.mcpProjection !== undefined,
  );
  expect(projected.map((d) => d.id)).toEqual([
    "view.snapPosX",
    "view.snapNegX",
    "view.snapPosY",
    "view.snapNegY",
    "view.snapPosZ",
    "view.snapNegZ",
  ]);
  for (const d of projected) {
    const axis = d.id.slice(-1).toLowerCase();
    const sign = d.id.includes("snapPos") ? 1 : -1;
    expect({ id: d.id, p: d.mcpProjection }).toEqual({
      id: d.id,
      p: { tool: "view.snap", input: { axis, sign } },
    });
  }
});

// --- the 640-press equivalence, and the ONE listed exception ------------------

/** Every key any binding names, in both cases where case is a thing, plus the keys the
 *  CANVAS owns — those must classify as nothing on both sides, which is the half of this
 *  comparison that a descriptor table cannot pass by claiming everything. */
const KEYS = [
  "s",
  "S",
  "z",
  "Z",
  "j",
  "J",
  "k",
  "K",
  "g",
  "G",
  "v",
  "V",
  "b",
  "B",
  "m",
  "M",
  "x",
  "X",
  "r",
  "R",
  "f",
  "F",
  "\\",
  "?",
  "/",
  "Backspace",
  "Delete",
  "Enter",
  "Escape",
  "Tab",
  "w",
  "a",
  "d",
  "q",
  "e",
  "[",
  "]",
  "ArrowUp",
  "Shift",
  "Control",
];

/** All 16 modifier combinations. `metaKey` and `ctrlKey` are enumerated SEPARATELY rather
 *  than as one `mod`, because the claim being checked is that the two sides collapse them
 *  the same way — asserting it over a pre-collapsed fixture would assume it. */
const MODS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(
  (n) => ({
    metaKey: (n & 1) !== 0,
    ctrlKey: (n & 2) !== 0,
    shiftKey: (n & 4) !== 0,
    altKey: (n & 8) !== 0,
  }),
);

test("the rows claim exactly what the closures claim, over every key × every modifier", () => {
  // ZERO exceptions, and there is no list to add one to. The rows reproduce the 22 closures
  // press for press — including the TWO ⇧ policies the source carries across its three
  // named-key bindings, which `ShiftPolicy` exists to preserve rather than unify.
  const divergences: {
    key: string;
    mods: string;
    rows: string[];
    live: string[];
  }[] = [];
  let checked = 0;
  for (const key of KEYS)
    for (const mods of MODS) {
      const e = ev({ key, ...mods });
      const live = ACTIONS.filter((a) => a.match?.(e) === true).map(
        (a) => a.id,
      );
      const rows = ACTION_DESCRIPTORS.filter(
        (d) => d.keys !== undefined && matchBinding(d.keys, factsOf(e)),
      ).map((d) => d.id);
      checked += 1;
      if (JSON.stringify(rows) !== JSON.stringify(live))
        divergences.push({ key, mods: JSON.stringify(mods), rows, live });
      // At most one action may claim a press — the property `keybindings.test.ts` holds
      // over its 22-row table, checked here over the whole cross-product instead.
      expect({ key, mods, claimants: rows.length <= 1 }).toEqual({
        key,
        mods,
        claimants: true,
      });
    }
  expect({ checked, divergences }).toEqual({ checked: 640, divergences: [] });
});

test("the three named-key bindings keep TWO ⇧ policies — preserved, not unified", () => {
  // THE FINDING, PINNED AS DATA. The cross-product above proves the rows match the closures,
  // and it would go on proving that if someone unified BOTH sides in one commit. This is the
  // assertion that makes unifying them a deliberate act: today's source refuses ⇧⌫ and
  // accepts ⇧⏎ / ⇧Esc, neither side says why, and T3b2 declined to pick.
  //
  // If this fails you are changing product behaviour on a destructive key. Read
  // `docs/backlog/editor-and-tooling/named-key-bindings-disagree-on-shift.md` and get the
  // decision made — do not edit this expectation to match the code.
  const policies = ACTION_DESCRIPTORS.flatMap((d) =>
    d.keys?.kind === "named" ? [[d.id, d.keys.shiftPolicy] as const] : [],
  );
  expect(Object.fromEntries(policies)).toEqual({
    "edit.delete": "up",
    "session.confirm": "any",
    "session.escape": "any",
  });
  // And the behaviour those two words buy, stated in keycaps, so a reader never has to hold
  // `"up"`/`"any"` in their head to see what is at stake.
  const shifted = (key: string) =>
    ACTION_DESCRIPTORS.filter(
      (d) =>
        d.keys !== undefined &&
        matchBinding(d.keys, factsOf(ev({ key, shiftKey: true }))),
    ).map((d) => d.id);
  expect({
    "⇧⌫": shifted("Backspace"),
    "⇧⌦": shifted("Delete"),
    "⇧⏎": shifted("Enter"),
    "⇧Esc": shifted("Escape"),
  }).toEqual({
    "⇧⌫": [],
    "⇧⌦": [],
    "⇧⏎": ["session.confirm"],
    "⇧Esc": ["session.escape"],
  });
});
