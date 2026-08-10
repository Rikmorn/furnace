// What the viewport CURSOR says the next press will do — D-F4.5-8's per-family
// cursor glyph, the third of its four arming channels (the rail's pressed state,
// the strip's naming and the status keymap are the others).
//
// Two decisions, two media, one question: the CSS keyword under the pointer
// ({@link viewportCursor}) and the world-space mark drawn at the point it
// resolves to ({@link cursorAffordance}). They live together because they have to
// agree — a crosshair over a gesture that draws nothing, or a mark under a cursor
// that says something else, is the same lie told twice.
//
// Pure and GPU-free, for the reason every other pure module here exists: a
// decision table inside the frame path can only be asserted through a live GPU
// context, and these two are exactly the kind that go quietly wrong. The host
// owns the drawing (`cursorAffordanceBatch`) and the DOM write (`syncCursor`);
// the geometry the marks are made of stays in `field-ghost.ts`.
//
// `ViewportGesture` is a TYPE-ONLY import from `field-host.ts` — erased at build,
// so it adds no runtime edge back to the host. Re-spelling the union locally is
// the alternative, and a second vocabulary for one armed slot is how the two
// would come to disagree.
import type { ViewportGesture } from "./field-host.ts";

/** The CSS `cursor` keywords the viewport uses. */
export type ViewportCursor =
  | "default"
  | "crosshair"
  | "cell"
  | "grab"
  | "grabbing";

/** What LMB is about to do, as a cursor.
 *
 *  A live entity move wins over every arm, because during one the pointer is
 *  doing exactly one thing: `grabbing` while a button holds it, `grab` for a `G`
 *  grab, where the ghost follows a cursor with no button held at all.
 *
 *  Then the three arming answers:
 *  - `cell` — the two-click gestures (box, segment, and a pending stamp's region).
 *    Distinct from `crosshair` on purpose: these SPAN something between two
 *    points rather than committing at one, and the box/region mark is a cross,
 *    which would otherwise sit under a crosshair and read as cursor decoration.
 *  - `default` — `pointer`, which selects and drags rather than marking a point;
 *    and anything the session has SUSPENDED, below.
 *  - `crosshair` — the brush and the one-click flood modes: they commit AT a
 *    point.
 *
 *  A live session takes the brush cursors back to `default`, because a session
 *  SUSPENDS the two arms that write to the field (the stroke and `segment` — see
 *  `suspendedByStamp`) and a crosshair over a click that will be swallowed is the
 *  same false promise the brush ghost is hidden to avoid. `pointer` and the flood
 *  modes are genuinely live during a session and keep their own answers. This is
 *  the COMMON path, not an edge: a stamp is picked from wherever the user already
 *  was, so whatever was armed is still armed underneath the session. */
export const viewportCursor = (s: {
  /** `drag` = a button is holding the move, `grab` = a free-hand `G` grab, `null` =
   *  no move in flight. */
  move: "drag" | "grab" | null;
  pendingStamp: boolean;
  /** A stamp/reconfigure/move session is live. */
  session: boolean;
  gesture: ViewportGesture | null;
}): ViewportCursor => {
  if (s.move !== null) return s.move === "drag" ? "grabbing" : "grab";
  if (s.pendingStamp) return "cell";
  // The two arms a session swallows. Checked before the arms themselves, so the
  // cursor stops promising a click the host is going to drop.
  if (s.session && (s.gesture === null || s.gesture === "segment"))
    return "default";
  if (s.gesture === "box" || s.gesture === "segment") return "cell";
  return s.gesture === "pointer" ? "default" : "crosshair";
};

/** What a two-click gesture draws at the cursor BEFORE its first click (f2b item
 *  10 / D-F4.5-7's "armed-but-unanchored always shows a cursor affordance").
 *
 *  - `ring` — the segment brush alone. Its sweep is `digRadius` thick, so the
 *    brush ring IS the width of what the first click starts: the radius is a fact
 *    about the gesture, not a leftover from the brush.
 *  - `cross` — the box corner and the pending stamp's region corner. Neither has
 *    a radius, so a radius-sized ring there would advertise a brush width that
 *    decides nothing about what the click does. The cross is a preview of the
 *    ANCHOR MARK itself (`crossSegments`), which is the only thing that is true
 *    before the click lands.
 *  - `null` — everything else. An ANCHORED gesture has its own live preview (the
 *    amber region box, the capsule), `pointer` has the pick, the brush has its
 *    sphere ghost, and a one-click flood has no pending state to preview at all.
 *
 *  A pending stamp SHADOWS whatever gesture is armed underneath it (the host
 *  routes LMB to region-draw first), so it decides before `gesture` does. */
export type CursorAffordance = "ring" | "cross" | null;
export const cursorAffordance = (s: {
  gesture: ViewportGesture | null;
  pendingStamp: boolean;
  anchored: boolean;
}): CursorAffordance => {
  if (s.anchored) return null;
  if (s.pendingStamp) return "cross";
  if (s.gesture === "segment") return "ring";
  if (s.gesture === "box") return "cross";
  return null;
};
