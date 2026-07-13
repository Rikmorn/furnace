// The chrome ↔ generation-worker message protocol (Slice 3.2.3). The handler is a
// PURE factory over injected deps so the protocol is unit-testable without a real
// Worker (bun test spawns none): the worker entry wires createWorkerHandler to the
// real engine import + self.postMessage; tests wire fakes.

/** The generator surface the worker consumes off the engine bundle's `extensions`
 *  namespace (structural — the bundle crosses the project-first boundary untyped;
 *  the worker narrows it once, mirroring the WorldPanel's main-thread seam). */
export type WorkerEngine = {
  /** Realize a declarative world spec for preview. DETERMINISTIC (no search/attempts)
   *  — one call, one payload. The payload passes through opaquely (only the panel
   *  reads inside it). */
  runWorld: (spec: unknown) => unknown;
  /** Bake a declarative world to a file set (uploaded via `generation.bake`). */
  bakeWorldFiles: (spec: unknown, name: string) => BakeFileLike[];
};

export type BakeFileLike = { path: string; contents: string | Uint8Array };

export type WorkerRequest =
  | { kind: "init"; engineUrl: string }
  | { kind: "runWorld"; runId: number; spec: unknown }
  | { kind: "bakeWorld"; runId: number; spec: unknown; name: string };

export type WorkerResponse =
  | { kind: "ready" }
  | { kind: "init-error"; message: string }
  /** Failure channel: every non-init error posts here with the runId. */
  | { kind: "done"; runId: number; outcome: "error"; message?: string }
  | { kind: "baked"; runId: number; files: BakeFileLike[] }
  /** The deterministic single realize payload (no attempt machinery). */
  | { kind: "world-run"; runId: number; payload: unknown };

/** Collect the distinct ArrayBuffers under a value for a postMessage transfer list.
 *  Typed-array views may ALIAS one buffer (mesh streams can share a backing store) —
 *  the Set dedupes so a shared buffer enters the list once (a duplicate transferable
 *  is a DataCloneError). */
export function collectTransferables(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer) buffers.add(v.buffer);
      return;
    }
    if (v instanceof ArrayBuffer) {
      buffers.add(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(value);
  return [...buffers];
}

export type PostFn = (msg: WorkerResponse, transfer?: Transferable[]) => void;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The worker's message handler over injected deps. `loadEngine` runs once
 * (memoized); EVERY failure path posts a typed message — the handler never throws
 * (a worker-side throw would surface as a generic ErrorEvent with no runId).
 */
export function createWorkerHandler(deps: {
  loadEngine: (url: string) => Promise<WorkerEngine>;
  post: PostFn;
}): (msg: WorkerRequest) => Promise<void> {
  let engine: Promise<WorkerEngine> | undefined;

  return async (msg) => {
    if (msg.kind === "init") {
      // Memoized by presence, not by URL: the client always inits with "/engine.js",
      // and cancel respawns a FRESH worker, so a same-instance re-init with a different
      // URL never happens (a page reload replaces the whole worker).
      engine ??= deps.loadEngine(msg.engineUrl);
      try {
        await engine;
        deps.post({ kind: "ready" });
      } catch (err) {
        engine = undefined; // a later init may retry (e.g. after a rebuild)
        deps.post({ kind: "init-error", message: errText(err) });
      }
      return;
    }

    const postError = (message: string): void =>
      deps.post({ kind: "done", runId: msg.runId, outcome: "error", message });

    if (!engine) {
      postError(
        "worker not initialised — init must precede runWorld/bakeWorld",
      );
      return;
    }
    const ext = await engine.catch(() => undefined);
    if (!ext) {
      postError("engine bundle failed to load");
      return;
    }

    if (msg.kind === "runWorld") {
      // Deterministic: one realize, one payload — no attempt loop. A throw (invalid spec,
      // generator failure) surfaces as a typed done-error carrying the runId.
      try {
        const payload = ext.runWorld(msg.spec);
        deps.post(
          { kind: "world-run", runId: msg.runId, payload },
          collectTransferables(payload),
        );
      } catch (err) {
        postError(errText(err));
      }
      return;
    }

    // msg.kind === "bakeWorld"
    try {
      const files = ext.bakeWorldFiles(msg.spec, msg.name);
      deps.post(
        { kind: "baked", runId: msg.runId, files },
        collectTransferables(files),
      );
    } catch (err) {
      postError(errText(err));
    }
  };
}
