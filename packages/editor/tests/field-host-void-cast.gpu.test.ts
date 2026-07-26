// The void cast's HOST lifecycle on a real (bun-webgpu) context — the half
// `field-host-headless.test.ts` cannot reach, because nothing about a cast is
// observable until `requestVoidCast` gets past its context guard.
//
// The worker is INJECTED (createFieldHost's spawnWorker seam) and runs the REAL
// protocol handler in-process, so these tests exercise the whole loop —
// snapshot → request → handler → response → applyVoidCast against a live device
// — with no `/field-worker.js` in sight. Necessary, not tidy: a job posted to a
// Worker spawned from that browser URL never settles under bun (measured: still
// pending after 1 s), so with a real one nothing past the request would run.
import { expect, test } from "bun:test";
import {
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  type FieldManifest,
  SOLID,
} from "@furnace/core/field";
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
import type { FieldLayers } from "../src/viewport-host/index.ts";

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

/** A chunk with an open pocket, so the cast has something to mesh. */
function pocketChunk(): Uint8Array {
  const chunk = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
  for (let z = 4; z < 12; z++)
    for (let y = 4; y < 12; y++)
      for (let x = 4; x < 12; x++) chunk[x + 16 * (y + 16 * z)] = 127;
  return encodeChunkFile(chunk);
}

/** A worker whose "thread" is the real handler, called on demand. `deliver`
 *  runs every request received so far and posts each answer back through
 *  `onmessage`, exactly as a Worker would — so the host's response path runs
 *  only when a test asks for it, and the interval before that IS the in-flight
 *  window. */
function handlerWorker() {
  const sent: FieldWorkerRequest[] = [];
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(msg, transfer) {
      // Faithful to the real boundary, and deliberately so: the message is
      // structured-cloned and every listed buffer is DETACHED on this side. A
      // host that transferred its live store buffers instead of copies loses
      // them here exactly as it would in a browser, which is what makes the
      // copy contract testable at all.
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
  return { worker, sent, deliver };
}

/** Drains the microtask queue. A response walks a two-link chain (`.then` for
 *  the result, `.catch` for a handler that threw), so one `await` is not
 *  enough — a single turn would assert before a failure inside applyVoidCast
 *  could be reported. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** rAF/cAF do not exist in bun. The host schedules its render loop through them
 *  at the end of `init`, so they must exist — but the callback must NOT run:
 *  ticking would render, and bun-webgpu's mock drops the `viewFormats` array
 *  the engine's default sRGB surface needs. Nothing under test lives in the
 *  tick (a cast is driven by setLayers → worker → response). */
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

/** The fixture canvas plus the DOM surface `attachListeners` and the camera
 *  bind reach for. All no-ops: these tests drive the host through its methods,
 *  never through input events. */
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

/** An initialized host over a one-chunk world with a pocket in it, plus its
 *  injected worker and an error log. Callers own `teardown`. */
async function fieldHostFixture() {
  const restoreRo = installMockResizeObserver();
  const restoreRaf = stubAnimationFrame();
  const fake = handlerWorker();
  const host = createFieldHost({ spawnWorker: () => fake.worker });
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [{ key: chunkKey(0, 0, 0), bytes: pocketChunk() }],
    oplog: null,
  });
  await host.init(await makeHostCanvas());
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  return {
    host,
    errors,
    ...fake,
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

test.skipIf(!bunWebGpuAvailable())(
  "enabling the cast snapshots every allocated chunk and meshes the response",
  async () => {
    const f = await fieldHostFixture();
    try {
      f.host.setLayers(layers(true));
      // The request the host BUILT — the piece a headless test can never see.
      expect(f.sent.length).toBe(1);
      const req = f.sent[0] as FieldWorkerRequest;
      expect(req.kind).toBe("void-cast");
      if (req.kind !== "void-cast") return;
      expect(req.chunks.map((c) => c.key)).toEqual([chunkKey(0, 0, 0)]);
      expect(req.cellSize).toBe(DEFAULT_CELL_SIZE);
      expect(req.chunks[0]?.density.byteLength).toBe(CHUNK_SAMPLES);

      // Run the handler and let the response land: geometry + meshes are built
      // against the live device. A throw in applyVoidCast surfaces as a
      // "void cast failed" tool error rather than escaping, so an empty error
      // log is the assertion that the response path ran clean.
      f.deliver();
      await flush();
      expect(f.errors).toEqual([]);

      // Cast again. This is the copy contract's teeth: the client TRANSFERS
      // what it is handed, so a host that snapshotted the store's live buffers
      // would have had them detached by the first send, and building this
      // second snapshot would throw instead of producing a whole chunk.
      f.host.setLayers(layers(false));
      f.host.setLayers(layers(true));
      expect(f.sent.length).toBe(1);
      const again = f.sent[0] as FieldWorkerRequest;
      if (again.kind !== "void-cast") throw new Error("expected a second cast");
      expect(again.chunks[0]?.density.byteLength).toBe(CHUNK_SAMPLES);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a mutation entry point that changes NO cells leaves the cast standing",
  async () => {
    const f = await fieldHostFixture();
    try {
      f.host.setLayers(layers(true));
      f.deliver();
      await flush();

      // `undo` with nothing to undo writes no cells, and neither does the pure
      // scatter commit it stands in for here (core scatter → `{ ops: [] }`), so
      // both reach markDirtyWithNeighbors with an empty set. A cast shows SHAPE
      // and never props: it cannot have been staled, and must not be torn down.
      //
      // The teeth: delete `if (changed.size === 0) return;` from
      // markDirtyWithNeighbors and this receives
      // ["void cast cleared — the field changed; …"].
      f.host.undo();
      expect(f.errors).toEqual([]);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a second cast is refused while the worker is still on the first",
  async () => {
    const f = await fieldHostFixture();
    try {
      f.host.setLayers(layers(true));
      expect(f.sent.length).toBe(1);
      // Off and on again while the job is unanswered. The discard cannot call
      // the worker off, so posting a second sweep of the world would only stack
      // work behind which every chunk remesh waits.
      f.host.setLayers(layers(false));
      f.host.setLayers(layers(true));
      expect(f.sent.length).toBe(1);
      expect(f.errors).toEqual([
        "a void cast is still building — re-tick the void layer once it lands",
      ]);

      // Once it lands (stranded by the discard — nothing is drawn), the latch
      // is free and the next enable posts again.
      f.deliver();
      await flush();
      f.host.setLayers(layers(false));
      f.host.setLayers(layers(true));
      expect(f.sent.length).toBe(1); // the queue was drained by deliver()
      expect(f.sent[0]?.kind).toBe("void-cast");
    } finally {
      f.teardown();
    }
  },
);
