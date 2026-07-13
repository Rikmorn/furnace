import { expect, test } from "bun:test";
import {
  GenerationWorkerClient,
  type WorkerLike,
} from "../src/frontend/lib/generation-client.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../src/frontend/lib/generation-protocol.ts";

/** A fake worker: records every posted request, exposes `emit` to simulate a worker
 *  message, and flags `terminated`. */
function fakeWorker() {
  const posts: WorkerRequest[] = [];
  const state = { terminated: false };
  const w: WorkerLike = {
    postMessage: (msg: WorkerRequest) => void posts.push(msg),
    terminate: () => {
      state.terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
  const emit = (m: WorkerResponse): void =>
    w.onmessage?.({ data: m } as MessageEvent<WorkerResponse>);
  /** The runId the client stamped on its most recent request post. */
  const lastRunId = (): number => {
    const last = posts.at(-1);
    if (!last || last.kind === "init") throw new Error("no request posted yet");
    return last.runId;
  };
  return { w, posts, emit, state, lastRunId };
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: no-op handler for tests that don't assert on this callback
const noop = (): void => {};

function noopWorld() {
  return { onWorld: noop, onError: noop };
}

test("cancel terminates, drops late messages, and respawns on the next run", () => {
  const first = fakeWorker();
  const second = fakeWorker();
  let spawned = 0;
  const client = new GenerationWorkerClient(() =>
    spawned++ === 0 ? first.w : second.w,
  );
  const seen: string[] = [];
  client.runWorld(
    { name: "w" },
    {
      onWorld: () => void seen.push("world"),
      onError: () => void seen.push("error"),
    },
  );
  const staleId = first.lastRunId();
  client.cancel();
  expect(first.state.terminated).toBe(true);
  first.emit({ kind: "world-run", runId: staleId, payload: {} }); // late message from the dead run
  expect(seen).toEqual([]); // dropped — cancel cleared the handlers and dereferenced the worker
  client.runWorld({ name: "w2" }, noopWorld());
  expect(spawned).toBe(2); // lazy respawn
});

test("a superseded run's late payload is dropped by the runId guard (live worker)", () => {
  const { w, emit, lastRunId } = fakeWorker();
  const client = new GenerationWorkerClient(() => w);
  const seen: string[] = [];
  client.runWorld(
    { name: "w" },
    { onWorld: () => void seen.push("first"), onError: noop },
  );
  const staleId = lastRunId();
  // No cancel: the SAME worker stays live and the new run installs its own handlers, so
  // neither the identity guard nor the handler reset can help here — the bumped runId is
  // the only thing standing between the abandoned run's payload and the new run's onWorld.
  client.runWorld(
    { name: "w2" },
    { onWorld: () => void seen.push("second"), onError: noop },
  );
  emit({ kind: "world-run", runId: staleId, payload: {} });
  expect(seen).toEqual([]);
  emit({ kind: "world-run", runId: lastRunId(), payload: {} });
  expect(seen).toEqual(["second"]); // the live run still lands
});

test("done error routes to onError; init-error reaches the active handler", () => {
  const { w, emit, lastRunId } = fakeWorker();
  const client = new GenerationWorkerClient(() => w);
  const errors: string[] = [];
  client.runWorld(
    { name: "w" },
    { onWorld: noop, onError: (m) => void errors.push(m) },
  );
  emit({ kind: "init-error", message: "bundle broke" });
  emit({ kind: "done", runId: lastRunId(), outcome: "error", message: "boom" });
  expect(errors).toEqual(["bundle broke", "boom"]);
});

test("runWorld inits, posts the spec, and routes world-run to onWorld", () => {
  const { w, posts, emit, lastRunId } = fakeWorker();
  const client = new GenerationWorkerClient(() => w);
  const payloads: unknown[] = [];
  client.runWorld(
    { name: "w", seeds: ["a", "b"] },
    { onWorld: (p) => void payloads.push(p), onError: noop },
  );
  expect(posts[0]).toEqual({ kind: "init", engineUrl: "/engine.js" });
  expect(posts[1]).toMatchObject({
    kind: "runWorld",
    spec: { name: "w", seeds: ["a", "b"] },
  });
  emit({ kind: "world-run", runId: lastRunId(), payload: { regions: [] } });
  expect(payloads).toEqual([{ regions: [] }]);
});

test("bakeWorld posts the spec + name and routes baked to onBaked", () => {
  const { w, posts, emit, lastRunId } = fakeWorker();
  const client = new GenerationWorkerClient(() => w);
  const baked: number[] = [];
  client.bakeWorld({ name: "w" }, "myworld", {
    onBaked: (files) => void baked.push(files.length),
    onError: noop,
  });
  expect(posts[1]).toMatchObject({
    kind: "bakeWorld",
    spec: { name: "w" },
    name: "myworld",
  });
  emit({
    kind: "baked",
    runId: lastRunId(),
    files: [{ path: "worlds/myworld/world.scene.json", contents: "{}" }],
  });
  expect(baked).toEqual([1]);
});

test("a world-run done error routes to the world handler's onError", () => {
  const { w, emit, lastRunId } = fakeWorker();
  const client = new GenerationWorkerClient(() => w);
  const errors: string[] = [];
  client.runWorld(
    { name: "w" },
    { onWorld: noop, onError: (m) => void errors.push(m) },
  );
  emit({ kind: "done", runId: lastRunId(), outcome: "error", message: "boom" });
  expect(errors).toEqual(["boom"]);
});

test("a spawn failure is setup-loud through onError, and runWorld() never throws (D5)", () => {
  const client = new GenerationWorkerClient(() => {
    throw new Error("worker script 404");
  });
  const errors: string[] = [];
  expect(() =>
    client.runWorld(
      { name: "w" },
      { onWorld: noop, onError: (m) => void errors.push(m) },
    ),
  ).not.toThrow();
  expect(errors).toEqual(["worker script 404"]);
});

test("a stale init-error from a cancelled worker never reaches a later run's onError", () => {
  const first = fakeWorker();
  const second = fakeWorker();
  let spawned = 0;
  const client = new GenerationWorkerClient(() =>
    spawned++ === 0 ? first.w : second.w,
  );
  client.runWorld({ name: "w" }, noopWorld());
  client.cancel();
  // Worker A is terminated + dereferenced; a queued message from it must not touch
  // the NEW run's handlers (init-error carries no runId, so only the identity guard
  // stops it).
  const errors: string[] = [];
  client.runWorld(
    { name: "w2" },
    { onWorld: noop, onError: (m) => void errors.push(m) },
  );
  first.emit({ kind: "init-error", message: "stale from dead worker A" });
  expect(errors).toEqual([]);
});
