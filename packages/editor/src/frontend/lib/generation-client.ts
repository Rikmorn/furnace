// The chrome-side client for the generation worker (Slice 3.2.3). One persistent
// module worker; cancel (mid-run included) = terminate + lazy respawn — a realize/bake
// needs no cooperation to die. A bumped runId makes any late message from a
// dead or superseded run fall on the floor (the document session's await-race
// discipline, applied to worker messages).
import type {
  BakeFileLike,
  WorkerRequest,
  WorkerResponse,
} from "./generation-protocol.ts";

/** The Worker surface the client uses — injectable so tests run a fake. */
export type WorkerLike = {
  postMessage(msg: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
};

export type BakeHandlers = {
  onBaked(files: BakeFileLike[]): void;
  onError(message: string): void;
};

/** W1 world-realize handlers: one deterministic payload (no attempt stream), or an error. */
export type WorldRunHandlers = {
  onWorld(payload: unknown): void;
  onError(message: string): void;
};

const defaultSpawn = (): WorkerLike =>
  // Boundary cast: the DOM Worker satisfies WorkerLike structurally; the alias
  // exists only so tests can inject a fake.
  new Worker("/generation-worker.js", {
    type: "module",
  }) as unknown as WorkerLike;

export class GenerationWorkerClient {
  private worker: WorkerLike | undefined;
  private runId = 0;
  private handlers: { bake?: BakeHandlers; worldRun?: WorldRunHandlers } = {};
  private readonly spawn: () => WorkerLike;
  private readonly engineUrl: string;

  constructor(
    spawn: () => WorkerLike = defaultSpawn,
    engineUrl = "/engine.js",
  ) {
    this.spawn = spawn;
    this.engineUrl = engineUrl;
  }

  /** W1: realize a declarative world spec (deterministic — one payload, no attempt stream). */
  // Reentrancy precondition (covers bakeWorld too): the caller must cancel() before
  // starting new work if a prior run may still be live. runId drops the abandoned
  // run's results, but the worker keeps grinding it until it finishes — the panel's
  // disabled-during-run gating is the real enforcement.
  runWorld(spec: unknown, handlers: WorldRunHandlers): void {
    const runId = ++this.runId;
    this.handlers = { worldRun: handlers };
    if (!this.ensure(handlers.onError)) return;
    this.worker?.postMessage({ kind: "runWorld", runId, spec });
  }

  /** W1: bake a declarative world spec to a file set (reuses the `baked` response). */
  bakeWorld(spec: unknown, name: string, handlers: BakeHandlers): void {
    const runId = ++this.runId;
    this.handlers = { bake: handlers };
    if (!this.ensure(handlers.onError)) return;
    this.worker?.postMessage({ kind: "bakeWorld", runId, spec, name });
  }

  /** Kill any in-flight work INSTANTLY (mid-run included). Lazy respawn. */
  cancel(): void {
    this.runId++;
    this.handlers = {};
    this.worker?.terminate();
    this.worker = undefined;
  }

  /** Spawn-on-demand; a spawn/init failure is setup-loud through onError (D5: no
   *  silent fallback path exists — the stepper is gone). */
  private ensure(onError: (message: string) => void): boolean {
    if (this.worker) return true;
    try {
      const w = this.spawn();
      // Worker-identity guard: terminate() does not dequeue a worker's already-posted
      // messages, so a late init-error/onerror from a cancelled or superseded worker
      // could otherwise reach the CURRENT run's handlers (ready/init-error carry no
      // runId, so the runId check in route() can't catch them). Drop anything from a
      // worker this client no longer owns.
      w.onmessage = (e) => {
        if (this.worker !== w) return;
        this.route(e.data);
      };
      w.onerror = (e) => {
        if (this.worker !== w) return;
        this.activeError(e.message || "generation worker crashed");
      };
      w.postMessage({ kind: "init", engineUrl: this.engineUrl });
      this.worker = w;
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  private activeError(message: string): void {
    (this.handlers.bake ?? this.handlers.worldRun)?.onError(message);
  }

  private route(msg: WorkerResponse): void {
    if (msg.kind === "ready") return; // init success needs no chrome-side action
    if (msg.kind === "init-error") {
      this.activeError(msg.message);
      return;
    }
    if (msg.runId !== this.runId) return; // stale run — dropped, no state writes
    switch (msg.kind) {
      case "baked":
        this.handlers.bake?.onBaked(msg.files);
        return;
      case "world-run":
        this.handlers.worldRun?.onWorld(msg.payload);
        return;
      case "done":
        this.activeError(msg.message ?? "generation failed");
        return;
    }
  }
}
