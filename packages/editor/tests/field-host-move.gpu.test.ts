// The POINTER half of entity move (F4.5b Task 5) on a real (bun-webgpu)
// context: the drag threshold, the cursor→lattice mapping, the gizmo's axis
// constraint, the drop, and the two ways a drag can end without one.
//
// It needs a device even though nothing here draws, for `field-host-pointer.gpu`'s
// reason: every one of these paths resolves through `cursorRay` →
// `camera.screenToRay`, and there is no camera until `init` has acquired a
// context. Same recipe too — the canvas RECORDS the listeners the host registers
// and the tests call the real handlers with synthetic events, because the move
// state machine has no method seam for the pointer half.
//
// HERE and not in `tests/viewport-host/`: `bun test` runs a directory's own files
// before its subdirectories, and `tests/chrome/` registers happy-dom, which
// replaces `globalThis.navigator` — taking `navigator.gpu` with it. Every host
// GPU test is in this directory for that reason.
//
// WHY THE ASSERTIONS ARE INVARIANTS, not screen-to-world literals: the mapping
// under test is `cursorRay` ∩ a world plane, and the only way to predict its
// output in metres is to re-run the host's own arithmetic here — a tautology
// that would agree with a broken host as readily as a correct one. What is
// checked instead cannot be faked by re-deriving anything: a drag out and back
// returns the region EXACTLY, every landing is on the 0.5 m lattice, a farther
// drag moves farther, and each mode moves the axes it owns and no others.
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
import { LATTICE } from "../src/shared/field-brush.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FieldWorkerRequest } from "../src/viewport-host/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/viewport-host/field-protocol.ts";
import type { StampSession } from "../src/viewport-host/field-stamp.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameNoop } from "./_helpers/raf.ts";

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

const TABLE: MaterialTable = {
  classes: [
    // Positional: `classOf` indexes `classes` BY id, so the middle class is
    // present because id 2 has to be at index 2 — not because anything here
    // paints with dirt.
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
 *  arithmetic in the test. Lattice-aligned on every face — which is what lets the
 *  "the region stays on the lattice" assertions mean something. */
const REGION = {
  min: [-2.5, -1, -2.5] as [number, number, number],
  max: [2.5, 3, 2.5] as [number, number, number],
};

/** The canvas centre — where the starting camera looks. */
const CENTRE = 32;

/** Flipped by a test to make the NEXT preview fail. The fake worker rewrites the
 *  request's generator to an id the registry does not carry, so the REAL handler
 *  throws at `generatorById` and answers with its own typed error response —
 *  the same path a genuine evaluate failure takes, rather than a hand-rolled
 *  rejection that could diverge from it. */
const preview = { failNext: false };

function installFakeWorker(): () => void {
  const real = globalThis.Worker;
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    private readonly handle = createFieldWorkerHandler((msg) => {
      this.onmessage?.({ data: msg } as MessageEvent);
    });
    postMessage(msg: unknown): void {
      const req = msg as FieldWorkerRequest;
      if (preview.failNext && req.kind === "stamp-preview") {
        preview.failNext = false;
        this.handle({ ...req, generator: "no-such-generator" });
        return;
      }
      this.handle(req);
    }
    terminate(): void {
      // fake worker: nothing to tear down
    }
  }
  // Boundary cast: the host spawns through the DOM Worker constructor; the fake
  // implements the WorkerLike subset field-client.ts actually calls.
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  return () => {
    globalThis.Worker = real;
  };
}

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** An initialized host over one committed hall, with the recorded input
 *  handlers and the session/selection pushes. Callers own `teardown`. */
async function moveFixture() {
  const uninstallWorker = installFakeWorker();
  const restoreRo = installMockResizeObserver();
  // The NO-OP rAF variant: nothing here observes a frame — every path under test
  // runs inside an input handler.
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

  const sessions: (StampSession | null)[] = [];
  const selected: (number | null)[] = [];
  const errors: string[] = [];
  host.subscribeStamp((s) => sessions.push(s));
  host.subscribeEntitySelection((id) => selected.push(id));
  host.subscribeToolError((m) => errors.push(m));

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
  const move = (x: number, y: number, shiftKey = false): void =>
    fire("pointermove", { clientX: x, clientY: y, shiftKey, pointerId: 1 });
  const up = (button = 0): void => fire("pointerup", { button, pointerId: 1 });
  const key = (k: string, shiftKey = false): void =>
    fire("keydown", {
      key: k,
      metaKey: false,
      ctrlKey: false,
      shiftKey,
      altKey: false,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    });

  return {
    host,
    entityId,
    sessions,
    selected,
    errors,
    down,
    move,
    up,
    key,
    fire,
    session: (): StampSession | null => sessions.at(-1) ?? null,
    /** The RECORDED region of the committed hall (not the session's ghost). */
    region: () => {
      const e = host.listEntities().find((x) => x.entityId === entityId);
      if (e === undefined) throw new Error("test: the hall left the log");
      return e.region;
    },
    /** The host's LIVE op log, read back through the baked artifact — the only
     *  window onto it, and the only thing that can tell a reconfigure that
     *  changed NOTHING from one that never ran: core re-splices the span with
     *  FRESH op ids either way. */
    ops: (): FieldOp[] => {
      const file = host
        .exportArtifact("probe")
        .find((f) => f.path === "worlds/probe/oplog.json");
      if (file === undefined || typeof file.contents !== "string")
        throw new Error("test: no oplog.json in the artifact");
      return parseOps(file.contents);
    },
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
      uninstallWorker();
      preview.failNext = false;
    },
  };
}

