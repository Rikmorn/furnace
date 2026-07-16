import { describe, expect, test } from "bun:test";
import type { FieldStore, MaterialTable } from "@furnace/core/field";
import {
  applyOp,
  chunkKey,
  createFieldStore,
  createOpLog,
  extractFieldAprons,
  logApply,
} from "@furnace/core/field";
import type { FieldWorkerResponse } from "../src/frontend/lib/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/frontend/lib/field-protocol.ts";

// 3-class fixture: rock (id0 organic), dirt (id1 organic), masonry (id2 kit).
// A kit class makes the skinner emit + the mesher split off a backing bucket —
// mirrors core's field-skin-topology fixture.
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

/** A masonry wall standing in a dug room, fully inside chunk (0,0,0): both a
 *  backing (kit) mesh bucket and kit instances fall out (core's wallFixture). */
function wallFixture(): FieldStore {
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
  return s;
}

/** Flattens every bucket's four buffers (positions/normals/uvs/indices) — the
 *  set that must appear in the response transfer list for zero-copy handoff. */
const bucketBuffers = (
  msg: Extract<FieldWorkerResponse, { kind: "meshed" }>,
): ArrayBuffer[] =>
  msg.buckets.flatMap((b) => [b.positions, b.normals, b.uvs, b.indices]);

describe("field worker protocol", () => {
  test("mesh request posts a meshed response with transferable bucket buffers", () => {
    const s = createFieldStore();
    applyOp(
      s,
      {
        id: 1,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [2, 2, 2], radius: 1.2 },
      },
      TABLE,
    );
    const posts: { msg: FieldWorkerResponse; transfer: Transferable[] }[] = [];
    const handler = createFieldWorkerHandler((msg, transfer) =>
      posts.push({ msg, transfer }),
    );
    const aprons = extractFieldAprons(s, chunkKey(0, 0, 0));
    handler({
      kind: "mesh",
      jobId: 7,
      key: "0,0,0",
      density: aprons.density.buffer as ArrayBuffer,
      materials: aprons.materials.buffer as ArrayBuffer,
      table: TABLE,
      cellSize: 0.25,
    });
    expect(posts.length).toBe(1);
    const first = posts[0] as (typeof posts)[0];
    expect(first.msg.kind).toBe("meshed");
    if (first.msg.kind === "meshed") {
      expect(first.msg.buckets.length).toBeGreaterThan(0);
      const bufs = bucketBuffers(first.msg);
      expect(first.transfer.length).toBe(bufs.length);
      for (const buf of bufs) expect(first.transfer).toContain(buf);
      const b0 = first.msg.buckets[0];
      expect(b0).toBeDefined();
      if (b0) expect(new Uint32Array(b0.indices).length).toBeGreaterThan(0);
    }
  });

  test("wall fixture meshes a kit backing bucket + non-empty kit instances", () => {
    const s = wallFixture();
    const posts: { msg: FieldWorkerResponse; transfer: Transferable[] }[] = [];
    const handler = createFieldWorkerHandler((msg, transfer) =>
      posts.push({ msg, transfer }),
    );
    const aprons = extractFieldAprons(s, chunkKey(0, 0, 0));
    handler({
      kind: "mesh",
      jobId: 3,
      key: "0,0,0",
      density: aprons.density.buffer as ArrayBuffer,
      materials: aprons.materials.buffer as ArrayBuffer,
      table: TABLE,
      cellSize: s.cellSize,
    });
    expect(posts.length).toBe(1);
    const first = posts[0] as (typeof posts)[0];
    expect(first.msg.kind).toBe("meshed");
    if (first.msg.kind === "meshed") {
      const backing = first.msg.buckets.filter((b) => b.backing);
      expect(backing.length).toBeGreaterThan(0);
      expect(backing.some((b) => b.classId === 2)).toBe(true);
      expect(first.msg.kit.length).toBeGreaterThan(0);
      const bufs = bucketBuffers(first.msg);
      expect(first.transfer.length).toBe(bufs.length);
      for (const buf of bufs) expect(first.transfer).toContain(buf);
    }
  });

  test("malformed apron posts mesh-error carrying the jobId, never throws", () => {
    const posts: FieldWorkerResponse[] = [];
    const handler = createFieldWorkerHandler((msg) => posts.push(msg));
    handler({
      kind: "mesh",
      jobId: 42,
      key: "0,0,0",
      density: new ArrayBuffer(3),
      materials: new ArrayBuffer(3),
      table: TABLE,
      cellSize: 0.25,
    });
    expect(posts[0]?.kind).toBe("mesh-error");
    expect(posts[0]?.jobId).toBe(42);
  });
});
