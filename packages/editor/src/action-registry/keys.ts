// A binding as DATA, and the one function that reads it.
//
// WHAT THIS REPLACES. Every keyed action used to carry `match: (e: KeyboardEvent) => boolean`
// — six matcher helpers in `frontend/lib/actions.ts` plus four hand-rolled inline ones. A
// closure over a DOM event is the single reason the action table cannot be held by anything
// but a browser: the daemon can hold a table of rows, and it cannot hold a table of
// functions that dereference `KeyboardEvent`. So the binding becomes a row and the matcher
// becomes one pure predicate over FACTS, and the only place a `KeyboardEvent` is read is the
// window dispatcher that builds those facts.
//
// THE FIVE KINDS ARE THE FIVE SHAPES ALREADY IN USE, not a vocabulary invented for the
// occasion. `actions.ts` carries FIVE helpers under its `// --- matchers ---` heading —
// `mod` (the shared ⌘-or-⌃ predicate) plus `chord`, `bare`, `shifted` and `question` — and
// THREE hand-rolled inline matchers, over ⌫/⌦, ⏎ and Esc. (Counted at head, 2026-08-06. The
// planning digest said "six matcher shapes … plus 4 hand-rolled inline"; it listed five
// under the six, and counted `question` a second time in the four — `match: question` is a
// bare reference to the helper, not a fourth inline matcher.) `chord`/`bare`/`shifted` are
// those helpers, `named` is the three inline ones, and `char` is `question`. Nothing here is expressible
// two ways: a binding is a chord or it is not, and a key is named by its NAME or by the
// CHARACTER it produced, never by both.
//
// The union carries exactly ONE field that is not a shape — `named`'s {@link ShiftPolicy} —
// and it is there because the source it was derived from disagrees with itself: three
// bindings match named keys and two ⇧ policies run across them, neither documented. This
// table PRESERVES both. The declarative form is allowed to force that question and is not
// allowed to answer it; the answer is a product decision, and it is filed
// (`docs/backlog/editor-and-tooling/named-key-bindings-disagree-on-shift.md`).
//
// This module names no DOM type and imports nothing. That is the point of the layer, and
// `tests/action-registry/node-door.test.ts` is what holds it.

/** What a binding requires of ⇧ when it is matched by a key NAME.
 *
 *  Two members, because the source this table was derived from carries two policies:
 *
 *  - `"up"` — ⇧ must NOT be held. `edit.delete`'s matcher spelled `!e.shiftKey`.
 *  - `"any"` — ⇧ is not read at all. `session.confirm`'s and `session.escape`'s did not.
 *
 *  NEITHER SIDE CARRIES A RATIONALE IN THE SOURCE, and foundations T3b2 preserved both
 *  rather than unifying them — deliberately. The declarative table forced the question and
 *  is allowed to force it; it is not allowed to answer it, because "which policy is right"
 *  is a product decision about a destructive key (should ⇧⌫ delete?) and not a consequence
 *  of the type shape. Filed with the three matchers and a trigger at
 *  `docs/backlog/editor-and-tooling/named-key-bindings-disagree-on-shift.md`. If you are
 *  here to tidy this away: read that first, then ask.
 *
 *  REQUIRED, never optional. An omitted policy would default silently to one of the two —
 *  and a silent default on exactly the question two live bindings already disagree about is
 *  how the disagreement got here. Every named binding states its own.
 *
 *  A DISTINCT NAME from `chord`'s `shift`, and the distinction is load-bearing: `chord`'s
 *  field is a boolean that STATES the modifier (absent or `false` = ⇧ up, `true` = ⇧ down),
 *  and it has no don't-care member because ⌘Z and ⇧⌘Z must stay two actions. This one has a
 *  don't-care and no "down". One name for two vocabularies would be a reader's trap. */
export type ShiftPolicy = "up" | "any";

