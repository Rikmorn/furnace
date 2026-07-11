import { expect, test } from "bun:test";
import {
  collectTransferables,
  createWorkerHandler,
  type WorkerEngine,
  type WorkerResponse,
} from "../src/frontend/lib/generation-protocol.ts";

/** A scripted engine: worldAttempts yields the given results; bake returns files. */
function fakeEngine(
  attempts: {
    attempt: number;
    attemptSeed: string;
    ok: boolean;
    error?: string;
    layout?: unknown;
  }[],
): WorkerEngine {
  return {
    worldAttempts: () => attempts.values(),
    bake: () => ({
      files: [{ path: "regions/w/wing.scene.json", contents: "{}" }],
    }),
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

test("run posts one attempt per yield, success carries the layout, then done placed", async () => {
  const layout = {
    regions: [{ p: new Float32Array([1, 2, 3]) }],
    connectors: [],
  };
  const { posted, handle } = harness(
    fakeEngine([
      { attempt: 0, attemptSeed: "s", ok: false, error: "nope" },
      { attempt: 1, attemptSeed: "s:1", ok: true, layout },
    ]),
  );
  await handle(INIT);
  await handle({
    kind: "run",
    runId: 7,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  expect(posted).toEqual([
    { kind: "ready" },
    {
      kind: "attempt",
      runId: 7,
      k: 0,
      attemptSeed: "s",
      ok: false,
      error: "nope",
    },
    { kind: "attempt", runId: 7, k: 1, attemptSeed: "s:1", ok: true, layout },
    { kind: "done", runId: 7, outcome: "placed" },
  ]);
});

test("exhausted run (no success) ends done exhausted", async () => {
  const { posted, handle } = harness(
    fakeEngine([{ attempt: 0, attemptSeed: "s", ok: false, error: "e" }]),
  );
  await handle(INIT);
  await handle({
    kind: "run",
    runId: 1,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 1,
    outcome: "exhausted",
  });
});

test("wantSuccesses !== 1 is refused setup-loud (reserved for 3.2.5)", async () => {
  const { posted, handle } = harness(fakeEngine([]));
  await handle(INIT);
  await handle({
    kind: "run",
    runId: 2,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 4,
  });
  const last = posted.at(-1);
  expect(last?.kind).toBe("done");
  expect(last && "outcome" in last && last.outcome).toBe("error");
  expect(last && "message" in last && last.message).toMatch(
    /wantSuccesses must be 1/,
  );
});

test("bake posts baked with the file set", async () => {
  const { posted, handle } = harness(fakeEngine([]));
  await handle(INIT);
  await handle({
    kind: "bake",
    runId: 3,
    attemptSeed: "s:1",
    config: {},
    budget: {},
    wingName: "w",
  });
  expect(posted.at(-1)).toEqual({
    kind: "baked",
    runId: 3,
    files: [{ path: "regions/w/wing.scene.json", contents: "{}" }],
  });
});

test("engine import failure posts init-error; a later run reports not-initialised", async () => {
  const { posted, handle } = harness(new Error("bundle broke"));
  await handle(INIT);
  expect(posted.at(-1)).toEqual({
    kind: "init-error",
    message: "bundle broke",
  });
  // The failed init reset the memoized engine → a later run hits the not-initialised guard.
  await handle({
    kind: "run",
    runId: 8,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 8,
    outcome: "error",
    message: "worker not initialised — init must precede run/bake",
  });
});

test("run before init posts a done error, never throws", async () => {
  const { posted, handle } = harness(fakeEngine([]));
  await handle({
    kind: "run",
    runId: 5,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  const last = posted.at(-1);
  expect(last?.kind).toBe("done");
  expect(last && "outcome" in last && last.outcome).toBe("error");
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

test("a successful attempt's post carries the layout's buffers as the transfer list", async () => {
  const buf = new Float32Array([1, 2, 3, 4]);
  const layout = { regions: [{ p: buf }], connectors: [] };
  const { posted, transfers, handle } = harness(
    fakeEngine([{ attempt: 0, attemptSeed: "s", ok: true, layout }]),
  );
  await handle(INIT);
  await handle({
    kind: "run",
    runId: 9,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  const i = posted.findIndex((m) => m.kind === "attempt");
  expect(transfers[i]).toContain(buf.buffer);
});

test("bake's post carries the file buffers as the transfer list", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const engine: WorkerEngine = {
    worldAttempts: () => [].values(),
    bake: () => ({ files: [{ path: "regions/w/x.fmesh", contents: bytes }] }),
    runWorld: () => ({ regions: [], connectors: [] }),
    bakeWorldFiles: () => [],
  };
  const { posted, transfers, handle } = harness(engine);
  await handle(INIT);
  await handle({
    kind: "bake",
    runId: 3,
    attemptSeed: "s:1",
    config: {},
    budget: {},
    wingName: "w",
  });
  const i = posted.findIndex((m) => m.kind === "baked");
  expect(transfers[i]).toContain(bytes.buffer);
});

test("worldAttempts throwing mid-iteration posts done error, never throws", async () => {
  const engine: WorkerEngine = {
    worldAttempts: function* () {
      yield { attempt: 0, attemptSeed: "s", ok: false, error: "first" };
      throw new Error("blew up mid-run");
    },
    bake: () => ({ files: [] }),
    runWorld: () => ({ regions: [], connectors: [] }),
    bakeWorldFiles: () => [],
  };
  const { posted, handle } = harness(engine);
  await handle(INIT);
  await handle({
    kind: "run",
    runId: 4,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  expect(posted.some((m) => m.kind === "attempt" && m.k === 0)).toBe(true);
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 4,
    outcome: "error",
    message: "blew up mid-run",
  });
});

test("bake throwing posts done error, never throws", async () => {
  const engine: WorkerEngine = {
    worldAttempts: () => [].values(),
    bake: () => {
      throw new Error("bake failed");
    },
    runWorld: () => ({ regions: [], connectors: [] }),
    bakeWorldFiles: () => [],
  };
  const { posted, handle } = harness(engine);
  await handle(INIT);
  await handle({
    kind: "bake",
    runId: 6,
    attemptSeed: "s:1",
    config: {},
    budget: {},
    wingName: "w",
  });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 6,
    outcome: "error",
    message: "bake failed",
  });
});

test("worldAttempts may return a bare Iterator (not just an Iterable)", async () => {
  const items = [
    { attempt: 0, attemptSeed: "s", ok: false, error: "e" },
    { attempt: 1, attemptSeed: "s:1", ok: true, layout: { regions: [] } },
  ];
  let i = 0;
  const engine: WorkerEngine = {
    // A bare Iterator (no Symbol.iterator) — exercises asIterable's wrap branch.
    worldAttempts: () =>
      ({
        next: () =>
          i < items.length
            ? { value: items[i++], done: false }
            : { value: undefined, done: true },
      }) as Iterator<(typeof items)[number]>,
    bake: () => ({ files: [] }),
    runWorld: () => ({ regions: [], connectors: [] }),
    bakeWorldFiles: () => [],
  };
  const { posted, handle } = harness(engine);
  await handle(INIT);
  await handle({
    kind: "run",
    runId: 10,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  expect(posted.at(-1)).toEqual({ kind: "done", runId: 10, outcome: "placed" });
});

test("an ok:true attempt with no layout surfaces the protocol-violation diagnostic and ends exhausted", async () => {
  const { posted, handle } = harness(
    fakeEngine([{ attempt: 0, attemptSeed: "s", ok: true /* no layout */ }]),
  );
  await handle(INIT);
  await handle({
    kind: "run",
    runId: 11,
    baseSeed: "s",
    config: {},
    budget: {},
    wantSuccesses: 1,
  });
  expect(posted).toContainEqual({
    kind: "attempt",
    runId: 11,
    k: 0,
    attemptSeed: "s",
    ok: false,
    error: "engine reported ok:true with no layout — protocol violation",
  });
  // No real success (the malformed ok had no layout) → the run ends exhausted, not placed.
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 11,
    outcome: "exhausted",
  });
});

// ── W1 world flow (deterministic — one payload, no attempt machinery) ──────────

test("runWorld posts a single world-run payload with the runId (no attempts)", async () => {
  const payload = {
    regions: [{ id: "cave-a", data: { p: new Float32Array([1, 2]) } }],
    connectors: [],
  };
  const engine: WorkerEngine = {
    ...fakeEngine([]),
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
    ...fakeEngine([]),
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
    ...fakeEngine([]),
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
    ...fakeEngine([]),
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
    ...fakeEngine([]),
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
    ...fakeEngine([]),
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
    ...fakeEngine([]),
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
  const { posted, handle } = harness(fakeEngine([]));
  await handle({ kind: "runWorld", runId: 27, spec: {} });
  expect(posted.at(-1)).toEqual({
    kind: "done",
    runId: 27,
    outcome: "error",
    message: "worker not initialised — init must precede run/bake",
  });
});
