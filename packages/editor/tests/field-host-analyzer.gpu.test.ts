// The advisor's marker layer on a real (bun-webgpu) context — the half
// `field-host-analyzer.test.ts` cannot reach, because `rebuildFlagMarkers`
// returns at its context guard without one, and everything past that guard is
// GPU: a cube geometry, an instanced mesh sized to the visible findings, a
// packed matrix upload and a per-instance tint.
//
// Plus the one host path that needs a CAMERA: a real dig. Every stroke resolves
// through `cursorRay` → `screenToRay`, so without `init` the pointer handler
// returns before it writes a cell — and writing cells is what feeds the mirror.
//
// ⚠️ NOT PROVEN ANYWHERE IN THIS SUITE: that the marker layer is DRAWN AT ALL.
// Deleting the `layers.flags && flagMarkers` push from `renderScene` fails no
// test in this repo. The tests below build the layer against a real device and
// pin its instance count, and the tick tests do call `renderScene` — but the
// host requests its context without `surfaceFormat: "linear"`, so under
// bun-webgpu that render is invalid (see the mute below) and proves nothing
// about what reached the draw list. There is no draw-list seam and no pixel read
// here.
//
// The whole weight of "the markers are visible" therefore rests on the BROWSER
// PIXEL CHECK, whose recipe is `scripts/analyzer-pixel-check.md` — run it when
// anything under the marker layer changes. That split is deliberate and
// recorded: this repo has already shipped ONE class of invisible overlay (a
// `drawLines` MSAA sample-count mismatch) through TWO sealed slices, passing
// every headless test both times (2026-07-21) — the history this pixel check
// exists for.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type {
  AgentProfile,
  FieldManifest,
  MaterialTable,
} from "@furnace/core/field";
import {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  SOLID,
} from "@furnace/core/field";
import { consoleSink, setSink } from "@furnace/core/log";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import type {
  AnalyzerEngine,
  AnalyzerRequest,
  AnalyzerResponse,
  VerifyVerdictWire,
} from "../src/frontend/lib/analyzer-protocol.ts";
import { createAnalyzerWorkerHandler } from "../src/frontend/lib/analyzer-protocol.ts";
import type { WorkerLike } from "../src/frontend/lib/field-client.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type {
  FieldStats,
  FieldTool,
  FlagsSummary,
} from "../src/viewport-host/index.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameCaptured } from "./_helpers/raf.ts";

await ensureBunWebGpu();

// The tick tests below drive `renderScene`, and under bun-webgpu that render is
// INVALID: the host requests its context without `surfaceFormat: "linear"`, so
// `createView({ format: "bgra8unorm-srgb" })` fails validation against the mock's
// canvas texture (the gpu-fixture header). It fails ASYNCHRONOUSLY, as uncaptured
// device errors rather than a throw, which is why the tick still returns and the
// stats push before it still happens. `setSink(null)` silences CORE's routing of those
// errors (the `uncaptured-error.gpu.test.ts` pattern) and nothing else: bun-webgpu
// prints its own `JS Device Error Callback` wall from native code, which no test-side
// mute can reach, so this run is noisy either way. What the mute buys is a clean core
// log — nothing here asserts on it, but a sink full of this render's failures is a trap
// for whatever does next. The host's own tool-error channel has a subscriber below.
beforeAll(() => setSink(null));
afterAll(() => setSink(consoleSink));

const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};

const DIG_TOOL: FieldTool = {
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
};

const FILL_TOOL: FieldTool = { ...DIG_TOOL, effect: "fill" };

// Rock-only, so the remesh worker (not injected here) is never needed to decide
// a bucket split — this test drives the ANALYZER worker only.
const ROCK_ONLY: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
  ],
};

/** The headless test's chamber, in one chunk: a tall half whose cells clear the
 *  capsule beside a low half that does not, so the low half is flagged
 *  `low-clearance` (candidate) by the tall cells next to it. */
const CHAMBER = {
  floorY: 4,
  tallTopY: 13,
  lowTopY: 9,
  tallX: [2, 7],
  lowX: [8, 13],
  z: [2, 13],
} as const;

