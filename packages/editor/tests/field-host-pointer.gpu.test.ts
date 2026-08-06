// The `pointer` gesture end to end on a real (bun-webgpu) context: a click on
// the canvas → `cursorRay` → the CPU pick → the entity-selection seam.
//
// It needs a device even though nothing here draws, and that is the whole
// reason it is not in `field-host-headless.test.ts`: every click resolves
// through `cursorRay` → `camera.screenToRay`, and there is no camera until
// `init` has acquired a context. Same constraint, same recipe as
// `field-host-segment.gpu.test.ts` — the canvas RECORDS the listeners the host
// registers and the tests call the real `pointerdown` handler with synthetic
// events, because the two-click/one-click state machines inside the host have
// no method seam at all.
//
// HERE and not in `tests/field-host/` (which holds this slice's PURE module
// tests, `field-pick.test.ts` among them) for a harness reason worth stating,
// because it is invisible and it bites silently: `bun test` runs a directory's
// own files before its subdirectories, and `tests/chrome/` registers happy-dom,
// which REPLACES `globalThis.navigator` — taking `navigator.gpu` with it. The
// bun-webgpu fixture memoizes its setup and never reinstalls, while
// `bunWebGpuAvailable()` keeps answering true, so a `.gpu` test in any
// subdirectory sorting after `chrome/` is not skipped — it runs and fails at
// `requestContext`. Every other host GPU test is in this directory for the same
// reason (filed: docs/backlog/editor-and-tooling/editor-test-harness-fragility.md).
//
// The world arrives through `loadWorld`'s oplog path rather than through a
// stamp commit. That is a real host path (it is how every saved world opens)
// and it puts the same entity + placement ops in the same log a commit would,
// which is all the pick reads — while a commit would need the field worker
// driven through a whole preview round trip to reach `ready`, none of which
// this is about. The store is left EMPTY on purpose: an unallocated chunk reads
// SOLID, so the eye is "in rock", which is exactly the state where the host
// skips the occlusion raycast (a start inside rock hits its own voxel at t=0)
// and the pick is decided by the candidates alone.
import { expect, test } from "bun:test";
import {
  type AgentProfile,
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  type FieldFlag,
  type FieldManifest,
  type FieldOp,
  SOLID,
} from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import type { AnalyzerRequest } from "../src/field-host/analyzer-protocol.ts";
import type { WorkerLike } from "../src/field-host/field-client.ts";
import { createFieldHost } from "../src/field-host/field-host.ts";
import type { FlagsSummary } from "../src/field-host/index.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameNoop } from "./_helpers/raf.ts";

await ensureBunWebGpu();

/** The dungeon's shipped capsule as a literal (the analyzer suite's rationale:
 *  the editor is project-first and pins nobody's numbers). Its only job in this
 *  file is to make the advisor RUN, so a canned response has somewhere to land. */
const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};

/** A worker whose "thread" is the real protocol handler, so a test can answer the
 *  host's analyze with a CANNED payload — the marker cases are about what a click
 *  lands on, not about what the column pass would really have found. */
