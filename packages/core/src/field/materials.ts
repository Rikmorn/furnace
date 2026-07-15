// packages/core/src/field/materials.ts — the material channel behind an
// accessor wall (the encoding is the swappable part; substrate-storage lesson).
import { CHUNK_DIM, CHUNK_SAMPLES, chunkKey, voxelChunk } from "./chunks.ts";
import type {
  ChunkKey,
  ChunkMaterials,
  FieldStore,
  MaterialClass,
  MaterialTable,
} from "./types.ts";
import { MAT_ROCK } from "./types.ts";

const MAX_PALETTE = 32; // far above the ≤8-class F2 reality; setup-loud beyond

const localIndex = (x: number, y: number, z: number): number => {
  const lx = x - voxelChunk(x) * CHUNK_DIM;
  const ly = y - voxelChunk(y) * CHUNK_DIM;
  const lz = z - voxelChunk(z) * CHUNK_DIM;
  return lx + CHUNK_DIM * (ly + CHUNK_DIM * lz);
};

const bitsFor = (paletteLen: number): number =>
  Math.max(1, Math.ceil(Math.log2(paletteLen)));

const packedLength = (bits: number): number =>
  Math.ceil((CHUNK_SAMPLES * bits) / 8);

const readPacked = (packed: Uint8Array, bits: number, i: number): number => {
  let v = 0;
  const base = i * bits;
  for (let b = 0; b < bits; b++) {
    const bit = base + b;
    v |= (((packed[bit >> 3] as number) >> (bit & 7)) & 1) << b;
  }
  return v;
};

const writePacked = (
  packed: Uint8Array,
  bits: number,
  i: number,
  v: number,
): void => {
  const base = i * bits;
  for (let b = 0; b < bits; b++) {
    const bit = base + b;
    const byte = bit >> 3;
    const mask = 1 << (bit & 7);
    if ((v >> b) & 1) packed[byte] = (packed[byte] as number) | mask;
    else packed[byte] = (packed[byte] as number) & ~mask;
  }
};

/** Material class id at sample (x,y,z); untracked chunks/cells read MAT_ROCK. */
export function getMaterial(
  store: FieldStore,
  x: number,
  y: number,
  z: number,
): number {
  const m = store.materials.get(
    chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z)),
  );
  if (m === undefined) return MAT_ROCK;
  if (m.kind === "uniform") return m.classId;
  return m.palette[readPacked(m.packed, m.bits, localIndex(x, y, z))] as number;
}

/** Writes the material class at sample (x,y,z), upgrading uniform→indexed on
 *  divergence and growing/repacking the palette when a new class arrives.
 *  Returns the chunk's key (the dirty unit). */
export function setMaterial(
  store: FieldStore,
  x: number,
  y: number,
  z: number,
  classId: number,
): ChunkKey {
  const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
  const existing = store.materials.get(key) ?? {
    kind: "uniform" as const,
    classId: MAT_ROCK,
  };
  if (existing.kind === "uniform") {
    if (existing.classId === classId) return key;
    const palette = Uint8Array.from([existing.classId, classId]);
    const bits = 1;
    const packed = new Uint8Array(packedLength(bits));
    const indexed: ChunkMaterials = { kind: "indexed", palette, bits, packed };
    writePacked(packed, bits, localIndex(x, y, z), 1);
    store.materials.set(key, indexed);
    return key;
  }
  let pi = existing.palette.indexOf(classId);
  let m = existing;
  if (pi < 0) {
    if (existing.palette.length >= MAX_PALETTE)
      throw new Error(
        `field materials: chunk palette exceeds ${MAX_PALETTE} classes`,
      );
    const palette = Uint8Array.from([...existing.palette, classId]);
    const bits = bitsFor(palette.length);
    if (bits !== existing.bits) {
      const packed = new Uint8Array(packedLength(bits));
      for (let i = 0; i < CHUNK_SAMPLES; i++)
        writePacked(
          packed,
          bits,
          i,
          readPacked(existing.packed, existing.bits, i),
        );
      m = { kind: "indexed", palette, bits, packed };
    } else {
      m = {
        kind: "indexed",
        palette,
        bits: existing.bits,
        packed: existing.packed,
      };
    }
    pi = palette.length - 1;
    store.materials.set(key, m);
  }
  writePacked(m.packed, m.bits, localIndex(x, y, z), pi);
  return key;
}

/** Deep copy of a chunk's material storage, for undo snapshots. */
export function cloneChunkMaterials(m: ChunkMaterials): ChunkMaterials {
  return m.kind === "uniform"
    ? { kind: "uniform", classId: m.classId }
    : {
        kind: "indexed",
        palette: Uint8Array.from(m.palette),
        bits: m.bits,
        packed: Uint8Array.from(m.packed),
      };
}

/** The engine's catalog-less fallback material table: rock only. */
export const BUILTIN_TABLE: MaterialTable = {
  classes: [
    {
      id: MAT_ROCK,
      name: "rock",
      kind: "organic",
      color: [0.62, 0.6, 0.58, 1],
    },
  ],
};

/**
 * Setup-loud validation of a material table: ids must be contiguous from 0 and
 * class 0 must be organic (rock).
 *
 * @throws {@link Error} if the table is empty, an id is non-contiguous, or
 *   class 0 is not organic.
 */
export function validateMaterialTable(table: MaterialTable): void {
  if (table.classes.length === 0) throw new Error("material table: empty");
  table.classes.forEach((c, i) => {
    if (c.id !== i)
      throw new Error(
        `material table: class ${i} has id ${c.id} (ids must be contiguous from 0)`,
      );
  });
  const first = table.classes[0] as MaterialClass;
  if (first.kind !== "organic")
    throw new Error("material table: class 0 must be organic (rock)");
}

/**
 * Looks up a material class by id.
 *
 * @throws {@link Error} if the id is not present in the table (setup-loud).
 */
export function classOf(table: MaterialTable, id: number): MaterialClass {
  const c = table.classes[id];
  if (c === undefined)
    throw new Error(`material table: unknown class id ${id}`);
  return c;
}