const CHAMBER_FLOOR: [number, number, number] = [
  4 * DEFAULT_CELL_SIZE,
  4.5 * DEFAULT_CELL_SIZE,
  6 * DEFAULT_CELL_SIZE,
];

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: CHAMBER_FLOOR,
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** The flag-and-fix loop's world: one flat-floored room, UNIFORMLY CLEAR — every
 *  floor cell has more than `clearance` overhead and no neighbour rises, so stage
 *  1 finds NOTHING. That zero baseline is the load-bearing part, and the only
 *  one: it is what lets the assertions below tell "the fix worked" from "the
 *  marker layer never held anything".
 *
 *  What is NOT load-bearing, though it looks like it: the top face being left
 *  open at the chunk's last sample. A roofed variant (`topY: 14`) runs this same
 *  loop to the same numbers — measured. It cannot matter, because no stroke here
 *  goes through `raycastField` at all: the framed camera's eye sits in
 *  unallocated space, which `getDensity` reads as SOLID, so `computeTarget` takes
 *  its EYE-IN-ROCK branch and mines `digRadius` straight ahead of the eye. The
 *  room only has to be wide enough for that to land in its air, which at this
 *  size it does (measured centre (2.304, 3.229, 3.368) m = cell 9, 12, 13, since
 *  `worldToVoxel` floors). */
const CLEAR_ROOM = {
  floorY: 4,
  topY: 15,
  x: [1, 14],
  z: [1, 14],
} as const;

const chamberChunk = (): Uint8Array => {
  const density = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
  const carve = (x0: number, x1: number, topY: number): void => {
    for (let z = CHAMBER.z[0]; z <= CHAMBER.z[1]; z++)
      for (let y = CHAMBER.floorY; y <= topY; y++)
        for (let x = x0; x <= x1; x++)
          density[x + CHUNK_DIM * (y + CHUNK_DIM * z)] = AIR;
  };
  carve(CHAMBER.tallX[0], CHAMBER.tallX[1], CHAMBER.tallTopY);
  carve(CHAMBER.lowX[0], CHAMBER.lowX[1], CHAMBER.lowTopY);
  return encodeChunkFile(density);
};

const clearRoomChunk = (): Uint8Array => {
  const density = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
  for (let z = CLEAR_ROOM.z[0]; z <= CLEAR_ROOM.z[1]; z++)
    for (let y = CLEAR_ROOM.floorY; y <= CLEAR_ROOM.topY; y++)
      for (let x = CLEAR_ROOM.x[0]; x <= CLEAR_ROOM.x[1]; x++)
        density[x + CHUNK_DIM * (y + CHUNK_DIM * z)] = AIR;
  return encodeChunkFile(density);
};

/** Drain rounds `deliver` allows before calling the host stuck. Each round is
 *  one settle→re-fire hop, and a world load takes two. */
const DELIVER_ROUNDS = 8;

/** The `field-host-analyzer.test.ts` fake, verbatim in spirit: the real handler
 *  as the worker's thread, run on demand.
 *
 *  `engine` supplies the stage-2 mover the handler would otherwise import from
 *  /engine.js. Omitted, the engine load rejects — the stage-1 default, and what
 *  every test here but the flag-and-fix loop wants. */
function analyzerWorker(engine?: AnalyzerEngine) {
  const sent: AnalyzerRequest[] = [];
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(msg) {
      sent.push(structuredClone(msg) as AnalyzerRequest);
    },
    terminate() {
      // nothing to tear down: there is no thread
    },
  };
  const handle = createAnalyzerWorkerHandler({
    post: (res: AnalyzerResponse) =>
      worker.onmessage?.({ data: res } as MessageEvent),
    loadEngine: () =>
      engine === undefined
        ? Promise.reject(new Error("no engine wired in this test"))
        : Promise.resolve(engine),
  });
  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));
  /** Run every request received so far through the real handler and post each
   *  answer back, exactly as a Worker would — then keep going while the host
   *  keeps talking. Settling one pass can fire the NEXT one (the pump re-fires a
   *  queued request on settle), so a single drain leaves the latch busy and the
   *  next verb silently queued behind it. */
  const deliver = async (): Promise<void> => {
    for (let round = 0; sent.length > 0; round++) {
      if (round > DELIVER_ROUNDS)
        throw new Error("test: the analyzer host will not go quiet");
      for (const req of sent.splice(0, sent.length)) await handle(req);
      await flush();
    }
  };
  const of = <K extends AnalyzerRequest["kind"]>(
    kind: K,
  ): Extract<AnalyzerRequest, { kind: K }>[] =>
    sent.filter(
      (r): r is Extract<AnalyzerRequest, { kind: K }> => r.kind === kind,
    );
  return { worker, sent, deliver, of };
}

