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
import { DEFAULT_CELL_SIZE, parseOps } from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FieldTool } from "../src/viewport-host/index.ts";

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

/** rAF/cAF do not exist in bun; the host schedules its loop through them at the
 *  end of `init`. Stubbed to no-ops — a tick would render, and nothing under
 *  test lives there (a gesture is driven entirely by input handlers). */
function stubAnimationFrame(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = ["requestAnimationFrame", "cancelAnimationFrame"].map(
    (name) => ({ name, had: name in g, prev: g[name] }),
  );
  g["requestAnimationFrame"] = () => 1;
  g["cancelAnimationFrame"] = () => undefined;
  return () => {
    for (const { name, had, prev } of saved) {
      if (had) g[name] = prev;
      else delete g[name];
    }
  };
}

type Listeners = Map<string, (e: unknown) => void>;

/** The fixture canvas, with a RECORDING addEventListener so the tests can fire
 *  the host's own handlers. */
async function makeHostCanvas(
  listeners: Listeners,
): Promise<HTMLCanvasElement> {
  const canvas = await makeOffscreenCanvas(64, 64);
  return Object.assign(canvas, {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.set(type, fn);
    },
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64, height: 64 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    style: {},
  }) as unknown as HTMLCanvasElement;
}

async function segmentFixture() {
  const restoreRo = installMockResizeObserver();
  const restoreRaf = stubAnimationFrame();
  const listeners: Listeners = new Map();
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
