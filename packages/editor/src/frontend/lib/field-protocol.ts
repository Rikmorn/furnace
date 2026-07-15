// Field remesh worker protocol. Unlike the generation worker, this worker
// runs ENGINE code (@furnace/core/field) — it does not load the project's
// /engine.js bundle and has no extension surface. The handler is a PURE factory
// over an injected `post` so the protocol is unit-testable without a real
// Worker (bun test spawns none): the worker entry wires post = self.postMessage;
// tests wire a collector.
import { BUILTIN_TABLE, meshChunkField } from "@furnace/core/field";

export type FieldWorkerRequest = {
  kind: "mesh";
  jobId: number;
  key: string;
  /** 20³ Int8 density apron, transferred. */
  density: ArrayBuffer;
  /** 20³ Uint8 material apron (global class ids), transferred. */
  materials: ArrayBuffer;
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
      // MIGRATION (until Task 9/10): the F2a host renders only bucket 0 (the
      // class-0 organic surface); BUILTIN_TABLE stands in for the project's
      // material table until Task 9 threads it over the wire. This is a hard
      // dependency, not a soft default — meshChunkField → classOf THROWS on any
      // non-rock class (surfacing here as a mesh-error), so the field must stay
      // rock-only until the real table arrives. Full per-class bucket transfer
      // lands with the Task-9 v2 protocol. A uniform chunk has no buckets, so
      // post empty (fresh, transferable) buffers.
      const result = meshChunkField(
        {
          density: new Int8Array(msg.density),
          materials: new Uint8Array(msg.materials),
        },
        BUILTIN_TABLE,
        msg.cellSize,
      );
      const m = result.buckets[0]?.mesh;
      const positions = (m ? m.positions : new Float32Array(0))
        .buffer as ArrayBuffer;
      const normals = (m ? m.normals : new Float32Array(0))
        .buffer as ArrayBuffer;
      const uvs = (m ? m.uvs : new Float32Array(0)).buffer as ArrayBuffer;
      const indices = (m ? m.indices : new Uint32Array(0))
        .buffer as ArrayBuffer;
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
