import { describe, expect, test } from "bun:test";
import type {
  BrushOp,
  BrushShape,
  ChunkKey,
  ChunkMaterials,
  EntityOp,
  FieldManifest,
  FieldOp,
  FieldStore,
  MaterialTable,
  OpLog,
  PatchChunk,
  PatchOp,
  PlacementOp,
  PlacementRecord,
} from "@furnace/core/field";
import {
  BUILTIN_TABLE,
  bakeFieldWorld,
  CHUNK_DIM,
  createFieldStore,
  createOpLog,
  decodeChunkFile,
  decodeMaterialFile,
  encodeChunkFile,
  encodeMaterialFile,
  logApply,
  logApplyPatch,
  parseOps,
  parsePlacements,
  serializeOps,
  serializePlacements,
  setMaterial,
} from "@furnace/core/field";

// PATCH_MASK_BYTES is deliberately NOT on the public index (the spliceOps
// precedent — in-core producer surface), so it comes from the source module.
import { PATCH_MASK_BYTES } from "../src/field/ops.ts";

// Local 3-class table (each test file owns its copy — no shared fixture).
// Mirrors field-mesher.test.ts / field-skin-topology.test.ts.
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
  ],
};

/** Room + snapped masonry (kit, class 2) wall inside chunk (0,0,0). Copied from
 *  field-skin-topology.test.ts's wallFixture — each test file owns its copy. */
function wallFixture(): { s: FieldStore; log: OpLog } {
  const s = createFieldStore();
  const log = createOpLog();
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 1.5, 2] },
    },
    TABLE,
  );
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: { kind: "box", center: [2.25, 1.5, 2], halfExtents: [0.25, 1, 1] },
    },
    TABLE,
  );
  return { s, log };
}

describe("field artifact", () => {
  test("chunk file roundtrips byte-identically and rejects bad magic", () => {
    const chunk = new Int8Array(4096).map((_, i) => (i % 255) - 127);
    const bytes = encodeChunkFile(chunk);
    expect(decodeChunkFile(bytes)).toEqual(chunk);
    const corrupt = Uint8Array.from(bytes);
    corrupt[0] = 0;
    expect(() => decodeChunkFile(corrupt)).toThrow(/magic/);
  });

  test("oplog roundtrips", () => {
    const ops = [
      {
        id: 1,
        kind: "brush" as const,
        effect: "dig" as const,
        shape: {
          kind: "sphere" as const,
          center: [1, 2, 3] as [number, number, number],
          radius: 0.5,
        },
      },
    ];
    expect(parseOps(serializeOps(ops))).toEqual(ops);
  });

  test("material file roundtrip (uniform + indexed)", () => {
    const u: ChunkMaterials = { kind: "uniform", classId: 3 };
    expect(decodeMaterialFile(encodeMaterialFile(u))).toEqual(u);
    const s = createFieldStore();
    setMaterial(s, 0, 0, 0, 1);
    setMaterial(s, 1, 0, 0, 2);
    setMaterial(s, 2, 0, 0, 5);
    const m = s.materials.get("0,0,0") as ChunkMaterials;
    expect(m.kind).toBe("indexed"); // guard: the fixture actually exercised packing
    expect(decodeMaterialFile(encodeMaterialFile(m))).toEqual(m);
  });

  test("material file rejects bad magic", () => {
    const bytes = encodeMaterialFile({ kind: "uniform", classId: 3 });
    const corrupt = Uint8Array.from(bytes);
    corrupt[0] = 0; // clobber a magic byte
    expect(() => decodeMaterialFile(corrupt)).toThrow(/magic/);
  });

  test("material file decode rejects corruption (version, kind, length)", () => {
    // A uniform file: header(8) + kind(1)@8 + classId(1)@9. Deterministic
    // byte-mutations exercise each of the decoder's throw sites.
    const uni = encodeMaterialFile({ kind: "uniform", classId: 3 });

    // unknown version — corrupt the version u32 (little-endian at offset 4)
    const badVer = Uint8Array.from(uni);
    badVer[4] = 2;
    expect(() => decodeMaterialFile(badVer)).toThrow(/version/);

    // unknown kind — corrupt the discriminant byte (offset 8) to an unknown 2
    const badKind = Uint8Array.from(uni);
    badKind[8] = 2;
    expect(() => decodeMaterialFile(badKind)).toThrow(/kind/);

    // uniform with trailing bytes — the strict exact-length check rejects it
    const padded = new Uint8Array(uni.byteLength + 1);
    padded.set(uni);
    expect(() => decodeMaterialFile(padded)).toThrow(/uniform length/);

    // indexed with a truncated packed section (drop one byte)
    const s = createFieldStore();
    setMaterial(s, 0, 0, 0, 1);
    setMaterial(s, 1, 0, 0, 2);
    const m = s.materials.get("0,0,0") as ChunkMaterials;
    expect(m.kind).toBe("indexed"); // guard: the fixture is actually indexed
    const idx = encodeMaterialFile(m);
    const truncated = idx.slice(0, idx.byteLength - 1);
    expect(() => decodeMaterialFile(truncated)).toThrow(/packed length/);
  });

  test("bakeFieldWorld emits manifest + a chunk file + a mesh per carved chunk", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [2, 2, 2], radius: 1.4 },
      },
      BUILTIN_TABLE,
    );
    const files = bakeFieldWorld(s, log, BUILTIN_TABLE, {
      name: "scratch",
      playerStart: [2, 2, 2],
      playerYaw: 0,
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("worlds/scratch/manifest.json");
    expect(paths).toContain("worlds/scratch/oplog.json");
    expect(paths.some((p) => p.startsWith("worlds/scratch/chunks/"))).toBe(
      true,
    );
    expect(paths.some((p) => p.endsWith(".fmesh"))).toBe(true);
    const manifestFile = files.find((f) => f.path.endsWith("manifest.json"));
    const manifest = JSON.parse(
      manifestFile?.contents as string,
    ) as FieldManifest;
    expect(manifest.version).toBe(2);
    expect(manifest.kind).toBe("field");
    expect(manifest.chunks.length).toBe(s.chunks.size);
    expect(manifest.meshes.length).toBeGreaterThan(0);
    // A rock-only bake carries no material sibling and no kit files.
    expect(manifest.materials).toBeUndefined();
    expect(manifest.kit).toBeUndefined();
  });

  test("bakeFieldWorld emits per-class meshes, kit json, material files, embedded table", () => {
    const { s, log } = wallFixture(); // dig room + fill masonry (class 2)
    const files = bakeFieldWorld(s, log, TABLE, {
      name: "t",
      playerStart: [2, 1, 2],
      playerYaw: 0,
    });
    const manifest = JSON.parse(
      files.find((f) => f.path.endsWith("manifest.json"))?.contents as string,
    ) as FieldManifest;
    expect(manifest.materialTable?.classes.length).toBe(3);
    expect((manifest.kit ?? []).length).toBeGreaterThan(0);
    expect((manifest.materials ?? []).length).toBeGreaterThan(0);
    expect(manifest.meshes.some((m) => m.backing === true)).toBe(true);
    // manifest still LAST; every referenced file present in the set
    expect(files[files.length - 1]?.path.endsWith("manifest.json")).toBe(true);
    for (const group of [
      manifest.chunks,
      manifest.meshes,
      manifest.materials ?? [],
      manifest.kit ?? [],
    ])
      for (const e of group)
        expect(files.some((f) => f.path === `worlds/t/${e.file}`)).toBe(true);
  });

  test("an F1 bake (no material fields) still parses as a valid manifest", () => {
    // A v2 manifest WITHOUT the new optional fields must stay type-compatible
    // with FieldManifest, and its mesh entries omit classId/backing.
    const f1: FieldManifest = {
      version: 2,
      kind: "field",
      cellSize: 0.25,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [],
      meshes: [{ key: "0,0,0", file: "meshes/0_0_0.fmesh", origin: [0, 0, 0] }],
    };
    expect(f1.materialTable).toBeUndefined();
    expect(f1.materials).toBeUndefined();
    expect(f1.kit).toBeUndefined();
    expect(f1.meshes[0]?.classId).toBeUndefined();
    expect(f1.meshes[0]?.backing).toBeUndefined();
  });
});

