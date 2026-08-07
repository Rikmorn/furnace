// The five binding kinds, one at a time. `descriptors.test.ts` beside this proves the DATA
// reproduces the live table; this file proves the PREDICATE means what the six matchers in
// `frontend/lib/actions.ts` meant, kind by kind — the ⌥ exclusion every kind shares, the
// case folding three of them do, `?`'s layout argument for reading no ⇧ at all, and the
// ⇧-indifference `named` settled on (product decision 2026-08-07 — ⇧⌫ deletes).
//
// Pure — no DOM, no chrome import. `KeyFacts` is a plain object by design, which is what
// lets this file (and, in T4, the daemon) exercise the matcher without a `KeyboardEvent`.
import { expect, test } from "bun:test";
import {
  type KeyBinding,
  type KeyFacts,
  keycap,
  matchBinding,
} from "../../src/action-registry/index.ts";

/** A press. Every flag is FILLED, never left off — a real `KeyboardEvent` always carries
 *  all four as booleans, and `KeyFacts` is built from one, so a fixture that omits them
 *  would be testing a shape the dispatcher cannot produce. */
const at = (key: string, mods: Partial<KeyFacts> = {}): KeyFacts => ({
  key,
  mod: false,
  shift: false,
  alt: false,
  ...mods,
});

const CHORD: KeyBinding = { kind: "chord", key: "s" };
const CHORD_SHIFT: KeyBinding = { kind: "chord", key: "s", shift: true };
const BARE: KeyBinding = { kind: "bare", key: "g" };
const SHIFTED: KeyBinding = { kind: "shifted", key: "b" };
const CHAR: KeyBinding = { kind: "char", char: "?" };
const NAMED: KeyBinding = {
  kind: "named",
  keys: ["Backspace", "Delete"],
};

/** Each kind beside a press that DOES run it — the five happy paths, so the exclusion case
 *  below can take each one and add ⌥ to it rather than guessing at a shape. */
const HITS: readonly (readonly [KeyBinding, KeyFacts])[] = [
  [CHORD, at("s", { mod: true })],
  [CHORD_SHIFT, at("s", { mod: true, shift: true })],
  [BARE, at("g")],
  [SHIFTED, at("b", { shift: true })],
  [CHAR, at("?", { shift: true })],
  [NAMED, at("Backspace")],
];

test("every kind's happy path runs — the fixtures below are real hits", () => {
  for (const [binding, facts] of HITS)
    expect({ kind: binding.kind, key: facts.key, match: true }).toEqual({
      kind: binding.kind,
      key: facts.key,
      match: matchBinding(binding, facts),
    });
});

test("⌥ classifies NOTHING — the exclusion is uniform across all five kinds", () => {
  // It is the viewport's eyedropper modifier and on macOS it rewrites `e.key` anyway. The
  // six matchers this replaces each spelled `!e.altKey` themselves; the predicate states it
  // once, so this case is what holds the five kinds to the same answer. Each press here is
  // a PROVEN hit above with ⌥ added, so a false is the modifier's doing and nothing else.
  for (const [binding, facts] of HITS)
    expect({
      kind: binding.kind,
      key: facts.key,
      match: matchBinding(binding, { ...facts, alt: true }),
    }).toEqual({ kind: binding.kind, key: facts.key, match: false });
});

test("a chord takes ⌘ or ⌃ — one fact, which is what makes ⌃K a live fallback", () => {
  // `mod` is `metaKey || ctrlKey` at the dispatcher, so the binding cannot tell them apart
  // and does not want to: the charter's ⌘K fallback is a documentation change, not a code
  // one.
  expect(matchBinding(CHORD, at("s", { mod: true }))).toBe(true);
  expect(matchBinding(CHORD, at("s"))).toBe(false);
});

test("a chord STATES ⇧ — ⌘S and ⇧⌘S are two bindings, and neither answers the other", () => {
  // Two shift policies in one table is how ⇧⌘S came to do nothing at all — unclaimed, so
  // unprevented, so the browser's Save-Page dialog. Absent `shift` means ⇧ must be UP.
  expect(matchBinding(CHORD, at("s", { mod: true, shift: true }))).toBe(false);
  expect(matchBinding(CHORD_SHIFT, at("s", { mod: true, shift: true }))).toBe(
    true,
  );
  expect(matchBinding(CHORD_SHIFT, at("s", { mod: true }))).toBe(false);
});

