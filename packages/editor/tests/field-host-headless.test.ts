// FieldHost surfaces that need NO GPU init (a field-host-load.test.ts
// sibling): startStamp's no-selection ARM and the pending-stamp seam,
// subscribeStamp's initial push, nudgeStamp's no-session no-op, the
// entity-selection seam's validation and release discipline, the void
// cast's pre-context refusals, the camera-pose seam, the segment HUD seam's
// release discipline, and the options `init` builds before it ever touches
// a device.
// Verified against the host source: none of these paths touch the GPU context,
// the render loop, or the lazily-spawned remesh worker — a selection-less
// startStamp returns at the arm BEFORE any session/preview work, nudgeStamp
// returns at its own session guard BEFORE nudgeRegion/previewStamp, and
// selectEntity only scans the op log. Everything DOWNSTREAM of a click is not
// here: it resolves through `cursorRay`, and there is no camera until `init`
// has a device (`field-host-stamp-entry.gpu.test.ts`,
// `field-host-pointer.gpu.test.ts`).
import { expect, test } from "bun:test";
import {
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  FIELD_GENERATORS,
  SOLID,
} from "@furnace/core/field";
import type { Context, RequestContextOptions } from "@furnace/core/gpu";
import { createFieldHost } from "../src/field-host/field-host.ts";
import { placesProps } from "../src/field-host/field-placements.ts";
import type {
  CameraPose,
  FieldLayers,
  FieldTool,
  FieldToolPush,
  SegmentHud,
} from "../src/field-host/index.ts";

// --- startStamp with NO selection: region-draw, not a refusal (D-F4.5-7) ----
//
// The refusal these cases replaced ("select a region first") is what the spec
// calls discovery-by-refusal, and it died in F4.5b Task 9: picking a stamp with
// nothing selected ARMS region-draw, and the region the user then drags opens
// the session. The arm is host state published on its own seam — the chrome
// mirrors it, so the rail, the status keymap and the cursor all read one fact.

test("startStamp with no selection ARMS region-draw instead of refusing", () => {
  const host = createFieldHost();
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const stamps: unknown[] = [];
  host.subscribeStamp((s) => stamps.push(s));
  const pending: unknown[] = [];
  host.subscribePendingStamp((p) => pending.push(p));

  host.startStamp("hall");
  // No refusal at all, and no SESSION either — a region is still owed.
  expect(errors).toEqual([]);
  expect(stamps).toEqual([null]);
  // The generator's display NAME rides the push: the status line and the rail
  // both name it, and resolving the id chrome-side against a cursor that ⇧S can
  // move is exactly how the two would come to name different generators.
  expect(pending).toEqual([null, { id: "hall", name: "Hall" }]);
});

test("startStamp with an UNKNOWN generator refuses and arms nothing", () => {
  const host = createFieldHost();
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const pending: unknown[] = [];
  host.subscribePendingStamp((p) => pending.push(p));

  host.startStamp("no-such-generator");
  // core's setup-loud message, surfaced verbatim.
  expect(errors.length).toBe(1);
  expect(errors[0]).toContain("no-such-generator");
  // The initial push only: a refusal must not leave the viewport armed for a
  // region it has no generator to put in.
  expect(pending).toEqual([null]);
});

test("Esc clears a pending stamp arm — its own rung on the cancel ladder", () => {
  const host = createFieldHost();
  const pending: unknown[] = [];
  host.subscribePendingStamp((p) => pending.push(p));
  host.startStamp("maze");
  expect(pending).toEqual([null, { id: "maze", name: "Maze" }]);

  host.escape();
  expect(pending).toEqual([null, { id: "maze", name: "Maze" }, null]);
  // …and the ladder is spent: a second Esc has nothing left to clear here, so it
  // must not push a second null at a subscriber that already knows.
  host.escape();
  expect(pending.length).toBe(3);
});

