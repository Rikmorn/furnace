// What the keys do RIGHT NOW — the status bar's keymap line, decided here and rendered
// there. The line's WORDS and its one bit of tone, because both follow from the same
// branch and splitting them is how they came to disagree (see `Keymap`).
//
// Its own module because it is PURE: no React, no JSX, no context, no host handle. The
// evidence that it wanted one is that `armedKeymap` was already exported solely so
// `shell.test.tsx` could import it — a function whose only non-local consumer is its own
// test is a function that has outgrown the component it sits in. `StatusBar.tsx` was
// past 620 lines with four unrelated clusters in it (`clean-code.md`'s ~400-line signal).
// The segment-length HUD (D-25) landed here rather than there for exactly that reason:
// it is another decision about what the line SAYS, and the renderer is left holding only
// the class name that says it.
//
// Type-imports only from the viewport host (erased) — the project-first invariant.
import type {
  FieldTool,
  PendingStamp,
  SegmentHud,
  StampSession,
  ViewportGesture,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { SESSION_VERBS, sessionStateTag } from "../../lib/field-session.ts";

/** Everything the status bar needs about what is armed. ONE options object rather than
 *  five positional nullables (`clean-code.md` calls >4 a smell, and four of the five read
 *  as bare `null`s at a call site): the fields are one cohesive question — what is the
 *  editor armed to do right now — which is the shape that rule blesses. */
export type ArmedState = {
  tool: FieldTool;
  gesture: ViewportGesture | null;
  session: StampSession | null;
  pendingStamp: PendingStamp | null;
  segment: SegmentHud | null;
};

/** The keymap line plus whether it is describing something the next click will REFUSE.
 *
 *  The tone rides WITH the text, and that pairing is the whole point of the type: the
 *  branch cascade below is the only thing that knows which state the line is about, and a
 *  renderer that re-derived "is this over the cap?" from `segment` alone would tone lines
 *  the segment is not even the subject of. That was live — a session opening over a
 *  pending point (`startStamp`'s selection-first branch keeps the anchor) painted
 *  "⏎ commit · Esc discard" as a refusal. Decided once, here, where the branch is. */
export type Keymap = { text: string; overCap: boolean };

/** A line with nothing to warn about — every branch but the segment's. */
const plain = (text: string): Keymap => ({ text, overCap: false });

/** One line per armed state — what the keys do RIGHT NOW. It answers the question a modal
 *  editor makes people ask constantly ("what does clicking do in this mode?") at the
 *  moment they ask it, which the static line it replaces could not.
 *
 *  Enumerated here rather than derived from the action table, and deliberately so: the
 *  registry knows what a key RUNS, not which four of two dozen bindings matter in a given
 *  mode — and the canvas-owned keys (`[`/`]`, ⇧, ⌃, the arrows) are half of what belongs
 *  on this line and are not in the table at all.
 *
 *  Keycaps are written the way the rest of the editor writes them — ⌘ ⇧ ⌃ ⌥ ⏎ ⌫ and
 *  `Esc`, matching the overlay and the menu. Two spellings of one key is drift that reads
 *  as two different keys, and it is part of how this line's old static clause got away
 *  with naming three keys the host does not bind.
 *
 *  ORDER IS THE CONTRACT: a session shadows a pending stamp, which shadows the gesture.
 *  Because the tone leaves with the text, that order now decides both — nothing
 *  downstream re-answers "which state is this?" and gets a different answer.
 *
 *  Tested DIRECTLY rather than through the DOM: these strings ARE the claim, and rendering
 *  them first would be asserting the same thing twice. */
export function armedKeymap({
  tool,
  gesture,
  session,
  pendingStamp,
  segment,
}: ArmedState): Keymap {
  // A live session owns the interaction — the family keys refuse while it stands, so
  // what is left to say is how it ENDS. The two end verbs come from `SESSION_VERBS`,
  // the one table the card and the session strip also read: a user working a stamp has
  // all three surfaces on screen at once, and this line used to re-derive the pair from
  // `moving` alone, which collapsed STAMP into RECONFIGURE. What stays a branch here is
  // the STEERING half, which genuinely differs — a move is dragged, everything else is
  // nudged — and that is a fact about `moving`, not about the state tag.
  if (session !== null) {
    const verbs = SESSION_VERBS[sessionStateTag(session)];
    const steer = session.moving === true ? "drag ghost move" : "← → ↑ ↓ nudge";
    return plain(
      `${steer} · R rotate ¼ · ⏎ ${verbs.primary} · Esc ${verbs.secondary}`,
    );
  }
  // A pending stamp SHADOWS the armed gesture: LMB is drawing that stamp's region,
  // whatever the gesture slot still says underneath (usually `pointer`, the arm most
  // stamps are picked from). It is checked before `gesture` for exactly that reason —
  // and it NAMES the generator, because "a region" alone leaves the user to remember
  // which stamp they pressed.
  //
  // "click ×2", NOT "drag": the mechanism is the box gesture's, and it takes two
  // separate presses — `onPointerUp` has no region branch at all, so a press-drag-
  // release anchors at the PRESS and throws the release away, making the user's next
  // click anywhere corner two. The box line three cases below says "click ×2" for the
  // same mechanism; one mechanism with two verbs on one status line, with the wrong
  // verb on the flow D-F4.5-7 exists to make discoverable, is worse than either.
  if (pendingStamp !== null)
    return plain(
      `click ×2 to span a region for ${pendingStamp.name} · Esc cancels`,
    );
  if (gesture === "pointer")
    return plain("LMB select · G grab · F frame · ⌫ delete");
  if (gesture === "box") return plain("click ×2 spans a region · Esc clears");
  if (gesture === "material")
    return plain("LMB floods the clicked material · Esc clears");
  if (gesture === "void") return plain("LMB floods an air pocket · Esc clears");
  if (gesture === "segment") return segmentLine(segment);
  // The brush itself, with the armed effect NAMED: it is what LMB is about to do, and
  // the four read very differently. Joined from parts rather than interpolated, so an
  // effect with no live modifiers ends at the radius instead of a dangling separator.
  return plain(
    [`LMB ${tool.effect}`, "[ ] radius", ...modifierParts(tool.effect)].join(
      " · ",
    ),
  );
}

/** The Segment line, in its two states (D-25).
 *
 *  With no point down it is the ordinary "what do the keys do" line. With one down it
 *  becomes a READOUT — the length the pending capsule has reached against the cap the
 *  second click is measured by — because that is the one fact the gesture cannot show on
 *  its own: the wireframe in the viewport draws the shape and says nothing about how
 *  long it is, and until now the cap arrived only afterwards, as a refusal for a click
 *  already spent.
 *
 *  Both numbers, not just the length: "42.5 m" alone leaves the reader to remember what
 *  it is being compared with, and the pair is what makes the over-cap state legible
 *  WITHOUT its colour (`61.0 m / 60 m` says it plainly), which is what keeps the tone in
 *  `KeymapLine` reinforcement rather than the only channel carrying it.
 *
 *  One decimal, which is what the host's own refusal prints (`segmentClick` formats the
 *  same measurement with `toFixed(1)`): the number a user watched climb here is the
 *  number quoted back at them if they push past it, and two roundings of one measurement
 *  is how those would come to disagree at the boundary.
 *
 *  `[ ] radius` survives into the pending state because the keys DO — `applyRadius`
 *  re-fattens a pending capsule, so dropping the clause would name a live key nowhere at
 *  the one moment it is most useful, which is this module's whole complaint about the
 *  static line it replaced. `click ×2` does not survive: with a point down only one
 *  click is left.
 *
 *  The ONE branch that can set `overCap`, and the only place that predicate is spelled.
 *  Strictly `>`, matching the host's own refusal (`len > MAX_SEGMENT_M`): a segment of
 *  exactly the cap COMMITS, so `>=` here would paint a legal click as a doomed one. */
function segmentLine(segment: SegmentHud | null): Keymap {
  if (segment === null)
    return plain(
      "click ×2 sweeps the brush · [ ] radius · Esc drops the point",
    );
  const { lenM, capM } = segment;
  return {
    text: `segment · ${lenM.toFixed(1)} m / ${capM} m · [ ] radius · Esc drops the point`,
    overCap: lenM > capM,
  };
}

/** Which momentary/sticky overrides are LIVE under `effect`, derived rather than stated.
 *
 *  A static clause was wrong three ways at once, and none of them was catchable by a test
 *  that pinned the string: `deriveMomentary` swaps dig↔fill SYMMETRICALLY, so under fill
 *  ⌃ gives *dig*, not fill; under paint and smooth ⌃ passes through entirely and
 *  `tool.swapEffect` is disabled, so both "⌃ fill" and "X swap" named dead keys; and
 *  "⇧ smooth" under smooth names a no-op. Verified against `field-host.ts`'s
 *  `deriveMomentary` and the registry's own `enabled`. */
function modifierParts(effect: FieldTool["effect"]): string[] {
  const parts: string[] = [];
  // ⇧ derives smooth from whatever is armed — nothing to say when it already is.
  if (effect !== "smooth") parts.push("⇧ smooth");
  // ⌃ is the momentary half of the swap `X` makes sticky, and both are live only on the
  // two carving effects. The swap is SYMMETRIC, so each names what it would give.
  if (effect === "dig") parts.push("⌃ fill", "X swap");
  if (effect === "fill") parts.push("⌃ dig", "X swap");
  return parts;
}
