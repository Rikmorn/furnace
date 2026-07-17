import { describe, expect, test } from "bun:test";
import type { FieldStore, MaterialTable } from "@furnace/core/field";
import {
  applyOp,
  CHUNK_SAMPLES,
  chunkKey,
  createFieldStore,
  createOpLog,
  extractFieldAprons,
  logApply,
  SOLID,
} from "@furnace/core/field";
import { FieldWorkerClient } from "../src/frontend/lib/field-client.ts";
import type {
  FieldWorkerRequest,
  FieldWorkerResponse,
  WireBucket,
} from "../src/frontend/lib/field-protocol.ts";
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

/** Max vertex Y (chunk-local metres) across buckets — positions stride 3. */
function maxVertexY(buckets: WireBucket[]): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const b of buckets) {
    const pos = new Float32Array(b.positions);
    for (let i = 1; i < pos.length; i += 3)
      max = Math.max(max, pos[i] as number);
  }
  return max;
}

/** Runs a fresh pure handler over one request, collecting posts. */
function runHandler(req: FieldWorkerRequest) {
  const posts: { msg: FieldWorkerResponse; transfer: Transferable[] }[] = [];
  createFieldWorkerHandler((msg, transfer) => posts.push({ msg, transfer }))(
    req,
  );
  return posts;
}

/** The hall generator's full param set (schema defaults spelled out — param
 *  narrowing is setup-loud, so every field must be present). */
const HALL_PARAMS: Record<string, unknown> = {
  width: 8,
  height: 6,
  depth: 8,
  pillars: "none",
  pillarSpacing: 3,
  doorNorth: true,
  doorSouth: false,
  doorEast: false,
  doorWest: false,
};

/** The default hall's stamp AABB: 10×8×10 coarse cells = 5×4×5 m at origin. */
const HALL_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [5, 4, 5] as [number, number, number],
};

const runStamp = (generator: string) =>
  runHandler({
    kind: "stamp-preview",
    jobId: 11,
    generator,
    params: HALL_PARAMS,
    seed: 42,
    region: HALL_REGION,
    policy: "replace",
    table: TABLE,
    cellSize: 0.25,
    chunks: [],
  });