test("arming another tool clears a pending stamp — including a re-push of the arm already held", () => {
  const host = createFieldHost();
  const pending: unknown[] = [];
  host.subscribePendingStamp((p) => pending.push(p));

  host.startStamp("hall");
  host.setGesture("box");
  expect(pending).toEqual([null, { id: "hall", name: "Hall" }, null]);

  // Back to the brush, then arm a stamp from there.
  host.setGesture(null); // pending is already clear — nothing to push
  host.startStamp("hall");
  expect(pending.length).toBe(4);

  // THE case that would leak: `armBrush` pushes `setGesture(null)` while the host
  // already holds `null`, so a clear sitting below the "same gesture" early return
  // would never run and the stamp would stay armed under a brush.
  host.setGesture(null);
  expect(pending).toEqual([
    null,
    { id: "hall", name: "Hall" },
    null,
    { id: "hall", name: "Hall" },
    null,
  ]);
});

test("a world reset clears the pending stamp arm", () => {
  const host = createFieldHost();
  const pending: unknown[] = [];
  host.subscribePendingStamp((p) => pending.push(p));
  host.startStamp("hall");
  host.newWorld();
  // The region it was asking for would be drawn in the NEW world for a question the
  // old one posed — and every surface reading the seam would go on saying "click ×2
  // to span a region" across a world swap. `resetWorld` clears every other
  // interaction state; this was the one exception.
  expect(pending).toEqual([null, { id: "hall", name: "Hall" }, null]);
});

test("subscribePendingStamp has a real, idempotent unsubscribe", () => {
  const host = createFieldHost();
  const seen: unknown[] = [];
  const unsubscribe = host.subscribePendingStamp((p) => seen.push(p));
  expect(seen).toEqual([null]);
  unsubscribe();
  const after: unknown[] = [];
  host.subscribePendingStamp((p) => after.push(p));
  // A STALE unsubscribe must not take the successor with it — releases are keyed to
  // the callback and calling one twice is a no-op (every seam here is the same channel).
  unsubscribe();
  host.startStamp("cave");
  expect(seen).toEqual([null]);
  expect(after).toEqual([null, { id: "cave", name: "Cave" }]);
});

test("subscribeStamp immediately pushes the current state (null without a session)", () => {
  const host = createFieldHost();
  let pushed: unknown = "not-pushed";
  host.subscribeStamp((s) => {
    pushed = s;
  });
  expect(pushed).toBeNull();
});

test("nudgeStamp without a session is a quiet no-op (no push, no preview)", () => {
  const host = createFieldHost();
  const pushes: unknown[] = [];
  host.subscribeStamp((s) => pushes.push(s));
  expect(() => host.nudgeStamp(1, 0, -1)).not.toThrow();
  // Only the initial subscribe push — a session-less nudge must not notify
  // (a notify would mean it reached previewStamp and the worker spawn).
  expect(pushes).toEqual([null]);
});

test("selectEntity is runtime-quiet on unknown ids, and never pushes a phantom id", () => {
  const host = createFieldHost();
  const pushes: (number | null)[] = [];
  host.subscribeEntitySelection((id) => pushes.push(id));
  // Only the initial push so far — an empty world has nothing selected.
  expect(pushes).toEqual([null]);
  // An id no entity op carries (an undone commit, a stale palette row) selects
  // NOTHING. Quiet, and — the half that matters — it must not notify: pushing
  // 999 would put a subscriber in a state the host is not in.
  expect(() => host.selectEntity(999)).not.toThrow();
  expect(() => host.selectEntity(null)).not.toThrow();
  expect(pushes).toEqual([null]);
});

test("subscribeEntitySelection has a real, idempotent unsubscribe", () => {
  const host = createFieldHost();
  const seen: (number | null)[] = [];
  const unsubscribe = host.subscribeEntitySelection((id) => seen.push(id));
  expect(seen).toEqual([null]);
  unsubscribe();
  // A stale unsubscribe must not take a SUCCESSOR with it (the subscribeTool rule
  // every seam here follows) — so re-subscribing after the release still lands, and
  // the released one is really gone.
  const after: (number | null)[] = [];
  host.subscribeEntitySelection((id) => after.push(id));
  unsubscribe();
  expect(after).toEqual([null]);
  host.newWorld();
  // Neither callback hears the reset: the first was released, and the second is
  // still installed but a no-selection world reset changes nothing to push.
  expect(seen).toEqual([null]);
  expect(after).toEqual([null]);
});

