// The segment brush: the two-click swept-capsule gesture (D-F3-14), the two
// overlays it draws and the status-bar readout it publishes (D-25) — the first
// cluster lifted OUT of the `createFieldHost` closure whole rather than
// discovered to be pure and moved.
//
// It is this cluster rather than another because of what the closure map
// (`docs/reference/field-host-clusters.md` §6) measured: six state bindings and
// six functions, eight edges crossing the cluster line, and exactly ONE mutation
// among them — the once-per-commit re-arm of the tool's mask-drop report.
// Nothing outside reassigns any of this state, so the whole of it can leave
// without cutting a state machine in half, which is the test the stamp session
// fails (§7.5).
//
// STATEFUL, and that is what makes it different from the pure siblings
// (`field-ghost`, `field-move`, `field-camera`, `field-history`): those are
// arithmetic the host calls, and they were extractable because they remember
// nothing. This is the gesture's own memory — where the first click landed, what
// the second would sweep, and how recently the readout was pushed. A factory
// returning an object, on `createFlagStore`'s precedent, because a set of free
// functions would have to be handed that memory on every call.
//
// EVERY CROSS-CLUSTER DEPENDENCY ARRIVES IN {@link SegmentDeps}, and the
// reassignable ones arrive as FUNCTIONS rather than as values. That is the whole
// discipline of the boundary: `digRadius` is a `let` the rail's slider, the wheel
// and `[` / `]` all move, and `maskDropReported` is a `let` this module has to
// clear. Either one passed by value would give this module a private copy the
// host's own writes never reach — a fork nothing would fail on, because both
// halves would go on holding a perfectly plausible number. The three constants
// travel by value for the mirror-image reason: nothing can move them.
import type { BrushShape } from "@furnace/core/field";
import {
  crossSegments,
  GHOST_COLOR,
  segmentGhostSegments,
} from "./field-ghost.ts";
// TYPE-ONLY, so it is erased and there is no import cycle at runtime. The payload
// type stays with the rest of the host's public surface because its own TSDoc
// links into `FieldHost`, and a type that named its consumer from across the
// directory would be a link this side could not resolve.
import type { SegmentHud } from "./field-host.ts";
import { createRung, type InputRouter } from "./input-router.ts";
import { segmentsToBatch } from "./reference-grid.ts";
import { createViewChannel } from "./view-channel.ts";

type Vec3T = [number, number, number];

/** A prebuilt drawLines batch (vertices + per-vertex colors). */
type LineBatch = { vertices: Float32Array; colors: Float32Array };

/** How long a segment between these two world points is (m).
 *
 *  ONE function for the two readers rather than two spellings of Pythagoras, and the
 *  reason is that they must agree exactly: `segmentClick` measures the pair to decide
 *  whether to REFUSE it, and the HUD measures the pending pair to say whether it is
 *  about to be refused. A readout that computed the length even slightly differently
 *  would show a number inside the cap for a click the very next line rejects. */
const segmentLength = (a: Vec3T, b: Vec3T): number =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** What the segment brush needs from the rest of the host.
 *
 *  The split between the numbers and the functions is not stylistic. A value read
 *  once at construction is correct only for state that cannot move afterwards, so
 *  the three constants — all `const` in the host — ride as numbers, and everything
 *  the host reassigns or that this module has to write back rides as a call. */