/** The most recent push, asserted present — `expectDefined` for a summary, so
 *  the assertions below compare numbers rather than `number | undefined`. */
const lastSummary = (pushes: readonly FlagsSummary[]): FlagsSummary => {
  const s = pushes.at(-1);
  if (s === undefined) throw new Error("test: no flags summary was pushed");
  return s;
};

/** Comfortably past ANALYZER_IDLE_MS (500) — the debounce is a real constant in
 *  the host, deliberately not injected, so the wait is real too. */
const IDLE_TAIL_WAIT_MS = 700;

async function fixture(
  opts: {
    profile?: AgentProfile | null;
    chunks?: { key: string; bytes: Uint8Array }[];
    engine?: AnalyzerEngine;
  } = {},
) {
  const profile = opts.profile === undefined ? AGENT : opts.profile;
  const restoreRo = installMockResizeObserver();
  // The CAPTURED rAF variant: one hand-driven tick is the only way to observe the
  // per-frame `FieldStats` push. The canvas records its listeners so a test can
  // fire the host's own pointer handler (the segment test's recipe).
  const raf = stubAnimationFrameCaptured();
  const listeners: HostListeners = new Map();
  const fake = analyzerWorker(opts.engine);
  const host = createFieldHost({ spawnAnalyzer: () => fake.worker });
  // Arm the BRUSH: a host opens with the pointer gesture armed (D-F4.5-7), where
  // LMB selects an entity instead of stroking — and every `click` below is a dig.
  // The chrome's brush pick is what does this in the product.
  host.setGesture(null);
  host.setMaterialTable(ROCK_ONLY);
  if (profile !== null) host.setAgentProfile(profile);
  host.loadWorld({
    manifest: MANIFEST,
    chunks: opts.chunks ?? [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }],
    oplog: null,
  });
  await host.init(await makeHostCanvas(listeners));
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const pushes: FlagsSummary[] = [];
  host.subscribeFlags((s) => pushes.push(s));
  const stats: FieldStats[] = [];
  host.subscribeStats((s) => stats.push(s));
  const click = (x: number, y: number): void => {
    const fn = listeners.get("pointerdown");
    if (fn === undefined) throw new Error("test: no pointerdown listener");
    fn({ button: 0, altKey: false, clientX: x, clientY: y, pointerId: 1 });
  };
  return {
    host,
    errors,
    pushes,
    stats,
    click,
    /** Run ONE frame of the host's own loop. The stats push happens before the
     *  render, so this is what makes {@link FieldStats} observable at all. */
    tick: raf.tick,
    ...fake,
    teardown: () => {
      host.dispose();
      raf.restore();
      restoreRo();
    },
  };
}

