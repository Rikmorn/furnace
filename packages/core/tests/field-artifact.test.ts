import { describe, expect, test } from "bun:test";
import type {
  ChunkMaterials,
  FieldManifest,
  FieldStore,
  MaterialTable,
  OpLog,
} from "@furnace/core/field";
import {
  BUILTIN_TABLE,
  bakeFieldWorld,
  createFieldStore,
  createOpLog,
  decodeChunkFile,
  decodeMaterialFile,
  encodeChunkFile,
  encodeMaterialFile,
  logApply,
  parseOps,
  serializeOps,
  setMaterial,
} from "@furnace/core/field";

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
