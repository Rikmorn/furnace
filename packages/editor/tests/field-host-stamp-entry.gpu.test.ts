// Stamps ENTER region-draw (D-F4.5-7, F4.5b Task 9): picking a stamp with
// nothing selected arms a region gesture, and the region the user then drags is
// what opens the session — the "select a region first" refusal is gone.
//
// It needs a device for the same reason `field-host-pointer.gpu.test.ts` does:
// every corner click resolves through `cursorRay` → `screenToRay`, and there is
// no camera until `init` has acquired a context. The ARM itself is headless and
// is pinned in `field-host-headless.test.ts`; what lives here is everything
// downstream of a click.
//
// HERE and not in `tests/viewport-host/` (this slice's PURE module tests): `bun
// test` runs a directory's own files before its subdirectories, and
// `tests/chrome/` registers happy-dom, which REPLACES `globalThis.navigator` and
// takes `navigator.gpu` with it. The bun-webgpu fixture memoizes and never
// reinstalls while `bunWebGpuAvailable()` keeps answering true — so a `.gpu` file
// in a subdirectory sorting after `chrome/` is not skipped, it RUNS and dies at
// `requestContext` (filed: docs/backlog/editor-and-tooling/editor-test-harness-fragility.md).
//
// The store is left EMPTY on purpose (the pointer suite's rule): an unallocated
// chunk reads SOLID, so `selectionPoint`'s raycast resolves against rock right at
// the eye and every click lands on a real world point without any camera
// arithmetic in the test.
import { expect, test } from "bun:test";
import type { FieldManifest, FieldOp } from "@furnace/core/field";
import { DEFAULT_CELL_SIZE, parseOps } from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type {
  PendingStamp,
  SelectionInfo,
  StampSession,
} from "../src/viewport-host/index.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import {
  stubAnimationFrameCaptured,
  stubAnimationFrameNoop,
} from "./_helpers/raf.ts";

await ensureBunWebGpu();

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** One committed hall, as `loadWorld`'s oplog path puts it in the log — the same
 *  route every saved world opens by, and all `openEntity` reads. */
const HALL_ENTITY_ID = 2;
const hallOps = (): FieldOp[] => [
  {
    id: 1,
    kind: "brush",
    effect: "dig",
    shape: { kind: "sphere", center: [0, 1, 0], radius: 0.5 },
  },
  {
    id: HALL_ENTITY_ID,
    kind: "entity",
    action: "place",
    entity: {
      entityId: HALL_ENTITY_ID,
      type: "generator",
      generator: "hall",
      params: {},
      seed: 7,
      region: { min: [-1, 0, -1], max: [1, 2, 1] },
      opSpan: [1, 1],
    },
  },
];

