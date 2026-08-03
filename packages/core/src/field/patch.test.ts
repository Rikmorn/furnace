import { describe, expect, test } from "bun:test";
import type {
  BrushOp,
  ChunkKey,
  ChunkMaterials,
  EntityOp,
  FieldStore,
  MaterialTable,
  PatchChunk,
  PatchOp,
} from "@furnace/core/field";
import {
  applyPatchOp,
  assertPatchValid,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  createFieldStore,
  createOpLog,
  fieldOpChunks,
  getDensity,
  getMaterial,
  logApply,
  logApplyPatch,
  MAT_ROCK,
  redo,
  SOLID,
  undo,
} from "@furnace/core/field";
import {
  type StoreSnapshot,
  snapshotAll,
} from "../../tests/_helpers/field-store.ts";
// PATCH_MASK_BYTES is deliberately NOT on the public index (the spliceOps
// precedent — in-core producer surface), so it comes from the source module.
import { PATCH_MASK_BYTES } from "./ops.ts";

const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
    { id: 3, name: "moss", kind: "organic", color: [0.3, 0.5, 0.3, 1] },
  ],
};
const DIRT = 1;
const MASONRY = 2;
const MOSS = 3;

/** Mask bit index of a chunk-local sample — the PatchChunk layout. */
const bitOf = (lx: number, ly: number, lz: number): number =>
  lx + CHUNK_DIM * (ly + CHUNK_DIM * lz);

const maskOf = (...bits: number[]): Uint8Array => {
  const m = new Uint8Array(PATCH_MASK_BYTES);
  for (const b of bits) m[b >> 3] = (m[b >> 3] as number) | (1 << (b & 7));
  return m;
};

const patch = (chunks: PatchChunk[]): PatchOp => ({
  id: 0,
  kind: "patch",
  chunks,
});

/** A minimal VALID slice (one density cell), with any field overridden — so a
 *  rejection case shows only the field under test. */
const slice = (over: Partial<PatchChunk> = {}): PatchChunk => ({
  key: "0,0,0",
  densityMask: maskOf(bitOf(0, 0, 0)),
  density: Int8Array.from([1]),
  materialMask: null,
  materials: null,
  ...over,
});

/** A density-only slice: `bits` ascending, one value per bit. */
const densitySlice = (
  key: ChunkKey,
  bits: number[],
  values: number[],
): PatchChunk =>
  slice({ key, densityMask: maskOf(...bits), density: Int8Array.from(values) });

const digSphere = (
  center: [number, number, number],
  radius: number,
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "dig",
  shape: { kind: "sphere", center, radius },
});

const expectStoreEquals = (s: FieldStore, snap: StoreSnapshot): void => {
  expect([...s.chunks.keys()].sort()).toEqual([...snap.chunks.keys()].sort());
  for (const [k, v] of snap.chunks) expect(s.chunks.get(k)).toEqual(v);
  expect([...s.materials.keys()].sort()).toEqual(
    [...snap.materials.keys()].sort(),
  );
  for (const [k, v] of snap.materials) expect(s.materials.get(k)).toEqual(v);
};

