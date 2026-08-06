import type { FieldAprons, MaterialTable } from "@furnace/core/field";
import type {
  FieldWorkerRequest,
  FieldWorkerResponse,
} from "./field-protocol.ts";

/** The slice of `Worker` this client uses — the seam {@link FieldWorkerClient}'s
 *  constructor takes, so a test can drive the protocol without a real Worker. */
export type WorkerLike = {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

/** The worker's success responses — what a pending job may resolve with. */
type FieldWorkerSuccess = Extract<
  FieldWorkerResponse,
  { kind: "meshed" | "stamp-previewed" | "void-casted" }
>;

/** The response kind each request kind is answered with. One statement of the
 *  pairing, so `send` derives the expected answer from the request instead of
 *  being told — passing them separately would let a caller ask for a `mesh` and
 *  await a `void-casted`, and only the runtime would object. */
const RESPONSE_KIND = {
  mesh: "meshed",
  "stamp-preview": "stamp-previewed",
  "void-cast": "void-casted",
} as const satisfies Record<
  FieldWorkerRequest["kind"],
  FieldWorkerSuccess["kind"]
>;

/** The answer a given request resolves with. */
type ResponseFor<R extends FieldWorkerRequest> = Extract<
  FieldWorkerResponse,
  { kind: (typeof RESPONSE_KIND)[R["kind"]] }
>;

/** `r.kind === kind` as a predicate: TypeScript cannot narrow a union through a
 *  comparison against a GENERIC discriminator, so the check has to name the
 *  relationship it proves. A predicate, not an `as` — the runtime test is real
 *  and this is the whole of it. */
function isKind<K extends FieldWorkerSuccess["kind"]>(
  r: FieldWorkerSuccess,
  kind: K,
): r is Extract<FieldWorkerResponse, { kind: K }> {
  return r.kind === kind;
}

const defaultSpawn = (): WorkerLike =>
  new Worker("/field-worker.js", { type: "module" }) as unknown as WorkerLike;

/** One persistent field worker; stale results dropped by jobId. A plain request
 *  pipe: it does NOT cancel or coalesce, so a caller that can fire the same job
 *  twice owns that itself — the FieldHost coalesces stamp previews behind a
 *  latch, drops redundant remeshes through its dirty set, and refuses a second
 *  void cast while one is in flight. Nothing here stops the worker computing a
 *  job whose result the caller has already decided to ignore. */
export class FieldWorkerClient {
  private worker: WorkerLike | null = null;
  private jobId = 0;
  private pending = new Map<
    number,
    {
      resolve: (r: FieldWorkerSuccess) => void;
      reject: (e: Error) => void;
    }
  >();

  constructor(private readonly spawn: () => WorkerLike = defaultSpawn) {}

  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.spawn();
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data as FieldWorkerResponse;
      const entry = this.pending.get(msg.jobId);
      if (!entry) return; // stale — superseded or already settled
      this.pending.delete(msg.jobId);
      if (msg.kind === "mesh-error") entry.reject(new Error(msg.message));
      else entry.resolve(msg);
    };
    this.worker = w;
    return w;
  }

  /** Posts one request and resolves with the response of the expected `kind`.
   *  The one place the pending-entry invariants live, so every request kind
   *  gets them: the answer is NARROWED at runtime rather than cast (a response
   *  of the wrong kind is a protocol bug, surfaced as a rejection), and a
   *  synchronous `postMessage` throw (bad transferable, dead worker) deletes
   *  the entry before rethrowing — a stranded entry would leave its promise
   *  pending forever. Rethrowing inside the executor rejects the returned
   *  promise, so callers see one failure channel. */
  private send<R extends FieldWorkerRequest>(
    req: R,
    transfer: Transferable[],
  ): Promise<ResponseFor<R>> {
    const { jobId } = req;
    // Reading a discriminator off a value of generic type widens it back to the
    // whole union, which loses the request→response pairing this signature
    // exists to keep. The lookup is TOTAL over that union (RESPONSE_KIND
    // `satisfies Record<FieldWorkerRequest["kind"], …>`), so the value is right
    // by construction and only its type needs restating.
    const kind = RESPONSE_KIND[req.kind as R["kind"]];
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, {
        resolve: (r) => {
          if (isKind(r, kind)) resolve(r);
          else
            reject(new Error(`field worker: expected ${kind}, got ${r.kind}`));
        },
        reject,
      });
      try {
        this.ensure().postMessage(req, transfer);
      } catch (err) {
        this.pending.delete(jobId);
        throw err;
      }
    });
  }

  /** Remesh one chunk from its aprons (buffers TRANSFERRED). `sliceY` clips
   *  the display copy: samples at/above that world Y read as air before
   *  mesh + skin (the worker copies — the field itself is untouched). */
  mesh(
    key: string,
    aprons: FieldAprons,
    table: MaterialTable,
    cellSize: number,
    sliceY?: number,
  ) {
    const density = aprons.density.buffer as ArrayBuffer;
    const materials = aprons.materials.buffer as ArrayBuffer;
    return this.send(
      {
        kind: "mesh",
        jobId: ++this.jobId,
        key,
        density,
        materials,
        table,
        cellSize,
        ...(sliceY === undefined ? {} : { sliceY }),
      },
      [density, materials],
    );
  }

  /** Ghost-evaluate a stamp on the worker's scratch store. Density snapshot
   *  buffers are TRANSFERRED (pass copies if the caller still needs them);
   *  materials are structured-cloned. */
  stampPreview(
    req: Omit<
      Extract<FieldWorkerRequest, { kind: "stamp-preview" }>,
      "kind" | "jobId"
    >,
  ) {
    return this.send(
      { kind: "stamp-preview", jobId: ++this.jobId, ...req },
      req.chunks.map((c) => c.density),
    );
  }

  /** Cast the VOID of an all-chunk snapshot: the worker inverts each chunk's
   *  density and meshes the result, so the buckets that come back are a solid
   *  cast of the air. Density buffers are TRANSFERRED (pass copies — the
   *  stampPreview contract); no materials and no table cross the wire (the
   *  cast is shape only). */
  voidCast(chunks: { key: string; density: ArrayBuffer }[], cellSize: number) {
    return this.send(
      { kind: "void-cast", jobId: ++this.jobId, chunks, cellSize },
      chunks.map((c) => c.density),
    );
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending)
      p.reject(new Error("field worker disposed"));
    this.pending.clear();
  }
}
