// `occupiedTopY` — the fact D-F4.5-16's slice seed is derived from: the world-Y of the
// highest AUTHORED solid sample.
//
// NO GPU, and that is a property of the verb rather than a shortcut: it reads the field
// store and nothing else, and `loadWorld` populates the store before `init` has ever been
// called (the GPU host fixtures load first and init second for their own reasons — see
// field-host-selection-cells.gpu.test.ts). A test that needed a context here would be a
// sign the verb had picked up a dependency on the render side.
//
// At `tests/` root rather than `tests/viewport-host/` for the harness reason the pointer
// suite documents: `bun test` walks a directory's own files before its subdirectories, and
// `tests/chrome/` registers happy-dom, which replaces `globalThis.navigator`. Nothing here
// touches `navigator.gpu`, so the placement is precautionary rather than load-bearing —
// but the file imports `createFieldHost`, and every other file that does lives out here.
import { expect, test } from "bun:test";
import type { ChunkKey, FieldManifest } from "@furnace/core/field";
import {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  SOLID,
} from "@furnace/core/field";
import { createFieldHost } from "../src/viewport-host/field-host.ts";

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** One chunk of air with the listed LOCAL samples set to `density`. Local coordinates
 *  throughout: every case here is about WHERE in a chunk the rock is, so writing them in
 *  world samples would put the chunk-origin arithmetic in the fixture, which is the same
 *  arithmetic the verb under test performs. */
function chunkWith(
  cells: readonly (readonly [number, number, number])[],
  density = SOLID,
): Uint8Array {
  const samples = new Int8Array(CHUNK_SAMPLES).fill(AIR);
  for (const [lx, ly, lz] of cells)
    samples[lx + CHUNK_DIM * (ly + CHUNK_DIM * lz)] = density;
  return encodeChunkFile(samples);
}

/** A host with `chunks` loaded and no GPU. Not disposed: `dispose` tears down GPU
 *  resources that were never created, and nothing here starts a frame loop. */
function hostWith(chunks: { key: ChunkKey; bytes: Uint8Array }[]) {
  const host = createFieldHost();
  host.loadWorld({ manifest: MANIFEST, chunks, oplog: null });
  return host;
}

/** World-Y of local sample `ly` in chunk-Y `cy`, at the default lattice. The expression
 *  the verb computes, written once here so a case reads as a claim about a CELL rather
 *  than as a bare number nobody can check. */
const topOf = (cy: number, ly: number): number =>
  (cy * CHUNK_DIM + ly) * DEFAULT_CELL_SIZE;

test("an untouched world has no occupied top — the store has no allocated chunks", () => {
  // The case the whole verb rests on. An unallocated chunk reads as SOLID
  // (`getDensity`), so "the topmost solid sample" over the DOMAIN is unbounded; over
  // the ALLOCATED chunks it is the top of what somebody authored. A world nobody has
  // touched has authored nothing, and `null` is the only honest answer — the chrome's
  // fallback park exists for exactly this.
  expect(hostWith([]).occupiedTopY()).toBeNull();
});

test("allocated chunks holding no rock at all are still `null`", () => {
  // A world dug out and then filled back to air: chunks exist, none of them carries
  // rock. Distinct from the case above and it has to be, because it is the WORST case
  // for the scan — it reads every allocated sample before it can answer.
  const chunks = [
    { key: chunkKey(0, 0, 0), bytes: chunkWith([]) },
    { key: chunkKey(0, 1, 0), bytes: chunkWith([]) },
  ];
  expect(hostWith(chunks).occupiedTopY()).toBeNull();
});

test("the answer is the topmost solid SAMPLE, not the top of the chunk holding it", () => {
  // One chunk at cy = 1 whose only rock is at ly = 3. Answering with the chunk's top
  // (ly = 15) would be 3 m too high — which on a shallow world is exactly the failure
  // D-F4.5-16 exists to fix, arriving through a different door.
  const chunks = [{ key: chunkKey(0, 1, 0), bytes: chunkWith([[5, 3, 7]]) }];
  expect(hostWith(chunks).occupiedTopY()).toBe(topOf(1, 3));
  expect(topOf(1, 3)).toBe(4.75);
});

test("two chunks in the SAME layer answer with the higher sample, whichever iterates first", () => {
  // THE discriminating case. Both chunks are at cy = 0, so a scan that walked CHUNKS
  // and took the first one carrying any rock would answer with whichever the Map
  // happens to yield first — and `Map` preserves insertion order, so it would be
  // deterministic and wrong. Asserted BOTH insertion orders: a chunk-order scan can
  // only be right in one of them.
  const low = { key: chunkKey(0, 0, 0), bytes: chunkWith([[0, 2, 0]]) };
  const high = { key: chunkKey(1, 0, 0), bytes: chunkWith([[0, 11, 0]]) };
  expect(hostWith([low, high]).occupiedTopY()).toBe(topOf(0, 11));
  expect(hostWith([high, low]).occupiedTopY()).toBe(topOf(0, 11));
});

test("a HIGHER chunk layer wins over a lower one, and an empty layer between them is skipped", () => {
  // cy = 2 holds the answer, cy = 1 is allocated and entirely air, cy = 0 holds rock
  // higher WITHIN its chunk (ly = 15) than the winner does (ly = 0). So a scan that
  // compared local ly before chunk cy would answer with the floor.
  const chunks = [
    { key: chunkKey(0, 0, 0), bytes: chunkWith([[0, 15, 0]]) },
    { key: chunkKey(0, 1, 0), bytes: chunkWith([]) },
    { key: chunkKey(0, 2, 0), bytes: chunkWith([[0, 0, 0]]) },
  ];
  expect(hostWith(chunks).occupiedTopY()).toBe(topOf(2, 0));
  expect(topOf(2, 0)).toBe(8);
  // …and the loser is genuinely higher inside its own chunk, so the assertion above
  // is not satisfied by a scan that got lucky on ly.
  expect(topOf(0, 15)).toBeLessThan(topOf(2, 0));
});

test("solid means BELOW the isosurface, not exactly SOLID — a smoothed ceiling counts", () => {
  // The mesher's sign change is at 0, so any negative density is rock the user can see
  // and stand under. A smoothed or partly-dug ceiling is never exactly -127, and a test
  // for `=== SOLID` would report the ceiling of every smoothed room as absent.
  const chunks = [
    { key: chunkKey(0, 0, 0), bytes: chunkWith([[4, 9, 4]], -1) },
  ];
  expect(hostWith(chunks).occupiedTopY()).toBe(topOf(0, 9));
  // The premise, so the case cannot pass by the value happening to be SOLID.
  expect(-1).not.toBe(SOLID);
});

test("a NEGATIVE chunk layer is reachable — the scan is not floored at cy = 0", () => {
  // Digging below the origin is ordinary (the dungeon's own worlds do it), and a scan
  // that started its descent at 0 would answer `null` for a world that lives entirely
  // underground.
  const chunks = [{ key: chunkKey(0, -2, 0), bytes: chunkWith([[1, 6, 1]]) }];
  expect(hostWith(chunks).occupiedTopY()).toBe(topOf(-2, 6));
  expect(topOf(-2, 6)).toBeLessThan(0);
});
