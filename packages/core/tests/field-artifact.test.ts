import { describe, expect, test } from "bun:test";
import type {
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
  serializeOps,
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

  /** A density-only slice: `bits` ascending, one Int8 per bit. */
  const densitySlice = (
    key: ChunkKey,
    bits: number[],
    values: number[],
  ): PatchChunk => ({
    key,
    densityMask: maskOf(...bits),
    density: Int8Array.from(values),
    materialMask: null,
    materials: null,
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
          {
            key: "0,0,0",
            densityMask: mask,
            density: Int8Array.from(Array.from({ length: 8 }, (_, i) => i - 4)),
            materialMask: null,
            materials: null,
          },
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

  test("serializeOps emits a v2 envelope with base64 payloads, never index-keyed objects", () => {
    const op = patch(7, [densitySlice("0,0,0", [bitOf(1, 2, 3)], [-5])]);
    const text = serializeOps([op]);
    const wire = JSON.parse(text) as {
      version: number;
      ops: { kind: string; chunks: Record<string, unknown>[] }[];
    };
    expect(wire.version).toBe(2);
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
      {
        key: "-1,-1,-1",
        densityMask: maskOf(bitOf(15, 15, 15), bitOf(0, 0, 0)),
        density: Int8Array.from([-128, 127]),
        materialMask: maskOf(bitOf(0, 0, 0)),
        materials: Uint8Array.from([1]),
      },
      {
        key: "2,-3,4",
        densityMask: maskOf(bitOf(8, 8, 8)),
        density: Int8Array.from([0]),
        materialMask: maskOf(bitOf(8, 8, 8), bitOf(9, 8, 8)),
        materials: Uint8Array.from([2, 0]),
      },
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
        {
          key: "0,0,0",
          densityMask: maskOf(bitOf(4, 4, 4), bitOf(5, 4, 4)),
          density: Int8Array.from([-30, 40]),
          materialMask: maskOf(bitOf(4, 4, 4)),
          materials: Uint8Array.from([1]),
        },
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
    expect(() => parseOps(JSON.stringify({ version: 3, ops: [] }))).toThrow(
      /newer than this build/,
    );
    expect(() => parseOps(JSON.stringify({ version: 1, ops: [] }))).toThrow(
      /unknown version 1/,
    );
    expect(() => parseOps("{}")).toThrow(/unknown version undefined/);
    expect(() => parseOps("null")).toThrow(/expected a v2 envelope/);
    expect(() => parseOps('"oplog"')).toThrow(/expected a v2 envelope/);
    expect(() => parseOps("42")).toThrow(/expected a v2 envelope/);
    expect(() => parseOps(JSON.stringify({ version: 2 }))).toThrow(/ops array/);
    expect(() => parseOps(JSON.stringify({ version: 2, ops: {} }))).toThrow(
      /ops array/,
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
    // The legacy-dig upgrade reads two fields; both are guarded.
    expect(() =>
      parseOps(JSON.stringify([{ kind: "dig", shape: {} }])),
    ).toThrow(/legacy dig op id must be a number/);
    expect(() => parseOps(JSON.stringify([{ id: 1, kind: "dig" }]))).toThrow(
      /legacy dig op 1 has no shape/,
    );
    // Patch-op envelope fields, before any payload decode.
    expect(() =>
      parseOps(JSON.stringify({ version: 2, ops: [{ kind: "patch" }] })),
    ).toThrow(/patch op id must be a number/);
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
  });
});