/** One key binding, as data.
 *
 *  ⌥ is excluded by ALL FIVE — it is the viewport's eyedropper modifier and on macOS it
 *  rewrites `e.key` anyway — so the exclusion is stated once in {@link matchBinding} rather
 *  than five times here.
 *
 *  What each kind does about ⇧ is the union's one real axis, and it is not decoration:
 *
 *  - `chord`, `bare` and `shifted` STATE it. That is what makes ⌘Z and ⇧⌘Z two actions
 *    rather than one, and `B` and `⇧B` the arm and the cycle. They also fold case, which is
 *    what makes a CapsLocked keyboard produce the same action.
 *  - `char` cannot state it. The character is what the layout produced, and which modifier
 *    produced it is the layout's business — see the kind's own note.
 *  - `named` CHOOSES, per binding, through {@link ShiftPolicy}. That field is the union's
 *    one concession to a source that disagrees with itself, and it is documented there.
 *
 *  `char` and `named: "any"` reach the same predicate and are still separate kinds, because
 *  the JUSTIFICATION is not the same: `{ kind: "named", keys: ["?"] }` would read as a claim
 *  that `?` is a key name, which is exactly the thing `char` exists to deny. */
export type KeyBinding =
  /** ⌘/⌃ + a key, with ⇧ stated rather than assumed (absent = ⇧ must be UP). */
  | { readonly kind: "chord"; readonly key: string; readonly shift?: boolean }
  /** A plain key with no modifier at all. */
  | { readonly kind: "bare"; readonly key: string }
  /** ⇧ + a key — the family CYCLE half of `B`/`M`/`S`. */
  | { readonly kind: "shifted"; readonly key: string }
  /** The key that PRODUCED this character, however this keyboard makes one.
   *
   *  `?` is the whole membership and the reason the kind exists: it is ⇧/ on a US layout,
   *  ⇧ß on a German one and ⇧, on a French one, and a layout that puts it unshifted is
   *  perfectly possible — so what the user produced is the whole test. No case folding:
   *  punctuation has no case.
   *
   *  NO {@link ShiftPolicy} here, and that is a decision rather than an omission: pinning ⇧
   *  up would kill this key on any layout that puts `?` unshifted, and pinning it down would
   *  kill it on the one this editor is developed against. There is nothing to choose, so
   *  there is no field to choose it with.
   *
   *  AltGr is the one keyboard this cannot reach, and it is a known cost rather than an
   *  oversight: Windows reports AltGr as ctrl+alt, which the `mod` and ⌥ exclusions both
   *  refuse. Filed at
   *  `docs/backlog/editor-and-tooling/chrome-focus-and-dismissal-follow-ons.md`. */
  | { readonly kind: "char"; readonly char: string }
  /** Any one of these NAMED keys, matched verbatim — `Backspace`/`Delete`, `Enter`,
   *  `Escape`. A list rather than a single name because ⌫ and ⌦ are one verb on two
   *  keycaps. Every one states its own {@link ShiftPolicy}; read that note before changing
   *  one.
   *
   *  NON-EMPTY BY TYPE, which is why {@link keycap} can index element 0 without a guard:
   *  tuple position 0 is exempt from `noUncheckedIndexedAccess`. An empty list was
   *  previously a runtime throw at cap time — a binding that is declared, gated and
   *  reachable, failing only when a surface tries to draw it. Now it does not compile. */
  | {
      readonly kind: "named";
      readonly keys: readonly [string, ...string[]];
      readonly shiftPolicy: ShiftPolicy;
    };

/** What a matcher is allowed to know about a keypress — the whole of it.
 *
 *  The dispatcher builds this from the `KeyboardEvent` and nothing else reads one. Four
 *  facts rather than five: the sketch this was built from carried `char` beside `key`, and
 *  they are the same value — `e.key` IS the produced character for a printable press and the
 *  key's NAME otherwise, which is precisely the distinction {@link KeyBinding}'s `char` and
 *  `named` kinds draw. Carrying it twice would be two fields to keep equal forever. */
export type KeyFacts = {
  /** `e.key` — the character produced, or the key's name when it produced none. */
  readonly key: string;
  /** `e.metaKey || e.ctrlKey`: ⌘ on macOS, Ctrl everywhere else. One fact because every
   *  binding in this editor treats them as one — which is what makes ⌃K a live fallback for
   *  ⌘K with no second row anywhere. */
  readonly mod: boolean;
  /** `e.shiftKey`. */
  readonly shift: boolean;
  /** `e.altKey`. */
  readonly alt: boolean;
};

