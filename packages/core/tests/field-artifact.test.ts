import { describe, expect, test } from "bun:test";
import type { FieldManifest } from "@furnace/core/field";
import {
  BUILTIN_TABLE,
  bakeFieldWorld,
  createFieldStore,
  createOpLog,
  decodeChunkFile,
  encodeChunkFile,
  logApply,
  parseOps,
  serializeOps,
} from "@furnace/core/field";

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
    const files = bakeFieldWorld(s, log, {
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
  });
});