export type SegmentDeps = {
  /** The host's `STROKE_MIN_MS`: how often the pending segment's length is allowed
   *  to reach the chrome. Shared with the brush stroke's own throttle deliberately
   *  — a readout refreshing on a different cadence from the brush it describes
   *  would be a second number to reason about. */
  strokeMinMs: number;
  /** The host's `ANCHOR_CROSS_HALF_M`: half-length of each axis stroke in the
   *  anchor cross (m). Shared with the box-select anchor, which is why it stays in
   *  the host rather than travelling with this cluster. */
  anchorCrossHalfM: number;
  /** The host's `MAX_SEGMENT_M`: the longest capsule this gesture will sweep (m).
   *  It stays in the host because it is derived there — twice the dig range, which
   *  is the geometry of two clicks from one camera (see its own TSDoc). */
  maxSegmentM: number;
  /** The LIVE brush radius. A function, not a number, because the host's
   *  `digRadius` is a `let` that the panel slider, the wheel and `[` / `]` all
   *  move through `applyRadius`; a snapshot taken here would fatten the preview
   *  capsule to a radius the committed op no longer uses. */
  digRadius(): number;
  /** The surface point under a client-space pixel — `field-targeting.ts`'s
   *  `selectionPoint`, reached through the host, i.e. the RAW raycast hit and not
   *  `computeTarget`'s bitten-past centre. Null when the ray resolves nothing. */
  selectionPoint(clientX: number, clientY: number): Vec3T | null;
  /** Report a refusal to the user (console + the panel subscriber). One caller
   *  here: the length cap. */
  reportToolError(msg: string): void;
  /** Apply one brush op through the ordinary log path, so a segment is one ⌘Z
   *  exactly like a stroke. */
  commitToolOp(shape: BrushShape): void;
  /** Re-arm the host's once-per-stroke mask-drop report.
   *
   *  THE cluster's one boundary MUTATION (`tool.maskDropReported`), and the reason
   *  it is a call rather than a flag handed over: the host owns that `let`, a
   *  pointer-down re-arms it too, and a copy living here would go on suppressing
   *  reports the host had already re-armed for. */
  armMaskDropReport(): void;
  /** The host's Esc capture stack. THE OBJECT, not a pair of capture/release
   *  callbacks, and that is the shape on purpose: this cluster owns a piece of
   *  cancellable state, so it owns the acquire/release pair over it too, and a
   *  bespoke callback pair would be a second spelling of a seam every extracted
   *  cluster gets handed anyway.
   *
   *  This TSDoc used to predict that the T3c gesture machine would "hand every
   *  extracted cluster" such a seam. T3c did not: it takes this same `router`
   *  object, for these same reasons. What DID arrive is the rung mechanism —
   *  {@link createRung} in `input-router.ts` — which this module now uses instead
   *  of the handle slot it used to hand-roll, so no rung in this directory can
   *  drift from another on when it acquires. The seam is the router; the shared
   *  part is the discipline over it. */
  router: InputRouter;
};

/** The segment gesture's live state and the six functions over it.
 *
 *  The three readers exist because the host still draws and routes: `renderScene`
 *  needs both batches, and `renderCursorAffordance` and the pointer-move branch
 *  need to know whether a point is down. They are calls rather than fields for the
 *  same reason {@link SegmentDeps.digRadius} is: the values move. */
export type SegmentBrush = {
  /** The pending segment start (null = none). */
  anchor(): Vec3T | null;
  /** The anchor's hologram-blue cross, or null with no anchor. */
  anchorBatch(): LineBatch | null;
  /** The capsule the second click would commit, or null until the cursor has
   *  resolved a far end once. */
  previewBatch(): LineBatch | null;
  /** Arm or drop the anchor. */
  setAnchor(p: Vec3T | null): void;
  /** Re-fatten the pending capsule from the LIVE radius, with no raycast. */
  rebuildPreview(): void;
  /** Track the cursor while an anchor is pending. */
  updatePreview(clientX: number, clientY: number): void;
  /** One LMB click while the segment brush is armed. */
  click(clientX: number, clientY: number): void;
  /** The HUD seam behind `FieldHost.subscribeSegmentHud` — multicast, with the
   *  current readout pushed to each arriving subscriber and an unsubscribe that
   *  removes only its own. */
  subscribeHud(cb: (hud: SegmentHud | null) => void): () => void;
};

/** Build the segment brush over one host's dependencies. One per host; it holds
 *  the gesture's state for that host's lifetime. */