/** Does this press run this binding?
 *
 *  Pure, total, and the ONLY reader of {@link KeyBinding}. ⌥ is refused up front for every
 *  kind: no binding in this editor uses it, so a press that holds it classifies as nothing
 *  and falls through to whoever else wants it.
 *
 *  THREE of the five kinds fold case, and two deliberately do not — so the folding lives in
 *  `sameKey` rather than above the switch, where a shared `folded` would sit in scope of the
 *  two branches that must never touch it. `char` compares raw because punctuation has no
 *  case, and `named` compares raw because `"escape"` is not a key any keyboard reports; both
 *  are pinned by `keys.test.ts`.
 *
 *  Where it does fold, BOTH sides are lowered. A binding's `key` is written lowercase by
 *  convention, and folding only the event's side would leave a stray capital in a row as a
 *  binding that is declared, documented, rendered on a keycap — and dead. Folding both makes
 *  the slip harmless instead of silent. */
export function matchBinding(binding: KeyBinding, facts: KeyFacts): boolean {
  if (facts.alt) return false;
  const sameKey = (key: string) =>
    facts.key.toLowerCase() === key.toLowerCase();
  switch (binding.kind) {
    case "chord":
      return (
        facts.mod &&
        facts.shift === (binding.shift ?? false) &&
        sameKey(binding.key)
      );
    case "bare":
      return !facts.mod && !facts.shift && sameKey(binding.key);
    case "shifted":
      return !facts.mod && facts.shift && sameKey(binding.key);
    case "char":
      return !facts.mod && facts.key === binding.char;
    case "named":
      return (
        !facts.mod &&
        (binding.shiftPolicy === "any" || !facts.shift) &&
        binding.keys.includes(facts.key)
      );
  }
}

/** How a NAMED key is drawn on a keycap. Three entries, one per named binding in the table;
 *  a name with no entry falls through to itself, which is what a future `Tab` or `Home`
 *  would want. */
const NAMED_CAPS: Readonly<Record<string, string>> = {
  Backspace: "⌫",
  Enter: "⏎",
  Escape: "Esc",
};

/** The keycap a surface prints, DERIVED from the binding rather than stated beside it.
 *
 *  Every keyed action used to carry its cap as a second field (`keys: "⇧⌘S"`) next to a
 *  matcher that had to agree with it by review. `tests/keybindings.test.ts` already worried
 *  about that gap in writing — *"a cap edited to `⇧/` would leave every case here green
 *  while the menu advertised a key nothing answers"* — and closed it for exactly one row by
 *  rebuilding the event from the cap. Deriving closes it for all of them: there is one
 *  spelling of a binding, and the cap is a view of it.
 *
 *  Every glyph this emits — ⇧ ⌘ ⏎ ⌫ Esc — and the order it emits them in (⇧ leads ⌘) is
 *  read off the 22 caps standing today, which the gate asserts row for row. ⌘ is printed
 *  for a chord although `mod` accepts ⌃ as well: the ⌃ fallback is live everywhere and
 *  documented nowhere on a keycap, which is a charter decision this function inherits
 *  rather than makes. A `named` binding is capped by its FIRST key: ⌫ and ⌦ are one verb,
 *  and the cap names the one a user reaches for. */
export function keycap(binding: KeyBinding): string {
  switch (binding.kind) {
    case "chord":
      return `${binding.shift === true ? "⇧" : ""}⌘${binding.key.toUpperCase()}`;
    case "bare":
      return binding.key.toUpperCase();
    case "shifted":
      return `⇧${binding.key.toUpperCase()}`;
    case "char":
      return binding.char;
    // No empty-list guard, and none is reachable: `keys` is a non-empty tuple, so index 0
    // types as `string` even under `noUncheckedIndexedAccess`. The throw this replaces
    // failed at CAP time — the last possible moment, on a surface trying to draw a binding
    // that had already been declared and gated.
    case "named":
      return NAMED_CAPS[binding.keys[0]] ?? binding.keys[0];
  }
}
