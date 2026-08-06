import type { AnalyzerRequest, AnalyzerResponse } from "./analyzer-protocol.ts";
import type { WorkerLike } from "./field-client.ts";

/** The worker's success responses — what a pending job may resolve with. */
type AnalyzerSuccess = Extract<
  AnalyzerResponse,
  { kind: "flags" | "verified" | "acked" }
>;

/** The response kind each request kind is answered with. One statement of the
 *  pairing, so `send` derives the expected answer from the request instead of
 *  being told (the FieldWorkerClient rule). */
const RESPONSE_KIND = {
  sync: "acked",
  placements: "acked",
  analyze: "flags",
  verify: "verified",
} as const satisfies Record<AnalyzerRequest["kind"], AnalyzerSuccess["kind"]>;

/** The answer a given request resolves with. */
type ResponseFor<R extends AnalyzerRequest> = Extract<
  AnalyzerResponse,
  { kind: (typeof RESPONSE_KIND)[R["kind"]] }
>;

/** `r.kind === kind` as a predicate: TypeScript cannot narrow a union through a
 *  comparison against a GENERIC discriminator, so the check has to name the
 *  relationship it proves. A predicate, not an `as` — the runtime test is real
 *  and this is the whole of it. */
function isKind<K extends AnalyzerSuccess["kind"]>(
  r: AnalyzerSuccess,
  kind: K,
): r is Extract<AnalyzerResponse, { kind: K }> {
  return r.kind === kind;
}

const defaultSpawn = (): WorkerLike =>
  // Boundary cast: the DOM Worker satisfies WorkerLike structurally; the alias
  // exists only so tests can inject a fake.
  new Worker("/analyzer-worker.js", {
    type: "module",
  }) as unknown as WorkerLike;

/** The payload of one request kind, minus the envelope {@link
 *  AnalyzerWorkerClient} stamps on it. Derived rather than restated so a change
 *  to {@link AnalyzerRequest} cannot leave this file describing a wire the
 *  worker no longer speaks. */
type Payload<K extends AnalyzerRequest["kind"]> = Omit<
  Extract<AnalyzerRequest, { kind: K }>,
  "kind" | "jobId"
>;

/** What one stage-1 pass needs to know. Per-field docs live on the request in
 *  `analyzer-protocol.ts`, which owns the shape. */
export type AnalyzeInput = Payload<"analyze">;

/** One persistent analyzer worker; stale results dropped by jobId. A plain
 *  request pipe, like `FieldWorkerClient`: it does not cancel and does not
 *  coalesce. Callers that can fire the same job twice own that themselves —
 *  {@link createAnalyzePump} is the latest-wins collapse for the one verb where
 *  it matters. */