test("subscribeSegmentHud has a real, identity-keyed, idempotent unsubscribe", () => {
  const host = createFieldHost();
  const seen: (SegmentHud | null)[] = [];
  // `null` on subscribe: no point is down on a fresh host, and a seam that said
  // nothing here would let a status bar mounting mid-gesture render its idle copy
  // beside a capsule the viewport is drawing (the subscribeCameraPose argument).
  const unsubscribe = host.subscribeSegmentHud((h) => seen.push(h));
  expect(seen).toEqual([null]);
  unsubscribe();

  // The KEYING, from the side that breaks it: React re-runs an effect BODY before the
  // previous cleanup, so the successor subscribes and the stale release runs after it.
  // A release keyed to anything but its own callback takes the successor with it and
  // the seam goes silent with nothing thrown — which is why the second `unsubscribe()`
  // here is the whole case rather than a tidy-up.
  const after: (SegmentHud | null)[] = [];
  host.subscribeSegmentHud((h) => after.push(h));
  unsubscribe();
  expect(after).toEqual([null]);

  // …and the successor is still the live one. Arming a gesture is the push this can
  // reach without a device: `setGesture` drops BOTH pending anchors on the way in, so
  // it republishes even with nothing pending. (`escape()` deliberately does not — its
  // first rung is guarded on an anchor actually existing, so with none down the ladder
  // falls straight through. Checked, having assumed otherwise first.)
  host.setGesture("segment");
  expect(after).toEqual([null, null]);
  expect(seen).toEqual([null]);
});

// --- listGenerators: the `emits` → `placesProps` WIRING (F4 Task 12, D-F4-15) -
//
// The seam the chrome actually reads. This covers the wiring only — that the
// host asks `placesProps` about every def and carries the answer out. The RULE
// itself lives in `field-placements.ts` and is pinned in that module's test,
// which is the only place able to feed it a `"both"` the registry does not
// contain.

test("listGenerators carries placesProps for every def in the registry", () => {
  const infos = createFieldHost().listGenerators();
  const byId = (id: string) => infos.find((g) => g.id === id);
  // Concrete, so a wiring bug cannot hide behind a mirrored expectation: the
  // three carvers say no, the placer says yes.
  expect(byId("hall")?.placesProps).toBe(false);
  expect(byId("cave")?.placesProps).toBe(false);
  expect(byId("maze")?.placesProps).toBe(false);
  expect(byId("scatter")?.placesProps).toBe(true);

  // …and no def is dropped or special-cased. Driven FROM the registry so a
  // missing id surfaces as `undefined` against a boolean rather than being
  // skipped. This much is a mirrored expectation — both sides read the same
  // `FIELD_GENERATORS` — so it cannot catch a wrong rule, only a wrong wiring.
  const carried = new Map(infos.map((i) => [i.id, i.placesProps]));
  expect(infos.length).toBe(FIELD_GENERATORS.length);
  for (const def of FIELD_GENERATORS)
    expect(carried.get(def.id)).toBe(placesProps(def.emits));
});

// --- void cast (F3b Task 12) ------------------------------------------------
// The refusals that need no GPU: they are decided before the context guard, so
// they are the half of the enable path a host with no device still runs. Once a
// cast can actually exist — the worker round trip, the meshes, the invalidation
// — the coverage moves to `field-host-void-cast.gpu.test.ts`, which drives the
// same host over a real bun-webgpu device with the worker injected.

const layersWithVoidCast = (on: boolean): FieldLayers => ({
  field: true,
  kit: true,
  props: true,
  ghost: true,
  selection: true,
  grid: true,
  flags: true,
  voidCast: on,
});

/** A host holding `count` allocated chunks, via loadWorld's decode path (the
 *  only way in without a pointer or a GPU). Contents are irrelevant — the
 *  budget counts chunks. */
function hostWithChunks(count: number): ReturnType<typeof createFieldHost> {
  const host = createFieldHost();
  const bytes = encodeChunkFile(new Int8Array(CHUNK_SAMPLES).fill(SOLID));
  const chunks = Array.from({ length: count }, (_, i) => ({
    key: chunkKey(i, 0, 0),
    bytes,
  }));
  host.loadWorld({
    manifest: {
      version: 2,
      kind: "field",
      cellSize: DEFAULT_CELL_SIZE,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [],
      meshes: [],
    },
    chunks,
    oplog: null,
  });
  return host;
}