export function createSegmentBrush(deps: SegmentDeps): SegmentBrush {
  // Pending SEGMENT anchor: the first click's world point (null = none). Its
  // own slot rather than a shared one — the two gestures are mutually
  // exclusive through `gesture`, but a shared anchor would silently survive a
  // box→segment switch as a segment start the user never clicked.
  let segmentAnchor: Vec3T | null = null;
  // The segment brush's two overlays, both hologram-blue and both under the
  // GHOST layer (a pending capsule is a preview of a brush op, not a selection):
  // the anchor cross, and the capsule wireframe the second click would commit —
  // rebuilt on pointer MOVE, never per frame, like boxPreviewBatch.
  let segmentAnchorBatch: LineBatch | null = null;
  let segmentPreviewBatch: LineBatch | null = null;
  // The segment preview's far endpoint — the last cursor point that resolved to
  // a surface while an anchor was pending. Kept beside the batch so a RADIUS
  // change can re-fatten the capsule without a fresh raycast (the raycast is
  // what makes updateSegmentPreview a pointer-MOVE job; the batch itself is
  // cheap). Cleared with the anchor.
  let segmentPreviewEnd: Vec3T | null = null;
  // The anchor's entry on the host's Esc stack, held for exactly as long as the
  // anchor is (old ladder rung 1). The slot lives inside `createRung` — it is
  // what makes a re-arm keep its position and a double clear a no-op — and this
  // module stopped hand-rolling its own at foundations T3c, where extracting the
  // session machine moved the rung mechanism into `input-router.ts` beside the
  // stack it captures on. The two branches below used to spell the acquire and
  // the release separately; one reconcile after the write says the same thing and
  // cannot disagree with the rungs in `field-host.ts` and `field-machine.ts`
  // about WHEN it acquires.
  const syncAnchorCapture = createRung(
    deps.router,
    "segment anchor",
    () => segmentAnchor !== null,
    () => setSegmentAnchor(null),
  );
  // The HUD's multicast seam. The snapshot is the (re)mount rule this seam has
  // always carried: a status bar arriving mid-gesture must not read blank
  // beside a capsule the viewport is plainly drawing.
  const segmentHudChannel = createViewChannel<[SegmentHud | null]>({
    snapshot: () => [segmentHudPayload()],
  });
  // The segment HUD's own throttle clock, NOT `lastStroke`'s (D-25). Both admit one
  // event per STROKE_MIN_MS and that CONSTANT is shared deliberately — a readout that
  // refreshed on a different cadence from the brush it describes would be a second
  // number to reason about.
  //
  // The VARIABLE is separate because the two paths are: the segment branch in
  // `field-machine.ts`'s `pointerMove` returns above the stroke throttle and so never
  // touches that module's `lastStroke` (both the throttle and the flag below moved
  // there with the pointer chain in T3c — neither is in `field-host.ts` any more).
  // Keeping them apart is HYGIENE rather than a fix for a live bug, and the honest size
  // of it is small — a stroke and a segment cannot be live at once (`pointerDown`
  // routes `gesture !== null` to the gesture branch and never sets `digging`), so
  // sharing the slot would cost at most one dropped brush application, and only if the
  // user disarmed the gesture, pressed LMB and moved within one 40 ms window of the last
  // HUD push — a couple of frames, with the lost application a few px from the
  // pointerdown one that already landed. Cheap to prevent, so prevented.
  let lastSegmentHud = 0;

  // The chrome's mirror of the pending segment (D-25). Measured between the SAME two
  // endpoints the preview capsule is swept between, so the number on the status bar and
  // the wireframe in the viewport can never describe different segments.
  //
  // With no far end resolved the only point the host has is the anchor, so the honest
  // length is 0 rather than nothing — which is what makes the anchoring click's own push
  // meaningful. Two ways to be in that state, and 0 is right for both: the cursor has
  // not moved since the click, or it has moved and resolved no surface (`if (!p) return`
  // in `updateSegmentPreview`, which deliberately leaves the last preview standing).
  const segmentHudPayload = (): SegmentHud | null => {
    if (segmentAnchor === null) return null;
    const lenM =
      segmentPreviewEnd === null
        ? 0
        : segmentLength(segmentAnchor, segmentPreviewEnd);
    return { lenM, capM: deps.maxSegmentM };
  };

  // ONE readout per publish, shared by every subscriber — a pushed value is
  // immutable by contract, which this one is by construction (two numbers).
  const publishSegmentHud = (): void => {
    segmentHudChannel.publish(segmentHudPayload());
  };

  // The HUD's pointer-rate half, on the stroke cadence. Throttled because it crosses
  // into React: an unthrottled push re-renders the status bar once per pointermove,
  // which is the cost the whole cadence split in `useFieldHostState` exists to avoid.
  //
  // Called only from the RESOLVED-point path in `updateSegmentPreview`, deliberately:
  // a cursor that hits nothing leaves the preview capsule standing, so publishing
  // there would spend the window's one push on a length that did not change and stale
  // the next real move by up to STROKE_MIN_MS. The edge pushes in `setSegmentAnchor`
  // are what guarantee the readout is never left WRONG — this only decides how often
  // a live one refreshes.
  const publishSegmentHudThrottled = (): void => {
    const now = performance.now();
    if (now - lastSegmentHud < deps.strokeMinMs) return;
    lastSegmentHud = now;
    publishSegmentHud();
  };

  // The pending segment start (null = none), plus its hologram-blue cross. The
  // preview capsule dies with the anchor: without a start point there is no
  // second endpoint to sweep to.
  //
  // THE edge for the HUD, and the reason the push lives here rather than at the call
  // sites: every path that arms or drops an anchor goes through this one function (six
  // today — the anchoring click, the committing one, Esc, `resetWorld`, `setGesture`
  // and a stamp arm), so a chrome readout left standing over a segment that no longer
  // exists is not reachable rather than merely unobserved.
  //
  // And the same six paths are why the Esc CAPTURE is taken here rather than by the
  // host: this cluster owns the anchor, so it owns the entry that says the anchor is
  // cancellable. The rung is reconciled AFTER the write, in both branches, which is
  // the canonical-setter law every captured state in this directory obeys — an arm
  // over an arm is not reachable today (`segmentClick` only anchors from null) but
  // the rung's own slot is what makes it a no-op if it ever becomes reachable.
  const setSegmentAnchor = (p: Vec3T | null): void => {
    segmentAnchor = p;
    if (p === null) {
      segmentAnchorBatch = null;
      segmentPreviewBatch = null;
      segmentPreviewEnd = null;
      syncAnchorCapture();
      publishSegmentHud();
      return;
    }
    segmentAnchorBatch = segmentsToBatch(
      crossSegments(p, deps.anchorCrossHalfM),
      GHOST_COLOR,
    );
    syncAnchorCapture();
    publishSegmentHud();
  };

  // The capsule the second click would build: same endpoints, same radius as
  // the op. Rebuilt on pointer MOVE while an anchor is pending. A cursor that
  // resolves to no surface point leaves the last preview standing — a
  // transient miss must not flicker the capsule off (updateBoxPreview's rule).
  //
  // This is the WHOLE preview: no worker ghost, no scratch mesh. A brush op is
  // cheap and reversible, and the generator preview protocol exists for
  // recipes whose output cannot be guessed from their inputs — a swept capsule
  // can.
  //
  // The RAYCAST is what makes this a pointer-MOVE job; the batch is cheap. So
  // the resolved endpoint is stored and the batch built from it in
  // `rebuildSegmentPreview` below, which the radius paths call too — a wheel
  // notch or `[` / `]` with a still cursor now re-fattens the pending capsule
  // instead of leaving it at the old radius until the pointer twitches (f2b
  // item 9; the plain sphere ghost, rebuilt per frame, never had that gap).
  //
  // The capsule batch itself comes from the anchor, the last resolved endpoint
  // and the LIVE radius. No raycast, so it is affordable from any path that
  // changes the radius; a no-op until the cursor has resolved a far end once.
  const rebuildSegmentPreview = (): void => {
    if (segmentAnchor === null || segmentPreviewEnd === null) return;
    segmentPreviewBatch = segmentsToBatch(
      segmentGhostSegments(segmentAnchor, segmentPreviewEnd, deps.digRadius()),
      GHOST_COLOR,
    );
  };

  const updateSegmentPreview = (clientX: number, clientY: number): void => {
    if (segmentAnchor === null) return;
    const p = deps.selectionPoint(clientX, clientY);
    if (!p) return;
    segmentPreviewEnd = p;
    rebuildSegmentPreview();
    publishSegmentHudThrottled();
  };

  // One LMB click while the segment brush is armed. First click anchors; the
  // second builds ONE capsule op with the ACTIVE tool's effect/material and
  // commits it through the ordinary log path — so it is one ⌘Z, exactly like a
  // stroke, and needs no undo machinery of its own.
  //
  // The endpoints are selectionPoint's RAW surface hits, not computeTarget's
  // bitten-past centres: a tunnel must start and end where the user clicked
  // (the box-select corner rule, and the same reason).
  const segmentClick = (clientX: number, clientY: number): void => {
    const p = deps.selectionPoint(clientX, clientY);
    if (!p) return;
    if (segmentAnchor === null) {
      setSegmentAnchor(p);
      return;
    }
    // Copy the anchor BEFORE clearing it — setSegmentAnchor nulls the field,
    // and the op is built after.
    const a: Vec3T = [...segmentAnchor];
    // The length cap (MAX_SEGMENT_M), decided BEFORE the anchor is cleared so a
    // refusal leaves the gesture exactly as it was: the pending start stands and
    // the user re-clicks nearer, rather than losing a point they meant to keep.
    const len = segmentLength(a, p);
    if (len > deps.maxSegmentM) {
      deps.reportToolError(
        `segment is ${len.toFixed(1)} m — the cap is ${deps.maxSegmentM} m; click nearer`,
      );
      return;
    }
    setSegmentAnchor(null);
    // Re-arm the once-per-stroke mask-drop report. A stroke re-arms it at
    // pointer-down (a drag is one stroke, many ops); a segment's unit is ONE
    // commit, so without this every segment after the first would drop a
    // selection mask SILENTLY.
    deps.armMaskDropReport();
    deps.commitToolOp({ kind: "capsule", a, b: p, radius: deps.digRadius() });
  };

  return {
    anchor: () => segmentAnchor,
    anchorBatch: () => segmentAnchorBatch,
    previewBatch: () => segmentPreviewBatch,
    setAnchor: setSegmentAnchor,
    rebuildPreview: rebuildSegmentPreview,
    updatePreview: updateSegmentPreview,
    click: segmentClick,
    // The initial push is the channel's snapshot (the subscribeSelection remount
    // rationale, and here the SAME argument as subscribeCameraPose's: nothing
    // moves this value on its own, so a subscriber that waited for the next
    // pointermove would read blank for as long as the user held still over a
    // segment they had already started).
    subscribeHud: (cb) => segmentHudChannel.subscribe(cb),
  };
}
