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
// Not asserted here: that `renderScene` draws the layer. The host requests its
// context WITHOUT `surfaceFormat: "linear"`, which bun-webgpu's mock cannot
// render through (see the gpu-fixture header), so both existing field-host GPU
// tests stub rAF to a no-op and this one does the same. Marker pixels are a
// browser gate's job.
import { expect, test } from "bun:test";
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
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import type {
  AnalyzerRequest,
  AnalyzerResponse,
} from "../src/frontend/lib/analyzer-protocol.ts";
import { createAnalyzerWorkerHandler } from "../src/frontend/lib/analyzer-protocol.ts";
import type { WorkerLike } from "../src/frontend/lib/field-client.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FieldTool, FlagsSummary } from "../src/viewport-host/index.ts";

await ensureBunWebGpu();

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

/** Drain rounds `deliver` allows before calling the host stuck. Each round is
 *  one settle→re-fire hop, and a world load takes two. */
const DELIVER_ROUNDS = 8;

/** The `field-host-analyzer.test.ts` fake, verbatim in spirit: the real handler
 *  as the worker's thread, run on demand. */
function analyzerWorker() {
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
    loadEngine: () => Promise.reject(new Error("no engine wired in this test")),
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

/** rAF/cAF do not exist in bun, and the host schedules its loop through them at
 *  the end of `init`. Stubbed to no-ops — see this file's header for why the
 *  callback must not run. */
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

/** The fixture canvas, with a RECORDING addEventListener so a test can fire the
 *  host's own pointer handler (the segment test's recipe). */
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

async function fixture() {
  const restoreRo = installMockResizeObserver();
  const restoreRaf = stubAnimationFrame();
  const listeners: Listeners = new Map();
  const fake = analyzerWorker();
  const host = createFieldHost({ spawnAnalyzer: () => fake.worker });
  host.setMaterialTable(ROCK_ONLY);
  host.setAgentProfile(AGENT);
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }],
    oplog: null,
  });
  await host.init(await makeHostCanvas(listeners));
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const pushes: FlagsSummary[] = [];
  host.subscribeFlags((s) => pushes.push(s));
  const click = (x: number, y: number): void => {
    const fn = listeners.get("pointerdown");
    if (fn === undefined) throw new Error("test: no pointerdown listener");
    fn({ button: 0, altKey: false, clientX: x, clientY: y, pointerId: 1 });
  };
  return {
    host,
    errors,
    pushes,
    click,
    ...fake,
    teardown: () => {
      host.dispose();
      restoreRaf();
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
      expect(summary.visible.every((v) => v.severity === "candidate")).toBe(
        true,
      );
      expect(f.host.flagMarkerCount()).toBe(summary.visible.length);

      // Widening the filter REBUILDS the layer — whole-layer teardown and
      // recreate, so this is a second pass over the same GPU calls with a
      // different instance count.
      f.host.setFlagFilters({
        candidates: true,
        info: true,
        unreachable: true,
      });
      expect(f.host.flagMarkerCount()).toBe(summary.total);
      expect(f.errors).toEqual([]);

      // …and narrowing it to nothing tears the layer down without creating an
      // empty instanced mesh (core refuses a zero count).
      f.host.setFlagFilters({
        candidates: false,
        info: false,
        unreachable: false,
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