/** Every component of a region corner sits on the 0.5 m lattice. */
const onLattice = (v: readonly number[]): boolean =>
  v.every((c) => Math.abs(c / LATTICE - Math.round(c / LATTICE)) < 1e-9);

/**
 * A canvas Y (at x = {@link CENTRE}) where a gizmo handle is grabbable, found by
 * probing upward from the footprint centre and leaving no session behind.
 *
 * SEARCHED rather than computed, deliberately: predicting where a world-space
 * arm projects means re-running the host's camera math in the test, which would
 * agree with a broken projection as readily as a correct one. A press that opens
 * a session with NO threshold move can only be the gizmo — every other press
 * arms a pending click — so the probe is unambiguous, and the caller requires
 * the entity to be selected before calling.
 */
async function findHandlePixel(
  f: Awaited<ReturnType<typeof moveFixture>>,
): Promise<number> {
  for (let dy = 2; dy <= 24; dy++) {
    f.down(CENTRE, CENTRE - dy);
    if (f.session() !== null) {
      await settle();
      f.key("escape"); // leave the fixture as it was found
      return CENTRE - dy;
    }
    f.up(); // an ordinary press: release it before the next probe
  }
  throw new Error("test: no gizmo handle found along the vertical");
}

// --- the drag threshold -----------------------------------------------------