describe("field patch op", () => {
  test("writes exactly its masked cells and round-trips undo", () => {
    const store = createFieldStore();
    const log = createOpLog();
    const mask = new Uint8Array(PATCH_MASK_BYTES);
    mask[0] = 0b0000_0011; // local cells (0,0,0) and (1,0,0) of chunk 0,0,0
    const op = patch([
      slice({ densityMask: mask, density: Int8Array.from([50, -50]) }),
    ]);
    const before = getDensity(store, 2, 0, 0); // an unmasked neighbour cell
    const dirty = logApplyPatch(store, log, op, TABLE);
    expect([...dirty]).toEqual(["0,0,0"]);
    expect(getDensity(store, 0, 0, 0)).toBe(50);
    expect(getDensity(store, 1, 0, 0)).toBe(-50);
    expect(getDensity(store, 2, 0, 0)).toBe(before); // untouched — the mask contract
    expect(log.ops).toHaveLength(1);
    expect((log.ops[0] as PatchOp).id).toBe(1); // stamped from log.nextId
    undo(store, log);
    expect(store.chunks.has("0,0,0")).toBe(false); // chunk was unallocated before
    redo(store, log, TABLE);
    expect(getDensity(store, 0, 0, 0)).toBe(50);
    expect(getDensity(store, 1, 0, 0)).toBe(-50);
    expect(log.ops).toHaveLength(1);
  });

  test("touches no cell outside its mask, over an already-carved chunk", () => {
    const store = createFieldStore();
    const log = createOpLog();
    logApply(store, log, digSphere([1, 1, 1], 0.8), TABLE);
    const key = "0,0,0";
    const before = Int8Array.from(store.chunks.get(key) as Int8Array);
    const bits = [bitOf(0, 0, 0), bitOf(5, 6, 7), bitOf(15, 15, 15)];
    logApplyPatch(
      store,
      log,
      patch([densitySlice(key, bits, [1, 2, 3])]),
      TABLE,
    );
    const after = store.chunks.get(key) as Int8Array;
    const changed: number[] = [];
    for (let i = 0; i < CHUNK_SAMPLES; i++)
      if (after[i] !== before[i]) changed.push(i);
    expect(changed).toEqual(bits);
    expect(bits.map((b) => after[b])).toEqual([1, 2, 3]);
  });

  test("spans multiple chunks in one op", () => {
    const store = createFieldStore();
    const log = createOpLog();
    const dirty = logApplyPatch(
      store,
      log,
      patch([
        densitySlice("0,0,0", [bitOf(15, 0, 0)], [7]),
        densitySlice("1,0,0", [bitOf(0, 0, 0)], [-7]),
      ]),
      TABLE,
    );
    expect([...dirty].sort()).toEqual(["0,0,0", "1,0,0"]);
    expect(getDensity(store, 15, 0, 0)).toBe(7);
    expect(getDensity(store, 16, 0, 0)).toBe(-7);
    undo(store, log);
    expect(store.chunks.size).toBe(0);
  });

  test("writes the density channel only when materialMask is null", () => {
    const store = createFieldStore();
    const log = createOpLog();
    logApplyPatch(
      store,
      log,
      patch([densitySlice("0,0,0", [bitOf(3, 3, 3)], [12])]),
      TABLE,
    );
    expect(getDensity(store, 3, 3, 3)).toBe(12);
    expect(store.materials.size).toBe(0);
    expect(getMaterial(store, 3, 3, 3)).toBe(MAT_ROCK);
  });

  test("writes the material channel only, with an all-zero densityMask", () => {
    const store = createFieldStore();
    const log = createOpLog();
    logApplyPatch(
      store,
      log,
      patch([
        slice({
          densityMask: new Uint8Array(PATCH_MASK_BYTES),
          density: new Int8Array(0),
          materialMask: maskOf(bitOf(2, 0, 0), bitOf(4, 0, 0)),
          materials: Uint8Array.from([DIRT, MASONRY]),
        }),
      ]),
      TABLE,
    );
    expect(store.chunks.size).toBe(0); // density channel untouched
    expect(getDensity(store, 2, 0, 0)).toBe(SOLID);
    expect(getMaterial(store, 2, 0, 0)).toBe(DIRT);
    expect(getMaterial(store, 4, 0, 0)).toBe(MASONRY);
    expect(getMaterial(store, 3, 0, 0)).toBe(MAT_ROCK); // between the two — untouched
    undo(store, log);
    expect(store.materials.size).toBe(0);
  });

  test("writes both channels, each value array tracking its OWN mask", () => {
    const store = createFieldStore();
    const log = createOpLog();
    logApplyPatch(
      store,
      log,
      patch([
        slice({
          densityMask: maskOf(bitOf(0, 0, 0), bitOf(1, 0, 0), bitOf(2, 0, 0)),
          density: Int8Array.from([10, 20, 30]),
          materialMask: maskOf(bitOf(1, 0, 0), bitOf(9, 0, 0)),
          materials: Uint8Array.from([MOSS, DIRT]),
        }),
      ]),
      TABLE,
    );
    expect([0, 1, 2].map((x) => getDensity(store, x, 0, 0))).toEqual([
      10, 20, 30,
    ]);
    expect(getDensity(store, 9, 0, 0)).toBe(SOLID); // material-only cell
    expect(getMaterial(store, 1, 0, 0)).toBe(MOSS);
    expect(getMaterial(store, 9, 0, 0)).toBe(DIRT);
    expect(getMaterial(store, 0, 0, 0)).toBe(MAT_ROCK);
    expect(getMaterial(store, 2, 0, 0)).toBe(MAT_ROCK);
  });

  test("is byte-exact on re-application and across stores (replay)", () => {
    // The material-only bit sits BETWEEN the two density bits, so the two value
    // cursors must advance independently: a shared cursor burns a density value
    // on it and then reads both arrays off their ends. Self-comparison alone
    // cannot see that (the same wrong bytes are produced every time), so the
    // expected VALUES are asserted too — that is what makes the dual-cursor
    // property load-bearing here, where the format defines it.
    const build = (): PatchOp =>
      patch([
        slice({
          densityMask: maskOf(bitOf(0, 0, 0), bitOf(8, 8, 8)),
          density: Int8Array.from([-3, 99]),
          materialMask: maskOf(bitOf(4, 0, 0), bitOf(8, 8, 8)),
          materials: Uint8Array.from([DIRT, MOSS]),
        }),
        densitySlice("0,1,0", [bitOf(0, 0, 0)], [4]),
      ]);
    const expectPatched = (s: FieldStore): void => {
      expect(getDensity(s, 0, 0, 0)).toBe(-3);
      expect(getDensity(s, 8, 8, 8)).toBe(99);
      expect(getDensity(s, 0, CHUNK_DIM, 0)).toBe(4);
      expect(getDensity(s, 4, 0, 0)).toBe(SOLID); // material-only cell
      expect(getMaterial(s, 4, 0, 0)).toBe(DIRT);
      expect(getMaterial(s, 8, 8, 8)).toBe(MOSS);
    };
    const a = createFieldStore();
    applyPatchOp(a, build());
    expectPatched(a);
    const once = snapshotAll(a);
    applyPatchOp(a, build()); // absolute writes — idempotent
    expectStoreEquals(a, once);
    expectPatched(a);
    const b = createFieldStore();
    applyPatchOp(b, build());
    expectStoreEquals(b, once);
    expectPatched(b);
  });

  test("interleaves with brush ops under LIFO undo/redo", () => {
    const store = createFieldStore();
    const log = createOpLog();
    logApply(store, log, digSphere([1, 1, 1], 0.8), TABLE);
    logApplyPatch(
      store,
      log,
      patch([
        densitySlice("0,0,0", [bitOf(0, 0, 0), bitOf(1, 1, 1)], [60, 61]),
      ]),
      TABLE,
    );
    const both = snapshotAll(store);
    undo(store, log);
    expect(getDensity(store, 0, 0, 0)).not.toBe(60);
    undo(store, log);
    expect(store.chunks.size).toBe(0);
    expect(log.ops).toHaveLength(0);
    redo(store, log, TABLE);
    redo(store, log, TABLE);
    expectStoreEquals(store, both);
    expect(log.ops.map((o) => o.kind)).toEqual(["brush", "patch"]);
  });

  test("the log owns its own copy of the patch buffers", () => {
    const store = createFieldStore();
    const log = createOpLog();
    const densityMask = maskOf(bitOf(0, 0, 0));
    const density = Int8Array.from([50]);
    const materialMask = maskOf(bitOf(0, 0, 0));
    const materials = Uint8Array.from([DIRT]);
    const op = patch([
      slice({ densityMask, density, materialMask, materials }),
    ]);
    logApplyPatch(store, log, op, TABLE);
    // the caller reuses its scratch buffers for the next patch
    densityMask[0] = 0xff;
    density[0] = -1;
    materialMask[0] = 0xff;
    materials[0] = MOSS;
    op.chunks.push(densitySlice("9,9,9", [bitOf(0, 0, 0)], [1]));
    const logged = log.ops[0] as PatchOp;
    const kept = logged.chunks[0] as PatchChunk;
    expect(logged.chunks).toHaveLength(1);
    expect(kept.densityMask[0]).toBe(1);
    expect(kept.density[0]).toBe(50);
    expect((kept.materialMask as Uint8Array)[0]).toBe(1);
    expect((kept.materials as Uint8Array)[0]).toBe(DIRT);
    // and the logged record still replays to the live store's bytes
    const replay = createFieldStore();
    applyPatchOp(replay, logged);
    expectStoreEquals(replay, snapshotAll(store));
  });

  test("application stays total: a materialMask with null materials writes none", () => {
    // Validation rejects this slice; the bare applier must not throw mid-write.
    const store = createFieldStore();
    applyPatchOp(
      store,
      patch([
        slice({
          density: Int8Array.from([5]),
          materialMask: maskOf(bitOf(0, 0, 0)),
          materials: null,
        }),
      ]),
    );
    expect(getDensity(store, 0, 0, 0)).toBe(5);
    expect(store.materials.size).toBe(0);
  });

  test("writes into a NEGATIVE-coordinate chunk at the right samples", () => {
    // cx·CHUNK_DIM + lx must land in [−16,−1] for chunk −1 — the floor-division
    // trap voxelChunk exists for, on the decode side.
    const store = createFieldStore();
    const log = createOpLog();
    logApplyPatch(
      store,
      log,
      patch([
        densitySlice(
          "-1,-1,-1",
          [bitOf(0, 0, 0), bitOf(3, 5, 7), bitOf(15, 15, 15)], // ascending
          [11, 22, 33],
        ),
      ]),
      TABLE,
    );
    expect([...store.chunks.keys()]).toEqual(["-1,-1,-1"]);
    expect(getDensity(store, -16, -16, -16)).toBe(11);
    expect(getDensity(store, -13, -11, -9)).toBe(22);
    expect(getDensity(store, -1, -1, -1)).toBe(33);
    expect(getDensity(store, -15, -16, -16)).toBe(SOLID); // neighbour untouched
    expect(getDensity(store, 0, 0, 0)).toBe(SOLID); // the +1 chunk untouched
    undo(store, log);
    expect(store.chunks.size).toBe(0);
  });

  test("undo restores an INDEXED material chunk exactly (palette + packing)", () => {
    const store = createFieldStore();
    const log = createOpLog();
    // masonry fill then a dig: the chunk ends up allocated, with a real
    // multi-entry palette rather than the uniform-rock default.
    logApply(
      store,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: MASONRY,
        shape: { kind: "box", center: [1, 1, 1], halfExtents: [1, 1, 1] },
      },
      TABLE,
    );
    logApply(store, log, digSphere([1, 1, 1], 0.5), TABLE);
    const key = "0,0,0";
    const priorMaterials = store.materials.get(key) as ChunkMaterials;
    expect(priorMaterials.kind).toBe("indexed");
    const before = snapshotAll(store);
    // Two writes with different storage consequences, both outside the filled
    // box (so both cells are rock today): MASONRY is ALREADY in the palette, so
    // setMaterial writes packed bits IN PLACE — the case that catches a
    // pre-image sharing the live buffer instead of cloning it. MOSS is new, so
    // the palette grows and repacks — the case that catches a lost palette.
    logApplyPatch(
      store,
      log,
      patch([
        slice({
          densityMask: maskOf(bitOf(12, 12, 12), bitOf(13, 13, 13)),
          density: Int8Array.from([-9, 9]),
          materialMask: maskOf(bitOf(12, 12, 12), bitOf(13, 13, 13)),
          materials: Uint8Array.from([MASONRY, MOSS]),
        }),
      ]),
      TABLE,
    );
    expect(getMaterial(store, 12, 12, 12)).toBe(MASONRY);
    expect(getMaterial(store, 13, 13, 13)).toBe(MOSS);
    const after = snapshotAll(store);
    undo(store, log);
    expectStoreEquals(store, before); // palette, bits and packed bytes all back
    redo(store, log, TABLE);
    expectStoreEquals(store, after);
  });

  test("rejects an invalid patch before touching the store or the log", () => {
    const store = createFieldStore();
    const log = createOpLog();
    logApply(store, log, digSphere([1, 1, 1], 0.8), TABLE);
    undo(store, log); // parks an entry on the redo stack
    const snap = snapshotAll(store);
    const nextId = log.nextId;
    expect(() =>
      logApplyPatch(
        store,
        log,
        patch([densitySlice("0,0,0", [bitOf(0, 0, 0)], [1, 2])]),
        TABLE,
      ),
    ).toThrow(/density length/);
    expectStoreEquals(store, snap);
    expect(log.ops).toHaveLength(0);
    expect(log.undoStack).toHaveLength(0);
    expect(log.redoStack).toHaveLength(1); // NOT cleared by a rejected mutation
    expect(log.nextId).toBe(nextId);
  });
});

