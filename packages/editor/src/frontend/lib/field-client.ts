import type { FieldAprons, MaterialTable } from "@furnace/core/field";
import type {
  FieldWorkerRequest,
  FieldWorkerResponse,
} from "./field-protocol.ts";

type WorkerLike = {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

/** The worker's success responses — what a pending job may resolve with. */
type FieldWorkerSuccess = Extract<
  FieldWorkerResponse,
  { kind: "meshed" | "stamp-previewed" }
>;

const defaultSpawn = (): WorkerLike =>
  new Worker("/field-worker.js", { type: "module" }) as unknown as WorkerLike;

/** One persistent field worker; stale results dropped by jobId; callers
 *  own dirty-set coalescing (this client is a plain request pipe — it does NOT
 *  cancel superseded jobs; the FieldHost avoids redundant sends). */
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
    const jobId = ++this.jobId;
    const density = aprons.density.buffer as ArrayBuffer;
    const materials = aprons.materials.buffer as ArrayBuffer;
    const req: FieldWorkerRequest = {
      kind: "mesh",
      jobId,
      key,
      density,
      materials,
      table,
      cellSize,
      ...(sliceY === undefined ? {} : { sliceY }),
    };
    return new Promise<Extract<FieldWorkerResponse, { kind: "meshed" }>>(
      (resolve, reject) => {
        this.pending.set(jobId, {
          resolve: (r) => {
            // Runtime narrowing, never a cast: the worker answers a mesh job
            // with `meshed`; anything else is a protocol bug surfaced loud.
            if (r.kind === "meshed") resolve(r);
            else
              reject(new Error(`field worker: expected meshed, got ${r.kind}`));
          },
          reject,
        });
        this.ensure().postMessage(req, [density, materials]);
      },
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
  ): Promise<Extract<FieldWorkerResponse, { kind: "stamp-previewed" }>> {
    const jobId = ++this.jobId;
    const full: FieldWorkerRequest = { kind: "stamp-preview", jobId, ...req };
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, {
        resolve: (r) => {
          // Runtime narrowing, never a cast (the mesh() twin).
          if (r.kind === "stamp-previewed") resolve(r);
          else
            reject(
              new Error(
                `field worker: expected stamp-previewed, got ${r.kind}`,
              ),
            );
        },
        reject,
      });
      this.ensure().postMessage(
        full,
        req.chunks.map((c) => c.density),
      );
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending)
      p.reject(new Error("field worker disposed"));
    this.pending.clear();
  }
}