test("enabling the void cast past the chunk budget refuses loudly", () => {
  const host = hostWithChunks(513);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setLayers(layersWithVoidCast(true));
  expect(errors.length).toBe(1);
  // The count AND the ceiling are both in the message: a refusal the user
  // cannot act on is a refusal that reads as a bug.
  expect(errors[0]).toContain("513");
  expect(errors[0]).toContain("512");
});

test("the budget refusal is decided BEFORE the GPU guard, and 512 is inside it", () => {
  // Ordering matters: check the context first and an over-budget enable would
  // go quiet in exactly the headless case this asserts. 512 must pass the
  // ceiling it names (an off-by-one here silently shrinks the tool).
  const host = hostWithChunks(512);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setLayers(layersWithVoidCast(true));
  expect(errors).toEqual([]);
});

test("enabling the void cast on a world with nothing dug says so", () => {
  // The feature's own rule (`field-voidcast.ts`'s `invalidateVoidCast` comment): a ticked box with
  // nothing behind it reads as a bug. An undug world has no air to cast, and
  // that refusal is the one the user is most likely to hit first.
  const host = createFieldHost();
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setLayers(layersWithVoidCast(true));
  expect(errors).toEqual(["nothing to cast yet — dig something first"]);
});

test("the enable/disable edges are context-free until they need a context", () => {
  // The narrow claim this CAN make headlessly: every step the enable takes
  // before it gives up on a missing context dereferences no GPU state, so
  // neither edge throws and neither reports. It deliberately does NOT claim the
  // guard stopped a worker job — a spawned bun Worker for the browser's
  // /field-worker.js neither resolves nor rejects in-process, so removing the
  // guard is invisible from here. Proving THAT needs a worker-client injection
  // seam the host does not have (backlog:
  // `field-host-worker-coverage-reach.md`).
  const host = hostWithChunks(2);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  expect(() => host.setLayers(layersWithVoidCast(true))).not.toThrow();
  expect(() => host.setLayers(layersWithVoidCast(false))).not.toThrow();
  expect(errors).toEqual([]);
});

// --- the camera-pose seam (F4.5a Task 9) ------------------------------------
//
// The corner axis triad's whole input. Reachable headlessly because `applyOrbit` —
// the ONE place every camera path ends — publishes before it touches the camera,
// and `frameChunks` is the one public verb that reaches it without a canvas (the
// fly keys and the look drag are canvas listeners `init` attaches).

test("subscribeCameraPose pushes the current pose immediately, then on every camera move", () => {
  const host = createFieldHost();
  const poses: CameraPose[] = [];
  const unsubscribe = host.subscribeCameraPose((p) => poses.push(p));
  // The initial push: a triad mounting mid-session must not draw the default view
  // until the user happens to move (the camera does not move on its own).
  expect(poses.length).toBe(1);
  const first = poses[0];
  expect(typeof first?.yaw).toBe("number");
  expect(typeof first?.pitch).toBe("number");

  host.frameChunks([chunkKey(2, 0, 0)]);
  expect(poses.length).toBe(2);
  // A frame-chunks retarget moves the PIVOT, not the orientation — so the second
  // push carries the same angles. That it arrives at all is the assertion: the
  // publish sits in applyOrbit, which is what makes it fire for the fly step and
  // the look drag this test cannot reach.
  expect(poses[1]).toEqual(first as CameraPose);

  unsubscribe();
  host.frameChunks([chunkKey(3, 0, 0)]);
  // The slot is a single one and the release really releases it — an inert
  // unsubscribe would leak a callback into an unmounted overlay.
  expect(poses.length).toBe(2);
});