/** Captures postMessage traffic — the client's injectable spawn seam. */
function fakeWorker() {
  const sent: {
    msg: FieldWorkerRequest;
    transfer: Transferable[] | undefined;
  }[] = [];
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage(msg: unknown, transfer?: Transferable[]) {
      sent.push({ msg: msg as FieldWorkerRequest, transfer });
    },
    terminate() {
      // fake worker: nothing to tear down
    },
  };
  return { worker, sent };
}

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

  test("mesh with sliceY caps the surface at the plane and drops kit above it", () => {
    const s = wallFixture();
    const run = (sliceY?: number) => {
      const aprons = extractFieldAprons(s, chunkKey(0, 0, 0));
      const posts = runHandler({
        kind: "mesh",
        jobId: 5,
        key: "0,0,0",
        density: aprons.density.buffer as ArrayBuffer,
        materials: aprons.materials.buffer as ArrayBuffer,
        table: TABLE,
        cellSize: s.cellSize,
        ...(sliceY === undefined ? {} : { sliceY }),
      });
      expect(posts.length).toBe(1);
      const msg = (posts[0] as (typeof posts)[0]).msg;
      if (msg.kind !== "meshed")
        throw new Error(`expected meshed, got ${msg.kind}`);
      return msg;
    };
    const SLICE_Y = 1.5;
    // Kit pieces sit within half a coarse cell (0.25 m) + proud offsets of
    // their cell centre — the band a surviving below-slice piece may reach into.
    const KIT_SLACK = 0.5;
    const cell = s.cellSize;
    const unsliced = run();
    const sliced = run(SLICE_Y);
    expect(unsliced.buckets.length).toBeGreaterThan(0);
    expect(sliced.buckets.length).toBeGreaterThan(0);
    // Capped: no sliced vertex above the plane (+ one cell of vertex slack)…
    expect(maxVertexY(unsliced.buckets)).toBeGreaterThan(SLICE_Y + cell);
    expect(maxVertexY(sliced.buckets)).toBeLessThanOrEqual(
      SLICE_Y + cell + 1e-6,
    );
    // …and a NONEMPTY cap: the sliced surface reaches the slice band.
    expect(maxVertexY(sliced.buckets)).toBeGreaterThan(SLICE_Y - cell - 1e-6);
    // SLICE_Y sits on a sample plane here, so the at/above clamp pins the cap
    // strictly at/below the plane (crossings live below the first air sample) —
    // an off-by-one ("strictly above") clamp would poke a cell past it.
    expect(maxVertexY(sliced.buckets)).toBeLessThanOrEqual(SLICE_Y + 1e-6);
    // Kit pieces derived from cells at/above the plane vanish.
    const above = (k: { position: [number, number, number] }) =>
      k.position[1] > SLICE_Y + KIT_SLACK;
    expect(unsliced.kit.some(above)).toBe(true);
    expect(sliced.kit.length).toBeGreaterThan(0);
    expect(sliced.kit.some(above)).toBe(false);
    expect(sliced.kit.length).toBeLessThan(unsliced.kit.length);
    // The MATERIAL half of the clamp: without MAT_ROCK above the plane, the
    // clamped wall top reads as suppressed kit (kit class + air) and grows
    // spurious rim collars at the slice rim — the fixture has none otherwise.
    const isRim = (k: { piece: string }) =>
      k.piece === "rimPostV" || k.piece === "rimEdgeH";
    expect(unsliced.kit.some(isRim)).toBe(false);
    expect(sliced.kit.some(isRim)).toBe(false);
  });

  test("stamp-preview evaluates the hall onto a scratch store and posts per-chunk buckets", () => {
    const posts = runStamp("hall");
    expect(posts.length).toBe(1);
    const first = posts[0] as (typeof posts)[0];
    expect(first.msg.kind).toBe("stamp-previewed");
    if (first.msg.kind === "stamp-previewed") {
      expect(first.msg.jobId).toBe(11);
      expect(first.msg.chunks.length).toBeGreaterThan(0);
      const buckets = first.msg.chunks.flatMap((c) => c.buckets);
      expect(buckets.length).toBeGreaterThan(0);
      expect(first.msg.opCount).toBeGreaterThan(2);
      expect(first.msg.evalMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("stamp-preview transfer list covers every bucket buffer of every chunk", () => {
    const posts = runStamp("hall");
    const first = posts[0] as (typeof posts)[0];
    expect(first.msg.kind).toBe("stamp-previewed");
    if (first.msg.kind === "stamp-previewed") {
      const bufs = first.msg.chunks.flatMap((c) =>
        c.buckets.flatMap((b) => [b.positions, b.normals, b.uvs, b.indices]),
      );
      expect(bufs.length).toBeGreaterThan(0);
      expect(first.transfer.length).toBe(bufs.length);
      for (const buf of bufs) expect(first.transfer).toContain(buf);
    }
  });

  test("stamp-preview remeshes allocated snapshot neighbours of the dirty set (the host halo rule)", () => {
    const solid = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
    const posts = runHandler({
      kind: "stamp-preview",
      jobId: 12,
      generator: "hall",
      params: HALL_PARAMS,
      seed: 42,
      region: HALL_REGION,
      policy: "replace",
      table: TABLE,
      cellSize: 0.25,
      // Allocated but never written by the stamp (the default hall's writes
      // stay in y-chunk 0): reachable only through the 26-neighbour halo.
      chunks: [
        {
          key: "0,1,0",
          density: solid.buffer as ArrayBuffer,
          materials: null,
        },
      ],
    });
    const first = posts[0] as (typeof posts)[0];
    expect(first.msg.kind).toBe("stamp-previewed");
    if (first.msg.kind === "stamp-previewed") {
      const keys = first.msg.chunks.map((c) => c.key);
      expect(keys).toContain("0,0,0");
      expect(keys).toContain("0,1,0");
    }
  });

  test("stamp-preview with an unknown generator posts mesh-error keyed by the generator id", () => {
    const posts = runStamp("nope");
    expect(posts.length).toBe(1);
    const msg = (posts[0] as (typeof posts)[0]).msg;
    expect(msg.kind).toBe("mesh-error");
    if (msg.kind === "mesh-error") {
      expect(msg.jobId).toBe(11);
      // Stamp errors have no chunk key — the generator id is the key sentinel.
      expect(msg.key).toBe("nope");
      expect(msg.message).toContain("unknown field generator");
    }
  });

  test("client stampPreview stamps a jobId, transfers density snapshots, resolves the response", async () => {
    const { worker, sent } = fakeWorker();
    const client = new FieldWorkerClient(() => worker);
    const density = new Int8Array(4096).buffer as ArrayBuffer;
    const promise = client.stampPreview({
      generator: "hall",
      params: HALL_PARAMS,
      seed: 1,
      region: HALL_REGION,
      policy: "replace",
      table: TABLE,
      cellSize: 0.25,
      chunks: [{ key: "0,0,0", density, materials: null }],
    });
    expect(sent.length).toBe(1);
    const first = sent[0] as (typeof sent)[0];
    expect(first.msg.kind).toBe("stamp-preview");
    expect(first.transfer).toEqual([density]);
    const reply: FieldWorkerResponse = {
      kind: "stamp-previewed",
      jobId: first.msg.jobId,
      chunks: [],
      opCount: 7,
      evalMs: 0.5,
    };
    worker.onmessage?.({ data: reply } as MessageEvent);
    const res = await promise;
    expect(res.kind).toBe("stamp-previewed");
    expect(res.opCount).toBe(7);
  });

  test("client mesh forwards sliceY to the worker request", () => {
    const { worker, sent } = fakeWorker();
    const client = new FieldWorkerClient(() => worker);
    const aprons = extractFieldAprons(createFieldStore(), chunkKey(0, 0, 0));
    void client.mesh("0,0,0", aprons, TABLE, 0.25, 1.5);
    expect(sent.length).toBe(1);
    const msg = (sent[0] as (typeof sent)[0]).msg;
    expect(msg.kind).toBe("mesh");
    if (msg.kind === "mesh") expect(msg.sliceY).toBe(1.5);
  });
});
