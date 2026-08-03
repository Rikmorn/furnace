// The camera half of F4.5b Task 6 that needs a real (bun-webgpu) context: the
// wheel's two bindings, the right-drag's two, the `F` key, and the CELL
// selection `frameSelection` falls back to.
//
// It needs a device even though nothing here draws, for `field-host-move.gpu`'s
// reason: `init` is what ATTACHES the input handlers, and every path that reads
// the cursor resolves through `cursorRay` → `camera.screenToRay`, which has no
// camera until a context is up. Same recipe too — the canvas RECORDS the
// listeners the host registers and the tests call the real handlers with
// synthetic events.
//
// HERE and not in `tests/viewport-host/`: `bun test` runs a directory's own files
// before its subdirectories, and `tests/chrome/` registers happy-dom, which
// replaces `globalThis.navigator` — taking `navigator.gpu` with it. Every host
// GPU test is in this directory for that reason. The verb half that needs no
// camera (`frameSelection` over an entity, `snapView`) is headless in
// `field-host-camera.test.ts`.
//
// The camera is read back through `exportArtifact`'s `playerStart` (= the live
// eye) and the brush radius through the RADIUS a committed stroke records —
// neither has a getter, and these are the windows the rest of the suite already
// uses.
import { expect, test } from "bun:test";
import type {
  FieldManifest,
  FieldOp,
  MaterialTable,
} from "@furnace/core/field";
import {
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  encodeMaterialFile,
  generatorById,
  parseOps,
  serializeOps,
} from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { generatorFootprint } from "../src/viewport-host/field-ghost.ts";
import type {
  CameraPose,
  SelectionInfo,
} from "../src/viewport-host/field-host.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import {
  stubAnimationFrameCaptured,
  stubAnimationFrameNoop,
} from "./_helpers/raf.ts";

await ensureBunWebGpu();

type V3 = [number, number, number];

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

