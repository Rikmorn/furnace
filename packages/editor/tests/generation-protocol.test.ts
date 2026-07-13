import { expect, test } from "bun:test";
import {
  collectTransferables,
  createWorkerHandler,
  type WorkerEngine,
  type WorkerResponse,
} from "../src/frontend/lib/generation-protocol.ts";

/** A scripted engine: runWorld echoes the spec; bakeWorldFiles returns one file. */
function fakeEngine(): WorkerEngine {
  return {
    runWorld: (spec) => ({ regions: [], connectors: [], spec }),
    bakeWorldFiles: () => [
      { path: "worlds/w/world.scene.json", contents: "{}" },
    ],
  };
}

function harness(engine: WorkerEngine | Error) {
  const posted: WorkerResponse[] = [];
  const transfers: (Transferable[] | undefined)[] = [];
  const handle = createWorkerHandler({
    loadEngine: () =>
      engine instanceof Error
        ? Promise.reject(engine)
        : Promise.resolve(engine),
    post: (msg, transfer) => {
      posted.push(msg);
      transfers.push(transfer);
    },
  });
  return { posted, transfers, handle };
}

const INIT = { kind: "init", engineUrl: "/engine.js" } as const;

test("engine import failure posts init-error; a later runWorld reports not-initialised", async () => {
  const { posted, handle } = harness(new Error("bundle broke"));
  await handle(INIT);
  expect(posted.at(-1)).toEqual({
    kind: "init-error",
    message: "bundle broke",
  });
  // The failed init reset the memoized engine → a later request hits the guard.
  await handle({ kind: "runWorld", runId: 8, spec: {} });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 8,
    outcome: "error",
    message: "worker not initialised — init must precede runWorld/bakeWorld",
  });
});

test("collectTransferables dedupes views aliasing one buffer", () => {
  const buf = new ArrayBuffer(64);
  const value = {
    a: new Float32Array(buf, 0, 4),
    b: new Uint16Array(buf, 32, 8),
    c: [new Float32Array(8)],
  };
  const t = collectTransferables(value);
  expect(t).toHaveLength(2); // the shared buffer once + the standalone one
  expect(t).toContain(buf);
});

// ── W1 world flow (deterministic — one payload, no attempt machinery) ──────────

test("runWorld posts a single world-run payload with the runId (no attempts)", async () => {
  const payload = {
    regions: [{ id: "cave-a", data: { p: new Float32Array([1, 2]) } }],
    connectors: [],
  };
  const engine: WorkerEngine = {
    ...fakeEngine(),
    runWorld: (spec) => ({ ...payload, spec }),
  };
  const { posted, handle } = harness(engine);
  await handle(INIT);
  await handle({ kind: "runWorld", runId: 20, spec: { name: "w" } });
  expect(posted).toEqual([
    { kind: "ready" },
    {
      kind: "world-run",
      runId: 20,
      payload: { ...payload, spec: { name: "w" } },
    },
  ]);
});

test("runWorld passes the spec through to ext.runWorld", async () => {
  let seen: unknown;
  const engine: WorkerEngine = {
    ...fakeEngine(),
    runWorld: (spec) => {
      seen = spec;
      return { regions: [], connectors: [] };
    },
  };
  const { handle } = harness(engine);
  await handle(INIT);
  await handle({ kind: "runWorld", runId: 21, spec: { seeds: ["a", "b"] } });
  expect(seen).toEqual({ seeds: ["a", "b"] });
});

test("runWorld's post carries the payload's buffers as the transfer list", async () => {
  const buf = new Float32Array([9, 8, 7]);
  const engine: WorkerEngine = {
    ...fakeEngine(),
    runWorld: () => ({ regions: [{ id: "r", data: { p: buf } }] }),
  };
  const { posted, transfers, handle } = harness(engine);
  await handle(INIT);
  await handle({ kind: "runWorld", runId: 22, spec: {} });
  const i = posted.findIndex((m) => m.kind === "world-run");
  expect(transfers[i]).toContain(buf.buffer);
});

test("runWorld throwing posts a done error with the runId, never throws", async () => {
  const engine: WorkerEngine = {
    ...fakeEngine(),
    runWorld: () => {
      throw new Error("bad world spec");
    },
  };
  const { posted, handle } = harness(engine);
  await handle(INIT);
  await handle({ kind: "runWorld", runId: 23, spec: {} });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 23,
    outcome: "error",
    message: "bad world spec",
  });
});

test("bakeWorld posts baked with the file set and the runId", async () => {
  const engine: WorkerEngine = {
    ...fakeEngine(),
    bakeWorldFiles: (_spec, name) => [
      { path: `worlds/${name}/world.scene.json`, contents: "{}" },
    ],
  };
  const { posted, handle } = harness(engine);
  await handle(INIT);
  await handle({ kind: "bakeWorld", runId: 24, spec: {}, name: "myworld" });
  expect(posted.at(-1)).toEqual({
    kind: "baked",
    runId: 24,
    files: [{ path: "worlds/myworld/world.scene.json", contents: "{}" }],
  });
});

test("bakeWorld's post carries the file buffers as the transfer list", async () => {
  const bytes = new Uint8Array([4, 5, 6]);
  const engine: WorkerEngine = {
    ...fakeEngine(),
    bakeWorldFiles: () => [{ path: "worlds/w/x.fmesh", contents: bytes }],
  };
  const { posted, transfers, handle } = harness(engine);
  await handle(INIT);
  await handle({ kind: "bakeWorld", runId: 25, spec: {}, name: "w" });
  const i = posted.findIndex((m) => m.kind === "baked");
  expect(transfers[i]).toContain(bytes.buffer);
});

test("bakeWorld throwing posts a done error with the runId, never throws", async () => {
  const engine: WorkerEngine = {
    ...fakeEngine(),
    bakeWorldFiles: () => {
      throw new Error("world bake failed");
    },
  };
  const { posted, handle } = harness(engine);
  await handle(INIT);
  await handle({ kind: "bakeWorld", runId: 26, spec: {}, name: "w" });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 26,
    outcome: "error",
    message: "world bake failed",
  });
});

test("runWorld before init posts a done error, never throws", async () => {
  const { posted, handle } = harness(fakeEngine());
  await handle({ kind: "runWorld", runId: 27, spec: {} });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 27,
    outcome: "error",
    message: "worker not initialised — init must precede runWorld/bakeWorld",
  });
});
