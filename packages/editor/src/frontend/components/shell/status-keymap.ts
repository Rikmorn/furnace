// What the keys do RIGHT NOW, as a string — the status bar's keymap line, decided here
// and rendered there.
//
// Its own module because it is PURE: no React, no JSX, no context, no host handle. The
// evidence that it wanted one is that `armedKeymap` was already exported solely so
// `shell.test.tsx` could import it — a function whose only non-local consumer is its own
// test is a function that has outgrown the component it sits in. `StatusBar.tsx` was
// past 620 lines with four unrelated clusters in it (`clean-code.md`'s ~400-line signal),
// and the segment-length HUD is still to come.
//
// Type-imports only from the viewport host (erased) — the project-first invariant.
import type {
  FieldTool,
  PendingStamp,
  StampSession,
  ViewportGesture,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { SESSION_VERBS, sessionStateTag } from "../../lib/field-session.ts";

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
 *  Tested DIRECTLY rather than through the DOM: these strings ARE the claim, and rendering
 *  them first would be asserting the same thing twice. */
export function armedKeymap(
  tool: FieldTool,
  gesture: ViewportGesture | null,
  session: StampSession | null,
  pendingStamp: PendingStamp | null,
): string {
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
    return `${steer} · R rotate ¼ · ⏎ ${verbs.primary} · Esc ${verbs.secondary}`;
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
    return `click ×2 to span a region for ${pendingStamp.name} · Esc cancels`;
  if (gesture === "pointer") return "LMB select · G grab · F frame · ⌫ delete";
  if (gesture === "box") return "click ×2 spans a region · Esc clears";
  if (gesture === "material")
    return "LMB floods the clicked material · Esc clears";
  if (gesture === "void") return "LMB floods an air pocket · Esc clears";
  if (gesture === "segment")
    return "click ×2 sweeps the brush · [ ] radius · Esc drops the point";
  // The brush itself, with the armed effect NAMED: it is what LMB is about to do, and
  // the four read very differently. Joined from parts rather than interpolated, so an
  // effect with no live modifiers ends at the radius instead of a dangling separator.
  return [
    `LMB ${tool.effect}`,
    "[ ] radius",
    ...modifierParts(tool.effect),
  ].join(" · ");
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
