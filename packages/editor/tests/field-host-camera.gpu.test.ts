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
import type { SelectionInfo } from "../src/viewport-host/field-host.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameNoop } from "./_helpers/raf.ts";

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

/** An initialized host over one committed hall, with the recorded input handlers. */
async function cameraFixture() {
  const restoreRo = installMockResizeObserver();
  // The NO-OP rAF variant: every path under test runs inside an input handler or
  // a method, and under bun-webgpu the render inside a frame is invalid anyway.
  const restoreRaf = stubAnimationFrameNoop();
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
  const key = (k: string): void =>
    fire("keydown", {
      key: k,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    });

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
    footprintCentre,
    footprintLongest,
    down,
    move,
    up,
    wheel,
    key,
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

      f.wheel(-100); // away from the user = forward

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
      // (a) pointer armed, nothing selected.
      f.host.setGesture("pointer");
      const eyeBefore = f.eye();
      rightDrag(f, 20);
      expect(f.eye()).toEqual(eyeBefore); // fly-look pins the eye

      // (b) something selected, but the BRUSH is armed — the selection is not
      // what the user is working on, so the drag must not start orbiting it.
      f.host.selectEntity(f.entityId);
      f.host.setGesture(null);
      const eyeBrush = f.eye();
      rightDrag(f, 20);
      expect(f.eye()).toEqual(eyeBrush);
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