export class AnalyzerWorkerClient {
  private worker: WorkerLike | null = null;
  private jobId = 0;
  private pending = new Map<
    number,
    { resolve: (r: AnalyzerSuccess) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly spawn: () => WorkerLike = defaultSpawn) {}

  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.spawn();
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data as AnalyzerResponse;
      const entry = this.pending.get(msg.jobId);
      if (!entry) return; // stale — superseded or already settled
      this.pending.delete(msg.jobId);
      if (msg.kind === "analyzer-error") entry.reject(new Error(msg.message));
      else entry.resolve(msg);
    };
    this.worker = w;
    return w;
  }

  /** Posts one request and resolves with the response of the expected `kind`.
   *  The one place the pending-entry invariants live: the answer is NARROWED at
   *  runtime rather than cast (a wrong-kind response is a protocol bug, surfaced
   *  as a rejection), and a synchronous `postMessage` throw (dead worker) is
   *  rethrown from inside the executor, so the caller sees ONE failure channel.
   *  The entry is deleted on that path as map hygiene — the worker never got the
   *  message, so no response will ever carry that jobId. */
  private send<R extends AnalyzerRequest>(req: R): Promise<ResponseFor<R>> {
    const { jobId } = req;
    // Reading a discriminator off a value of generic type widens it back to the
    // whole union, which loses the request→response pairing this signature
    // exists to keep. The lookup is TOTAL over that union (RESPONSE_KIND
    // `satisfies Record<AnalyzerRequest["kind"], …>`), so the value is right by
    // construction and only its type needs restating.
    const kind = RESPONSE_KIND[req.kind as R["kind"]];
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, {
        resolve: (r) => {
          if (isKind(r, kind)) resolve(r);
          else
            reject(
              new Error(`analyzer worker: expected ${kind}, got ${r.kind}`),
            );
        },
        reject,
      });
      try {
        this.ensure().postMessage(req);
      } catch (err) {
        this.pending.delete(jobId);
        throw err;
      }
    });
  }

  /** Bring the worker's mirror level with the host's store. Density buffers are
   *  structured-CLONED, not transferred: the host goes on editing its own. */
  sync(
    cellSize: number,
    upserts: Payload<"sync">["upserts"],
    removed: Payload<"sync">["removed"],
  ) {
    return this.send({
      kind: "sync",
      jobId: ++this.jobId,
      cellSize,
      upserts,
      removed,
    });
  }

  /** Replace the placement collider set the analyzer sees. */
  placements(groups: Payload<"placements">["groups"]) {
    return this.send({ kind: "placements", jobId: ++this.jobId, groups });
  }

  /** Run stage 1 over the chunks the edits could have changed the answer for.
   *  The response carries a REPLACEMENT flag list per analysed chunk. */
  analyze(input: AnalyzeInput) {
    return this.send({ kind: "analyze", jobId: ++this.jobId, ...input });
  }

  /** Run stage 2 on one flag: the project's real mover, driven at it. */
  verify(req: Payload<"verify">) {
    return this.send({ kind: "verify", jobId: ++this.jobId, ...req });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending)
      p.reject(new Error("analyzer worker disposed"));
    this.pending.clear();
  }
}

/** A latest-wins in-flight latch. `request()` fires immediately when idle; while
 *  a job is in flight, any number of further requests collapse into ONE queued
 *  flag, re-fired once on `settle()`. `fire` returns whether a job was actually
 *  posted; false leaves the latch idle instead of wedging it.
 *
 *  COPIED from `createPreviewCoalescer` in `src/field-host/field-stamp.ts`
 *  rather than imported: `tests/frontend-no-engine-leakage.test.ts` forbids any
 *  `field-host` specifier in a chrome-graph file, because that barrel carries
 *  engine code. This much duplication is the cheaper side of that trade — the
 *  alternative is hoisting the primitive into a third module, which is a refactor
 *  of the stamp host, not of this. */
function createLatestWinsLatch(fire: () => boolean): {
  request(): void;
  settle(): void;
} {
  let inFlight = false;
  let queued = false;
  return {
    request(): void {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = fire();
    },
    settle(): void {
      inFlight = false;
      if (!queued) return;
      queued = false;
      inFlight = fire();
    },
  };
}

/**
 * A latest-wins analyse pump over one client: the collapse an interactive edit
 * loop needs, kept out of the client so the client stays a plain pipe.
 *
 * Every `request()` while a pass is in flight collapses into ONE re-fire, and
 * that re-fire reads `next()` at FIRE time — so the accumulated dirty set goes
 * out, not the one that happened to be current when the key was pressed.
 * `next()` returning `undefined` (nothing dirty, no profile yet) skips the fire
 * and leaves the latch idle.
 *
 * One failure channel: a rejected pass AND a throw out of `onFlags` both reach
 * `onError`, and the latch settles either way. Wedging the pump on a host-side
 * render bug would stop analysis for the rest of the session.
 */
export function createAnalyzePump(
  client: AnalyzerWorkerClient,
  deps: {
    next: () => AnalyzeInput | undefined;
    onFlags: (r: Extract<AnalyzerResponse, { kind: "flags" }>) => void;
    onError: (err: Error) => void;
  },
): { request(): void } {
  const latch = createLatestWinsLatch(() => {
    const input = deps.next();
    if (input === undefined) return false;
    client
      .analyze(input)
      .then(deps.onFlags)
      .catch((err: unknown) =>
        deps.onError(err instanceof Error ? err : new Error(String(err))),
      )
      // settle() on EVERY settlement, result or error, or the latch wedges.
      .finally(() => latch.settle());
    return true;
  });
  return { request: () => latch.request() };
}