// --- the context init asks for (F4.5a Task 9, re-aimed at T4c) ---------------
//
// It used to pin the AA switch's mechanism — that `init` asked for whichever sample
// count it was handed. MSAA left the editor at T4c and the option with it, and what
// is left is a stronger claim than the one it replaced: the count is now FIXED at 1,
// because `frame.renderToTexture` refuses every other value and the capture path
// draws the live viewport's own pipelines into an offscreen target. A real context
// never reports the options it was built from, which is what `deps.requestContext` is
// for: it RECORDS the request and then refuses, because everything init does past
// that line needs a device.

function recordingContextRequests(): {
  seen: RequestContextOptions[];
  requestContext: (
    canvas: HTMLCanvasElement,
    options?: RequestContextOptions,
  ) => Promise<Context>;
} {
  const seen: RequestContextOptions[] = [];
  return {
    seen,
    requestContext: (_canvas, options = {}) => {
      seen.push(options);
      return Promise.reject(new Error("stub context"));
    },
  };
}

const FAKE_CANVAS = {} as HTMLCanvasElement;

test("init asks for a SINGLE-SAMPLE context, which is what makes a capture possible", async () => {
  const stub = recordingContextRequests();
  const host = createFieldHost({ requestContext: stub.requestContext });
  await expect(host.init(FAKE_CANVAS)).rejects.toThrow("stub context");
  // The literal 1, not "not 4": core's `frame.renderToTexture` throws on any context
  // whose sample count is not exactly 1, so this is the requirement rather than a
  // preference. Raising it here is how the editor loses offscreen rendering.
  expect(stub.seen).toEqual([{ sampleCount: 1 }]);
});

// --- W-2: the host ANNOUNCES a radius change ---------------------------------

test("setDigRadius publishes the new radius on the tool seam", () => {
  // The HOST half of the F4.5 gate's W-2, and the half a chrome-side test cannot
  // reach: the strip's mirror was written first and its case fires the seam by
  // hand, so it proves the chrome ADOPTS a push and says nothing about whether
  // one is ever made. Deleting `notifyTool()` from `applyRadius` left that case
  // green — which is how this test came to exist.
  const host = createFieldHost();
  const pushes: { tool: unknown; radius: number }[] = [];
  host.subscribeTool((p) => pushes.push(p));
  // The seam is a state mirror, so subscribing is itself a push (the host's own
  // starting radius). Asserted rather than sliced off: it is the (re)mount rule the
  // strip depends on, and dropping it silently would hide the day it stops arriving.
  expect(pushes.map((p) => p.radius)).toEqual([1.25]);
  pushes.length = 0;

  host.setDigRadius(3.5);

  expect(pushes.map((p) => p.radius)).toEqual([3.5]);
});

test("a radius that does not CHANGE publishes nothing — the echo guard", () => {
  // The same early return is what stops a chrome-originated set round-tripping
  // back and fighting a slider drag. Pinned here because it is load-bearing for
  // the mirror, not merely an optimisation.
  const host = createFieldHost();
  host.setDigRadius(3.5);
  const pushes: { radius: number }[] = [];
  host.subscribeTool((p) => pushes.push(p));
  // The subscribe snapshot, carrying the radius set above — and the reason this case
  // clears the log rather than asserting emptiness at the end: the seam speaks once
  // for the mount and the claim below is about the SET.
  expect(pushes.map((p) => p.radius)).toEqual([3.5]);
  pushes.length = 0;

  host.setDigRadius(3.5);

  expect(pushes).toEqual([]);
});

