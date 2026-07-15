import type {
  FieldWorkerRequest,
  FieldWorkerResponse,
} from "./field-protocol.ts";

type WorkerLike = {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

const defaultSpawn = (): WorkerLike =>
  new Worker("/field-worker.js", { type: "module" }) as unknown as WorkerLike;

/** One persistent remesh worker; stale results dropped by jobId; callers
 *  own dirty-set coalescing (this client is a plain request pipe — it does NOT
 *  cancel superseded jobs; the FieldHost avoids redundant sends). */
export class FieldWorkerClient {
  private worker: WorkerLike | null = null;
  private jobId = 0;
  private pending = new Map<
    number,
    {
      resolve: (r: Extract<FieldWorkerResponse, { kind: "meshed" }>) => void;
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
      if (msg.kind === "meshed") entry.resolve(msg);
      else entry.reject(new Error(msg.message));
    };
    this.worker = w;
    return w;
  }

  mesh(key: string, apron: Int8Array, cellSize: number) {
    const jobId = ++this.jobId;
    const buf = apron.buffer as ArrayBuffer;
    const req: FieldWorkerRequest = {
      kind: "mesh",
      jobId,
      key,
      apron: buf,
      cellSize,
    };
    return new Promise<Extract<FieldWorkerResponse, { kind: "meshed" }>>(
      (resolve, reject) => {
        this.pending.set(jobId, { resolve, reject });
        this.ensure().postMessage(req, [buf]);
      },
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