describe("assertPatchValid", () => {
  const SHORT_MASK = new Uint8Array(PATCH_MASK_BYTES - 1);
  const EMPTY_MASK = new Uint8Array(PATCH_MASK_BYTES);
  const ONE_BIT = maskOf(bitOf(0, 0, 0));

  /** [what is wrong with the single slice, the message that must say so]. */
  const REJECTED: [Partial<PatchChunk>, RegExp][] = [
    [{ density: Int8Array.from([1, 2]) }, /density length/],
    [
      { densityMask: SHORT_MASK, density: new Int8Array(0) },
      /densityMask must be 512 bytes/,
    ],
    [
      { materialMask: SHORT_MASK, materials: new Uint8Array(0) },
      /materialMask must be 512 bytes/,
    ],
    [
      { materials: Uint8Array.from([DIRT]) },
      /materials present without materialMask/,
    ],
    [{ materialMask: ONE_BIT, materials: null }, /materials is null/],
    [
      { materialMask: ONE_BIT, materials: Uint8Array.from([DIRT, MOSS]) },
      /materials length/,
    ],
    [
      { materialMask: ONE_BIT, materials: Uint8Array.from([250]) },
      /unknown class id/,
    ],
    [{ densityMask: EMPTY_MASK, density: new Int8Array(0) }, /masks no cells/],
  ];

  test("rejects malformed slices, one message per malformation", () => {
    for (const [over, message] of REJECTED)
      expect(() => assertPatchValid(patch([slice(over)]), TABLE)).toThrow(
        message,
      );
  });

  test("rejects an op with no slices at all", () => {
    expect(() => assertPatchValid(patch([]), TABLE)).toThrow(
      /writes no chunks/,
    );
  });

  test("rejects malformed and duplicate chunk keys", () => {
    for (const key of ["", "0,0", "0,0,0,0", "a,0,0", "0, 0,0", "0.5,0,0"])
      expect(() => assertPatchValid(patch([slice({ key })]), TABLE)).toThrow(
        /malformed chunk key/,
      );
    expect(() => assertPatchValid(patch([slice(), slice()]), TABLE)).toThrow(
      /duplicate chunk key/,
    );
    expect(() =>
      assertPatchValid(patch([slice(), slice({ key: "-1,2,-3" })]), TABLE),
    ).not.toThrow();
  });

  test("accepts kit-class ids (a patch has no shape to lattice-check)", () => {
    expect(() =>
      assertPatchValid(
        patch([
          slice({
            densityMask: EMPTY_MASK,
            density: new Int8Array(0),
            materialMask: maskOf(bitOf(1, 2, 3)),
            materials: Uint8Array.from([MASONRY]),
          }),
        ]),
        TABLE,
      ),
    ).not.toThrow();
  });
});

describe("fieldOpChunks", () => {
  test("declares a patch's own keys, a brush's sample-bounds chunks, nothing for an entity", () => {
    expect(
      [
        ...fieldOpChunks(patch([slice(), slice({ key: "-2,3,4" })]), 0.25),
      ].sort(),
    ).toEqual(["-2,3,4", "0,0,0"]);

    // sphere at 1m r=0.8 with 0.25 m cells spans samples −1..8 per axis, so the
    // +1-margin bounds straddle the chunk 0 / chunk −1 boundary on all three.
    const brushKeys = fieldOpChunks(digSphere([1, 1, 1], 0.8), 0.25);
    expect(brushKeys.size).toBe(8);
    expect(brushKeys.has("0,0,0")).toBe(true);
    expect(brushKeys.has("-1,-1,-1")).toBe(true);

    const entity: EntityOp = {
      id: 1,
      kind: "entity",
      action: "place",
      entity: {
        entityId: 1,
        type: "generator",
        generator: "hall",
        params: {},
        seed: 1,
        region: { min: [0, 0, 0], max: [1, 1, 1] },
        opSpan: [1, 1],
      },
    };
    expect(fieldOpChunks(entity, 0.25).size).toBe(0);
  });
});
