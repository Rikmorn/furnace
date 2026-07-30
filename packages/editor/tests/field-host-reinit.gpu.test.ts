// The dispose → re-init round trip on a real (bun-webgpu) context: the AA switch's
// whole mechanism (F4.5a Task 9). What it pins is the half that is invisible from the
// chrome — that the world the user was looking at COMES BACK.
//
// `dispose` destroys every chunk mesh, and the host's dirty set only ever holds chunks
// something EDITED, so an `init` that did not re-mark the store's chunks would leave the
// viewport empty until the next brush stroke: "toggling antialiasing deleted my world".
// The observable is `FieldStats.remeshVersion`, the monotonic "a remesh landed" counter
// (its TSDoc asks for a consumer or a deletion — this is a consumer).
//
// Needs a device because remeshing is the thing under test: `remeshOne` returns at the
// context guard without one, so nothing downstream of the dirty set runs headlessly.
// The worker is INJECTED (the void-cast fixture's recipe — a job posted to a real
// `/field-worker.js` Worker never settles under bun), and the render loop is driven BY
// HAND (the analyzer fixture's recipe) because `drainDirty` and the stats push both live
// inside the host's own tick.
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  type FieldManifest,
  SOLID,
} from "@furnace/core/field";
import { consoleSink, setSink } from "@furnace/core/log";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import type { WorkerLike } from "../src/frontend/lib/field-client.ts";
import type {
  FieldWorkerRequest,
  FieldWorkerResponse,
} from "../src/frontend/lib/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/frontend/lib/field-protocol.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FieldStats } from "../src/viewport-host/index.ts";

await ensureBunWebGpu();

// The hand-driven tick RENDERS, and under bun-webgpu that render is INVALID: the host
// requests its context without `surfaceFormat: "linear"`, so `createView({ format:
// "bgra8unorm-srgb" })` fails validation against the mock's canvas texture. It fails
// ASYNCHRONOUSLY, as uncaptured device errors rather than a throw — which is why the
// tick still returns and the stats push before it still happens. Muted so the expected
// wall of device errors does not drown the suite (the analyzer fixture's precedent).
beforeAll(() => setSink(null));
afterAll(() => setSink(consoleSink));

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** A chunk with an open pocket, so meshing it produces real geometry rather than an
 *  empty bucket set. */
function pocketChunk(): Uint8Array {
  const chunk = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
  for (let z = 4; z < 12; z++)
    for (let y = 4; y < 12; y++)
      for (let x = 4; x < 12; x++) chunk[x + 16 * (y + 16 * z)] = 127;
  return encodeChunkFile(chunk);
}

/** A worker whose "thread" is the real protocol handler, run on demand: `deliver()`
 *  answers every request received so far. The void-cast fixture's shape, including the
 *  structured-clone-with-transfer, which is what makes the aprons really detach on this
 *  side exactly as they would in a browser. */
function handlerWorker() {
  const sent: FieldWorkerRequest[] = [];
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(msg, transfer) {
      sent.push(
        structuredClone(msg, {
          transfer: transfer ?? [],
        }) as FieldWorkerRequest,
      );
    },
    terminate() {
      // nothing to tear down: there is no thread
    },
  };
  const deliver = (): void => {
    const queued = sent.splice(0, sent.length);
    const handle = createFieldWorkerHandler((res: FieldWorkerResponse) => {
      worker.onmessage?.({ data: res } as MessageEvent);
    });
    for (const req of queued) handle(req);
  };
  return { worker, deliver };
}

/** rAF/cAF do not exist in bun, and the host schedules its loop through them at the end
 *  of `init` AND at the end of every tick. Stubbed so the loop never runs on its own,
 *  with the callback CAPTURED — one hand-driven frame is the only way to reach
 *  `drainDirty` and the stats push. */
function stubAnimationFrame(): {
  restore: () => void;
  tick: (now: number) => void;
} {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = ["requestAnimationFrame", "cancelAnimationFrame"].map(
    (name) => ({ name, had: name in g, prev: g[name] }),
  );
  let pending: ((now: number) => void) | null = null;
  g["requestAnimationFrame"] = (fn: (now: number) => void) => {
    pending = fn;
    return 1;
  };
  g["cancelAnimationFrame"] = () => undefined;
  return {
    tick: (now) => {
      const fn = pending;
      if (fn === null) throw new Error("test: the host scheduled no frame");
      pending = null;
      fn(now);
    },
    restore: () => {
      for (const { name, had, prev } of saved) {
        if (had) g[name] = prev;
        else delete g[name];
      }
    },
  };
}

/** Drains the microtask queue: a remesh response walks a `.then`/`.catch` chain, so one
 *  `await` is not enough (the void-cast fixture's note). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** The fixture canvas plus the DOM surface `attachListeners` and the camera bind reach
 *  for — all no-ops: this test drives the host through its methods and its own tick. */
async function makeHostCanvas(): Promise<HTMLCanvasElement> {
  const canvas = await makeOffscreenCanvas(64, 64);
  return Object.assign(canvas, {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64, height: 64 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    style: {},
  }) as unknown as HTMLCanvasElement;
}

test.skipIf(!bunWebGpuAvailable())(
  "a re-init re-meshes the world the dispose tore down (the AA switch's real cost)",
  async () => {
    const restoreRo = installMockResizeObserver();
    const raf = stubAnimationFrame();
    const fake = handlerWorker();
    const host = createFieldHost({ spawnWorker: () => fake.worker });
    const canvas = await makeHostCanvas();
    const stats: FieldStats[] = [];
    host.subscribeStats((s) => stats.push(s));
    const version = (): number => {
      const s = stats.at(-1);
      if (s === undefined) throw new Error("test: no stats were pushed");
      return s.remeshVersion;
    };
    /** One frame, the worker's answer, and a second frame to carry the result into a
     *  stats push. */
    const frameAndSettle = async (now: number): Promise<void> => {
      raf.tick(now);
      fake.deliver();
      await flush();
      raf.tick(now + 16);
    };

    host.loadWorld({
      manifest: MANIFEST,
      chunks: [{ key: chunkKey(0, 0, 0), bytes: pocketChunk() }],
      oplog: null,
    });
    await host.init(canvas);
    try {
      // The load's own dirty set drains on the first frames.
      await frameAndSettle(16);
      const meshed = version();
      expect(meshed).toBeGreaterThan(0);

      // …and then STAYS drained: an idle frame remeshes nothing. This is what makes the
      // assertion after the re-init mean something — without it, a counter that climbed
      // every frame regardless would pass either way.
      await frameAndSettle(48);
      expect(version()).toBe(meshed);

      // The AA switch, exactly as CanvasHost performs it: same host, same canvas, new
      // sample count. The store, the log and the camera ride through; the meshes do not.
      host.dispose();
      await host.init(canvas, { sampleCount: 1 });
      await frameAndSettle(80);
      // The world came back. Delete `init`'s re-mark of the store's chunks and this is
      // the line that fails — everything else about the round trip still passes, which
      // is precisely why it needs its own test.
      expect(version()).toBeGreaterThan(meshed);
    } finally {
      host.dispose();
      raf.restore();
      restoreRo();
    }
  },
);
