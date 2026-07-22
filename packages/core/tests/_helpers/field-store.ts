// packages/core/tests/_helpers/field-store.ts — generic FieldStore deep-copy
// for tests. Deliberately NOT a domain fixture: the "each test file owns its own
// TABLE" convention covers material catalogs and op shapes, which encode what a
// test is about. A store deep-copy encodes nothing, and three byte-identical
// copies of it (field-ops, field-patch, field-reconfigure) is the third
// occurrence the clean-code rule says to extract.
import type { ChunkKey, ChunkMaterials, FieldStore } from "@furnace/core/field";
import { cloneChunkMaterials } from "@furnace/core/field";

/** A deep copy of the WHOLE store — both channels, every chunk. */
export type StoreSnapshot = {
  chunks: Map<ChunkKey, Int8Array>;
  materials: Map<ChunkKey, ChunkMaterials>;
};

/** Deep-copies both channels of every chunk. The reference for "undo left
 *  nothing behind": a leaked chunk or material entry fails the comparison,
 *  because the copy carries the map KEYS as well as the bytes. */
export const snapshotAll = (s: FieldStore): StoreSnapshot => ({
  chunks: new Map([...s.chunks].map(([k, v]) => [k, Int8Array.from(v)])),
  materials: new Map(
    [...s.materials].map(([k, v]) => [k, cloneChunkMaterials(v)]),
  ),
});