describe("field oplog v2 codec", () => {
  /** Mask bit index of a chunk-local sample — the PatchChunk layout. */
  const bitOf = (lx: number, ly: number, lz: number): number =>
    lx + CHUNK_DIM * (ly + CHUNK_DIM * lz);

  const maskOf = (...bits: number[]): Uint8Array => {
    const m = new Uint8Array(PATCH_MASK_BYTES);
    for (const b of bits) m[b >> 3] = (m[b >> 3] ?? 0) | (1 << (b & 7));
    return m;
  };

  /** A minimal VALID slice (one density cell), with any field overridden — so
   *  each case shows only the field under test. Mirrors field-patch.test.ts's
   *  helper; each test file owns its copy. */
  const slice = (over: Partial<PatchChunk> = {}): PatchChunk => ({
    key: "0,0,0",
    densityMask: maskOf(bitOf(0, 0, 0)),
    density: Int8Array.from([1]),
    materialMask: null,
    materials: null,
    ...over,
  });

  /** A density-only slice: `bits` ascending, one Int8 per bit. */
  const densitySlice = (
    key: ChunkKey,
    bits: number[],
    values: number[],
  ): PatchChunk =>
    slice({
      key,
      densityMask: maskOf(...bits),
      density: Int8Array.from(values),
    });

  const patch = (id: number, chunks: PatchChunk[]): PatchOp => ({
    id,
    kind: "patch",
    chunks,
  });

  /** Narrows a parsed op to a patch — a plain cast would hide exactly the
   *  mis-decode these tests exist to catch. */
  const patchAt = (ops: FieldOp[], i: number): PatchOp => {
    const op = ops[i];
    if (op?.kind !== "patch")
      throw new Error(`expected a patch op at ${i}, got ${String(op?.kind)}`);
    return op;
  };

  const entityAt = (ops: FieldOp[], i: number): EntityOp => {
    const op = ops[i];
    if (op?.kind !== "entity")
      throw new Error(`expected an entity op at ${i}, got ${String(op?.kind)}`);
    return op;
  };

  /** Element-wise equality that also pins the ELEMENT TYPE. `toEqual` is strict
   *  on both in bun 1.3.14 (an Int8Array does NOT equal a Uint8Array holding the
   *  same bytes — verified), so this states the invariant the codec's Int8
   *  reinterpretation rests on rather than leaning on matcher internals. */
  const expectSameBytes = (
    got: Int8Array | Uint8Array | null,
    want: Int8Array | Uint8Array,
  ): void => {
    expect(got?.constructor.name).toBe(want.constructor.name);
    expect(Array.from(got ?? [])).toEqual(Array.from(want));
  };

  /** Re-encodes a v2 envelope after `mutate` edits its first patch slice — the
   *  corruption vector (a truncated / garbage payload) without hand-rolling a
   *  second base64 encoder in the tests. */
  const corruptFirstSlice = (
    text: string,
    mutate: (slice: Record<string, unknown>) => void,
  ): string => {
    const wire = JSON.parse(text) as {
      ops: { chunks: Record<string, unknown>[] }[];
    };
    const slice = wire.ops[0]?.chunks[0];
    if (slice === undefined) throw new Error("fixture has no patch slice");
    mutate(slice);
    return JSON.stringify(wire);
  };

  test("oplog v2 round-trips patch ops and entity flags byte-exactly", () => {
    const mask = new Uint8Array(PATCH_MASK_BYTES);
    mask[5] = 0xff;
    const ops: FieldOp[] = [
      {
        id: 1,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [1, 2, 3], radius: 1 },
      },
      {
        id: 2,
        kind: "patch",
        chunks: [
          slice({
            densityMask: mask,
            density: Int8Array.from(Array.from({ length: 8 }, (_, i) => i - 4)),
          }),
        ],
      },
      {
        id: 3,
        kind: "entity",
        action: "place",
        entity: {
          entityId: 3,
          type: "generator",
          generator: "hall",
          params: {},
          seed: 1,
          region: { min: [0, 0, 0], max: [1, 1, 1] },
          opSpan: [1, 2],
          frozen: true,
        },
      },
    ];
    const parsed = parseOps(serializeOps(ops));
    expect(parsed).toEqual(ops);
  });

  test("parseOps still accepts v1 bare arrays incl. legacy dig ops", () => {
    const legacy = JSON.stringify([
      {
        id: 1,
        kind: "dig",
        shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
      },
    ]);
    const parsed = parseOps(legacy);
    expect(parsed[0]).toEqual({
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    });
  });

  test("serializeOps emits a v3 envelope with base64 payloads, never index-keyed objects", () => {
    const op = patch(7, [densitySlice("0,0,0", [bitOf(1, 2, 3)], [-5])]);
    const text = serializeOps([op]);
    const wire = JSON.parse(text) as {
      version: number;
      ops: { kind: string; chunks: Record<string, unknown>[] }[];
    };
    expect(wire.version).toBe(3);
    expect(wire.ops[0]?.kind).toBe("patch");
    const slice = wire.ops[0]?.chunks[0];
    expect(typeof slice?.["densityMask"]).toBe("string");
    expect(typeof slice?.["density"]).toBe("string");
    expect(slice?.["materialMask"]).toBeNull();
    expect(slice?.["materials"]).toBeNull();
    // The pre-v2 failure mode, stated directly: JSON.stringify of a typed array
    // yields {"0":..,"1":..}. Base64 carries neither quotes nor colons, and the
    // only other string on the wire is the chunk key, so this can't false-fire.
    expect(text).not.toContain('"0":');
  });

  test("a multi-chunk patch with BOTH channels and a negative key round-trips", () => {
    const op = patch(4, [
      slice({
        key: "-1,-1,-1",
        densityMask: maskOf(bitOf(15, 15, 15), bitOf(0, 0, 0)),
        density: Int8Array.from([-128, 127]),
        materialMask: maskOf(bitOf(0, 0, 0)),
        materials: Uint8Array.from([1]),
      }),
      slice({
        key: "2,-3,4",
        densityMask: maskOf(bitOf(8, 8, 8)),
        density: Int8Array.from([0]),
        materialMask: maskOf(bitOf(8, 8, 8), bitOf(9, 8, 8)),
        materials: Uint8Array.from([2, 0]),
      }),
    ]);
    const back = patchAt(parseOps(serializeOps([op])), 0);
    expect(back.chunks.map((c) => c.key)).toEqual(["-1,-1,-1", "2,-3,4"]);
    for (const [i, want] of op.chunks.entries()) {
      const got = back.chunks[i];
      expect(got).toBeDefined();
      expectSameBytes(got?.densityMask ?? null, want.densityMask);
      expectSameBytes(got?.density ?? null, want.density);
      expectSameBytes(
        got?.materialMask ?? null,
        want.materialMask as Uint8Array,
      );
      expectSameBytes(got?.materials ?? null, want.materials as Uint8Array);
    }
  });

  test("entity flags survive: baked, frozen, and ABSENCE stays absence", () => {
    const entity = (
      flags: { frozen?: true; baked?: true },
      id: number,
    ): EntityOp => ({
      id,
      kind: "entity",
      action: "place",
      entity: {
        entityId: id,
        type: "generator",
        generator: "hall",
        params: { width: 3 },
        seed: 9,
        region: { min: [0, 0, 0], max: [2, 2, 2] },
        opSpan: [id - 1, id - 1],
        ...flags,
      },
    });
    const ops: FieldOp[] = [
      entity({ baked: true }, 2),
      entity({ frozen: true }, 3),
      entity({}, 4),
    ];
    const parsed = parseOps(serializeOps(ops));
    expect(parsed).toEqual(ops);
    expect(entityAt(parsed, 0).entity.baked).toBe(true);
    expect(entityAt(parsed, 1).entity.frozen).toBe(true);
    // toEqual treats an own `undefined` as absent, so assert the KEY is gone —
    // "not frozen" is spelled by absence (GeneratorEntity.frozen is `true?`).
    const bare = entityAt(parsed, 2).entity;
    expect(Object.hasOwn(bare, "frozen")).toBe(false);
    expect(Object.hasOwn(bare, "baked")).toBe(false);
  });

  test("empty logs round-trip in both directions and v1/v2 never confuse", () => {
    expect(parseOps(serializeOps([]))).toEqual([]);
    expect(parseOps("[]")).toEqual([]); // a v1 bake with no ops
  });

  test("a patch survives a real bakeFieldWorld round-trip", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [2, 2, 2], radius: 1.4 },
      },
      TABLE,
    );
    logApplyPatch(
      s,
      log,
      patch(0, [
        slice({
          densityMask: maskOf(bitOf(4, 4, 4), bitOf(5, 4, 4)),
          density: Int8Array.from([-30, 40]),
          materialMask: maskOf(bitOf(4, 4, 4)),
          materials: Uint8Array.from([1]),
        }),
      ]),
      TABLE,
    );
    const files = bakeFieldWorld(s, log, TABLE, {
      name: "p",
      playerStart: [2, 2, 2],
      playerYaw: 0,
    });
    const oplog = files.find((f) => f.path === "worlds/p/oplog.json");
    expect(typeof oplog?.contents).toBe("string");
    expect(parseOps(oplog?.contents as string)).toEqual(log.ops);
  });

  test("parseOps rejects unknown, future and malformed envelopes", () => {
    // v3 is the CURRENT version; v4 is the future case.
    expect(() => parseOps(JSON.stringify({ version: 4, ops: [] }))).toThrow(
      /newer than this build/,
    );
    expect(() => parseOps(JSON.stringify({ version: 1, ops: [] }))).toThrow(
      /unknown version 1/,
    );
    expect(() => parseOps("{}")).toThrow(/unknown version undefined/);
    // A STRING "2" is not version 2. `String(version)` would report
    // `unknown version 2`, which reads as "2 is unknown" — quote it.
    expect(() => parseOps(JSON.stringify({ version: "2", ops: [] }))).toThrow(
      /unknown version "2"/,
    );
    // Malformed JSON gets the module's locator too: the load path reads
    // manifest.json, oplog.json and kit/*.json, so a bare "JSON Parse error"
    // leaves the user guessing which file broke.
    expect(() => parseOps("{not json")).toThrow(/field oplog: not valid JSON/);
    expect(() => parseOps("")).toThrow(/field oplog: not valid JSON/);
    expect(() => parseOps("null")).toThrow(/expected a versioned envelope/);
    expect(() => parseOps('"oplog"')).toThrow(/expected a versioned envelope/);
    expect(() => parseOps("42")).toThrow(/expected a versioned envelope/);
    expect(() => parseOps(JSON.stringify({ version: 2 }))).toThrow(/ops array/);
    expect(() => parseOps(JSON.stringify({ version: 2, ops: {} }))).toThrow(
      /ops array/,
    );
  });

  /** A v1 bare array holding one hand-written op — the shortest route to the
   *  decoder for a shape `serializeOps` would never emit. */
  const oneOp = (op: Record<string, unknown>): string => JSON.stringify([op]);
  const SPHERE: BrushShape = { kind: "sphere", center: [1, 2, 3], radius: 1 };

  test("parseOps demands an integer id on EVERY op kind", () => {
    // The measured consequence of NOT checking: the editor's loadWorld does
    // `ops.reduce((max, o) => Math.max(max, o.id), 0) + 1`, so one id-less op
    // makes nextId NaN, every later op is stamped `id: NaN`, and JSON.stringify
    // writes those back to disk as `null` — a corrupt oplog become a
    // plausible-looking one, which is exactly what parseOps promises to prevent.
    for (const op of [
      { kind: "brush", effect: "dig", shape: SPHERE },
      { kind: "entity", action: "place", entity: {} },
      { kind: "dig", shape: SPHERE },
      { kind: "patch", chunks: [] },
      { id: "1", kind: "brush", effect: "dig", shape: SPHERE },
      { id: null, kind: "brush", effect: "dig", shape: SPHERE },
      { id: 1.5, kind: "brush", effect: "dig", shape: SPHERE },
    ])
      expect(() => parseOps(oneOp(op))).toThrow(/op id must be an integer/);

    // …and the positive half: a parsed log always yields a finite nextId.
    const ops = parseOps(
      oneOp({ id: 7, kind: "brush", effect: "dig", shape: SPHERE }),
    );
    const nextId = ops.reduce((max, o) => Math.max(max, o.id), 0) + 1;
    expect(nextId).toBe(8);
  });

  test("parseOps rejects off-contract brush/entity fields (the closed unions)", () => {
    // `effect` is a 4-value union and `shape.kind` a 3-value one (sphere, box,
    // and F3b's capsule) — both table-INDEPENDENT, so the decoder can check
    // them for the same reason
    // assertPatchStructure checks a patch's shape. Measured when it did not:
    // effect:"carve" parsed, then applyOp returned dirty.size 0 and the
    // replayed world silently diverged from the baked one; shape:{kind:"torus"}
    // parsed, then replay died with a raw TypeError inside opBounds, far from
    // the corrupt file.
    expect(() =>
      parseOps(oneOp({ id: 1, kind: "brush", effect: "carve", shape: SPHERE })),
    ).toThrow(/effect must be one of/);
    expect(() =>
      parseOps(
        oneOp({
          id: 1,
          kind: "brush",
          effect: "dig",
          shape: { kind: "torus" },
        }),
      ),
    ).toThrow(/shape\.kind must be one of/);
    expect(() =>
      parseOps(oneOp({ id: 1, kind: "brush", effect: "dig" })),
    ).toThrow(/brush op 1 has no shape object/);
    // The legacy-dig upgrade writes `effect` itself, but still reads the shape.
    expect(() =>
      parseOps(oneOp({ id: 1, kind: "dig", shape: { kind: "torus" } })),
    ).toThrow(/shape\.kind must be one of/);
    // Entity: `action` is a single literal, and `entity` must be a record.
    expect(() =>
      parseOps(
        oneOp({ id: 1, kind: "entity", action: "detonate", entity: {} }),
      ),
    ).toThrow(/action must be one of/);
    expect(() =>
      parseOps(oneOp({ id: 1, kind: "entity", action: "place", entity: 42 })),
    ).toThrow(/entity op 1 has no entity record/);
    // Every legal spelling still passes.
    for (const effect of ["dig", "fill", "paint", "smooth"])
      expect(() =>
        parseOps(oneOp({ id: 1, kind: "brush", effect, shape: SPHERE })),
      ).not.toThrow();
    expect(() =>
      parseOps(
        oneOp({
          id: 1,
          kind: "brush",
          effect: "fill",
          shape: { kind: "box", center: [0, 0, 0], halfExtents: [1, 1, 1] },
        }),
      ),
    ).not.toThrow();
  });

  test("union membership is OWN-key only — Object.prototype names are not members", () => {
    // The union tables are plain objects, so `"toString" in table` is TRUE for
    // every one of them. Only Object.hasOwn distinguishes a real member from an
    // inherited Object.prototype name, and nothing else in this file would
    // notice the difference — verified by sabotage (swapping hasOwn for `in`
    // left every other test green).
    for (const inherited of [
      "toString",
      "constructor",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(() =>
        parseOps(
          oneOp({ id: 1, kind: "brush", effect: inherited, shape: SPHERE }),
        ),
      ).toThrow(/effect must be one of/);
      expect(() =>
        parseOps(
          oneOp({
            id: 1,
            kind: "brush",
            effect: "dig",
            shape: { kind: inherited },
          }),
        ),
      ).toThrow(/shape\.kind must be one of/);
      expect(() =>
        parseOps(
          oneOp({
            id: 1,
            kind: "entity",
            action: "place",
            entity: { type: inherited },
          }),
        ),
      ).toThrow(/entity\.type must be one of/);
    }
  });

  /** A dig op carrying one extra field — the optional `mask`/`smooth` legs. */
  const withField = (field: string, value: unknown): string =>
    oneOp({
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: SPHERE,
      [field]: value,
    });

  test("parseOps rejects off-contract mask + selection discriminators", () => {
    // Measured before these guards existed: mask:{kind:"bogus"} parsed, and
    // applyOp then wrote 0 cells where the identical UNMASKED op writes 7 —
    // makeMaskGate falls through to the class branch and compares against an
    // undefined classId. The same silent-divergence mode as effect:"carve".
    expect(() => parseOps(withField("mask", { kind: "bogus" }))).toThrow(
      /mask\.kind must be one of/,
    );
    // `mask` is OPTIONAL, so present-but-not-a-record must throw too —
    // otherwise it sails past every field guard below it (measured: 0 cells).
    for (const bad of [42, "solid-only", null, []])
      expect(() => parseOps(withField("mask", bad))).toThrow(
        /mask must be an object/,
      );
    // An embedded selection carries its OWN discriminator. Measured: a bogus
    // one parsed, then replay died with `TypeError: … 'spec.seed'` inside
    // assertSelectionSpecValid — the raw-TypeError mode, one level down.
    expect(() =>
      parseOps(
        withField("mask", { kind: "selection", selection: { kind: "bogus" } }),
      ),
    ).toThrow(/mask\.selection\.kind must be one of/);
    expect(() =>
      parseOps(withField("mask", { kind: "selection", selection: 42 })),
    ).toThrow(/mask\.selection must be an object/);
    // Every legal spelling still passes, including absence.
    expect(() =>
      parseOps(oneOp({ id: 1, kind: "brush", effect: "dig", shape: SPHERE })),
    ).not.toThrow();
    for (const kind of ["organic-only", "kit-only", "solid-only"])
      expect(() => parseOps(withField("mask", { kind }))).not.toThrow();
    expect(() =>
      parseOps(withField("mask", { kind: "class", classId: 1 })),
    ).not.toThrow();
    for (const kind of ["region", "flood-material", "flood-void"])
      expect(() =>
        parseOps(withField("mask", { kind: "selection", selection: { kind } })),
      ).not.toThrow();
  });

  test("parseOps rejects an off-contract smooth mode and entity type", () => {
    // applySmooth special-cases only erode/fill, so an unknown mode silently
    // behaves as `both`. assertSmoothValid already owns the right predicate —
    // it is simply never reached for a loaded op.
    expect(() =>
      parseOps(withField("smooth", { strength: 16, iterations: 1, mode: "x" })),
    ).toThrow(/smooth\.mode must be one of/);
    for (const bad of [42, "both", null, []])
      expect(() => parseOps(withField("smooth", bad))).toThrow(
        /smooth must be an object/,
      );
    for (const mode of ["both", "erode", "fill"])
      expect(() =>
        parseOps(withField("smooth", { strength: 16, iterations: 1, mode })),
      ).not.toThrow();

    // GeneratorEntity.type is a single literal — a closed union like the rest.
    expect(() =>
      parseOps(
        oneOp({
          id: 1,
          kind: "entity",
          action: "place",
          entity: { type: "bogus" },
        }),
      ),
    ).toThrow(/entity\.type must be one of/);
    expect(() =>
      parseOps(
        oneOp({
          id: 1,
          kind: "entity",
          action: "place",
          entity: { type: "generator" },
        }),
      ),
    ).not.toThrow();
  });

  test("a fully-populated brush op survives the round-trip (what the engine emits)", () => {
    // No oplog on disk carries mask/smooth TODAY, but generators.ts emits
    // `mask:{kind:"solid-only"}` into logged brush ops under keep-existing-air,
    // so masks WILL appear in bakes going forward. This pins that the new wire
    // guards accept everything the engine actually produces — typed as BrushOp,
    // so a union widened in types.ts fails here as well as at the guard tables.
    const ops: FieldOp[] = [
      {
        id: 1,
        kind: "brush",
        effect: "fill",
        material: 2,
        hollow: 0.5,
        mask: { kind: "solid-only" },
        shape: { kind: "box", center: [1, 1, 1], halfExtents: [0.5, 0.5, 0.5] },
      },
      {
        id: 2,
        kind: "brush",
        effect: "smooth",
        smooth: { strength: 16, iterations: 2, mode: "erode" },
        shape: { kind: "sphere", center: [1, 1, 1], radius: 1 },
      },
      {
        id: 3,
        kind: "brush",
        effect: "paint",
        material: 1,
        mask: {
          kind: "selection",
          selection: {
            kind: "flood-material",
            seed: [1, 2, 3],
            classId: 0,
            budget: 1000,
          },
        },
        shape: { kind: "sphere", center: [2, 2, 2], radius: 2 },
      },
      {
        id: 4,
        kind: "brush",
        effect: "dig",
        mask: { kind: "class", classId: 1 },
        shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
      },
    ];
    expect(parseOps(serializeOps(ops))).toEqual(ops);
  });

  test("a legacy dig op decodes the same inside a v2 envelope as in a v1 array", () => {
    // The "one decode path" claim, exercised on the v2 side too.
    const dig = { id: 1, kind: "dig", shape: SPHERE };
    const want: BrushOp = {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: SPHERE,
    };
    expect(parseOps(oneOp(dig))[0]).toEqual(want);
    expect(parseOps(JSON.stringify({ version: 2, ops: [dig] }))[0]).toEqual(
      want,
    );
  });

  test("parseOps rejects ops that are not ops, in either envelope version", () => {
    // A v1 bare array gets the same op-level guards as a v2 envelope.
    expect(() => parseOps("[null]")).toThrow(/every op must be a JSON object/);
    expect(() => parseOps("[[]]")).toThrow(/must be a JSON object, got array/);
    expect(() =>
      parseOps(JSON.stringify({ version: 2, ops: ["brush"] })),
    ).toThrow(/must be a JSON object, got string/);
    expect(() => parseOps(JSON.stringify([{ id: 1, kind: "carve" }]))).toThrow(
      /unknown kind "carve"/,
    );
    expect(() => parseOps(JSON.stringify([{ id: 1 }]))).toThrow(
      /unknown kind undefined/,
    );
    // The legacy-dig upgrade supplies `effect` but still reads the shape (the
    // id is guarded once, up in decodeOp — see the id test above).
    expect(() => parseOps(JSON.stringify([{ id: 1, kind: "dig" }]))).toThrow(
      /legacy dig op 1 has no shape/,
    );
    // Patch-op envelope fields, before any payload decode.
    expect(() =>
      parseOps(JSON.stringify({ version: 2, ops: [{ id: 5, kind: "patch" }] })),
    ).toThrow(/patch op 5 has no chunks array/);
    expect(() =>
      parseOps(
        JSON.stringify({
          version: 2,
          ops: [{ id: 5, kind: "patch", chunks: [1] }],
        }),
      ),
    ).toThrow(/patch chunk is not a JSON object/);
  });

  test("parseOps rejects a corrupt patch payload rather than mis-decoding it", () => {
    const text = serializeOps([
      patch(1, [
        densitySlice("0,0,0", [bitOf(0, 0, 0), bitOf(1, 0, 0)], [1, 2]),
      ]),
    ]);
    // 4 base64 chars = 3 bytes exactly, so the payload stays VALID base64 and
    // only its LENGTH is wrong — the silent-corruption shape.
    const shortMask = corruptFirstSlice(text, (c) => {
      c["densityMask"] = (c["densityMask"] as string).slice(0, -4);
    });
    expect(() => parseOps(shortMask)).toThrow(/densityMask must be 512 bytes/);

    const shortDensity = corruptFirstSlice(text, (c) => {
      c["density"] = (c["density"] as string).slice(0, -4);
    });
    expect(() => parseOps(shortDensity)).toThrow(/density length/);

    const garbage = corruptFirstSlice(text, (c) => {
      c["density"] = "!!! not base64 !!!";
    });
    expect(() => parseOps(garbage)).toThrow(/not valid base64/);

    const notAString = corruptFirstSlice(text, (c) => {
      c["densityMask"] = 42;
    });
    expect(() => parseOps(notAString)).toThrow(/base64 string/);

    const badKey = corruptFirstSlice(text, (c) => {
      c["key"] = "0,0";
    });
    expect(() => parseOps(badKey)).toThrow(/malformed chunk key/);

    const halfMaterials = corruptFirstSlice(text, (c) => {
      c["materials"] = "AQ=="; // present without a materialMask
    });
    expect(() => parseOps(halfMaterials)).toThrow(
      /materials present without materialMask/,
    );

    // A MISSING nullable field is not an implicit null: `serializeOps` always
    // writes the key, so its absence is corruption, not an older spelling.
    for (const name of ["materials", "materialMask"]) {
      const dropped = corruptFirstSlice(text, (c) => {
        delete c[name];
      });
      expect(() => parseOps(dropped)).toThrow(/must be a base64 string/);
    }
  });

  // ——— v3: placement ops (D-F3-8) ———

  const placementOp = (id: number): FieldOp => ({
    id,
    kind: "placement",
    records: [
      {
        archetypeId: "torch",
        position: [1.5, 2, -3],
        quat: [0, 0, 0, 1],
        scale: [1, 1, 1],
        variantIndex: 0,
      },
      {
        archetypeId: "barrel",
        position: [4, 0, 4],
        // a real quarter-turn about +Y: |q|² = 2·(√½)² ≈ 1 (within tolerance)
        quat: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
        scale: [0.5, 1.25, 0.5],
        variantIndex: 3,
      },
    ],
  });

  test("v3 round-trips a placement op exactly, as literal JSON (no base64)", () => {
    const op = placementOp(9);
    const text = serializeOps([op]);
    const wire = JSON.parse(text) as {
      version: number;
      ops: Record<string, unknown>[];
    };
    expect(wire.version).toBe(3);
    // a placement op rides the envelope literally — no typed-array encoding
    expect(wire.ops[0]).toEqual(op as unknown as Record<string, unknown>);
    expect(parseOps(text)).toEqual([op]);
  });

  test("three-version chain — v1 bare array, v2 envelope, v3 envelope all parse", () => {
    const brush: FieldOp = {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: SPHERE,
    };
    // v1: a bare JSON array, no envelope
    expect(parseOps(JSON.stringify([brush]))).toEqual([brush]);
    // v2: an envelope with version 2 (carries no placement ops by construction)
    expect(parseOps(JSON.stringify({ version: 2, ops: [brush] }))).toEqual([
      brush,
    ]);
    // v3: the current envelope, which may carry placement ops
    expect(
      parseOps(JSON.stringify({ version: 3, ops: [brush, placementOp(2)] })),
    ).toEqual([brush, placementOp(2)]);
  });

  test("parseOps validates placement records — shape AND values", () => {
    const good = {
      archetypeId: "torch",
      position: [0, 0, 0],
      quat: [0, 0, 0, 1],
      scale: [1, 1, 1],
      variantIndex: 0,
    };
    const withRecord = (over: Record<string, unknown>): string =>
      JSON.stringify({
        version: 3,
        ops: [{ id: 1, kind: "placement", records: [{ ...good, ...over }] }],
      });
    // structure
    expect(() =>
      parseOps(
        JSON.stringify({ version: 3, ops: [{ id: 1, kind: "placement" }] }),
      ),
    ).toThrow(/has no records array/);
    expect(() => parseOps(withRecord({ archetypeId: 42 }))).toThrow(
      /archetypeId must be a string/,
    );
    expect(() => parseOps(withRecord({ position: [0, 0] }))).toThrow(
      /position must be an array of 3 numbers/,
    );
    expect(() => parseOps(withRecord({ quat: [0, 0, 1] }))).toThrow(
      /quat must be an array of 4 numbers/,
    );
    // values
    expect(() => parseOps(withRecord({ archetypeId: "" }))).toThrow(
      /archetypeId must be a non-empty string/,
    );
    expect(() => parseOps(withRecord({ quat: [0, 0, 0, 0] }))).toThrow(
      /unit-length/,
    );
    expect(() => parseOps(withRecord({ variantIndex: -1 }))).toThrow(
      /variantIndex must be a non-negative integer/,
    );
    expect(() => parseOps(withRecord({ variantIndex: 1.5 }))).toThrow(
      /variantIndex/,
    );
    // the good record parses clean
    expect(() => parseOps(withRecord({}))).not.toThrow();
  });
});

