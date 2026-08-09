// The dispose → re-init round trip on a real (bun-webgpu) context (F4.5a Task 9). What it
// pins is the half that is invisible from the chrome — that the world the user was looking
// at COMES BACK.
//
// ITS ORIGINAL CALLER IS GONE and the round trip is not: it was written for the View
// popover's AA switch, which was a dispose + init at a different sample count, and MSAA
// left the editor at foundations T4c. `dispose()` + `init()` on one host stays part of
// `FieldHost`'s declared contract — a double-invoked mount is the same shape, and so is
// any future re-acquisition — and what makes that contract worth anything is exactly what
// these two cases assert. A capability with no caller and no test is a capability that has
// already rotted.
//
// `dispose` destroys every chunk mesh, and the host's dirty set only ever holds chunks
// something EDITED, so an `init` that did not re-mark the store's chunks would leave the
// viewport empty until the next brush stroke — the defect that once had the user-facing
// name "toggling antialiasing deleted my world". The observable is
// `FieldStats.remeshVersion`, the monotonic "a remesh landed" counter (its TSDoc asks for
// a consumer or a deletion — this is a consumer).
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
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import type { WorkerLike } from "../src/field-host/field-client.ts";
import { createFieldHost } from "../src/field-host/field-host.ts";
import type {
  FieldWorkerRequest,
  FieldWorkerResponse,
} from "../src/field-host/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/field-host/field-protocol.ts";
import type { FieldLayers, FieldStats } from "../src/field-host/index.ts";
import { makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameCaptured } from "./_helpers/raf.ts";

await ensureBunWebGpu();

// The hand-driven tick RENDERS, and under bun-webgpu that render is INVALID: the host
// requests its context without `surfaceFormat: "linear"`, so `createView({ format:
// "bgra8unorm-srgb" })` fails validation against the mock's canvas texture. It fails
// ASYNCHRONOUSLY, as uncaptured device errors rather than a throw — which is why the
// tick still returns and the stats push before it still happens.
//
// `setSink(null)` silences CORE's routing of those errors (the `uncaptured-error.gpu`
// pattern), and that is ALL it silences: bun-webgpu prints its own `JS Device Error
// Callback` wall from native code, which nothing here can suppress. So this run is noisy
// either way — the mute keeps the duplicates out of core's log sink, where a test that
// asserted on it would otherwise be reading this render's failures.
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
  /** Every request ever posted, by kind. `sent` is the QUEUE — `deliver()` drains it —
   *  so counting "how many casts were asked for" needs a log that nothing splices. */
  const posted: FieldWorkerRequest["kind"][] = [];
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(msg, transfer) {
      const req = structuredClone(msg, {
        transfer: transfer ?? [],
      }) as FieldWorkerRequest;
      posted.push(req.kind);
      sent.push(req);
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
  return { worker, deliver, posted };
}

/** Drains the microtask queue: a remesh response walks a `.then`/`.catch` chain, so one
 *  `await` is not enough (the void-cast fixture's note). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** All layers on, `voidCast` as asked for. The chrome's own default set, restated here
 *  for the same reason the chrome restates it: nothing exports it. */
const layers = (voidCast: boolean): FieldLayers => ({
  field: true,
  kit: true,
  props: true,
  ghost: true,
  selection: true,
  grid: true,
  flags: true,
  voidCast,
});

/** An initialized host over a one-chunk world, with the render loop in the test's hand
 *  and the worker answering on demand. Callers own `teardown`. */
async function fixture() {
  const restoreRo = installMockResizeObserver();
  // The CAPTURED rAF variant: one hand-driven frame is the only way to reach
  // `drainDirty` and the stats push, both of which live inside the host's tick.
  // The canvas takes no listener map — this test drives the host through its
  // methods and that tick, never through input events.
  const raf = stubAnimationFrameCaptured();
  const fake = handlerWorker();
  const host = createFieldHost({ spawnWorker: () => fake.worker });
  const canvas = await makeHostCanvas();
  const stats: FieldStats[] = [];
  host.subscribeStats((s) => stats.push(s));
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [{ key: chunkKey(0, 0, 0), bytes: pocketChunk() }],
    oplog: null,
  });
  await host.init(canvas);
  return {
    host,
    canvas,
    errors,
    posted: fake.posted,
    /** The last stats push's remesh counter. */
    version: (): number => {
      const s = stats.at(-1);
      if (s === undefined) throw new Error("test: no stats were pushed");
      return s.remeshVersion;
    },
    /** One frame, the worker's answer, and a second frame to carry the result into a
     *  stats push. */
    frameAndSettle: async (now: number): Promise<void> => {
      raf.tick(now);
      fake.deliver();
      await flush();
      raf.tick(now + 16);
    },
    /** Let a response land without driving a frame (the cast needs no tick). */
    settle: async (): Promise<void> => {
      fake.deliver();
      await flush();
    },
    teardown: () => {
      host.dispose();
      raf.restore();
      restoreRo();
    },
  };
}

test.skipIf(!bunWebGpuAvailable())(
  "a re-init re-meshes the world the dispose tore down — the round trip's real cost",
  async () => {
    const f = await fixture();
    try {
      // The load's own dirty set drains on the first frames.
      await f.frameAndSettle(16);
      const meshed = f.version();
      expect(meshed).toBeGreaterThan(0);

      // …and then STAYS drained: an idle frame remeshes nothing. This is what makes the
      // assertion after the re-init mean something — without it, a counter that climbed
      // every frame regardless would pass either way.
      await f.frameAndSettle(48);
      expect(f.version()).toBe(meshed);

      // The round trip, exactly as CanvasHost would perform it: same host, same canvas.
      // The store, the log and the camera ride through; the meshes do not.
      f.host.dispose();
      await f.host.init(f.canvas);
      await f.frameAndSettle(80);
      // The world came back. Delete `init`'s re-mark of the store's chunks and this is
      // the line that fails — everything else about the round trip still passes, which
      // is precisely why it needs its own test.
      expect(f.version()).toBeGreaterThan(meshed);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a re-init re-requests the void cast the layer is still asking for",
  async () => {
    const f = await fixture();
    try {
      f.host.setLayers(layers(true));
      await f.settle();
      const casts = (): number =>
        f.posted.filter((k) => k === "void-cast").length;
      expect(casts()).toBe(1);
      // Scoped to the cast's own channel, so a future advisor message on the same seam
      // cannot pass or fail this. (Today there is none: the fixture never answers the
      // agent-profile question either way, and the idle notice waits for that answer.)
      const castErrors = (): string[] =>
        f.errors.filter((m) => m.includes("cast"));
      expect(castErrors()).toEqual([]);

      // `dispose` destroys the cast meshes; the LAYER FLAG rides through, and setLayers
      // only builds on the false→true edge — so without init's re-request the box stays
      // ticked over an X-ray that is simply gone, which is the reading
      // `field-voidcast.ts`'s `invalidateVoidCast` refuses to ship.
      f.host.dispose();
      await f.host.init(f.canvas);
      expect(casts()).toBe(2);
      // Re-REQUESTED, not complained about: no "re-toggle the void layer", no "still
      // building" (the in-flight latch cleared with the job the dispose rejected), no
      // "nothing to cast yet".
      expect(castErrors()).toEqual([]);

      // And the answer still lands — the cast is real, not a request into a void.
      await f.settle();
      expect(castErrors()).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);
