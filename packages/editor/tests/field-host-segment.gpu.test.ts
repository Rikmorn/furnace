// The segment brush's GESTURE on a real (bun-webgpu) context — the half a
// headless test cannot reach. Every step of it needs the camera `init` builds:
// each click resolves through `cursorRay` → `screenToRay`, and without a camera
// the handler returns before it ever anchors.
//
// So the canvas here RECORDS its listeners (the void-cast fixture's stubs them
// out, because those tests drive the host through its methods) and the tests
// call the real `pointerdown`/`keydown` handlers with synthetic events. That is
// the whole point: what is under test is the two-click state machine inside the
// host, which has no method seam at all.
import { expect, test } from "bun:test";
import type {
  BrushOp,
  FieldManifest,
  FieldOp,
  MaterialTable,
} from "@furnace/core/field";
import { chunkKey, DEFAULT_CELL_SIZE, parseOps } from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FieldHistory, FieldTool } from "../src/viewport-host/index.ts";
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

const DIG_TOOL: FieldTool = {
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
};

async function segmentFixture() {
  const restoreRo = installMockResizeObserver();
  // The NO-OP rAF variant: a tick would only render, and the two-click state
  // machine under test is driven entirely through the RECORDED input handlers.
  const restoreRaf = stubAnimationFrameNoop();
  const listeners: HostListeners = new Map();
  const host = createFieldHost();
  host.loadWorld({ manifest: MANIFEST, chunks: [], oplog: null });
  await host.init(await makeHostCanvas(listeners));
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));

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
  return {
    host,
    errors,
    click,
    key,
    ops,
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

/** The one brush op a committed segment leaves, narrowed to its capsule. */
function soleCapsule(ops: FieldOp[]): Extract<
  BrushOp["shape"],
  { kind: "capsule" }
> & {
  effect: BrushOp["effect"];
  material?: number;
} {
  expect(ops).toHaveLength(1);
  const op = ops[0] as FieldOp;
  if (op.kind !== "brush")
    throw new Error(`expected a brush op, got ${op.kind}`);
  if (op.shape.kind !== "capsule")
    throw new Error(`expected a capsule, got ${op.shape.kind}`);
  return { ...op.shape, effect: op.effect, material: op.material };
}

test.skipIf(!bunWebGpuAvailable())(
  "two clicks commit ONE capsule op with the tool's effect and radius",
  async () => {
    const f = await segmentFixture();
    try {
      f.host.setTool(DIG_TOOL);
      f.host.setDigRadius(0.75);
      f.host.setGesture("segment");

      // The FIRST click only anchors — a segment that logged an op per click
      // would be two ⌘Z, and would carve at the anchor before the user has
      // said where the tunnel goes.
      f.click(16, 16);
      expect(f.ops()).toHaveLength(0);

      // The second commits, through the ordinary log path.
      f.click(48, 40);
      const capsule = soleCapsule(f.ops());
      expect(capsule.effect).toBe("dig");
      expect(capsule.radius).toBe(0.75);
      // Two DIFFERENT screen points → two different world endpoints (each
      // click resolves its own ray), so this is a real sweep, not a sphere.
      expect(capsule.a).not.toEqual(capsule.b);
      expect(f.errors).toEqual([]);

      // …and it is ONE undo unit, like any other stroke.
      f.host.undo();
      expect(f.ops()).toHaveLength(0);

      // The anchor is spent: the next click starts a fresh segment rather than
      // sweeping from the old start point.
      f.click(20, 20);
      expect(f.ops()).toHaveLength(0);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "the committed op carries the ACTIVE tool — fill raises a rampart",
  async () => {
    const f = await segmentFixture();
    try {
      f.host.setTool({ ...DIG_TOOL, effect: "fill", materialId: 0 });
      f.host.setGesture("segment");
      f.click(16, 16);
      f.click(48, 40);
      const capsule = soleCapsule(f.ops());
      expect(capsule.effect).toBe("fill");
      expect(capsule.material).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "Esc drops a pending anchor — the next click re-anchors, it does not commit",
  async () => {
    const f = await segmentFixture();
    try {
      f.host.setTool(DIG_TOOL);
      f.host.setGesture("segment");
      f.click(16, 16); // anchor
      f.key("Escape");
      // The teeth: with the anchor still pending this click is the SECOND of
      // the pair and commits, so the log holds one op instead of none.
      f.click(48, 40);
      expect(f.ops()).toHaveLength(0);
      // Proof the gesture is still armed and re-anchored (not simply dead):
      // one more click completes the new pair.
      f.click(20, 44);
      expect(f.ops()).toHaveLength(1);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "re-arming drops a pending anchor; a selection gesture never commits a capsule",
  async () => {
    const f = await segmentFixture();
    try {
      f.host.setTool(DIG_TOOL);
      f.host.setGesture("segment");
      f.click(16, 16); // anchor
      f.host.setGesture("box"); // the two gestures share ONE slot
      f.click(48, 40); // a box-select corner, not a segment endpoint
      f.click(20, 44); // …and its second corner: a selection, no op
      expect(f.ops()).toHaveLength(0);

      // Back to segment: the pre-switch anchor is gone, so this click anchors
      // afresh and only the one after it commits.
      f.host.setGesture("segment");
      f.click(24, 24);
      expect(f.ops()).toHaveLength(0);
      f.click(40, 40);
      expect(f.ops()).toHaveLength(1);
    } finally {
      f.teardown();
    }
  },
);

/** A table with a KIT class (id 2) — kit writes are lattice-locked to a BOX,
 *  so this is what makes a capsule commit fail core's validator. */
const KIT_TABLE: MaterialTable = {
  classes: [
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

test.skipIf(!bunWebGpuAvailable())(
  "loading a different world drops a pending anchor",
  async () => {
    const f = await segmentFixture();
    try {
      f.host.setTool(DIG_TOOL);
      f.host.setGesture("segment");
      f.click(16, 16); // anchor, in THIS world

      // Load is reachable with a half-drawn segment on screen. The anchor is a
      // point in the field that just went away; carried over, the next click
      // sweeps a capsule from somewhere the user never clicked in a world they
      // have not seen.
      f.host.loadWorld({ manifest: MANIFEST, chunks: [], oplog: null });
      f.click(48, 40); // must ANCHOR afresh, not commit
      expect(f.ops()).toHaveLength(0);

      // …and the gesture is still armed, so the pair completes normally.
      f.click(20, 44);
      expect(f.ops()).toHaveLength(1);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a kit-class fill under Segment is REPORTED, not thrown, and writes nothing",
  async () => {
    const f = await segmentFixture();
    try {
      // Kit classes stay grid-locked to a lattice BOX, so core rejects a
      // capsule carrying one (assertOpValid). The segment gesture is the only
      // path that can build that op — a plain stroke swaps in a snapped box —
      // which makes this the ONE reachable case for that setup-loud throw, and
      // the editor's job is to surface it rather than let it escape the
      // pointer handler.
      f.host.setMaterialTable(KIT_TABLE);
      f.host.setTool({ ...DIG_TOOL, effect: "fill", materialId: 2 });
      f.host.setGesture("segment");
      f.click(16, 16);
      f.click(48, 40);
      expect(f.ops()).toHaveLength(0);
      expect(f.errors.at(-1)).toMatch(/kit-class writes require a box shape/);

      // The anchor is still consumed: a rejected commit must not leave the
      // gesture half-armed, or the next click sweeps from a stale point.
      f.click(20, 44);
      expect(f.ops()).toHaveLength(0);
    } finally {
      f.teardown();
    }
  },
);

// --- the 60 m length clamp (D-F4-16) ----------------------------------------
//
// A segment sweeps a capsule between two raw surface hits, and each op's cost is
// linear in that length: an accidental cross-world pair (a click, an orbit, a
// second click) commits one op that dirties every chunk on the line. The cap
// refuses it and KEEPS the anchor, so the fix is one nearer click rather than
// re-arming the gesture from scratch.
//
// The camera is what makes a long pair reachable here. Both endpoints fall back
// to `computeBrushCenter`'s open-space distance (4 m ahead of the eye) in this
// empty world, so two clicks from ONE camera are never more than ~8 m apart —
// the length only grows when the eye moves between them, which is exactly the
// gesture the cap is about. `frameChunks` is the seam that moves it (the flags
// list's click-to-frame drives the same one).

/** Chunks are `CHUNK_DIM · cellSize` = 4 m at the production lattice, so framing
 *  chunk `cx` parks the orbit target at `4·cx + 2` on X. Measured, not derived:
 *  from an eye framed on chunk 0, chunk 14 puts the pair at 56.7 m and chunk 15
 *  at 60.7 m — the tightest straddle of the 60 m cap this seam can express, and
 *  each test re-measures rather than trusting these numbers. */
const NEAR_CHUNK_X = 14;
const FAR_CHUNK_X = 15;

/** The metres a refusal reported, so a test can check WHICH side of the cap the
 *  fixture actually landed on rather than trusting the constants above. */
const reportedLength = (message: string): number => {
  const m = /segment is ([\d.]+) m/.exec(message);
  if (m?.[1] === undefined)
    throw new Error(`test: no length in the refusal "${message}"`);
  return Number(m[1]);
};

const capsuleLength = (ops: FieldOp[]): number => {
  const { a, b } = soleCapsule(ops);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
};

test.skipIf(!bunWebGpuAvailable())(
  "an over-length second click commits nothing and leaves the anchor ARMED",
  async () => {
    const f = await segmentFixture();
    try {
      f.host.setTool(DIG_TOOL);
      f.host.frameChunks([chunkKey(0, 0, 0)]);
      f.host.setGesture("segment");
      f.click(16, 16); // anchor, beside the origin

      // Orbit far away, then click: the pair is now past the cap.
      f.host.frameChunks([chunkKey(FAR_CHUNK_X, 0, 0)]);
      f.click(48, 40);
      expect(f.ops()).toHaveLength(0);
      const refusal = f.errors.at(-1) ?? "";
      // The message carries BOTH numbers: a refusal that only says "too long"
      // gives the user nothing to aim at.
      expect(refusal).toMatch(/the cap is 60 m/);
      expect(refusal).toMatch(/click nearer/);
      // …and the fixture really is over the cap, not merely refused.
      expect(reportedLength(refusal)).toBeGreaterThan(60);

      // THE TEETH: the anchor survived. Orbit back and one click completes the
      // ORIGINAL pair — which is only possible if the refusal left it standing.
      // A guard that cleared it would make this click a fresh anchor, and the
      // log would still be empty.
      f.host.frameChunks([chunkKey(0, 0, 0)]);
      f.click(48, 40);
      expect(f.ops()).toHaveLength(1);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a long segment INSIDE the cap commits normally",
  async () => {
    const f = await segmentFixture();
    try {
      f.host.setTool(DIG_TOOL);
      f.host.frameChunks([chunkKey(0, 0, 0)]);
      f.host.setGesture("segment");
      f.click(16, 16);
      f.host.frameChunks([chunkKey(NEAR_CHUNK_X, 0, 0)]);
      f.click(48, 40);

      // The other half of the clamp: it must not have become a general
      // long-segment ban. This pair is tens of metres — far past anything two
      // clicks from one camera could reach — and still commits.
      const length = capsuleLength(f.ops());
      expect(length).toBeGreaterThan(30);
      expect(length).toBeLessThanOrEqual(60);
      expect(f.errors).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "an unknown material id is reported, not thrown out of the pointer handler",
  async () => {
    const f = await segmentFixture();
    try {
      // `classOf` throws setup-loud on an id absent from the table. It reaches
      // this path through assertOpValid inside logApply — the op BUILD is
      // total (isKitFillTool swallows its own classOf), so the throw is
      // apply-time and the catch in commitToolOp is what stops it escaping
      // onPointerDown. Sabotage-checked: deleting that try/catch fails this
      // test; hoisting the build out of it does NOT, which is the honest
      // extent of what this pins.
      f.host.setTool({ ...DIG_TOOL, effect: "fill", materialId: 99 });
      f.host.setGesture("segment");
      f.click(16, 16);
      f.click(48, 40);
      expect(f.ops()).toHaveLength(0);
      expect(f.errors.at(-1)).toMatch(/unknown class id 99/);

      // The same throw on the plain STROKE path (no gesture), which is where an
      // escaped exception also costs a stranded pointer capture: onPointerDown
      // sets `digging = true` before applyTool and calls setPointerCapture
      // after it.
      f.host.setGesture(null);
      f.click(32, 32);
      expect(f.ops()).toHaveLength(0);
      expect(f.errors.at(-1)).toMatch(/unknown class id 99/);
    } finally {
      f.teardown();
    }
  },
);

// --- the named-history push from the BRUSH path (F4.5b Task 12) --------------
//
// HERE rather than in `field-host-history.test.ts`, and it is the one history case that
// cannot live there: `commitToolOp` is reached only from a pointer over a live context
// (both arms resolve their world point through `cursorRay`, which needs the camera
// `init` builds). It is also the ONE log-mutating host path that rewrites no entity
// record, so it is the one that does not reach `notifyHistory` through `notifyEntities`
// — i.e. exactly the branch a test on the other side of the seam cannot see. The rAF
// stub in this fixture is a no-op, so nothing but the explicit push can deliver these.
test.skipIf(!bunWebGpuAvailable())(
  "a brush stroke publishes its own history, on BOTH committing arms",
  async () => {
    const f = await segmentFixture();
    try {
      const pushes: FieldHistory[] = [];
      f.host.subscribeHistory((h) => pushes.push(h));
      expect(pushes.at(-1)?.undo).toEqual([]);

      // The sphere brush: one click, one op.
      f.host.setTool(DIG_TOOL);
      f.host.setGesture(null);
      f.click(32, 32);
      expect(f.ops()).toHaveLength(1);
      expect(pushes.at(-1)?.undo).toEqual(["dig"]);

      // The segment: the FIRST click only anchors, so it must publish nothing — a
      // history row for a click that wrote no op would name a step ⌘Z cannot take.
      f.host.setTool({ ...DIG_TOOL, effect: "fill", materialId: 0 });
      f.host.setGesture("segment");
      const beforeAnchor = pushes.length;
      f.click(16, 16);
      expect(pushes.length).toBe(beforeAnchor);
      // …and the second click commits the capsule, which the label names as a segment.
      f.click(48, 40);
      expect(pushes.at(-1)?.undo).toEqual(["dig", "segment fill"]);
      expect(pushes.at(-1)?.undoDepth).toBe(2);
      expect(f.errors).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);