test("the radius rides ALONGSIDE the tool rather than inside it", () => {
  // Why radius is not a field of `FieldTool`, pinned structurally: the momentary ⇧/⌃
  // overrides swap that value WHOLESALE (`deriveMomentary` builds a different tool and
  // `notifyTool` pushes it), so a radius living inside it would be replaced by the
  // override's and restored on release — the brush resizing itself because the user
  // held a modifier.
  //
  // Asserted on the pushed SHAPE because that is where the guarantee lives. The
  // momentary path itself needs key events over a live canvas and belongs to the GPU
  // suite; what is checkable here is that the two are separate fields, which is the
  // property the momentary swap cannot reach through.
  //
  // `setTool` is absent from this case because the RADIUS is the subject and the radius
  // funnel is what moves it. It used to be absent for a contract reason, and this comment
  // used to say so: "on the ORDINARY path it is a chrome→host verb the host does not echo
  // back […], so there is no push to inspect" — found by writing the obvious version of this
  // test and watching `pushes.at(-1)` come back undefined. That is no longer true (T3b2
  // Task 6: a plain `setTool` publishes), and the two cases below are where the verb's own
  // announcement is pinned.
  const host = createFieldHost();
  const pushes: { tool: Record<string, unknown>; radius: number }[] = [];
  host.subscribeTool((p) =>
    pushes.push({
      tool: p.tool as unknown as Record<string, unknown>,
      radius: p.radius,
    }),
  );

  host.setDigRadius(3.5);

  const push = pushes.at(-1);
  if (push === undefined) throw new Error("test: the tool seam pushed nothing");
  expect(push.radius).toBe(3.5);
  // The tool is a WHOLE tool, so the push is not a partial…
  expect(Object.keys(push.tool).sort()).toEqual([
    "effect",
    "hollow",
    "mask",
    "materialId",
    "smooth",
  ]);
  // …and `radius` is not one of its keys, which is the separation the momentary swap
  // cannot reach through.
  expect(Object.keys(push.tool)).not.toContain("radius");
});

// --- T3b2 Task 6: the tool seam tells the truth on every set -----------------
//
// A SANCTIONED behaviour change, so these are conscious-change pins: each one would have
// FAILED before the change, and that is the point of writing them rather than adjusting
// something. What they replace is a contract the chrome had to work around — a plain
// `setTool` announced nothing, so the only holder of the armed brush was whichever chrome
// surface had written it, and a surface that mounted later (the tool strip, which the top
// bar unmounts for the whole of every stamp session) had nothing to read.

test("a plain setTool reaches a subscriber", () => {
  // The conscious change itself. Before it, this array stayed empty for anything short of
  // a momentary modifier being held — the eyedrop and the ⇧/⌃ derive were the only paths
  // that fired, so three simultaneous chrome readers of the tool diverged the first time
  // anyone picked a brush and nothing ever brought them back.
  const host = createFieldHost();
  const pushes: FieldToolPush[] = [];
  host.subscribeTool((p) => pushes.push(p));
  pushes.length = 0; // the subscribe snapshot; the claim is about the SET

  host.setTool({
    effect: "fill",
    materialId: 2,
    mask: { kind: "none" },
    smooth: { strength: 16, iterations: 1, mode: "both" },
    hollow: null,
  });

  expect(pushes.map((p) => [p.tool.effect, p.tool.materialId])).toEqual([
    ["fill", 2],
  ]);
});

test("the setTool push carries what the host CLAMPED, not what was asked for", () => {
  // The chassis is the enforcement point for parameter ranges, and the publish is what
  // makes that visible to a reader instead of only to the strokes: a control that asked
  // for a sub-floor hollow must not go on displaying the number it asked for while the
  // brush carves the floor.
  const host = createFieldHost();
  const pushes: FieldToolPush[] = [];
  host.subscribeTool((p) => pushes.push(p));
  pushes.length = 0;

  host.setTool({
    effect: "fill",
    materialId: 0,
    mask: { kind: "none" },
    smooth: { strength: 16, iterations: 1, mode: "both" },
    hollow: 0.1, // below HOLLOW_MIN_M
  });

  expect(pushes.map((p) => p.tool.hollow)).toEqual([0.5]);
});

test("a setTool that changes nothing publishes nothing — the value guard", () => {
  // `applyRadius`'s `clamped === digRadius` one type up, and the half the publish above
  // could not ship without: every no-op set would otherwise reach every reader of the
  // tool, and the strip re-sets the whole tool object for a change to any one of its
  // fields. Sabotage-proven: dropping `sameTool` from `setTool` fails THIS case and
  // nothing else in the suite.
  const host = createFieldHost();
  const armed = (): FieldTool => ({
    effect: "fill",
    materialId: 2,
    mask: { kind: "class", classId: 1 },
    smooth: { strength: 8, iterations: 2, mode: "erode" },
    hollow: 0.75,
  });
  host.setTool(armed());
  const pushes: FieldToolPush[] = [];
  host.subscribeTool((p) => pushes.push(p));
  pushes.length = 0;

  // A DIFFERENT object with identical values, nested fields and all — which is what the
  // strip sends, since every one of its controls rebuilds the whole tool.
  host.setTool(armed());

  expect(pushes).toEqual([]);
});