describe("field placement artifact (D-F3-10)", () => {
  // Every value here is EXACTLY representable in Float32 (integers, halves,
  // quarters, eighths, and unit quats built from 0/1/0.5), so a round-trip
  // through the packed Float32 payload is BYTE-exact and can be asserted with
  // toEqual — no float-precision slack.
  const rockA: PlacementRecord = {
    archetypeId: "rock",
    position: [1.5, 2, -3],
    quat: [0, 0, 0, 1],
    scale: [1, 1, 1],
    variantIndex: 0,
  };
  const rockB: PlacementRecord = {
    archetypeId: "rock",
    position: [4, 0, 4],
    quat: [0.5, 0.5, 0.5, 0.5], // |q|² = 1, Float32-exact
    scale: [0.5, 1.25, 0.5],
    variantIndex: 2,
  };
  const stalag: PlacementRecord = {
    archetypeId: "stalagmite",
    position: [-2, 0.5, 8],
    quat: [0, 0, 0, 1],
    scale: [1, 2, 1],
    variantIndex: 1,
  };

  test("round-trips records exactly, grouped per archetype, first-appearance order", () => {
    const records = [rockA, rockB, stalag];
    const groups = parsePlacements(serializePlacements(records));
    expect(groups.map((g) => g.id)).toEqual(["rock", "stalagmite"]);
    expect(groups.map((g) => g.records.length)).toEqual([2, 1]);
    // archetype-contiguous input survives unreordered and byte-exact
    expect(groups.flatMap((g) => g.records)).toEqual(records);
  });

  test("groups records by archetype even when the input INTERLEAVES them", () => {
    // rock, stalagmite, rock — the grouping must collect both rocks under one id.
    const groups = parsePlacements(serializePlacements([rockA, stalag, rockB]));
    expect(groups.map((g) => g.id)).toEqual(["rock", "stalagmite"]);
    // count test: break the per-archetype grouping (e.g. one group per record)
    // and this 2 goes to 1 — the sabotage target.
    expect(groups[0]?.records.length).toBe(2);
    expect(groups[0]?.records).toEqual([rockA, rockB]);
    expect(groups[1]?.records).toEqual([stalag]);
  });

  test("packs EXACTLY 11 floats/record: [pos3 quat4 scale3 variant]", () => {
    const wire = JSON.parse(serializePlacements([rockB])) as {
      version: number;
      archetypes: { id: string; count: number; records: string }[];
    };
    expect(wire.version).toBe(1);
    expect(wire.archetypes[0]?.id).toBe("rock");
    expect(wire.archetypes[0]?.count).toBe(1);
    // Decode the base64 payload directly and assert the exact float layout.
    const b64 = wire.archetypes[0]?.records as string;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const f = new Float32Array(bytes.buffer);
    expect(f.length).toBe(11);
    // rockB: pos [4,0,4], quat [0.5,0.5,0.5,0.5], scale [0.5,1.25,0.5], variant 2
    expect(Array.from(f)).toEqual([
      4, 0, 4, 0.5, 0.5, 0.5, 0.5, 0.5, 1.25, 0.5, 2,
    ]);
  });

  test("empty records serialize to a versioned envelope with no archetypes", () => {
    const groups = parsePlacements(serializePlacements([]));
    expect(groups).toEqual([]);
  });

  test("parsePlacements is setup-loud on structural corruption", () => {
    // bad JSON gets the module locator (three JSON files sit in a world dir)
    expect(() => parsePlacements("{not json")).toThrow(
      /field placements: not valid JSON/,
    );
    // wrong / missing version
    expect(() =>
      parsePlacements(JSON.stringify({ version: 2, archetypes: [] })),
    ).toThrow(/unknown version 2/);
    expect(() => parsePlacements(JSON.stringify({ archetypes: [] }))).toThrow(
      /unknown version undefined/,
    );
    // missing archetypes array
    expect(() => parsePlacements(JSON.stringify({ version: 1 }))).toThrow(
      /no archetypes array/,
    );
    // a group with a non-string id
    expect(() =>
      parsePlacements(JSON.stringify({ version: 1, archetypes: [{ id: 42 }] })),
    ).toThrow(/id must be a non-empty string/);
    // count disagreeing with the payload length — the silent-corruption shape
    const good = JSON.parse(serializePlacements([rockA, rockB])) as {
      version: number;
      archetypes: { id: string; count: number; records: string }[];
    };
    const badCount = structuredClone(good);
    (badCount.archetypes[0] as { count: number }).count = 3; // payload holds 2
    expect(() => parsePlacements(JSON.stringify(badCount))).toThrow(
      /expected .* × 11 × 4/,
    );
    // garbage base64
    const badB64 = structuredClone(good);
    (badB64.archetypes[0] as { records: string }).records = "!!! not b64 !!!";
    expect(() => parsePlacements(JSON.stringify(badB64))).toThrow(
      /not valid base64/,
    );
  });

  test("parsePlacements value-validates via assertPlacementsValid (non-unit quat)", () => {
    // Hand-pack one record whose quat is NOT unit-length (all ones, |q|² = 4).
    const f = new Float32Array([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0]);
    const bytes = new Uint8Array(f.buffer);
    const b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
    const text = JSON.stringify({
      version: 1,
      archetypes: [{ id: "rock", count: 1, records: b64 }],
    });
    expect(() => parsePlacements(text)).toThrow(/unit-length/);
  });

  const placementOp = (
    id: number,
    records: PlacementRecord[],
  ): PlacementOp => ({
    id,
    kind: "placement",
    records,
  });

  test("bakeFieldWorld emits placements.json + manifest.placements; version stays 2", () => {
    const { s, log } = wallFixture();
    // A scatter commit appends a placement op to the log; bake reads log.ops.
    log.ops.push(placementOp(99, [rockA, rockB, stalag]));
    const files = bakeFieldWorld(s, log, TABLE, {
      name: "props",
      playerStart: [2, 1, 2],
      playerYaw: 0,
    });
    const manifest = JSON.parse(
      files.find((f) => f.path.endsWith("manifest.json"))?.contents as string,
    ) as FieldManifest;
    expect(manifest.version).toBe(2); // ADDITIVE — NOT bumped
    expect(manifest.placements).toBe("placements.json");
    // manifest still LAST (partial-write safety), placements written before it
    expect(files[files.length - 1]?.path.endsWith("manifest.json")).toBe(true);
    const pf = files.find((f) => f.path === "worlds/props/placements.json");
    expect(pf).toBeDefined();
    const artifact = JSON.parse(pf?.contents as string) as {
      version: number;
      archetypes: { id: string; count: number }[];
    };
    expect(artifact.version).toBe(1);
    expect(artifact.archetypes.map((a) => a.id)).toEqual([
      "rock",
      "stalagmite",
    ]);
    expect(artifact.archetypes.map((a) => a.count)).toEqual([2, 1]);
    // full round-trip through the baked file
    const groups = parsePlacements(pf?.contents as string);
    expect(groups.flatMap((g) => g.records)).toEqual([rockA, rockB, stalag]);
  });

  test("bakeFieldWorld omits placements when the log has no placement ops", () => {
    const { s, log } = wallFixture(); // brush ops only
    const files = bakeFieldWorld(s, log, TABLE, {
      name: "noprops",
      playerStart: [2, 1, 2],
      playerYaw: 0,
    });
    const manifest = JSON.parse(
      files.find((f) => f.path.endsWith("manifest.json"))?.contents as string,
    ) as FieldManifest;
    expect(manifest.placements).toBeUndefined();
    expect(files.some((f) => f.path.endsWith("placements.json"))).toBe(false);
  });
});