test.skipIf(!bunWebGpuAvailable())(
  "findings build one instanced marker draw against a live device",
  async () => {
    const f = await fixture();
    try {
      await f.deliver();
      // A throw anywhere in the rebuild escapes `onFlags` into the pump's catch
      // and surfaces as a tool error, so an empty error log IS the assertion
      // that the geometry, the instanced mesh, the matrix upload and every tint
      // went through the real device.
      expect(f.errors).toEqual([]);
      const summary = lastSummary(f.pushes);
      expect(summary.visible.length).toBeGreaterThan(0);
      expect(
        summary.visible.every((r) => r.flag.severity === "candidate"),
      ).toBe(true);
      expect(f.host.flagMarkerCount()).toBe(summary.visible.length);

      // Widening the filter REBUILDS the layer — whole-layer teardown and
      // recreate, so this is a second pass over the same GPU calls with a
      // different instance count.
      f.host.setFlagFilters({
        candidates: true,
        info: true,
        unreachable: true,
        pits: true,
      });
      expect(f.host.flagMarkerCount()).toBe(summary.total);
      expect(f.errors).toEqual([]);

      // …and narrowing it to nothing tears the layer down without creating an
      // empty instanced mesh (core refuses a zero count).
      f.host.setFlagFilters({
        candidates: false,
        info: false,
        unreachable: false,
        pits: true,
      });
      expect(f.host.flagMarkerCount()).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a dig syncs exactly the chunks it wrote and analyses them incrementally",
  async () => {
    const f = await fixture();
    try {
      await f.deliver(); // settle the load's whole-world pass
      f.sent.length = 0;

      f.host.setTool(DIG_TOOL);
      f.host.setDigRadius(0.75);
      f.click(32, 32);

      const sync = f.of("sync").at(-1);
      const analyze = f.of("analyze").at(-1);
      expect(analyze).toBeDefined();
      // What the host WROTE, and only that: the worker widens to the chunks
      // whose answer could have changed (its own rule, which spreads past the
      // 26-neighbourhood), so a host that pre-widened would be guessing at it.
      expect(analyze?.dirty.length).toBeGreaterThan(0);
      expect(sync?.upserts.map((u) => u.key).sort()).toEqual(
        [...(analyze?.dirty ?? [])].sort(),
      );
      // Per-keystroke passes are INCREMENTAL: the connectivity passes are
      // world-cadence and ride the idle tail instead.
      expect(analyze?.reachability).toBe(false);

      await f.deliver();
      expect(f.errors).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "analyzerPending counts the pass in flight and the work queued behind it",
  async () => {
    const f = await fixture();
    try {
      // The load's pass is posted and unanswered, and `init`'s prop rebuild has
      // queued another behind it: one in flight, one waiting.
      f.tick(16);
      expect(f.stats.at(-1)?.analyzerPending).toBe(2);

      await f.deliver();
      f.tick(32);
      // Everything answered, nothing queued — the markers describe the field.
      expect(f.stats.at(-1)?.analyzerPending).toBe(0);

      // An edit re-opens it: the pass goes out immediately, so this is the
      // in-flight 1 rather than the queued one.
      f.click(32, 32);
      f.tick(48);
      expect(f.stats.at(-1)?.analyzerPending).toBe(1);

      await f.deliver();
      f.tick(64);
      expect(f.stats.at(-1)?.analyzerPending).toBe(0);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "with no agent profile the meter reads 0 — the advisor is off, not busy",
  async () => {
    const f = await fixture({ profile: null });
    try {
      // The load marked a full re-sync and a whole-world pass, and NEITHER will
      // ever be posted. Reporting them as pending would park the meter at 1 for
      // the session and read as an advisor that is permanently working.
      expect(f.sent).toEqual([]);
      f.tick(16);
      expect(f.stats.at(-1)?.analyzerPending).toBe(0);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "the whole-world pass runs on the idle TAIL of an edit burst, once",
  async () => {
    const f = await fixture();
    try {
      await f.deliver();
      f.sent.length = 0;

      // A burst: three strokes inside the debounce window. Each posts its own
      // INCREMENTAL pass; none may run the connectivity passes, which are
      // world-cadence and cost ~72% of a full analyzeWorld on top of the pass
      // they ride (which is the whole reason they are debounced).
      //
      // Read BEFORE each deliver, because `deliver` splices `sent` — asserting
      // over `of("analyze")` after the last one runs `[].every(...)`, which is
      // vacuously true and cannot fail.
      const burst: boolean[] = [];
      for (const [x, y] of [
        [30, 30],
        [32, 32],
        [34, 34],
      ] as const) {
        f.click(x, y);
        burst.push(...f.of("analyze").map((a) => a.reachability));
        await f.deliver();
      }
      // Three strokes, three passes, none of them whole-world. The LENGTH is
      // half of it — a burst that posted nothing would satisfy "no whole-world
      // pass" just as well — and the values are the other half. Between them
      // they catch an edit that reaches the analyzer not at all, and an edit
      // whose own pass runs the connectivity passes. What they do NOT catch is
      // the debounce being absent, because the timer is asynchronous either way:
      // that is the post-wait assertion's job, below.
      expect(burst).toEqual([false, false, false]);

      // Let the tail fire. THIS is where the debounce itself is pinned: with
      // `scheduleWholeWorldPass` no-op'd nothing arrives, and with it
      // undebounced the burst has already spent the whole-world passes before
      // the wait, so either way this comes back empty.
      f.sent.length = 0;
      await new Promise((resolve) => setTimeout(resolve, IDLE_TAIL_WAIT_MS));
      const whole = f.of("analyze").filter((a) => a.reachability);
      expect(whole).toHaveLength(1);
      // It re-analyses the WORLD, not the last chunk edited, and carries the
      // seeds both connectivity passes need.
      expect(whole[0]?.seeds).toEqual([CHAMBER_FLOOR]);
      expect(whole[0]?.dirty.length).toBeGreaterThan(0);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a dispose/re-init re-syncs the mirror the terminated worker took with it",
  async () => {
    const f = await fixture();
    try {
      await f.deliver();
      f.host.dispose();
      f.sent.length = 0;

      // The client spawns a FRESH worker on the next request, with an empty
      // mirror. Without the re-sync the protocol refuses the analyse outright
      // (`requireStore`: "analyze before any sync"), so the failure is a typed
      // analyzer-error on the tool-error seam rather than a wrong answer — and it
      // repeats for every pass until something fills `analyzerDirty`. The
      // advisor is dead, loudly.
      await f.host.init(await makeHostCanvas(new Map()));
      const sync = f.of("sync").at(-1);
      const analyze = f.of("analyze").at(-1);
      expect(sync?.upserts.map((u) => u.key)).toEqual([chunkKey(0, 0, 0)]);
      expect(f.of("placements").length).toBeGreaterThan(0);
      expect(analyze?.reachability).toBe(true);
      // The sync must PRECEDE the analyze — the worker dispatches in arrival
      // order, so an analyze that overtook its sync reads an empty mirror.
      expect(f.sent.findIndex((r) => r.kind === "sync")).toBeLessThan(
        f.sent.findIndex((r) => r.kind === "analyze"),
      );
    } finally {
      f.teardown();
    }
  },
);

// --- the flag-and-fix loop ---------------------------------------------------
//
// The loop the user gate drives, end to end on a real device: an edit raises a
// candidate, the corrective edit retires it, and the marker layer follows both
// ways. Nothing is canned — the strokes go through `cursorRay` → `applyTool`,
// the findings come from core's own column pass, and the marker count is what
// `rebuildFlagMarkers` decided against the live GPU.
//
// DIRECTION, and why it is the reverse of the obvious one: the flag-raising edit
// here is the FILL, not the dig. A single spherical dig into a flat floor can
// only ADD headroom and leave a climbable bowl, so measurement (this fixture,
// dig at the same cursor) finds `ledge`/`lip-near-wall` — both `info` — and no
// candidate at all. Filling drops a shelf over the floor, which is the cheapest
// one-stroke way to make a REAL `low-clearance` candidate, and digging it back
// out is the fix. The mechanism under test is the same either way: a re-analysis
// REPLACES the chunk's findings, so a fixed problem stops being reported.

/** Big enough that the shelf the fill drops over the floor has its underside
 *  within the capsule's `clearance` of it — a smaller blob hangs too high and the
 *  floor beneath it stays walkable, which is the whole finding.
 *
 *  ONE radius for both strokes, and they do share a centre: the eye-in-rock
 *  branch mines a fixed distance ahead of the eye without consulting a raycast
 *  hit, so the fill having changed the geometry cannot move where the dig lands
 *  (instrumented — same origin, same centre, both times). The dig is therefore
 *  very nearly the fill's inverse. NOT exactly: neither stroke is a pure set
 *  operation — both carry the tool's smoothing pass and both write quantized
 *  densities — so "the dig takes the whole shelf back out" stays a measured fact
 *  rather than a geometric identity. */
const SHELF_RADIUS_M = 1.25;

const LOOP_VERDICT: VerifyVerdictWire = {
  outcome: "clear",
  lanes: [{ dir: [1, 0], outcome: "clear", progressed: 3.5 }],
  ms: 7,
};

test.skipIf(!bunWebGpuAvailable())(
  "the flag-and-fix loop: an edit raises a candidate, the fix retires it",
  async () => {
    const f = await fixture({
      chunks: [{ key: chunkKey(0, 0, 0), bytes: clearRoomChunk() }],
      engine: { analyzerVerify: () => Promise.resolve(LOOP_VERDICT) },
    });
    try {
      await f.deliver();
      // A clean room: nothing found, nothing drawn. Without this the assertions
      // below could not tell "the fix worked" from "the marker layer never had
      // anything in it".
      expect(lastSummary(f.pushes).total).toBe(0);
      expect(f.host.flagMarkerCount()).toBe(0);

      // The bad edit: a shelf dropped over the floor.
      f.host.setTool(FILL_TOOL);
      f.host.setDigRadius(SHELF_RADIUS_M);
      f.click(32, 32);
      await f.deliver();

      const flagged = lastSummary(f.pushes);
      // Only `low-clearance` — the shelf's own footprint. The kind is asserted
      // because it is the one this geometry is built to raise: a test that
      // accepted any candidate would keep passing if the column pass started
      // reporting something else entirely about the same edit.
      expect(flagged.visible.length).toBeGreaterThan(0);
      expect(
        flagged.visible.every((r) => r.flag.kind === "low-clearance"),
      ).toBe(true);
      expect(f.host.flagMarkerCount()).toBe(flagged.visible.length);

      // Stage 2 lands a verdict on one of them, so the fix below has something
      // to invalidate.
      const verified = flagged.visible[0];
      if (verified === undefined) throw new Error("test: nothing to verify");
      f.host.verifyFlag(verified.key);
      await f.deliver();
      expect(
        lastSummary(f.pushes).visible.find((r) => r.key === verified.key)
          ?.verdict,
      ).toEqual(LOOP_VERDICT);

      // The fix: dig the shelf back out.
      f.host.setTool(DIG_TOOL);
      f.click(32, 32);
      await f.deliver();

      // No candidate left, so nothing to draw. `flagMarkerCount` is the count the
      // rebuild SETTLED ON and not a read of the GPU, so what it pins is that a
      // fixed problem takes its markers with it, which is the loop's point.
      const fixed = lastSummary(f.pushes);
      expect(fixed.visible).toEqual([]);
      expect(f.host.flagMarkerCount()).toBe(0);
      // …and the advisor stopped raising an ALARM rather than going blind. The
      // dig leaves its own `ledge`/`lip-near-wall` behind and the default filters
      // hide them, so an analyzer that had simply stopped reporting would satisfy
      // the two assertions above just as well. These two are what tell them apart.
      expect(fixed.total).toBeGreaterThan(0);
      expect(fixed.byKindSeverity.every((c) => c.severity === "info")).toBe(
        true,
      );
      // The verified finding is gone from the STORE, not merely filtered out of
      // the view: `rowByKey` no longer resolves its key, so the verdict taken on
      // it has nothing left to badge. A verify aimed at it is refused outright
      // rather than posted at a finding that no longer exists.
      f.sent.length = 0;
      f.host.verifyFlag(verified.key);
      expect(f.errors.at(-1)).toBe("that flag was re-analyzed away");
      expect(f.of("verify")).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a whole-world request outlives an empty store — and owes nothing while it waits",
  async () => {
    // Nothing to analyse yet, so the whole-world request `init`'s prop rebuild
    // made cannot go out — `dirty` is the STORE when the flag is set, and the
    // store is empty.
    const f = await fixture({ chunks: [] });
    try {
      expect(f.of("analyze")).toEqual([]);
      f.tick(16);
      // The METER half, and the F4.5 gate's F-3: this is a brand-new world with
      // a profile installed, and it read "analyzer catching up — 1 pass owed"
      // for the rest of the session. A deferred request over a store with
      // nothing in it is not work owed, and the chip that renders this number
      // never left. `analyzerFire` and `analyzerPendingCount` now ask ONE
      // predicate, so the meter cannot disagree with the pump again.
      expect(f.stats.at(-1)?.analyzerPending).toBe(0);

      // The world arrives by the one route that does NOT re-request a
      // whole-world pass: a density write. If the flag had been consumed by the
      // empty fire, this pass would be INCREMENTAL and reachability + pits would
      // wait out the idle tail for no reason.
      f.click(32, 32);
      expect(f.of("analyze").at(-1)?.reachability).toBe(true);
      // …and NOW one is owed. Without this the meter half above is satisfied by
      // a count hard-wired to 0, which would take the chip away for good.
      f.tick(32);
      expect(f.stats.at(-1)?.analyzerPending).toBe(1);
      await f.deliver();
      f.tick(48);
      expect(f.stats.at(-1)?.analyzerPending).toBe(0);
    } finally {
      f.teardown();
    }
  },
);
