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
// HERE and not in `tests/field-host/` (this slice's PURE module tests): `bun
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
import { createFieldHost } from "../src/field-host/field-host.ts";
import type {
  PendingStamp,
  SelectionInfo,
  StampSession,
  ViewportGesture,
} from "../src/field-host/index.ts";
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

// --- …and it drops the pending ANCHORS, exactly as its sibling does ----------
//
// The no-selection branch clears both anchors and says why: `cursorAffordance` answers
// `null` for any anchored gesture, the hologram goes on tracking a sweep that can no
// longer happen, and Esc spends its first press on a point the user believes is gone.
// All three hold when the session opens SELECTION-first, and D-7 suspends the brush
// while a session pends anyway — a live anchor under one is a contradiction.
//
// The branch said "supersedes any arm" and superseded neither anchor. Its
// `setPendingStamp(null)` looks like it would cover the corner — the clear does live in
// that setter — but the setter's first line returns on an unchanged id, so with NOTHING
// armed the call is a complete no-op. That is why the ARM_EXITS row below (which reaches
// this same branch WITH a stamp armed, so the setter really disarms) was green
// throughout: the two paths differ by exactly the guard.
//
// Pinned by CONSEQUENCE rather than by the assignment: `segmentAnchor` is not readable
// from outside, and "the anchor is null" is an implementation fact where "one Esc still
// discards the session" is the thing a user would notice. Rung one of the ladder is "a
// half-drawn gesture", so a stale anchor eats the press that should have ended the
// session — the exact wording of the sibling's comment, turned into an assertion.
const STALE_ANCHORS: readonly {
  name: string;
  /** Leave one pending anchor down. `box` is armed and its selection is committed. */
  arm: (f: Awaited<ReturnType<typeof stampEntryFixture>>) => void;
}[] = [
  {
    name: "a pending segment point",
    arm: (f) => {
      f.host.setGesture("segment");
      f.click(20, 20);
    },
  },
  {
    // `box` is still armed from the selection above, so this is corner one of a NEW
    // region — the selection it would close is not the one already committed.
    name: "a pending box corner",
    arm: (f) => f.click(20, 20),
  },
];

for (const row of STALE_ANCHORS) {
  test.skipIf(!bunWebGpuAvailable())(
    `a selection-first startStamp drops ${row.name}`,
    async () => {
      const f = await stampEntryFixture();
      try {
        f.host.setGesture("box");
        f.click(14, 14);
        f.click(50, 50);
        expect(f.selections.at(-1)).not.toBeNull();

        row.arm(f);
        f.host.startStamp("hall");
        expect(opened(f.sessions)).not.toBeNull();

        // ONE Esc has to reach the SESSION. With a stale anchor standing the ladder
        // stops at rung one instead, clearing a point nothing on screen still explains,
        // and the session the user was trying to discard is still there.
        f.key("Escape");
        expect(f.sessions.at(-1)).toBeNull();
        expect(f.errors).toEqual([]);
      } finally {
        f.teardown();
      }
    },
  );
}

// --- disarming the stamp takes its pending corner with it -------------------
//
// ONE table, because the claim is one rule: the clear lives inside
// `setPendingStamp` rather than at its callers, so every path that disarms drops
// the corner whether or not its author thought about anchors. Before that move
// each of these left an amber cross drawing with nothing armed to close it, and
// each ate an Esc rung on the way out.
//
// `boxAnchor` is not readable, so the corner is observed the only way it is from
// outside: a corner still down makes the NEXT click a CLOSING click, which commits
// a cell selection. `box` is therefore armed for the whole case — re-arming it
// afterwards to observe would clear the anchor and the probe would pass against
// anything (it did: the first cut of this table stayed green under sabotage, which
// is the ninth instance of this slice's fixture defect and the reason the probe is
// spelled out here).
//
// THREE exits are deliberately absent, because each clears the anchor on its own
// path BEFORE this rule could and a row for it could not fail:
//   - Esc — rung one IS the anchor (pinned in "Esc drops the pending CORNER first").
//   - arming a DIFFERENT gesture — `setGesture`'s own `setBoxAnchor(null)`, and it
//     also changes what a probe click would do.
//   - a world reset — `resetWorld`'s own line (its ARM clear is pinned headless).
const ARM_EXITS: readonly {
  name: string;
  /** Run the exit. `box` is armed, the stamp is armed over it, one corner is down. */
  exit: (f: Awaited<ReturnType<typeof stampEntryFixture>>) => void;
}[] = [
  {
    // The one that NEEDS the clear to live in the setter: `setGesture` returns at
    // its same-gesture guard, above its own anchor clears. Reached by `armBrush`
    // on every brush pick made from under an arm.
    name: "re-pushing the gesture already armed",
    exit: (f) => f.host.setGesture("box"),
  },
  {
    name: "opening an entity session (the palette's Open)",
    exit: (f) => f.host.openEntity(HALL_ENTITY_ID),
  },
  {
    // `beginMove` opens the SAME session through `beginMoveSession`, so every `G`
    // grab is this exit too — the site the per-branch fix would have missed.
    name: "a G grab (the same session, via beginMove)",
    exit: (f) => {
      f.host.beginMove(HALL_ENTITY_ID);
      // The cancel is OBSERVATION SETUP, not part of the exit: a live grab owns
      // LMB (the press DROPS it), so the probe click below would never reach the
      // box branch and this row would pass against anything. It was green exactly
      // that way until this line. `cancelStampSession` touches no anchor, so it
      // cannot stand in for the rule under test.
      f.host.cancelStamp();
    },
  },
  {
    // Reselect restores a PARKED selection with no click at all, which is what
    // makes a selection-first `startStamp` reachable while a corner is down.
    name: "Reselect, then a selection-first startStamp",
    exit: (f) => {
      f.host.reselect();
      f.host.startStamp("hall");
    },
  },
];