async function stampEntryFixture(
  opts: { frames?: boolean; ops?: FieldOp[] } = {},
) {
  const restoreRo = installMockResizeObserver();
  // The NO-OP rAF variant by default: everything under test is driven through the
  // recorded input handlers, and under bun-webgpu the render inside a frame is
  // invalid anyway (it prints, harmlessly, and nothing here reads pixels).
  // `frames: true` swaps in the CAPTURED one for the cursor cases — the cursor is
  // written from the frame path, which is the one place that cannot go stale as
  // arms change.
  const frames = opts.frames === true ? stubAnimationFrameCaptured() : null;
  const restoreRaf =
    frames === null ? stubAnimationFrameNoop() : frames.restore;
  const listeners: HostListeners = new Map();
  const canvas = await makeHostCanvas(listeners);
  const host = createFieldHost();
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [],
    oplog: opts.ops === undefined ? null : JSON.stringify(opts.ops),
  });
  await host.init(canvas);

  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const sessions: (StampSession | null)[] = [];
  host.subscribeStamp((s) => sessions.push(s));
  const pending: (PendingStamp | null)[] = [];
  host.subscribePendingStamp((p) => pending.push(p));
  const selections: (SelectionInfo | null)[] = [];
  host.subscribeSelection((s) => selections.push(s));

  const click = (x: number, y: number): void => {
    const fn = listeners.get("pointerdown");
    if (fn === undefined) throw new Error("test: no pointerdown listener");
    fn({ button: 0, altKey: false, clientX: x, clientY: y, pointerId: 1 });
  };
  const key = (k: string): void => {
    const fn = listeners.get("keydown");
    if (fn === undefined) throw new Error("test: no keydown listener");
    fn({
      key: k,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    });
  };
  /** The host's LIVE op log, read back through the baked artifact. */
  const ops = (): FieldOp[] => {
    const file = host
      .exportArtifact("probe")
      .find((f) => f.path === "worlds/probe/oplog.json");
    if (file === undefined || typeof file.contents !== "string")
      throw new Error("test: no oplog.json in the artifact");
    return parseOps(file.contents);
  };
  /** The canvas cursor after one more frame (`frames: true` fixtures only). */
  const cursorAfterFrame = (now: number): string => {
    if (frames === null) throw new Error("test: fixture built without frames");
    frames.tick(now);
    return canvas.style.cursor;
  };
  return {
    host,
    canvas,
    errors,
    sessions,
    pending,
    selections,
    click,
    key,
    ops,
    cursorAfterFrame,
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

/** The session a run opened, or null — the last non-null push. */
const opened = (sessions: (StampSession | null)[]): StampSession | null =>
  sessions.filter((s): s is StampSession => s !== null).at(-1) ?? null;

test.skipIf(!bunWebGpuAvailable())(
  "two corner clicks open the session on the drawn region — and commit NO cell selection",
  async () => {
    const f = await stampEntryFixture();
    try {
      f.host.startStamp("hall");
      expect(f.pending.at(-1)).toEqual({ id: "hall", name: "Hall" });

      f.click(20, 20); // the first corner ANCHORS — still no session
      expect(opened(f.sessions)).toBeNull();
      expect(f.pending.at(-1)).toEqual({ id: "hall", name: "Hall" });

      f.click(44, 44); // the second CLOSES the region
      const session = opened(f.sessions);
      if (session === null) throw new Error("no session opened");
      expect(session.generator).toBe("hall");
      // The arm is spent the moment its region lands: leaving it set would make
      // the next click start a SECOND region for a session already open.
      expect(f.pending.at(-1)).toBeNull();

      // The region is a real, non-degenerate box on the 0.5 m lattice — the same
      // snap a box SELECTION gets (`snapSpan`), reached through the same path.
      const { min, max } = session.region;
      for (const axis of [0, 1, 2] as const) {
        expect(max[axis]).toBeGreaterThan(min[axis]);
        expect((min[axis] * 2) % 1).toBe(0);
        expect((max[axis] * 2) % 1).toBe(0);
      }

      // The DISCRIMINATING half: the completed box must not also displace the
      // cell selection. Routing region-draw through `commitSelectionSpec` would
      // pass every other assertion here and silently overwrite what the user had.
      expect(f.selections).toEqual([null]);
      expect(f.errors).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "Esc drops the pending CORNER first and the arm second — one rung per press",
  async () => {
    const f = await stampEntryFixture();
    try {
      f.host.startStamp("maze");
      f.click(20, 20); // a corner is down

      f.key("Escape");
      // Rung one took the anchor, NOT the arm: the user re-draws rather than
      // re-picking the generator.
      expect(f.pending.at(-1)).toEqual({ id: "maze", name: "Maze" });

      f.key("Escape");
      expect(f.pending.at(-1)).toBeNull();

      // …and the dropped corner really is gone: two fresh clicks make a region
      // from the SECOND pair, not from the abandoned first corner. With the arm
      // cleared, nothing opens at all.
      f.click(20, 20);
      f.click(44, 44);
      expect(opened(f.sessions)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a selection-first startStamp still opens on the SELECTION, arming nothing",
  async () => {
    const f = await stampEntryFixture();
    try {
      // Box-select a region the ordinary way, then stamp into it.
      f.host.setGesture("box");
      f.click(20, 20);
      f.click(44, 44);
      const selected = f.selections.at(-1);
      if (selected === undefined || selected === null)
        throw new Error("no selection committed");
      const aabb = selected.aabb;
      if (aabb === null) throw new Error("the selection reported no AABB");

      f.host.startStamp("hall");
      const session = opened(f.sessions);
      if (session === null) throw new Error("no session opened");
      // Straight to a session: the pending seam never fires past its initial push.
      expect(f.pending).toEqual([null]);
      // On the SELECTION's own box, snapped — not on anything drawn afterwards.
      expect(session.region.min).toEqual(aabb.min);
      expect(session.region.max).toEqual(aabb.max);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "the brush is SUSPENDED while a session stands (D-F4.5-7)",
  async () => {
    const f = await stampEntryFixture();
    try {
      // Arm the brush, then open a session from region-draw — the ordinary route
      // now that picking a stamp no longer needs a selection first.
      f.host.setGesture(null);
      expect(f.ops()).toEqual([]);

      // The brush IS live before the session: one click, one op. Without this the
      // assertion below would pass against a canvas that never strokes at all.
      f.click(32, 32);
      expect(f.ops().length).toBe(1);

      f.host.startStamp("hall");
      f.click(20, 20);
      f.click(44, 44);
      expect(opened(f.sessions)).not.toBeNull();

      // Same gesture state (`null` — the brush), same click, and now nothing
      // happens: a stroke here would carve the rock the ghost is being fitted to.
      f.click(32, 32);
      expect(f.ops().length).toBe(1);

      // …and the brush comes back when the session goes.
      f.host.cancelStamp();
      f.click(32, 32);
      expect(f.ops().length).toBe(2);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "an arm and a session are mutually exclusive, in BOTH directions",
  async () => {
    const f = await stampEntryFixture({ ops: hallOps() });
    try {
      // (1) Arming while a session stands ends it. Chrome-unreachable today (the
      // registry's `armsTool` gate refuses the key and the rail button), so this is
      // the only thing holding the invariant every surface picks a name from.
      f.host.openEntity(HALL_ENTITY_ID);
      expect(opened(f.sessions)).not.toBeNull();
      f.host.startStamp("maze");
      expect(f.sessions.at(-1)).toBeNull();
      expect(f.pending.at(-1)).toEqual({ id: "maze", name: "Maze" });

      // (2) …and opening a session ends the arm. THIS direction is reachable by
      // hand — the Entities palette's Open button is not gated on a pending arm —
      // and without it the next click would draw a region for a stamp nobody is
      // looking at any more.
      f.host.openEntity(HALL_ENTITY_ID);
      expect(f.pending.at(-1)).toBeNull();
      expect(opened(f.sessions)).not.toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "the canvas cursor follows the armed family (D-F4.5-8)",
  async () => {
    const f = await stampEntryFixture({ frames: true });
    try {
      // `pointer` is the default arm, and the ONLY one that keeps the plain arrow.
      expect(f.cursorAfterFrame(16)).toBe("default");

      f.host.setGesture("box");
      expect(f.cursorAfterFrame(32)).toBe("crosshair");

      f.host.setGesture("pointer");
      expect(f.cursorAfterFrame(48)).toBe("default");

      // A pending stamp overrides the arm underneath it — and `pointer` is the
      // arm it is most often picked from, so this is the case that matters.
      f.host.startStamp("hall");
      expect(f.cursorAfterFrame(64)).toBe("crosshair");
    } finally {
      f.teardown();
    }
  },
);
