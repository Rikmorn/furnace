// THE ROWS' OWN SHAPE — what is true of the descriptor table whatever the chrome does with
// it.
//
// WHAT THIS FILE WAS, AND WHY MOST OF IT IS GONE. Foundations T3b2 Task 3 landed the rows
// BESIDE the `frontend/lib/actions.ts` literals for exactly one commit, and this file was the
// proof that the two agreed: all seven data fields asserted row for row in order, and the 22
// binding rows asserted against the 22 live `match` CLOSURES over a 640-press cross-product,
// with zero divergences and no exception list. Task 4 deleted those literals — the chrome now
// joins its five closures ONTO these rows — so a derivation compared against a deleted
// literal has nothing left to say, and every assertion that read `ACTIONS` went with them.
// The MIGRATION marker that stood here named exactly what had to survive, and this is it: the
// shape half (keyed ⟺ gated, unique ids, unique caps, the MCP-projection membership) and the
// two-⇧-policies pin, none of which ever mentioned `ACTIONS`.
//
// The cross-product survived in a REDUCED form, and the reduction is honest about what is
// left to check. It can no longer compare two matchers, because there is only one; what it
// still holds is a property of the table by itself, and the sharper of the two the old case
// asserted — AT MOST ONE ACTION MAY CLAIM A PRESS, over every key any binding names × all 16
// modifier combinations, plus the keys the CANVAS owns classifying as nothing. A table that
// claimed everything would pass a same-shape comparison and fails this.
//
// NOTHING FROM `frontend/` IS IMPORTED HERE ANY MORE, which is a second thing the deletion
// bought: this file now tests the registry from the registry's own side, the way
// `node-door.test.ts` and `keys.test.ts` do. The chrome's half of the join — that every
// descriptor has a behavior and every behavior a descriptor — is the chrome's to hold, and it
// holds it at COMPILE time (`ActionBehaviors` is a mapped type over `ActionId`).
import { expect, test } from "bun:test";
import {
  ACTION_DESCRIPTORS,
  keycap,
  matchBinding,
} from "../../src/action-registry/index.ts";
import { ACTION_INPUT_SCHEMAS } from "../../src/action-registry/schemas.ts";

/** A press, as the four facts a binding is allowed to read. `metaKey` and `ctrlKey` are
 *  built separately and collapsed here, exactly as `keyFacts` does it in the dispatcher, so
 *  the cross-product below can enumerate the two independently. */
const facts = (o: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}) => ({
  key: o.key,
  mod: o.metaKey === true || o.ctrlKey === true,
  shift: o.shiftKey === true,
  alt: o.altKey === true,
});

// --- the table's own shape ----------------------------------------------------

test("the counts the digest measured still hold — 39 rows, 22 of them keyed", () => {
  // Cheap insurance that every case below is not being satisfied by an empty array, and the
  // one place the table's size is written down as a number.
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

test("every id `schemas.ts` names is a row in this table", () => {
  // The `satisfies Partial<Record<ActionId, …>>` on that map already makes a stray key a
  // compile error; this is the runtime half, and it is not redundant — `bun test` transpiles
  // without type-checking, so a suite run alone would never see the compile error.
  const ids = new Set(ACTION_DESCRIPTORS.map((d) => d.id));
  for (const id of Object.keys(ACTION_INPUT_SCHEMAS))
    expect({ id, row: ids.has(id) }).toEqual({ id, row: true });
});

test("the six that take input are the six the slice named, and no axis view is among them", () => {
  // THE SETTLED READING of "twelve actions need input", pinned so it cannot drift back. Six
  // take a schema. The other six are the axis views, whose axis and sign ARE their id — a
  // `{axis, sign}` schema on `view.snapNegZ` would let a caller hand it `x` and make the id a
  // lie — so what they carry instead is `mcpProjection`, below. The two sets are disjoint and
  // that disjointness is the claim.
  expect(Object.keys(ACTION_INPUT_SCHEMAS)).toEqual([
    "world.saveAs",
    "world.makeDefault",
    "edit.duplicate",
    "edit.delete",
    "edit.grab",
    "tool.stamp",
  ]);
  const projected = ACTION_DESCRIPTORS.filter(
    (d) => d.mcpProjection !== undefined,
  ).map((d) => d.id);
  for (const id of projected)
    expect({ id, alsoSchema: id in ACTION_INPUT_SCHEMAS }).toEqual({
      id,
      alsoSchema: false,
    });
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

// --- the 640-press property ---------------------------------------------------

/** Every key any binding names, in both cases where case is a thing, plus the keys the
 *  CANVAS owns — those must classify as nothing, which is the half of this property a table
 *  cannot pass by claiming everything. */
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
 *  than as one `mod`, because every binding in this table treats them as one and a
 *  pre-collapsed fixture would assume the thing being checked. */
const MODS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(
  (n) => ({
    metaKey: (n & 1) !== 0,
    ctrlKey: (n & 2) !== 0,
    shiftKey: (n & 4) !== 0,
    altKey: (n & 8) !== 0,
  }),
);

/** Which rows claim this press. */
const claimants = (f: ReturnType<typeof facts>): string[] =>
  ACTION_DESCRIPTORS.filter(
    (d) => d.keys !== undefined && matchBinding(d.keys, f),
  ).map((d) => d.id);

test("at most ONE action claims any press, over every key × every modifier", () => {
  // The property `keybindings.test.ts` holds over its 22-row human-authored table, checked
  // here over the whole cross-product instead. Collected rather than asserted per press, so a
  // collision reports which two rows collided on which press rather than only the first.
  const collisions: { key: string; mods: string; rows: string[] }[] = [];
  let checked = 0;
  for (const key of KEYS)
    for (const mods of MODS) {
      const rows = claimants(facts({ key, ...mods }));
      checked += 1;
      if (rows.length > 1)
        collisions.push({ key, mods: JSON.stringify(mods), rows });
    }
  expect({ checked, collisions }).toEqual({ checked: 640, collisions: [] });
});

test("the canvas keys classify as NOTHING — the registry claims none of them", () => {
  // The fly set, the radius steppers and an arrow nudge are the viewport's (the ownership
  // rule at the top of `frontend/lib/actions.ts`). Bare, which is how the canvas listener
  // reads them.
  for (const key of ["w", "a", "d", "q", "e", "[", "]", "ArrowUp", "Shift"])
    expect({ key, rows: claimants(facts({ key })) }).toEqual({ key, rows: [] });
});

test("the three named-key bindings keep TWO ⇧ policies — preserved, not unified", () => {
  // THE FINDING, PINNED AS DATA. Today's source refuses ⇧⌫ and accepts ⇧⏎ / ⇧Esc, neither
  // side says why, and T3b2 declined to pick — so this is the assertion that makes unifying
  // them a deliberate act rather than the side effect of a tidy-up.
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
  const shifted = (key: string) => claimants(facts({ key, shiftKey: true }));
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
