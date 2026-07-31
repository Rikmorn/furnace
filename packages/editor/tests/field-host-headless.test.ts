// FieldHost surfaces that need NO GPU init (a field-host-load.test.ts
// sibling): startStamp's no-selection ARM and the pending-stamp seam,
// subscribeStamp's initial push, nudgeStamp's no-session no-op, the
// entity-selection seam's validation and single-slot discipline, the void
// cast's pre-context refusals, the camera-pose seam, and the options `init`
// builds before it ever touches a device.
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
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import { placesProps } from "../src/viewport-host/field-placements.ts";
import type { CameraPose, FieldLayers } from "../src/viewport-host/index.ts";

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

test("subscribePendingStamp is a single slot with a real unsubscribe", () => {
  const host = createFieldHost();
  const seen: unknown[] = [];
  const unsubscribe = host.subscribePendingStamp((p) => seen.push(p));
  expect(seen).toEqual([null]);
  unsubscribe();
  const after: unknown[] = [];
  host.subscribePendingStamp((p) => after.push(p));
  // A STALE unsubscribe must not null the successor's callback (every seam here
  // carries the same identity guard).
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

test("subscribeEntitySelection is a single slot with a real unsubscribe", () => {
  const host = createFieldHost();
  const seen: (number | null)[] = [];
  const unsubscribe = host.subscribeEntitySelection((id) => seen.push(id));
  expect(seen).toEqual([null]);
  unsubscribe();
  // A stale unsubscribe must not null a SUCCESSOR's callback (the subscribeTool
  // rule every seam here follows) — so re-subscribing after the release still
  // lands, and the released one is really gone.
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
  // The feature's own rule (invalidateVoidCast's comment): a ticked box with
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
  // seam the host does not have (backlog: field-host-worker-injection-seam).
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

// --- init's MSAA option (F4.5a Task 9) --------------------------------------
//
// The AA switch is a dispose + re-init at a different sample count, so what has to
// be true is that `init` asks for the count it was given. A real context never
// reports the options it was built from, which is what `deps.requestContext` is
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

test("init asks for 4× MSAA by default", async () => {
  const stub = recordingContextRequests();
  const host = createFieldHost({ requestContext: stub.requestContext });
  await expect(host.init(FAKE_CANVAS)).rejects.toThrow("stub context");
  expect(stub.seen).toEqual([{ sampleCount: 4 }]);
});

test("init honours an explicit sampleCount (the AA switch's whole mechanism)", async () => {
  const stub = recordingContextRequests();
  const host = createFieldHost({ requestContext: stub.requestContext });
  await expect(host.init(FAKE_CANVAS, { sampleCount: 1 })).rejects.toThrow(
    "stub context",
  );
  expect(stub.seen).toEqual([{ sampleCount: 1 }]);
});