test("case is folded on BOTH sides — a CapsLocked keyboard runs the same action", () => {
  expect(matchBinding(CHORD, at("S", { mod: true }))).toBe(true);
  expect(matchBinding(BARE, at("G"))).toBe(true);
  expect(matchBinding(SHIFTED, at("B", { shift: true }))).toBe(true);
  // The binding's own side is folded too, so a row written with a stray capital is a
  // harmless slip rather than a binding that is declared, capped, documented — and dead.
  expect(matchBinding({ kind: "bare", key: "G" }, at("g"))).toBe(true);
});

test("a bare key wants NO modifier at all; a shifted one wants exactly ⇧", () => {
  expect(matchBinding(BARE, at("g"))).toBe(true);
  expect(matchBinding(BARE, at("g", { shift: true }))).toBe(false);
  expect(matchBinding(BARE, at("g", { mod: true }))).toBe(false);
  expect(matchBinding(SHIFTED, at("b", { shift: true }))).toBe(true);
  expect(matchBinding(SHIFTED, at("b"))).toBe(false);
  expect(matchBinding(SHIFTED, at("b", { mod: true, shift: true }))).toBe(
    false,
  );
});

test("`?` is matched by the CHARACTER — ⇧ is the layout's business, either way", () => {
  // ⇧/ on a US layout, ⇧ß on a German one, ⇧, on a French one. Pinning `shift: true` would
  // kill this key on any layout that puts `?` unshifted; pinning `false` would kill it on
  // the one this editor is developed against. So it states neither.
  for (const shift of [true, false])
    expect({ shift, match: matchBinding(CHAR, at("?", { shift })) }).toEqual({
      shift,
      match: true,
    });
  // Not a chord in disguise, and not case-folded (punctuation has no case).
  expect(matchBinding(CHAR, at("?", { mod: true }))).toBe(false);
  // AltGr is the documented cost: Windows reports it as ctrl+alt, which both exclusions
  // refuse. Asserted so the backlog entry describes something real.
  expect(matchBinding(CHAR, at("?", { mod: true, alt: true }))).toBe(false);
});

test("a named key answers to any name in its list, verbatim", () => {
  expect(matchBinding(NAMED, at("Backspace"))).toBe(true);
  expect(matchBinding(NAMED, at("Delete"))).toBe(true);
  expect(matchBinding(NAMED, at("Enter"))).toBe(false);
  expect(matchBinding(NAMED, at("Backspace", { mod: true }))).toBe(false);
  // Verbatim, not folded: `Escape`.toLowerCase() is not a key any keyboard reports.
  expect(matchBinding(NAMED, at("backspace"))).toBe(false);
});

test("a named key does not read ⇧ — the same verb answers either way", () => {
  // The unit half of the 2026-08-07 product decision: named keys briefly carried a
  // required per-binding ShiftPolicy to preserve a source disagreement (⇧⌫ refused,
  // ⇧⏎/⇧Esc accepted, neither side saying why). The user unified on acceptance —
  // ⇧⌫ deletes — and the field died with the disagreement. The keys.ts header holds
  // the history; the descriptor half is pinned in descriptors.test.ts in keycaps.
  const enter: KeyBinding = { kind: "named", keys: ["Enter"] };
  expect(matchBinding(NAMED, at("Backspace", { shift: true }))).toBe(true);
  expect(matchBinding(NAMED, at("Backspace"))).toBe(true);
  expect(matchBinding(enter, at("Enter", { shift: true }))).toBe(true);
  expect(matchBinding(enter, at("Enter"))).toBe(true);
});

test("the keycap is DERIVED from the binding, in the editor's own vocabulary", () => {
  // ⇧ leads ⌘ because that is how the 22 caps standing today are written;
  // `descriptors.test.ts` proves this function reproduces all 22 of them.
  expect(keycap(CHORD)).toBe("⌘S");
  expect(keycap(CHORD_SHIFT)).toBe("⇧⌘S");
  expect(keycap(BARE)).toBe("G");
  expect(keycap(SHIFTED)).toBe("⇧B");
  expect(keycap(CHAR)).toBe("?");
  // A named binding caps by its FIRST key: ⌫ and ⌦ are one verb, and the cap names the one
  // a user reaches for.
  expect(keycap(NAMED)).toBe("⌫");
  expect(keycap({ kind: "named", keys: ["Enter"] })).toBe("⏎");
  expect(keycap({ kind: "named", keys: ["Escape"] })).toBe("Esc");
  // A name with no cap of its own falls through to itself — what a future Tab or Home wants.
  expect(keycap({ kind: "named", keys: ["Home"] })).toBe("Home");
});