function fakeAnalyzer() {
  let lastJob: number | null = null;
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(msg) {
      const req = structuredClone(msg) as AnalyzerRequest;
      if (req.kind === "analyze") lastJob = req.jobId;
    },
    terminate() {
      // no thread to tear down
    },
  };
  const respond = async (flags: FieldFlag[]): Promise<void> => {
    if (lastJob === null)
      throw new Error("test: no analyze has been posted to respond to");
    worker.onmessage?.({
      data: {
        kind: "flags",
        jobId: lastJob,
        chunks: [{ key: chunkKey(0, 0, 0), flags }],
      },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { worker, respond };
}

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** The host's starting orbit target — where the centre of a 64×64 canvas looks.
 *  Everything below is placed at it so a click at (32, 32) is a hit and a click
 *  at a corner is not, with no camera arithmetic in the test. */
const TARGET: [number, number, number] = [0, 1, 0];

const CARVE_ENTITY_ID = 2;
const SCATTER_ENTITY_ID = 4;

/** A dig op at `center` (the orbit target by default), and the entity that
 *  claims it. Its footprint is the sphere's own bounds — a 1 m box straddling
 *  that point.
 *
 *  Parameterized so two DIFFERENT worlds can be built with the same op count and
 *  the same op ids, which is what the world-swap case needs: those two logs are
 *  indistinguishable to any signature derived from the log alone. */
const carveOps = (center: [number, number, number] = TARGET): FieldOp[] => [
  {
    id: 1,
    kind: "brush",
    effect: "dig",
    shape: { kind: "sphere", center: [...center], radius: 0.5 },
  },
  {
    id: CARVE_ENTITY_ID,
    kind: "entity",
    action: "place",
    entity: {
      entityId: CARVE_ENTITY_ID,
      type: "generator",
      generator: "hall",
      params: {},
      seed: 7,
      region: {
        min: [center[0] - 1, center[1] - 1, center[2] - 1],
        max: [center[0] + 1, center[1] + 1, center[2] + 1],
      },
      opSpan: [1, 1],
    },
  },
];

/** A placement op at the same target, claimed by a SECOND entity — the pair the
 *  ownership walk has to tell apart: the prop is inside the carve entity's
 *  footprint, so a pick that attributed it wrongly (or preferred the enclosing
 *  volume) would answer with the carver. */
const scatterOps = (): FieldOp[] => [
  {
    id: 3,
    kind: "placement",
    records: [
      {
        archetypeId: "barrel",
        position: [...TARGET],
        quat: [0, 0, 0, 1],
        scale: [1, 1, 1],
        variantIndex: 0,
      },
    ],
  },
  {
    id: SCATTER_ENTITY_ID,
    kind: "entity",
    action: "place",
    entity: {
      entityId: SCATTER_ENTITY_ID,
      type: "generator",
      generator: "scatter",
      params: {},
      seed: 3,
      region: { min: [-1, 0, -1], max: [1, 2, 1] },
      opSpan: [3, 3],
    },
  },
];

// --- real terrain, for the occlusion cases ----------------------------------
//
// The default fixture leaves the store EMPTY, which makes every unallocated
// chunk read SOLID, the eye "in rock", and the occlusion raycast skipped
// entirely — so the two cases below allocate real chunks instead, and they are
// the only coverage the `clearTo` arithmetic has.
//
// The geometry is chosen so no camera math is needed in the test, only the ONE
// documented fact that the host's starting pitch is positive — the eye sits
// ABOVE the orbit target (field-host's own comment: "at distance 6 this seats
// the eye at y ≈ 3.9"). The centre ray therefore DESCENDS from ~3.9 to the
// target at y = 1, and a horizontal slab between those two heights blocks it
// wherever the eye happens to be in x/z.

/** Chunk indices covering the eye's possible x/z (|x|,|z| ≤ 6, the orbit
 *  distance) and the target's, at 16 samples × 0.25 m = 4 m per chunk. */
const AIR_CHUNK_RANGE = [-2, -1, 0, 1];
/** Local Y index of the slab's top face: world y = 10 × 0.25 = 2.5 m, between
 *  the target (y = 1) and the eye (y ≈ 3.9). */
const SLAB_TOP_LOCAL_Y = 10;

/** One chunk of the y = 0 band: air everywhere, except — when `slab` — solid
 *  below {@link SLAB_TOP_LOCAL_Y}, a floor-to-2.5 m wall of rock. */
const bandChunk = (slab: boolean): Uint8Array => {
  const samples = new Int8Array(CHUNK_SAMPLES).fill(AIR);
  if (slab)
    for (let ly = 0; ly < SLAB_TOP_LOCAL_Y; ly++)
      for (let lz = 0; lz < CHUNK_DIM; lz++)
        for (let lx = 0; lx < CHUNK_DIM; lx++)
          samples[lx + CHUNK_DIM * (ly + CHUNK_DIM * lz)] = SOLID;
  return encodeChunkFile(samples);
};

/** The y = 0 chunk band around the origin, air or slabbed. Chunks OUTSIDE it stay
 *  unallocated and therefore solid, which is what stops the ray at the band's
 *  edge in the un-slabbed case — a real terrain hit, just a distant one. */
const terrainBand = (slab: boolean): { key: string; bytes: Uint8Array }[] => {
  const bytes = bandChunk(slab);
  return AIR_CHUNK_RANGE.flatMap((cx) =>
    AIR_CHUNK_RANGE.map((cz) => ({ key: chunkKey(cx, 0, cz), bytes })),
  );
};

/** One `loadWorld` payload, spelled once — the fixture opens with it and the
 *  world-swap case reuses it to load a SECOND world into the same live host. */
const loadInto = (
  host: ReturnType<typeof createFieldHost>,
  ops: FieldOp[],
  chunks: { key: string; bytes: Uint8Array }[] = [],
): void => {
  host.loadWorld({ manifest: MANIFEST, chunks, oplog: JSON.stringify(ops) });
};

/** An initialized host over a world built from `ops` (and optionally real
 *  terrain), with the recorded click handler and the entity-selection pushes.
 *  Callers own `teardown`. */
async function pointerFixture(
  ops: FieldOp[],
  chunks: { key: string; bytes: Uint8Array }[] = [],
  /** Findings to land on the host before the first click, for the marker cases.
   *  Injecting the analyzer WORKER is the only way in: `applyFlags` is the flag
   *  store's, behind the pump, and the store is private to the host. */
  flags: FieldFlag[] = [],
) {
  const restoreRo = installMockResizeObserver();
  // The NO-OP rAF variant: nothing here observes a frame — the pick runs
  // entirely inside the pointerdown handler.
  const restoreRaf = stubAnimationFrameNoop();
  const listeners: HostListeners = new Map();
  const analyzer = fakeAnalyzer();
  const host = createFieldHost({ spawnAnalyzer: () => analyzer.worker });
  if (flags.length > 0) host.setAgentProfile(AGENT);
  loadInto(host, ops, chunks);
  const summaries: FlagsSummary[] = [];
  host.subscribeFlags((s) => summaries.push(s));
  if (flags.length > 0) {
    // The pump posts its analyze off a microtask, so the response needs a turn to
    // have something to answer.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await analyzer.respond(flags);
  }
  await host.init(await makeHostCanvas(listeners));
  const selected: (number | null)[] = [];
  host.subscribeEntitySelection((id) => selected.push(id));
  const click = (x: number, y: number): void => {
    const fn = listeners.get("pointerdown");
    if (fn === undefined) throw new Error("test: no pointerdown listener");
    fn({ button: 0, altKey: false, clientX: x, clientY: y, pointerId: 1 });
  };
  return {
    host,
    selected,
    summaries,
    click,
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

test.skipIf(!bunWebGpuAvailable())(
  "a click selects the entity under the cursor — with NO setGesture call, because pointer is the default",
  async () => {
    const f = await pointerFixture(carveOps());
    try {
      // The initial push only: a freshly loaded world has nothing selected.
      expect(f.selected).toEqual([null]);

      // Deliberately no `setGesture`: a host opens armed with `pointer`
      // (D-F4.5-7), so this click is a PICK and not a dig. If the default
      // regressed to `null` the click would stroke the brush instead and this
      // seam would never fire.
      f.click(32, 32);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID]);

      // Re-clicking the same entity is a no-op: the seam pushes CHANGES, and a
      // palette row re-rendering on every push must not be re-entered for free.
      f.click(32, 32);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID]);

      // A corner click's ray leaves the 1 m footprint by metres — nothing to
      // pick, which the caller reads as deselect.
      f.click(2, 2);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID, null]);

      // …and a miss with nothing selected pushes nothing at all.
      f.click(60, 60);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID, null]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a click on a PROP selects the entity that placed it, not the carver it sits inside",
  async () => {
    const f = await pointerFixture([...carveOps(), ...scatterOps()]);
    try {
      // Both entities' footprints straddle the target, and the carve entity's
      // encloses the prop. The prop wins on both counts under test: objects are
      // resolved before footprint volumes, and its owner is read off the op
      // SPAN that claims its placement op — not off the box it happens to be in.
      f.click(32, 32);
      expect(f.selected).toEqual([null, SCATTER_ENTITY_ID]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a world reset invalidates the selection through the seam",
  async () => {
    const f = await pointerFixture(carveOps());
    try {
      f.click(32, 32);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID]);
      // The entity leaves the log with the world. A subscriber left holding its
      // id would render a palette row selected for a stamp that no longer
      // exists — and the box would outlive the world that had it.
      f.host.newWorld();
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID, null]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "props switched OFF are not pickable — what you see is what you target",
  async () => {
    const f = await pointerFixture([...carveOps(), ...scatterOps()]);
    try {
      f.host.setLayers({
        field: true,
        kit: true,
        props: false,
        ghost: true,
        selection: true,
        grid: true,
        flags: true,
        voidCast: false,
      });
      // With the prop layer hidden, the same click that selected the scatter
      // above falls through to the carve entity's footprint. Selecting an
      // invisible prop's owner would be picking something the user cannot see.
      f.click(32, 32);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a world swap invalidates the footprint memo, even when the two logs SIGN identically",
  async () => {
    // Both worlds carry 2 ops with ids 1 and 2 and empty undo/redo stacks, so
    // every signature derivable from the LOG alone — lengths, ids, nextId — is
    // the same for the two. Only the geometry differs: world A's hall is at the
    // orbit target, world B's is 200 m away. A memo keyed on the log alone
    // therefore serves world A's boxes to world B, and a click on empty space
    // re-selects an entity from the world that is gone.
    const f = await pointerFixture(carveOps());
    try {
      f.click(32, 32);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID]);

      loadInto(f.host, carveOps([200, 1, 200]));
      // The load cleared the selection through the seam (resetWorld).
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID, null]);

      // Nothing is under the cursor in world B — its hall is 200 m away, well
      // past the pick's reach. The click must stay a deselect.
      f.click(32, 32);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID, null]);
    } finally {
      f.teardown();
    }
  },
);