for (const row of ARM_EXITS) {
  test.skipIf(!bunWebGpuAvailable())(
    `the pending corner goes with the arm: ${row.name}`,
    async () => {
      const f = await stampEntryFixture({ ops: hallOps() });
      try {
        // A real selection, then Clear — which PARKS it in the Reselect slot. That
        // is what the last row restores; it is inert for the others.
        f.host.setGesture("box");
        f.click(14, 14);
        f.click(50, 50);
        expect(f.selections.at(-1)).not.toBeNull();
        f.host.clearSelection();

        f.host.startStamp("maze");
        f.click(20, 20); // one corner down — LMB routes to the ARM, not to box
        expect(f.pending.at(-1)).toEqual({ id: "maze", name: "Maze" });

        row.exit(f);
        expect(f.pending.at(-1)).toBeNull();

        // `box` is still what LMB does, and no gesture was re-armed to get here.
        // With the corner gone this click can only ANCHOR; with it standing, it
        // would close a region and commit a selection nobody asked for.
        const before = f.selections.length;
        f.click(44, 44);
        expect(f.selections.length).toBe(before);
      } finally {
        f.teardown();
      }
    },
  );
}

test.skipIf(!bunWebGpuAvailable())(
  "arming a stamp drops a pending SEGMENT point too, not just a box corner",
  async () => {
    const f = await stampEntryFixture();
    try {
      f.host.setGesture("segment");
      f.click(20, 20); // a segment start is down
      f.host.startStamp("hall");
      expect(f.pending.at(-1)).toEqual({ id: "hall", name: "Hall" });

      // ONE Esc. With the segment point cleared at arm time this reaches the ARM's
      // rung and disarms; with it left standing, rung one spends the press on a
      // point the user believes is long gone and the arm survives.
      //
      // The stale point is not merely cosmetic: `cursorAffordance` answers `null`
      // for ANY anchored gesture, so it would suppress the region cross this arm
      // exists to show, while `onPointerMove` went on live-tracking a capsule for
      // a sweep that can no longer happen.
      f.host.escape();
      expect(f.pending.at(-1)).toBeNull();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "re-arming the SAME stamp restarts its region draw (a deliberate reset, not a no-op)",
  async () => {
    const f = await stampEntryFixture();
    try {
      f.host.startStamp("hall");
      f.click(20, 20); // corner one
      // Pressing `S` again on the stamp already armed. The arm does not change —
      // the seam pushes nothing — but the CORNER is dropped: `startStamp` clears
      // both anchors before arming, and it does so whether or not the arm moves.
      // Chosen rather than inherited: a user who presses the same stamp key mid-
      // draw is starting over, and "arming drops both anchors" is the rule every
      // other arm already follows. Keeping the corner would make this the one
      // arming path that silently preserves one.
      f.host.startStamp("hall");
      expect(f.pending).toEqual([null, { id: "hall", name: "Hall" }]);

      // So the next two clicks are corner one and corner two of a FRESH region —
      // if the first corner had survived, this single click would have closed a
      // region and opened a session.
      f.click(44, 44);
      expect(opened(f.sessions)).toBeNull();
      f.click(50, 50);
      expect(opened(f.sessions)).not.toBeNull();
    } finally {
      f.teardown();
    }
  },
);

/** Every arm whose LMB COMMITS A FIELD OP, with the click sequence that does it —
 *  the set D-F4.5-7's suspension has to cover, spelled as data so it cannot be
 *  covered for one member and quietly missed for the other.
 *
 *  It is exactly two: the sphere brush strokes on one press, and the segment brush
 *  sweeps a capsule on the second of a pair. `pointer` and the two flood modes are
 *  deliberately absent — they SELECT, they never write to the store, and they stay
 *  live during a session on purpose. */
const COMMITTING_ARMS: readonly {
  gesture: ViewportGesture | null;
  name: string;
  /** One committing sequence — the last click is the one that writes the op. */
  clicks: readonly (readonly [number, number])[];
}[] = [
  { gesture: null, name: "the sphere brush", clicks: [[32, 32]] },
  {
    gesture: "segment",
    name: "the segment brush",
    clicks: [
      [30, 30],
      [36, 36],
    ],
  },
];

for (const arm of COMMITTING_ARMS) {
  test.skipIf(!bunWebGpuAvailable())(
    `${arm.name} is SUSPENDED while a session stands (D-F4.5-7)`,
    async () => {
      const f = await stampEntryFixture();
      const stroke = (): void => {
        for (const [x, y] of arm.clicks) f.click(x, y);
      };
      try {
        f.host.setGesture(arm.gesture);
        expect(f.ops()).toEqual([]);

        // It IS live before the session: one sequence, one op. Without this
        // before-shot the assertion below would pass against a canvas that never
        // strokes at all.
        stroke();
        expect(f.ops().length).toBe(1);

        // Open a session from region-draw — the ordinary route now that picking a
        // stamp no longer needs a selection first, and the route that leaves
        // whatever was armed still armed underneath.
        f.host.startStamp("hall");
        f.click(20, 20);
        f.click(44, 44);
        expect(opened(f.sessions)).not.toBeNull();

        // Same arm, same clicks, and now nothing happens: a stroke here would
        // carve the rock the ghost is being fitted to. The segment brush is the
        // member this test exists for — it reaches the store through a DIFFERENT
        // branch of onPointerDown than the sphere brush does.
        const errorsBefore = f.errors.length;
        stroke();
        expect(f.ops().length).toBe(1);

        // …and the swallow SPEAKS. Every other suspension signal is ambient (the
        // strip's clause, the hidden ghost, the rail's refusals) and none of them
        // fires at the click, which is the moment the user is asking. ONCE per
        // session, though — including for the two-click arm, whose second click
        // finds the latch already spent.
        expect(f.errors.length).toBe(errorsBefore + 1);
        expect(f.errors.at(-1)).toContain("suspended");
        stroke();
        expect(f.errors.length).toBe(errorsBefore + 1);

        // …and the brush comes back when the session goes.
        f.host.cancelStamp();
        stroke();
        expect(f.ops().length).toBe(2);
      } finally {
        f.teardown();
      }
    },
  );
}

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
      // `pointer` is the default arm, and the ONLY live arm that keeps the plain
      // arrow.
      expect(f.cursorAfterFrame(16)).toBe("default");

      // A two-click gesture spans between points rather than committing at one.
      f.host.setGesture("box");
      expect(f.cursorAfterFrame(32)).toBe("cell");

      // …a brush commits AT the point.
      f.host.setGesture(null);
      expect(f.cursorAfterFrame(48)).toBe("crosshair");

      f.host.setGesture("pointer");
      expect(f.cursorAfterFrame(64)).toBe("default");

      // A pending stamp overrides the arm underneath it — and `pointer` is the
      // arm it is most often picked from, so this is the case that matters.
      f.host.startStamp("hall");
      expect(f.cursorAfterFrame(80)).toBe("cell");

      // …and a live SESSION takes the suspended brush back to the plain arrow: a
      // crosshair over a click the host is going to swallow is the same false
      // promise the ghost is hidden to avoid. Reached the ordinary way — the arm
      // was picked from under a brush, so the brush is what it lands back on.
      f.host.setGesture(null);
      f.host.startStamp("hall");
      f.click(20, 20);
      f.click(44, 44);
      expect(f.cursorAfterFrame(96)).toBe("default");
    } finally {
      f.teardown();
    }
  },
);
