// Field remesh worker protocol. Unlike the generation worker, this worker
// runs ENGINE code (@furnace/core/field) — it does not load the project's
// /engine.js bundle and has no extension surface. The handler is a PURE factory
// over an injected `post` so the protocol is unit-testable without a real
// Worker (bun test spawns none): the worker entry wires post = self.postMessage;
// tests wire a collector.
import { meshChunkApron } from "@furnace/core/field";

export type FieldWorkerRequest = {
  kind: "mesh";
  jobId: number;
  key: string;
  /** 18³ Int8 apron, transferred. */
  apron: ArrayBuffer;
  cellSize: number;
};

export type FieldWorkerResponse =
  | {
      kind: "meshed";
      jobId: number;
      key: string;
      positions: ArrayBuffer;
      normals: ArrayBuffer;
      uvs: ArrayBuffer;
      indices: ArrayBuffer;
    }
  | { kind: "mesh-error"; jobId: number; key: string; message: string };

/** Pure handler factory (worker entry wires post = self.postMessage). Never
 *  throws — every failure posts a typed mesh-error message (a worker-side
 *  throw would surface as a generic ErrorEvent with no jobId). */
export function createFieldWorkerHandler(
  post: (msg: FieldWorkerResponse, transfer: Transferable[]) => void,
) {
  return (msg: FieldWorkerRequest): void => {
    if (msg.kind !== "mesh") return;
    try {
      const m = meshChunkApron(new Int8Array(msg.apron), msg.cellSize);
      const positions = m.positions.buffer as ArrayBuffer;
      const normals = m.normals.buffer as ArrayBuffer;
      const uvs = m.uvs.buffer as ArrayBuffer;
      const indices = m.indices.buffer as ArrayBuffer;
      post(
        {
          kind: "meshed",
          jobId: msg.jobId,
          key: msg.key,
          positions,
          normals,
          uvs,
          indices,
        },
        [positions, normals, uvs, indices],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      post({ kind: "mesh-error", jobId: msg.jobId, key: msg.key, message }, []);
    }
  };
}