test.skipIf(!bunWebGpuAvailable())(
  "a press on the SELECTED entity becomes a move only past the 4 px threshold",
  async () => {
    const f = await moveFixture();
    try {
      // The click that selects it — the ordinary `pointer` path (D-F4.5-7's
      // default gesture), proven end to end in field-host-pointer.gpu.test.ts.
      f.down(CENTRE, CENTRE);
      f.up();
      expect(f.selected.at(-1)).toBe(f.entityId);

      // A press on what is already selected. Under the threshold this is still a
      // CLICK: a 2 px tremor between mousedown and mouseup must not open a
      // session, let alone splice the log.
      f.down(CENTRE, CENTRE);
      f.move(CENTRE + 2, CENTRE + 1);
      await settle();
      expect(f.session()).toBeNull();

      // …and past it the press is a move.
      f.move(CENTRE + 10, CENTRE + 8);
      await settle();
      const s = f.session();
      expect(s).not.toBeNull();
      expect(s?.moving).toBe(true);
      expect(s?.entityId).toBe(f.entityId);
      f.up();
      await settle();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a press on something NOT selected still selects it, and arms no move",
  async () => {
    const f = await moveFixture();
    try {
      // Nothing selected yet, so this press is an ordinary pick — and dragging
      // afterwards must not turn the pick into a move, or the first click on any
      // entity would be able to shove it.
      f.down(CENTRE, CENTRE);
      f.move(CENTRE + 20, CENTRE + 20);
      await settle();
      expect(f.selected.at(-1)).toBe(f.entityId);
      expect(f.session()).toBeNull();
      f.up();
    } finally {
      f.teardown();
    }
  },
);

// --- the mapping ------------------------------------------------------------

/** Selects the hall and drags it from the canvas centre to `(x, y)`, leaving the
 *  drag OPEN (no drop). Returns the fixture. */
async function draggedTo(
  f: Awaited<ReturnType<typeof moveFixture>>,
  x: number,
  y: number,
  shiftKey = false,
): Promise<void> {
  f.down(CENTRE, CENTRE);
  f.move(x, y, shiftKey);
  await settle();
}

test.skipIf(!bunWebGpuAvailable())(
  "a ground drag moves X and Z on the lattice, never Y — and comes back exactly",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      expect(f.session()).toBeNull(); // a selection is not a session

      await draggedTo(f, CENTRE + 14, CENTRE + 12);
      const out = f.session()?.region;
      if (out === undefined) throw new Error("test: no move session");
      // The ghost really moved — a mapping that produced nothing would make
      // every assertion below vacuously true.
      expect(out.min).not.toEqual(REGION.min);
      // Ground drag: the horizontal plane owns X and Z. Y is the ⇧ promotion's
      // axis and must not creep in.
      expect(out.min[1]).toBeCloseTo(REGION.min[1], 10);
      expect(out.max[1]).toBeCloseTo(REGION.max[1], 10);
      // Whole lattice steps, both corners — a continuous drag that leaked
      // sub-lattice metres would leave the region off-grid and the generator
      // anchoring somewhere the numbers do not say.
      expect(onLattice(out.min)).toBe(true);
      expect(onLattice(out.max)).toBe(true);
      // The region keeps its SIZE: a move translates, it does not resize.
      expect(out.max[0] - out.min[0]).toBeCloseTo(
        REGION.max[0] - REGION.min[0],
        10,
      );
      expect(out.max[2] - out.min[2]).toBeCloseTo(
        REGION.max[2] - REGION.min[2],
        10,
      );

      // Back to the press point: the mapping is anchored, not incremental, so
      // the round trip must land EXACTLY where it started. A drift of one step
      // per event would show up here and nowhere else.
      f.move(CENTRE, CENTRE);
      await settle();
      expect(f.session()?.region).toEqual(REGION);

      // Esc, so nothing here writes to the log.
      f.key("escape");
      expect(f.session()).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

// The step bookkeeping, from the side that `onLattice` cannot see. `nudgeRegion`
// rounds its own argument, so a host that skipped the rounding here would STILL
// land every region on the lattice and still round-trip — the assertions above
// all stay green. What it would not do is stay quiet: `applied` would hold
// fractional steps, every sub-step cursor twitch would compute a non-zero
// difference, and each one would bump the session run and re-fire a preview.
// This is the case that observes that.
test.skipIf(!bunWebGpuAvailable())(
  "cursor motion that changes no step re-previews NOTHING",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 14, CENTRE + 12);
      const settled = f.session();
      if (settled === null) throw new Error("test: no move session");
      const runAt = settled.run;
      const pushes = f.sessions.length;

      // Fractions of a pixel — far under half a lattice step in world metres, so
      // the region has nothing to do and the session must not move at all.
      f.move(CENTRE + 14.1, CENTRE + 12.05);
      f.move(CENTRE + 13.95, CENTRE + 12.1);
      await settle();
      expect(f.session()?.run).toBe(runAt);
      expect(f.sessions.length).toBe(pushes);

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a farther drag moves farther — the mapping tracks the cursor, it does not just fire once",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 8, CENTRE + 6);
      const near = f.session()?.region.min;
      f.move(CENTRE + 24, CENTRE + 18);
      await settle();
      const far = f.session()?.region.min;
      if (near === undefined || far === undefined)
        throw new Error("test: no move session");
      const d = (a: readonly number[]): number =>
        Math.hypot(
          (a[0] as number) - REGION.min[0],
          (a[2] as number) - REGION.min[2],
        );
      expect(d(far)).toBeGreaterThan(d(near));

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "⇧ held during a drag promotes it to Y — and only Y",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      // Ground first, then ⇧ mid-drag: the promotion RE-ANCHORS, so the switch
      // itself moves nothing and what came before is kept.
      await draggedTo(f, CENTRE + 14, CENTRE + 12);
      const ground = f.session()?.region;
      if (ground === undefined) throw new Error("test: no move session");

      f.move(CENTRE + 14, CENTRE + 12, true);
      await settle();
      expect(f.session()?.region).toEqual(ground); // the switch alone: no motion

      f.move(CENTRE + 14, CENTRE - 12, true);
      await settle();
      const lifted = f.session()?.region;
      if (lifted === undefined) throw new Error("test: no move session");
      expect(lifted.min[1]).not.toBeCloseTo(ground.min[1], 10);
      expect(lifted.min[0]).toBeCloseTo(ground.min[0], 10);
      expect(lifted.min[2]).toBeCloseTo(ground.min[2], 10);
      expect(onLattice(lifted.min)).toBe(true);

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "RMB re-aiming mid-drag moves NOTHING — the anchor is a world point, not a pixel",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 14, CENTRE + 12);
      const before = f.session()?.region;
      if (before === undefined) throw new Error("test: no move session");

      // RMB look stays live during a move on purpose (a free-hand grab wants to
      // be re-aimed). But the anchor was captured under the OLD camera: turn the
      // view and the SAME pixel maps somewhere else, so `point − anchor` jumps by
      // metres the user never dragged. Cursor returned to exactly where it was.
      f.down(CENTRE + 14, CENTRE + 12, 2);
      f.move(CENTRE + 34, CENTRE + 12);
      f.up(2);
      f.move(CENTRE + 14, CENTRE + 12);
      await settle();

      expect(f.session()?.region).toEqual(before);

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a wheel DOLLY mid-drag moves nothing either — the retirement is per camera path, not per look",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 14, CENTRE + 12);
      const before = f.session()?.region;
      if (before === undefined) throw new Error("test: no move session");

      // F4.5b Task 6 moved the anchor retirement to `applyOrbit` — the ONE place
      // every camera path ends — precisely so it covers the paths that did NOT
      // exist when it lived on the pointerup: the wheel dolly here, the fly step,
      // and `F`/`snapView`. The RMB case above cannot stand in for any of them:
      // narrowing the retirement back to `if (look !== null)` leaves that test
      // green and this one red. The dolly TRANSLATES the rig, so the same pixel
      // maps somewhere else just as it does after a turn. Cursor returned to
      // exactly where it was.
      f.fire("wheel", { deltaY: -100, preventDefault: () => undefined });
      f.move(CENTRE + 14, CENTRE + 12);
      await settle();

      expect(f.session()?.region).toEqual(before);

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

// --- the gizmo --------------------------------------------------------------

test.skipIf(!bunWebGpuAvailable())(
  "a press on a gizmo handle starts an AXIS-constrained move with no threshold",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      expect(f.selected.at(-1)).toBe(f.entityId);

      // The arms radiate from the footprint's CENTRE, which is the pixel the
      // click above landed on — so every probe is inside the footprint box, and a
      // session opening on the press ALONE (no threshold move) is what proves the
      // gizmo beats the volume tier rather than merely existing.
      const handle = await findHandlePixel(f);
      f.down(CENTRE, handle);
      expect(f.session()?.moving).toBe(true);
      await settle();

      // Drag well away in BOTH screen axes. An unconstrained mapping would move
      // two world axes; the handle's job is to let exactly one through.
      f.move(CENTRE + 20, handle + 14);
      await settle();
      const out = f.session()?.region.min;
      if (out === undefined) throw new Error("test: no move session");
      const movedAxes = [0, 1, 2].filter(
        (i) => Math.abs((out[i] as number) - (REGION.min[i] as number)) > 1e-9,
      );
      // EXACTLY one, not "at most one": a mapping that moved nothing at all
      // would satisfy the constraint vacuously, and `onLattice` passes trivially
      // on an unchanged region — the same trap the ground-drag case guards with
      // its `not.toEqual(REGION.min)`.
      expect(movedAxes).toHaveLength(1);
      expect(onLattice(out)).toBe(true);

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

// `gizmoVisible`'s three conditions, from the only side a test can reach them:
// whether a press on a handle pixel starts a move. The predicate is what makes
// the drawn thing and the pickable thing the same thing, so each condition
// failing open would mean a click that moves something with no affordance on
// screen saying it would.
test.skipIf(!bunWebGpuAvailable())(
  "the gizmo is unpickable with no selection, with a brush armed, and under a FOREIGN session",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      const handle = await findHandlePixel(f);

      // 1. NOTHING SELECTED. The gizmo is the selection's affordance; with the
      //    selection cleared the same pixel is bare space.
      f.host.selectEntity(null);
      f.down(CENTRE, handle);
      expect(f.session()).toBeNull();
      f.up();

      // 2. A BRUSH ARMED. LMB digs under any non-pointer gesture, so a handle
      //    there would promise a move the click will not make.
      f.host.selectEntity(f.entityId);
      f.host.setGesture("box");
      f.down(CENTRE, handle);
      expect(f.session()).toBeNull();
      f.up();
      f.host.setGesture("pointer");

      // 3. A FOREIGN SESSION. `openEntity` already owns the region through the
      //    card's own nudges; a handle over that ghost is a second way to move
      //    one thing.
      f.host.openEntity(f.entityId);
      await settle();
      const opened = f.session();
      expect(opened?.moving).toBeUndefined();
      f.down(CENTRE, handle);
      // The press neither started a move nor replaced the session.
      expect(f.session()?.moving).toBeUndefined();
      f.up();
      f.key("escape");

      // …and with all three conditions back, the same pixel works — otherwise
      // this whole case would pass against a gizmo that is simply never pickable.
      f.down(CENTRE, handle);
      expect(f.session()?.moving).toBe(true);
      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a press inside the gizmo's DEAD ZONE is a free drag, not an axis drag",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      // The footprint centre is where all three arms converge and where the
      // dead zone is. The pure test pins that `pickAxis` culls it; this pins
      // that the host passes the SAME inner bound it draws from — a host that
      // drew the gap but picked from zero would open an axis-constrained move
      // here, with no threshold and no visible handle under the cursor.
      f.down(CENTRE, CENTRE);
      expect(f.session()).toBeNull(); // a pending click, not a gizmo grab
      f.move(CENTRE + 14, CENTRE + 12);
      await settle();
      expect(f.session()?.moving).toBe(true);
      // …and it is the FREE mapping: both ground axes are live.
      const out = f.session()?.region.min;
      if (out === undefined) throw new Error("test: no move session");
      const movedAxes = [0, 1, 2].filter(
        (i) => Math.abs((out[i] as number) - (REGION.min[i] as number)) > 1e-9,
      );
      expect(movedAxes.length).toBeGreaterThan(1);

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "arming another gesture mid-move cancels it",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 16, CENTRE + 14);
      expect(f.session()).not.toBeNull();

      // A move is a `pointer`-tool mode. Arming a brush means LMB now digs, so a
      // ghost still chasing the cursor would promise a drop no button will make.
      f.host.setGesture("material");

      expect(f.session()).toBeNull();
      expect(f.region()).toEqual(REGION);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "dispose ends a live move — no mapping survives the teardown",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 16, CENTRE + 14);
      expect(f.session()).not.toBeNull();

      // What this pins is the session half: a dispose mid-drag announces the end
      // rather than leaving the panel driving a session the host destroyed, and
      // no further cursor motion resurrects it.
      //
      // It does NOT distinguish `cancelStampSession()` from a bare
      // `stamp = null` — `updateMove` guards on `stamp === null` as well, so the
      // stranded MAPPING that routing exists to prevent has no effect until a
      // re-init, which this fixture does not perform. Recorded rather than
      // papered over; the reason the line is there anyway is on the source.
      f.host.dispose();
      expect(f.sessions.at(-1)).toBeNull();
      f.move(CENTRE + 30, CENTRE + 30);
      expect(f.sessions.at(-1)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

// --- the drop, and the two ways it does not happen --------------------------

test.skipIf(!bunWebGpuAvailable())(
  "pointerup drops the move: the record moves, as ONE undo step",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 16, CENTRE + 14);
      // Still only a ghost — the log has not moved.
      expect(f.session()?.region).not.toEqual(REGION);
      expect(f.region()).toEqual(REGION);

      // One more drag tick and let go WITHOUT settling, which is what a real
      // release does: the fingers leave the button within a preview round trip
      // of the last cursor move far more often than not. The drop is ready-phase
      // gated like every commit, so it has to LATCH here and land when the ghost
      // settles — otherwise the release is swallowed and the session hangs open
      // with a ghost nobody can commit.
      f.move(CENTRE + 22, CENTRE + 19);
      expect(f.session()?.phase).toBe("previewing");
      const dropped = f.session()?.region;
      if (dropped === undefined) throw new Error("test: no move session");
      f.up();
      expect(f.session()).not.toBeNull(); // nothing has landed yet
      await settle();

      expect(f.session()).toBeNull();
      // …and what landed is the LAST ghost, not the one that had settled before
      // the release: the latch commits the session as the user left it.
      expect(f.region()).toEqual(dropped);
      // The entity survived the splice.
      expect(f.host.listEntities().map((e) => e.entityId)).toEqual([
        f.entityId,
      ]);

      f.host.undo();
      expect(f.region()).toEqual(REGION);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a move dropped without moving ends the session without writing history",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      // The `G` grab, dropped with LMB before the cursor went anywhere. Driven
      // through the grab rather than a sub-lattice pointer drag because at this
      // canvas scale even the 4 px that opens a drag is worth more than half a
      // lattice step on the ground — there is no pixel delta that both crosses
      // the threshold and rounds to nothing. The branch is the same one.
      f.host.beginMove(f.entityId);
      await settle();
      expect(f.session()?.moving).toBe(true);
      expect(f.session()?.region).toEqual(REGION);
      const before = f.ops();

      f.down(CENTRE, CENTRE); // LMB drops a grab
      await settle();
      expect(f.session()).toBeNull();
      // The LOG, not just the region: a reconfigure that changed nothing still
      // re-splices the span with FRESH op ids and still spends an undo entry, and
      // the region alone cannot tell the two apart. A no-op history entry for
      // every grab the user thought better of is the thing being refused.
      expect(f.ops()).toEqual(before);
      expect(f.region()).toEqual(REGION);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "losing focus mid-drag CANCELS it — a move nobody released is not a move",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 16, CENTRE + 14);
      expect(f.session()).not.toBeNull();

      // Alt-tab: the pointerup never arrives. Committing would land a splice the
      // user never confirmed; leaving it live would strand a ghost that answers
      // to nothing. The same discipline `onBlur` already applies to stranded
      // keydown state.
      f.fire("blur", {});
      expect(f.session()).toBeNull();
      expect(f.region()).toEqual(REGION);

      // …and the drag is really gone: further cursor motion must not resurrect it.
      f.move(CENTRE + 30, CENTRE + 30);
      await settle();
      expect(f.session()).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "pointercancel discards the move; it is not a quiet drop",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 16, CENTRE + 14);
      expect(f.session()).not.toBeNull();

      f.fire("pointercancel", { button: 0, pointerId: 1 });
      await settle();
      expect(f.session()).toBeNull();
      expect(f.region()).toEqual(REGION);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a preview that FAILS under a latched drop disarms the latch and demotes the session",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      await draggedTo(f, CENTRE + 16, CENTRE + 14);

      // One more drag tick whose preview will fail, then release before it
      // settles — the exact window the latch exists for.
      preview.failNext = true;
      f.move(CENTRE + 22, CENTRE + 19);
      expect(f.session()?.phase).toBe("previewing");
      f.up();
      await settle();

      // Nothing landed, and nothing may land LATER: an armed latch would fire on
      // whatever settle came next (a re-roll, a param edit) and commit a drop the
      // user made against a ghost that never arrived.
      expect(f.region()).toEqual(REGION);
      const stalled = f.session();
      expect(stalled).not.toBeNull();
      expect(stalled?.error).not.toBeNull();
      // The session stays up — its message is the only legible reason — but it is
      // no longer a MOVE: nothing drives its region, and Task 8's card renders
      // the word off this flag.
      expect(stalled?.moving).toBeUndefined();

      // Prove the latch really is disarmed: a fresh preview settling to ready
      // must NOT commit.
      f.host.rotateStamp();
      await settle();
      expect(f.session()?.phase).toBe("ready");
      expect(f.region()).toEqual(REGION);

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "Enter over a zero-step grab drops it — same rule as the mouse-up, no history",
  async () => {
    const f = await moveFixture();
    try {
      f.down(CENTRE, CENTRE);
      f.up();
      const before = f.ops();

      f.host.beginMove(f.entityId);
      await settle();
      expect(f.session()?.moving).toBe(true);

      // Enter over a live move is a DROP, not a bare commit — otherwise
      // confirming a grab the user thought better of would spend an undo entry
      // on a reconfigure that changed nothing, while the mouse-up would not.
      f.key("enter");
      await settle();
      expect(f.session()).toBeNull();
      expect(f.ops()).toEqual(before);

      // …and Enter after a real move still commits, so the rule is about the
      // zero step and not about Enter.
      await draggedTo(f, CENTRE + 16, CENTRE + 14);
      const ghost = f.session()?.region;
      if (ghost === undefined) throw new Error("test: no move session");
      f.key("enter");
      await settle();
      expect(f.session()).toBeNull();
      expect(f.region()).toEqual(ghost);
    } finally {
      f.teardown();
    }
  },
);

// --- R, on the canvas -------------------------------------------------------

test.skipIf(!bunWebGpuAvailable())(
  "R quarter-turns the live session, and is swallowed without one",
  async () => {
    const f = await moveFixture();
    try {
      // No session: R is not a fly key and not a nudge — it does nothing at all.
      f.key("r");
      expect(f.session()).toBeNull();
      expect(f.errors).toEqual([]);

      f.host.beginMove(f.entityId);
      await settle();
      expect(f.session()?.params["rotation"]).toBe("0");

      f.key("r");
      await settle();
      expect(f.session()?.params["rotation"]).toBe("90");
      f.key("R"); // case-insensitive, like every other canvas key
      await settle();
      expect(f.session()?.params["rotation"]).toBe("180");

      f.key("escape");
    } finally {
      f.teardown();
    }
  },
);
