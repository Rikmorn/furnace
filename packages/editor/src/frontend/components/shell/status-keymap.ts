// What the keys do RIGHT NOW — the status bar's keymap line, as the HOST's objects reach it.
//
// This module is an ADAPTER since T3b2 Task 5 and nothing else. The words, the precedence
// and the one bit of tone are `shared/action-table.ts`'s: `deriveArmedKeymap` walks
// `STATUS_PRECEDENCE` over row data and returns the line. What is left here is the one thing
// the floor cannot do — reach the host's `StampSession` / `PendingStamp` / `SegmentHud` and
// flatten them into the plain `KeymapInput` a module below `field-host/` is allowed to take.
//
// ─── THE DECISION THIS FILE USED TO CARRY, RETIRED 2026-08-06 ────────────────────────────
// It said, of the branch cascade that stood here:
//
//   "Enumerated here rather than derived from the action table, and deliberately so: the
//    registry knows what a key RUNS, not which four of two dozen bindings matter in a given
//    mode — and the canvas-owned keys (`[`/`]`, ⇧, ⌃, the arrows) are half of what belongs
//    on this line and are not in the table at all."
//
// SUPERSEDED by the full-derivation decision (`docs/reference/editor/tools.md`, "One table
// states a tool fact"). The objection was
// right about the ACTION registry — a binding table really does not know which four bindings
// matter in a mode — and wrong only about whether the table a status line derives from has
// to be that one. The canvas-owned vocabulary went INTO the tool table: a row states its own
// status line, so the line is a fact carried beside the label rather than a projection of
// the bindings. The premise was tested before it was acted on — `deriveArmedKeymap`
// reproduced this file's cascade string for string and tone for tone across every armed
// state, under the derive-and-diff gate, before a single consumer switched.
//
// `ToolRail.tsx` carried the same objection at second hand and retires the same way.
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// THE TRADE, stated rather than left for a reader to discover: for the one question "what
// does the line say under fill?" this is now FIVE hops (here → the precedence → the effect
// row → its modifiers → the separator) where it used to be one linear cascade. What buys it
// back is fourteen greppable golden strings where there were zero, and the other question —
// "what does adding an effect touch?" — going from six files to one row.
//
// Type-imports only from the field host (erased) — the project-first invariant.
import type {
  FieldTool,
  PendingStamp,
  SegmentHud,
  StampSession,
  ViewportGesture,
} from "../../../field-host/index.ts"; // type-only: erased
import type { StatusLine } from "../../../shared/action-table.ts";
import { deriveArmedKeymap } from "../../../shared/action-table.ts";
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
 *  The table's own {@link StatusLine}, re-exported rather than re-declared: `{text,
 *  overCap}` written twice is exactly the shape this slice is deleting, and the two would
 *  have had to agree by review. The tone rides WITH the text, and that pairing is the whole
 *  point of the type — the precedence walk is the only thing that knows which state the line
 *  is about, and a renderer that re-derived "is this over the cap?" from `segment` alone
 *  would tone lines the segment is not even the subject of. That was live: a session opening
 *  over a pending point (`startStamp`'s selection-first branch keeps the anchor) painted
 *  "⏎ commit · Esc discard" as a refusal. */
export type Keymap = StatusLine;

/** The armed state, as the table takes it.
 *
 *  The two session VERBS are resolved HERE and travel as values, which is what keeps
 *  `SESSION_VERBS` the one source for them — the card, the session strip and this line are
 *  all on screen at once while a user works a stamp, and this line used to re-derive the
 *  pair from `moving` alone, which collapsed STAMP into RECONFIGURE. What stays a branch is
 *  the STEERING half, and it stays in the TABLE: a move is dragged and everything else is
 *  nudged, which is a fact about `moving` rather than about the state tag, so the flag
 *  travels and the words do not. */
export function armedKeymap({
  tool,
  gesture,
  session,
  pendingStamp,
  segment,
}: ArmedState): Keymap {
  return deriveArmedKeymap({
    effect: tool.effect,
    gesture,
    session: session === null ? null : sessionInput(session),
    pendingStamp,
    segment,
  });
}

/** The three facts the table needs about a live session. Named rather than spread, so a
 *  third field on `SessionVerbs` has to be routed here deliberately instead of arriving. */
function sessionInput(
  session: StampSession,
): NonNullable<Parameters<typeof deriveArmedKeymap>[0]["session"]> {
  const verbs = SESSION_VERBS[sessionStateTag(session)];
  return {
    moving: session.moving === true,
    primary: verbs.primary,
    secondary: verbs.secondary,
  };
}
