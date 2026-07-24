import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { decodeMeshBlob } from "@furnace/core/scene";
import { bakeCatalogMeshes } from "../scripts/bake-catalog-meshes.ts";

const MESHES_DIR = resolve(import.meta.dir, "../catalog/meshes");
const MAX_BYTES = 100 * 1024;
const EXPECTED = ["rock.0", "rock.1", "rock.2", "stalagmite.0", "stalagmite.1"];

test("bake is deterministic (bake twice → byte-identical) and small", () => {
  const a = bakeCatalogMeshes();
  const b = bakeCatalogMeshes();
  expect(a.map((m) => m.name)).toEqual(EXPECTED);
  expect(a.length).toBe(EXPECTED.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) throw new Error("missing mesh");
    // byte-identical across two bakes (the snapshot invariant)
    expect(Array.from(x.bytes)).toEqual(Array.from(y.bytes));
    // committed project assets — assert the < 100 KB budget
    expect(x.bytes.byteLength).toBeLessThan(MAX_BYTES);
  }
});

test("every baked blob decodes cleanly with valid unit-normal geometry", () => {
  for (const m of bakeCatalogMeshes()) {
    const blob = decodeMeshBlob(m.bytes.buffer as ArrayBuffer);
    const { positions, normals, indices } = blob.render;
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length % 3).toBe(0);
    expect(normals.length).toBe(positions.length);
    expect(indices.length % 3).toBe(0);
    expect(indices.length).toBeGreaterThan(0);
    // every index addresses a real vertex
    const vertCount = positions.length / 3;
    for (const idx of indices) expect(idx).toBeLessThan(vertCount);
    // recomputed normals are unit length
    for (let v = 0; v < vertCount; v++) {
      const nx = normals[v * 3] ?? 0;
      const ny = normals[v * 3 + 1] ?? 0;
      const nz = normals[v * 3 + 2] ?? 0;
      expect(Math.sqrt(nx * nx + ny * ny + nz * nz)).toBeCloseTo(1, 4);
    }
  }
});

test("unit sizing: rocks fit in ±0.5, stalagmites span y ∈ [0, 1]", () => {
  for (const m of bakeCatalogMeshes()) {
    const { positions } = decodeMeshBlob(m.bytes.buffer as ArrayBuffer).render;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] ?? 0;
      const y = positions[i + 1] ?? 0;
      const z = positions[i + 2] ?? 0;
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(z)).toBeLessThanOrEqual(0.5);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (m.name.startsWith("rock")) {
      expect(Math.abs(minY)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(maxY)).toBeLessThanOrEqual(0.5);
    } else {
      // stalagmite: base at y=0, unit height
      expect(minY).toBeCloseTo(0, 5);
      expect(maxY).toBeCloseTo(1, 5);
    }
  }
});

test("committed .fmesh files on disk match a fresh bake (regenerate if this fails)", async () => {
  for (const m of bakeCatalogMeshes()) {
    const path = resolve(MESHES_DIR, `${m.name}.fmesh`);
    const onDisk = new Uint8Array(await Bun.file(path).arrayBuffer());
    expect(Array.from(onDisk)).toEqual(Array.from(m.bytes));
  }
});