const TABLE: MaterialTable = {
  classes: [
    // Positional: `classOf` indexes `classes` BY id, so the middle class is
    // present because id 2 has to be at index 2.
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

/** A hall straddling the host's starting orbit target ([0, 1, 0]), so a click at
 *  the centre of the 64×64 canvas lands on its footprint with no camera
 *  arithmetic in the test — field-host-move.gpu.test.ts's fixture region. */
const REGION = {
  min: [-2.5, -1, -2.5] as V3,
  max: [2.5, 3, 2.5] as V3,
};

/** The canvas centre — where the starting camera looks. */
const CENTRE = 32;

const dist = (a: V3, b: V3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** An initialized host over one committed hall, with the recorded input handlers.
 *
 *  `frames: true` swaps the no-op rAF for the CAPTURED one, so a test can run the
 *  host's own tick — the only way to reach `applyFlyMove`, which lives inside a
 *  frame rather than in any handler. */
async function cameraFixture(opts: { frames?: boolean } = {}) {
  const restoreRo = installMockResizeObserver();
  // The NO-OP rAF variant by default: every other path under test runs inside an
  // input handler or a method, and under bun-webgpu the render inside a frame is
  // invalid anyway (it prints, harmlessly, and the assertions never read pixels).
  const frames = opts.frames === true ? stubAnimationFrameCaptured() : null;
  const restoreRaf =
    frames === null ? stubAnimationFrameNoop() : frames.restore;
  const listeners: HostListeners = new Map();
  const host = createFieldHost();

  const store = createFieldStore();
  const log = createOpLog();
  const entityId = commitGenerator(store, log, generatorById("hall"), {
    params: structuredClone(generatorById("hall").defaults),
    seed: 7,
    region: REGION,
    policy: "replace",
    table: TABLE,
  }).entity.entityId;
  host.setMaterialTable(TABLE);
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [...store.chunks].map(([key, density]) => ({
      key,
      bytes: encodeChunkFile(density),
    })),
    materials: [...store.materials].map(([key, m]) => ({
      key,
      bytes: encodeMaterialFile(m),
    })),
    oplog: serializeOps(log.ops),
  });
  await host.init(await makeHostCanvas(listeners));

  const selections: (SelectionInfo | null)[] = [];
  host.subscribeSelection((s) => selections.push(s));
  const entitySelections: (number | null)[] = [];
  host.subscribeEntitySelection((id) => entitySelections.push(id));
  // The pose seam is how a test sees the camera TURN. The eye alone cannot: a
  // fly-look pins the eye by definition, so "the eye did not move" is satisfied
  // just as well by nothing having happened at all.
  const poses: CameraPose[] = [];
  host.subscribeCameraPose((p) => poses.push(p));

  const fire = (type: string, e: Record<string, unknown>): void => {
    const fn = listeners.get(type);
    if (fn === undefined) throw new Error(`test: no ${type} listener`);
    fn(e);
  };
  const down = (x: number, y: number, button = 0): void =>
    fire("pointerdown", {
      button,
      altKey: false,
      shiftKey: false,
      clientX: x,
      clientY: y,
      pointerId: 1,
    });
  const move = (x: number, y: number): void =>
    fire("pointermove", {
      clientX: x,
      clientY: y,
      shiftKey: false,
      pointerId: 1,
    });
  const up = (button = 0): void => fire("pointerup", { button, pointerId: 1 });

  /** One wheel notch. Negative deltaY is "away from the user" — forward, or a
   *  bigger brush, depending on what LMB is armed to do. */
  const wheel = (deltaY: number): void =>
    fire("wheel", { deltaY, preventDefault: () => undefined });
  /** Every canvas key event records whether the host CLAIMED it — the two calls
   *  are what decide whether the window listener (which binds the same ⏎/Esc/R/F)
   *  runs the verb a second time. */
  const claimed = { preventDefault: 0, stopPropagation: 0 };
  const key = (k: string, mods: Record<string, boolean> = {}): void => {
    claimed.preventDefault = 0;
    claimed.stopPropagation = 0;
    fire("keydown", {
      key: k,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...mods,
      preventDefault: () => {
        claimed.preventDefault += 1;
      },
      stopPropagation: () => {
        claimed.stopPropagation += 1;
      },
    });
  };
  const keyUp = (k: string): void => {
    const fn = listeners.get("keyup");
    if (fn === undefined) throw new Error("test: no keyup listener");
    fn({ key: k });
  };

  const ops = (): FieldOp[] => {
    const file = host
      .exportArtifact("probe")
      .find((f) => f.path === "worlds/probe/oplog.json");
    if (file === undefined || typeof file.contents !== "string")
      throw new Error("test: no oplog.json in the artifact");
    return parseOps(file.contents);
  };

  /** The entity's FOOTPRINT centre — what the host pivots and frames on, read
   *  through the same `generatorFootprint` it uses (recorded region as the null
   *  fallback). Not the recorded region: for an oversized region the two differ,
   *  and it is the footprint the box and the gizmo hang on. */
  const footprintCentre = (): V3 => {
    const op = ops().find(
      (o) => o.kind === "entity" && o.entity.entityId === entityId,
    );
    if (op === undefined || op.kind !== "entity")
      throw new Error("test: the hall left the log");
    const box =
      generatorFootprint(ops(), op.entity, DEFAULT_CELL_SIZE) ??
      op.entity.region;
    return [
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    ];
  };

  /** The longest edge of that same footprint — the fit rule's input. */
  const footprintLongest = (): number => {
    const op = ops().find(
      (o) => o.kind === "entity" && o.entity.entityId === entityId,
    );
    if (op === undefined || op.kind !== "entity")
      throw new Error("test: the hall left the log");
    const box =
      generatorFootprint(ops(), op.entity, DEFAULT_CELL_SIZE) ??
      op.entity.region;
    return Math.max(
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    );
  };

  return {
    host,
    entityId,
    selections,
    entitySelections,
    footprintCentre,
    footprintLongest,
    /** The camera's current orientation, off the pose seam. */
    pose: (): CameraPose => {
      const p = poses.at(-1);
      if (p === undefined)
        throw new Error("test: the pose seam pushed nothing");
      return p;
    },
    down,
    move,
    up,
    wheel,
    key,
    keyUp,
    /** Whether the LAST `key()` was claimed by the canvas handler. */
    claimed,
    /** Run ONE host frame at `now` ms. Throws if the host scheduled none. */
    tick: (now: number): void => {
      if (frames === null)
        throw new Error("test: fixture built without frames");
      frames.tick(now);
    },
    /** The live camera EYE, read back off the baked manifest's playerStart. */
    eye: (): V3 => {
      const file = host
        .exportArtifact("probe")
        .find((f) => f.path === "worlds/probe/manifest.json");
      if (file === undefined || typeof file.contents !== "string")
        throw new Error("test: no manifest.json in the artifact");
      return (JSON.parse(file.contents) as { playerStart: V3 }).playerStart;
    },
    /** The brush radius, read through what a stroke RECORDS: a plain LMB press
     *  with no gesture armed commits a dig sphere carrying `digRadius`. The only
     *  window onto it — `setDigRadius` has no getter. */
    probeRadius: (): number => {
      host.setGesture(null);
      down(CENTRE, CENTRE);
      up();
      const last = ops().at(-1);
      if (last === undefined || last.kind !== "brush")
        throw new Error("test: the stroke committed no brush op");
      if (last.shape.kind !== "sphere")
        throw new Error("test: the stroke committed a non-sphere shape");
      return last.shape.radius;
    },
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

// --- the wheel's two bindings ----------------------------------------------

test.skipIf(!bunWebGpuAvailable())(
  "wheel under the POINTER tool travels the camera and leaves the brush radius alone",
  async () => {
    const f = await cameraFixture();
    try {
      const radiusBefore = f.probeRadius();
      f.host.setGesture("pointer");
      const eyeBefore = f.eye();
      // The dolly LATCHES the camera as hand-aimed (`aimCamera`, not `placeCamera`),
      // which is what stops the chrome's Open from re-framing over it. The dig stroke
      // `probeRadius` just ran did NOT latch, which is what makes this half real.
      expect(f.host.cameraAimedByHand()).toBe(false);

      f.wheel(-100); // away from the user = forward

      expect(f.host.cameraAimedByHand()).toBe(true);
      const eyeAfter = f.eye();
      expect(dist(eyeBefore, eyeAfter)).toBeGreaterThan(0.1);
      // A dolly, not a zoom: the rig travelled, so the radius the brush would
      // stroke with is untouched.
      expect(f.probeRadius()).toBe(radiusBefore);

      // Back is the mirror — and the return trip proves the direction is read
      // off deltaY rather than being one fixed step.
      f.host.setGesture("pointer");
      f.wheel(100);
      expect(dist(f.eye(), eyeBefore)).toBeLessThan(1e-9);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "wheel travel is measured in SCROLL DISTANCE, not in events",
  async () => {
    const f = await cameraFixture();
    try {
      f.host.setGesture("pointer");
      const eyeBefore = f.eye();

      // A macOS trackpad's momentum emits many small events. One dolly step per
      // EVENT makes travel a function of the event rate — 30 of these would be
      // ~27 m at the starting distance, past the far edge of the workable world.
      for (let i = 0; i < 30; i++) f.wheel(-3);
      // 30 × 3 px = 90, under the 100 px that buys a step: banked, not spent.
      expect(f.eye()).toEqual(eyeBefore);

      // Crossing the threshold spends exactly one step, and the tenth event is
      // no different from the first — so this is a threshold, not a lockout.
      for (let i = 0; i < 4; i++) f.wheel(-3);
      const eyeAfter = f.eye();
      expect(dist(eyeBefore, eyeAfter)).toBeGreaterThan(0.1);

      // One notch of a real wheel is one step, and travels the same distance the
      // 102 px of trackpad above just did.
      const eyeNotch = f.eye();
      f.wheel(-100);
      expect(dist(eyeNotch, f.eye())).toBeCloseTo(dist(eyeBefore, eyeAfter), 6);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "wheel under a brush gesture is still the radius, and moves no camera",
  async () => {
    const f = await cameraFixture();
    try {
      const radiusBefore = f.probeRadius();
      const eyeBefore = f.eye();

      f.host.setGesture(null);
      f.wheel(-100);
      // One RADIUS_WHEEL_STEP up, and no travel at all.
      expect(f.probeRadius()).toBeCloseTo(radiusBefore + 0.1, 9);
      expect(f.eye()).toEqual(eyeBefore);

      // `segment` rides the BRUSH family — its capsule takes the same radius —
      // so it keeps the radius binding even though it is a "gesture".
      f.host.setGesture("segment");
      f.wheel(-100);
      expect(f.probeRadius()).toBeCloseTo(radiusBefore + 0.2, 9);
      expect(f.eye()).toEqual(eyeBefore);
    } finally {
      f.teardown();
    }
  },
);

// --- the right-drag's two ---------------------------------------------------

/** Right-drag from the canvas centre, `dx` pixels across. */
function rightDrag(
  f: Awaited<ReturnType<typeof cameraFixture>>,
  dx: number,
): void {
  f.down(CENTRE, CENTRE, 2);
  f.move(CENTRE + dx, CENTRE);
  f.up(2);
}

test.skipIf(!bunWebGpuAvailable())(
  "right-drag over a selected entity ORBITS it: the eye swings, its range to the footprint does not",
  async () => {
    const f = await cameraFixture();
    try {
      f.host.setGesture("pointer");
      f.host.selectEntity(f.entityId);
      // The fixture hall straddles the origin, so its footprint centre is close
      // to it — but the assertion below reads the range, not a literal, so the
      // exact centre never has to be predicted here.
      const eyeBefore = f.eye();

      rightDrag(f, 20);

      const eyeAfter = f.eye();
      // A fly-look holds the eye EXACTLY still, so this alone separates the two.
      expect(dist(eyeBefore, eyeAfter)).toBeGreaterThan(0.1);
      // …and an orbit is a rotation about the pivot, so the range to it survives.
      const centre = f.footprintCentre();
      expect(dist(eyeAfter, centre)).toBeCloseTo(dist(eyeBefore, centre), 4);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "right-drag falls back to fly-look with nothing selected, and with a brush armed",
  async () => {
    const f = await cameraFixture();
    try {
      // BOTH halves of "fly-look ran", every time. Pinning only the eye would
      // be satisfied by the branch not existing at all — fly-look holds the eye
      // BY DEFINITION, so a right-drag that did nothing whatsoever passes it.
      // The yaw is the discriminating claim: fly-look pins the eye AND turns the
      // view, and this is the editor's primary navigation gesture.
      //
      // (a) pointer armed, nothing selected.
      f.host.setGesture("pointer");
      const eyeBefore = f.eye();
      const yawBefore = f.pose().yaw;
      // A look drag LATCHES the camera as hand-aimed, so the chrome's Open leaves
      // it alone afterwards — the same claim the dolly and the fly step carry, on
      // the gesture that turns the view without moving the eye.
      expect(f.host.cameraAimedByHand()).toBe(false);
      rightDrag(f, 20);
      expect(f.host.cameraAimedByHand()).toBe(true);
      expect(f.eye()).toEqual(eyeBefore);
      // 20 px at LOOK_SPEED is 0.1 rad; a hundredth of that would be a
      // rounding artefact rather than a look.
      expect(Math.abs(f.pose().yaw - yawBefore)).toBeGreaterThan(0.01);

      // (b) something selected, but the BRUSH is armed — the selection is not
      // what the user is working on, so the drag must not start orbiting it.
      // It must still LOOK, which is the half `orbitPivot`'s gesture gate is
      // otherwise free to break.
      f.host.selectEntity(f.entityId);
      f.host.setGesture(null);
      const eyeBrush = f.eye();
      const yawBrush = f.pose().yaw;
      rightDrag(f, 20);
      expect(f.eye()).toEqual(eyeBrush);
      expect(Math.abs(f.pose().yaw - yawBrush)).toBeGreaterThan(0.01);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "the orbit pivot is LATCHED at the press — deselecting mid-drag does not change the drag",
  async () => {
    const f = await cameraFixture();
    try {
      f.host.setGesture("pointer");
      f.host.selectEntity(f.entityId);
      const centre = f.footprintCentre();
      const range = dist(f.eye(), centre);

      f.down(CENTRE, CENTRE, 2);
      f.move(CENTRE + 10, CENTRE);
      const midEye = f.eye();
      // Mid-drag the selection goes away. A pivot re-derived per move would fall
      // back to fly-look from here on — which PINS the eye, while leaving the
      // range the first half already established intact. So the range assertion
      // alone cannot see it: what does is that the second half still travels.
      f.host.selectEntity(null);
      f.move(CENTRE + 20, CENTRE);
      const endEye = f.eye();
      f.up(2);

      expect(dist(midEye, endEye)).toBeGreaterThan(0.1);
      expect(dist(endEye, centre)).toBeCloseTo(range, 4);
    } finally {
      f.teardown();
    }
  },
);

// --- F, and the cell selection it falls back to -----------------------------

test.skipIf(!bunWebGpuAvailable())(
  "F frames the CELL selection when no entity is selected",
  async () => {
    const f = await cameraFixture();
    try {
      // Two clicks under the `box` gesture span a region — the only route to a
      // cell selection, and it selects no entity, which is what makes this the
      // fallback branch.
      f.host.setGesture("box");
      f.down(CENTRE - 8, CENTRE - 8);
      f.up();
      f.down(CENTRE + 8, CENTRE + 8);
      f.up();
      const aabb = f.selections.at(-1)?.aabb;
      if (aabb === undefined || aabb === null)
        throw new Error("test: the box gesture made no selection");

      f.key("f");

      const centre: V3 = [
        (aabb.min[0] + aabb.max[0]) / 2,
        (aabb.min[1] + aabb.max[1]) / 2,
        (aabb.min[2] + aabb.max[2]) / 2,
      ];
      const longest = Math.max(
        aabb.max[0] - aabb.min[0],
        aabb.max[1] - aabb.min[1],
        aabb.max[2] - aabb.min[2],
      );
      // The fit rule, restated against literals (camera-control.test.ts owns it):
      // longest edge × 1.8, floored at 2 m.
      expect(dist(f.eye(), centre)).toBeCloseTo(Math.max(2, longest * 1.8), 5);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "F prefers the selected ENTITY when both selections stand at once",
  async () => {
    const f = await cameraFixture();
    try {
      f.host.setGesture("box");
      f.down(CENTRE - 8, CENTRE - 8);
      f.up();
      f.down(CENTRE + 8, CENTRE + 8);
      f.up();
      const aabb = f.selections.at(-1)?.aabb;
      if (aabb === undefined || aabb === null)
        throw new Error("test: the box gesture made no selection");
      // Selecting an entity leaves the CELL selection standing — they are
      // independent state, which is exactly why the order has to be decided.
      f.host.selectEntity(f.entityId);

      f.key("f");

      const entityCentre = f.footprintCentre();
      const cellCentre: V3 = [
        (aabb.min[0] + aabb.max[0]) / 2,
        (aabb.min[1] + aabb.max[1]) / 2,
        (aabb.min[2] + aabb.max[2]) / 2,
      ];
      // The two centres have to actually differ, or the assertion below is
      // vacuous — the cell region is a slice of the canvas, not the whole hall.
      expect(dist(entityCentre, cellCentre)).toBeGreaterThan(0.05);
      expect(dist(f.eye(), entityCentre)).toBeCloseTo(
        Math.max(2, f.footprintLongest() * 1.8),
        5,
      );
    } finally {
      f.teardown();
    }
  },
);

// --- fly is RMB-GATED (D-10) ------------------------------------------------
//
// The behaviour change this slice makes, and until now the least-pinned thing in
// the host: NOTHING exercised `applyFlyMove` at all (`camera-control.test.ts`
// covers the pure `flyMove` it calls, which is a different claim — that the
// arithmetic is right, not that the key reaches it). These two cases are the
// first guard on the binding itself, in both directions.

/** Two frames 16 ms apart, on a clock that only ever goes FORWARD.
 *
 *  Both halves matter. The host computes `dt = 0` for the first tick after init
 *  by design (it has no previous timestamp), so a test that ran ONE tick could
 *  never move a camera and would pass whatever the gate did. And the clock has to
 *  advance across calls: `dt` is `now - lastFrameT`, so replaying the same two
 *  timestamps hands the host a NEGATIVE `dt` followed by its exact positive twin,
 *  and the two fly steps cancel to a stationary eye — which is indistinguishable
 *  from the gate refusing. (Found by this test failing at `Received: 0` for that
 *  reason, not by reading.) */
let flyClock = 1000;
function flyFrames(f: Awaited<ReturnType<typeof cameraFixture>>): void {
  f.tick(flyClock);
  f.tick(flyClock + 16);
  flyClock += 32;
}

test.skipIf(!bunWebGpuAvailable())(
  "WASD does NOT fly on its own — the letters are the app's tool keys",
  async () => {
    const f = await cameraFixture({ frames: true });
    try {
      const eyeBefore = f.eye();
      f.key("w");
      flyFrames(f);
      // Not "barely moved": the eye is EXACTLY where it was, because the gate
      // returns before `flyMove` is ever called.
      expect(f.eye()).toEqual(eyeBefore);
      // …and the key is still HELD as far as the host is concerned, so this is a
      // gate on the travel rather than the key having been dropped: pressing the
      // right button now flies without a fresh keydown (asserted below).
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "…and it flies the moment the right button goes down, with no fresh keypress",
  async () => {
    const f = await cameraFixture({ frames: true });
    try {
      f.key("w");
      flyFrames(f);
      const eyeIdle = f.eye();

      // The right button goes down BETWEEN frames — which is exactly why the app
      // gate polls `isLooking()` per keypress rather than mirroring it.
      f.down(CENTRE, CENTRE, 2);
      expect(f.host.isLooking()).toBe(true);
      // HOLDING the button is not aiming — the press only latches `look`, and the
      // idle frames above travelled nowhere. Only the fly STEP inside the frame goes
      // through `aimCamera`, so this is the exact boundary the next assertion crosses.
      expect(f.host.cameraAimedByHand()).toBe(false);
      flyFrames(f);
      expect(f.host.cameraAimedByHand()).toBe(true);
      const eyeFlown = f.eye();
      // 16 ms at FLY_SPEED is a small but unmistakable step; a tenth of a
      // millimetre would be a rounding artefact rather than a fly.
      expect(dist(eyeIdle, eyeFlown)).toBeGreaterThan(0.001);

      // Releasing stops it again — the gate is the BUTTON, not a latch the first
      // press flipped.
      f.up(2);
      expect(f.host.isLooking()).toBe(false);
      flyFrames(f);
      expect(f.eye()).toEqual(eyeFlown);

      f.keyUp("w");
    } finally {
      f.teardown();
    }
  },
);

// --- the shared keys are CLAIMED (the ownership rule) -----------------------

test.skipIf(!bunWebGpuAvailable())(
  "every canvas branch that ACTS on a shared key stops it — one press, one handler",
  async () => {
    // ⏎, Esc, R and F are app-level actions too (frontend/lib/actions.ts). The
    // canvas answers first when it has something to answer with, and must claim
    // the event when it does, or the window listener runs the verb again — which
    // for R (a quarter turn per call) is a visible 180°.
    const f = await cameraFixture();
    try {
      // F acts unconditionally, so it always claims.
      f.key("f");
      expect(f.claimed).toEqual({ preventDefault: 1, stopPropagation: 1 });

      // With no session, Esc/⏎/R have nothing to do — and must NOT claim, or the
      // window ladder (which would clear the selection) could never run.
      f.key("Escape");
      expect(f.claimed).toEqual({ preventDefault: 0, stopPropagation: 0 });
      f.key("Enter");
      expect(f.claimed).toEqual({ preventDefault: 0, stopPropagation: 0 });
      f.key("r");
      expect(f.claimed).toEqual({ preventDefault: 0, stopPropagation: 0 });

      // A selected entity gives the Esc LADDER a rung — now it claims, and the
      // selection is gone.
      f.host.selectEntity(f.entityId);
      f.key("Escape");
      expect(f.claimed).toEqual({ preventDefault: 1, stopPropagation: 1 });
      f.key("Escape");
      expect(f.claimed).toEqual({ preventDefault: 0, stopPropagation: 0 });

      // A live LOOK does not change any of this, and that is deliberate: `r` and `f`
      // are not fly letters (`readFlyMove` reads w/a/s/d/q/e), so framing or turning
      // a ghost mid-orbit collides with nothing. The app-level gate draws the same
      // line — it stands down only for the actions marked `flyLetter`.
      f.down(CENTRE, CENTRE, 2);
      f.key("f");
      expect(f.claimed).toEqual({ preventDefault: 1, stopPropagation: 1 });
      f.up(2);
    } finally {
      f.teardown();
    }
  },
);

// --- the Esc LADDER's order (D-12) ------------------------------------------

test.skipIf(!bunWebGpuAvailable())(
  "Esc cancels ONE thing per press, most recent intent first",
  async () => {
    // The order IS the claim here. Before this case the rungs were only reachable
    // through incidental move/gizmo tests, and rung 4 (the cell selection) was
    // reachable through none — deleting it left the whole suite green.
    //
    // Two independent witnesses per press, which is what makes "one thing" checkable:
    // `claimed` says the ladder ACTED at all (the canvas branch stops the event only
    // when it did), and the two selection seams say what it did NOT touch.
    const f = await cameraFixture();
    try {
      // Stack all three cancellables at once: a cell selection, a selected entity, and
      // a half-drawn segment.
      f.host.setGesture("box");
      f.down(CENTRE - 8, CENTRE - 8);
      f.up();
      f.down(CENTRE + 8, CENTRE + 8);
      f.up();
      expect(f.selections.at(-1)).not.toBeNull();
      f.host.selectEntity(f.entityId);
      expect(f.entitySelections.at(-1)).toBe(f.entityId);
      f.host.setGesture("segment");
      f.down(CENTRE, CENTRE);
      f.up();
      const cellPushes = f.selections.length;
      const entityPushes = f.entitySelections.length;

      // 1 — the half-drawn segment. It acted (so it claimed), and neither selection
      //     moved, which is what makes this rung FIRST rather than merely present.
      f.key("Escape");
      expect(f.claimed).toEqual({ preventDefault: 1, stopPropagation: 1 });
      expect(f.entitySelections.length).toBe(entityPushes);
      expect(f.selections.length).toBe(cellPushes);

      // 2 — no session is live here, so the next rung is the selected ENTITY. The cell
      //     selection still stands.
      f.key("Escape");
      expect(f.claimed).toEqual({ preventDefault: 1, stopPropagation: 1 });
      expect(f.entitySelections.at(-1)).toBeNull();
      expect(f.selections.length).toBe(cellPushes);

      // 3 — and only now the cell selection.
      f.key("Escape");
      expect(f.claimed).toEqual({ preventDefault: 1, stopPropagation: 1 });
      expect(f.selections.at(-1)).toBeNull();

      // 4 — nothing left: a no-op that does NOT claim the key, so an Esc with an empty
      //     ladder still reaches whatever else might want it.
      f.key("Escape");
      expect(f.claimed).toEqual({ preventDefault: 0, stopPropagation: 0 });

      // The cell selection went to the RESELECT slot rather than being destroyed, so
      // Esc has the same way back that the panel's Clear does.
      f.host.reselect();
      expect(f.selections.at(-1)).not.toBeNull();
    } finally {
      f.teardown();
    }
  },
);