/** The brush the per-field cases below start from. Every value here differs from the one
 *  its row changes to, so each row is a real one-field move. */
const ARMED_BRUSH: FieldTool = {
  effect: "fill",
  materialId: 2,
  mask: { kind: "class", classId: 1 },
  smooth: { strength: 8, iterations: 2, mode: "both" },
  hollow: 0.75,
};

/** One row per field `sameTool` compares that NO other case in the package moves on its
 *  own. `effect`, `hollow` and `mask` each already redden a case elsewhere if their
 *  comparison is dropped; these four redden nothing, and the destructure backstop does not
 *  cover them — it catches a field nobody ADDED a comparison for, never one somebody
 *  DELETED. A dropped `materialId` compare would swallow every swatch click and snap the
 *  strip back to the class before it, with the suite green. */
const ONE_FIELD_MOVES: readonly (readonly [
  string,
  (t: FieldTool) => FieldTool,
])[] = [
  ["materialId", (t) => ({ ...t, materialId: 3 })],
  ["smooth.strength", (t) => ({ ...t, smooth: { ...t.smooth, strength: 4 } })],
  [
    "smooth.iterations",
    (t) => ({ ...t, smooth: { ...t.smooth, iterations: 3 } }),
  ],
  ["smooth.mode", (t) => ({ ...t, smooth: { ...t.smooth, mode: "erode" } })],
];

test("the value guard lets a change to any ONE compared field through", () => {
  // The guard's other half, and the direction that fails SILENTLY: the case above proves it
  // suppresses a no-op, this proves it does not suppress a real move. Table-driven rather
  // than four near-identical blocks (the `LIFTED_SEAMS` precedent one file over) — the claim
  // has the same shape in all four and only the field differs.
  //
  // Sabotage-proven: dropping `materialId` from `sameTool` fails this and nothing else in
  // the package.
  for (const [field, move] of ONE_FIELD_MOVES) {
    const host = createFieldHost();
    host.setTool(ARMED_BRUSH);
    const pushes: FieldToolPush[] = [];
    host.subscribeTool((p) => pushes.push(p));
    pushes.length = 0;

    host.setTool(move(ARMED_BRUSH));

    // Named in the tuple so a failure says WHICH comparison went missing.
    expect([field, pushes.length]).toEqual([field, 1]);
  }
});

test("subscribeTool pushes the CURRENT pair on subscribe", () => {
  // The other half of the conversion, and the one the chrome's late mount rests on: the
  // seam had no snapshot at all, so a surface arriving mid-session read a default beside
  // a brush the viewport was actively drawing and nothing ever corrected it.
  const host = createFieldHost();
  host.setTool({
    effect: "smooth",
    materialId: 0,
    mask: { kind: "none" },
    smooth: { strength: 4, iterations: 3, mode: "fill" },
    hollow: null,
  });
  host.setDigRadius(2.75);

  const pushes: FieldToolPush[] = [];
  host.subscribeTool((p) => pushes.push(p));

  expect(pushes.map((p) => [p.tool.effect, p.radius])).toEqual([
    ["smooth", 2.75],
  ]);
});

test("the snapshot is a CLONE — a subscriber cannot write into host state", () => {
  // The seam's standing rule ("a pushed value is CLONED once per publish"), which the
  // snapshot had no way to break before it existed. `subscribe`'s push goes through the
  // same builder as `notifyTool`, so this is what says the builder is on both paths.
  const host = createFieldHost();
  const seen: FieldTool[] = [];
  host.subscribeTool((p) => seen.push(p.tool));
  const first = seen[0];
  if (first === undefined)
    throw new Error("test: the tool seam pushed nothing");
  first.effect = "paint";
  first.smooth.strength = 1;

  const later: FieldToolPush[] = [];
  host.subscribeTool((p) => later.push(p));

  expect(later.map((p) => [p.tool.effect, p.tool.smooth.strength])).toEqual([
    ["dig", 16],
  ]);
});
