// Field remesh worker protocol. Unlike the generation worker, this worker
// runs ENGINE code (@furnace/core/field) — it does not load the project's
// /engine.js bundle and has no extension surface. The handler is a PURE factory
// over an injected `post` so the protocol is unit-testable without a real
// Worker (bun test spawns none): the worker entry wires post = self.postMessage;
// tests wire a collector.

import type { KitInstance, MaterialTable } from "@furnace/core/field";
import { meshChunkField, skinChunkKit } from "@furnace/core/field";

export type FieldWorkerRequest = {
  kind: "mesh";
  jobId: number;
  key: string;
  /** 20³ Int8 density apron, transferred. */
  density: ArrayBuffer;
  /** 20³ Uint8 material apron (global class ids), transferred. */
  materials: ArrayBuffer;
  /** Resolved material table (structured-cloned — tiny, ≤8 classes). Drives the
   *  mesher's per-class bucket split and the skinner's kit dispatch. */
  table: MaterialTable;
  cellSize: number;
};

/** One per-class mesh bucket over the wire: the {@link MeshBucket}'s ChunkMesh
 *  TypedArrays flattened to their backing ArrayBuffers (each transferred). */
export type WireBucket = {
  classId: number;
  backing: boolean;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  uvs: ArrayBuffer;
  indices: ArrayBuffer;
};

export type FieldWorkerResponse =
  | {
      kind: "meshed";
      jobId: number;
      key: string;
      buckets: WireBucket[];
      kit: KitInstance[];
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
      const aprons = {
        density: new Int8Array(msg.density),
        materials: new Uint8Array(msg.materials),
      };
      const meshes = meshChunkField(aprons, msg.table, msg.cellSize);
      const kit = skinChunkKit(aprons, msg.table, msg.cellSize, msg.key);
      // compactBucket returns fresh Float32Array.from / new Uint32Array per
      // bucket, so each `.buffer` is a standalone backing buffer — safe to
      // transfer (nothing else references it).
      const buckets: WireBucket[] = meshes.buckets.map((b) => ({
        classId: b.classId,
        backing: b.backing,
        positions: b.mesh.positions.buffer as ArrayBuffer,
        normals: b.mesh.normals.buffer as ArrayBuffer,
        uvs: b.mesh.uvs.buffer as ArrayBuffer,
        indices: b.mesh.indices.buffer as ArrayBuffer,
      }));
      const transfer = buckets.flatMap((b) => [
        b.positions,
        b.normals,
        b.uvs,
        b.indices,
      ]);
      post(
        { kind: "meshed", jobId: msg.jobId, key: msg.key, buckets, kit },
        transfer,
      );
    } catch (err) {
      // A malformed apron (mesher/skinner length guard) or an unknown class
      // (classOf throw) surfaces here as a typed, jobId-carrying error.
      const message = err instanceof Error ? err.message : String(err);
      post({ kind: "mesh-error", jobId: msg.jobId, key: msg.key, message }, []);
    }
  };
}