// --- the occluder, with real terrain in the store ---------------------------
//
// The pair below is what covers `pointerClick`'s distance arithmetic — the
// `Math.hypot(rc.point − ray.origin)` that turns the raycast's hit POINT into
// the `maxT` the pick is bounded by. Everything else in this file runs with an
// empty store, where that line never executes.
//
// They differ by ONE thing (the slab), so a bug that occludes everything and a
// bug that occludes nothing each fail exactly one of them.

test.skipIf(!bunWebGpuAvailable())(
  "with the ray CLEAR to the entity, the terrain hit beyond it does not occlude",
  async () => {
    const f = await pointerFixture(carveOps(), terrainBand(false));
    try {
      // The eye is in real air now, so the occlusion raycast actually runs: it
      // crosses the whole air band and stops at the unallocated (solid) chunk
      // below y = 0, PAST the hall. A `clearTo` that came back short — or zero —
      // would swallow this click.
      f.click(32, 32);
      expect(f.selected).toEqual([null, CARVE_ENTITY_ID]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a rock slab between the eye and the entity occludes the pick",
  async () => {
    const f = await pointerFixture(carveOps(), terrainBand(true));
    try {
      // Same world, same click, one difference: a solid slab whose top face is
      // at y = 2.5, which the descending centre ray meets before it reaches the
      // hall's box. The user clicked ROCK, so nothing is selected — and a
      // `clearTo` left at the probe's full range would select the hall through
      // a wall.
      f.click(32, 32);
      expect(f.selected).toEqual([null]);
    } finally {
      f.teardown();
    }
  },
);

// --- the flag marker as a pick target (F4.5b Task 13, D-F4.5-15) -------------
//
// "The viewport is the primary selection surface" is this pair of cases. Task 3
// built the pick's `flag` candidate but had nowhere to put the key, so the branch
// it fed was `return` — the whole path was covered only where it is pure. It has a
// seam now, and this is the only place a real CLICK reaches it.
//
// What these two do NOT discriminate, stated rather than implied: the half-cell LIFT
// inside `flagCellBox`. Removing it leaves both cases green, because at the default
// 0.25 m lattice the lifted and unlifted boxes still overlap where the centre ray
// crosses them — the camera looks AT the target, so the ray is inside the column for
// only a fraction of a cell either way. The lift is pinned in
// tests/field-host/field-flags.test.ts (red when it goes) and is shared BY
// CONSTRUCTION: the pick, the frame and the outline all call the one function, so
// there is no second spelling for it to drift from. What these cases own is the seam
// and the layer gate, and both go red when either is broken.

/** A finding whose anchor cell contains the orbit target `[0, 1, 0]` — the point
 *  the canvas-centre ray passes through by construction. `flagCellBox` lifts the
 *  box half a cell in Y, so a `world.y` of 0.875 spans 0.875…1.125 and the target
 *  sits inside it. */
const AT_TARGET: FieldFlag = {
  kind: "narrow",
  severity: "candidate",
  cell: [0, 3, 0],
  world: [0, 0.875, 0],
  chunk: chunkKey(0, 0, 0),
};

test.skipIf(!bunWebGpuAvailable())(
  "a click on a MARKER selects the finding and leaves the entity selection standing",
  async () => {
    const f = await pointerFixture(carveOps(), terrainBand(false), [AT_TARGET]);
    try {
      // Select the entity first, so the "leaves it standing" half has something to
      // be about: a marker click that deselected would be the pre-Task-3 bug.
      f.host.selectEntity(CARVE_ENTITY_ID);
      expect(f.selected.at(-1)).toBe(CARVE_ENTITY_ID);
      const pushes = f.summaries.length;

      f.click(32, 32);

      // The marker wins the click over the entity FOOTPRINT it sits inside — the
      // pick's tier rule (objects before volumes), which is what makes a marker
      // clickable at all once the camera is inside the room that carved it.
      const key = f.summaries.at(-1)?.selected;
      expect(key).toBe(f.summaries.at(-1)?.visible[0]?.key);
      expect(typeof key).toBe("string");
      // It PUSHED, so the palette really does hear about a viewport click…
      expect(f.summaries.length).toBeGreaterThan(pushes);
      // …and the entity selection is untouched: two different selections, and
      // clicking a finding is not a statement about which stamp is being worked on.
      expect(f.selected.at(-1)).toBe(CARVE_ENTITY_ID);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "markers switched OFF are not selectable — what you see is what you target",
  async () => {
    const f = await pointerFixture(carveOps(), terrainBand(false), [AT_TARGET]);
    try {
      f.host.setLayers({
        field: true,
        kit: true,
        props: true,
        ghost: true,
        selection: true,
        grid: true,
        flags: false,
        voidCast: false,
      });
      // With the marker layer hidden the same click falls THROUGH to the carve
      // entity's footprint — the slice-coherence rule applied to objects. It also
      // means a flag selection cannot be made while the outline that would show it
      // is switched off, which is why that outline is gated on `flags` too.
      f.click(32, 32);
      expect(f.selected.at(-1)).toBe(CARVE_ENTITY_ID);
      expect(f.summaries.at(-1)?.selected).toBeNull();
    } finally {
      f.teardown();
    }
  },
);
