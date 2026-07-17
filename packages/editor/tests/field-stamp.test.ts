// The stamp session's pure transitions (supersession semantics) + the
// preview→commit determinism round: the SAME evaluate runs on the worker's
// scratch store (ghost) and in commitGenerator (commit), so the committed
// chunks must mesh byte-identically to the previewed ghost buckets.
import { describe, expect, test } from "bun:test";
import type { FieldWorkerResponse } from "../src/frontend/lib/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/frontend/lib/field-protocol.ts";
import {
  createPreviewCoalescer,
  startSession,
  toPreviewing,
  withParams,
  withPreviewError,
  withPreviewResult,
} from "../src/viewport-host/field-stamp.ts";

const REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [5, 4, 5] as [number, number, number],
};

const DEFAULTS: Record<string, unknown> = { width: 8, doorNorth: true };

const fresh = () => startSession("hall", DEFAULTS, REGION, 42, false);

describe("stamp session transitions", () => {
  test("startSession opens configuring at run 0 with the generator defaults", () => {
    const s = startSession("hall", DEFAULTS, REGION, 42, true);
    expect(s.generator).toBe("hall");
    expect(s.params).toEqual(DEFAULTS);
    expect(s.seed).toBe(42);
    expect(s.policy).toBe("replace");
    expect(s.region).toEqual(REGION);
    expect(s.phase).toBe("configuring");
    expect(s.run).toBe(0);
    expect(s.opCount).toBeNull();
    expect(s.error).toBeNull();
    expect(s.truncatedSelection).toBe(true);
  });

  test("withParams returns to configuring, bumps run, clears result state", () => {
    const s0 = withPreviewResult(toPreviewing(fresh()), 0, 9);
    expect(s0).not.toBeNull();
    if (s0 === null) return;
    const s1 = withParams(s0, { width: 12 }, 7, "keep-existing-air");
    expect(s1.phase).toBe("configuring");
    expect(s1.run).toBe(1);
    expect(s1.params).toEqual({ width: 12 });
    expect(s1.seed).toBe(7);
    expect(s1.policy).toBe("keep-existing-air");
    expect(s1.opCount).toBeNull();
    expect(s1.error).toBeNull();
    // session identity fields carry through
    expect(s1.generator).toBe("hall");
    expect(s1.region).toEqual(REGION);
    expect(s1.truncatedSelection).toBe(false);
  });

  test("toPreviewing marks the phase only", () => {
    const s = toPreviewing(fresh());
    expect(s.phase).toBe("previewing");
    expect(s.run).toBe(0);
    expect(s.opCount).toBeNull();
  });

  test("withPreviewResult on the live run lands ready with the op count", () => {
    const s = withPreviewResult(toPreviewing(fresh()), 0, 128);
    expect(s).not.toBeNull();
    if (s === null) return;
    expect(s.phase).toBe("ready");
    expect(s.opCount).toBe(128);
    expect(s.error).toBeNull();
  });

  test("a stale run's result is dropped (returns null)", () => {
    expect(withPreviewResult(toPreviewing(fresh()), 3, 128)).toBeNull();
  });

  test("a param change invalidates the in-flight preview", () => {
    const inFlight = toPreviewing(fresh()); // run 0 owns the in-flight job
    const changed = withParams(inFlight, { width: 10 }, 42, "replace"); // run 1
    expect(withPreviewResult(changed, 0, 55)).toBeNull(); // run-0 reply: stale
    const live = withPreviewResult(toPreviewing(changed), 1, 55);
    expect(live?.phase).toBe("ready");
  });

  test("withPreviewError on the live run returns to configuring carrying the message", () => {
    const s = withPreviewError(toPreviewing(fresh()), 0, "no kit class");
    expect(s).not.toBeNull();
    if (s === null) return;
    expect(s.phase).toBe("configuring");
    expect(s.error).toBe("no kit class");
    expect(s.opCount).toBeNull();
  });

  test("a stale run's error is dropped (returns null)", () => {
    expect(withPreviewError(toPreviewing(fresh()), 9, "late")).toBeNull();
  });

  test("transitions never mutate their input session", () => {
    const s0 = fresh();
    const snapshot = structuredClone(s0);
    toPreviewing(s0);
    withParams(s0, { width: 9 }, 1, "keep-existing-air");
    withPreviewResult(toPreviewing(s0), 0, 3);
    withPreviewError(toPreviewing(s0), 0, "x");
    expect(s0).toEqual(snapshot);
  });
});

// ——— preview→commit determinism (the fake-client handler round) ———

import type { FieldStore, MaterialTable } from "@furnace/core/field";
import {
  applyOp,
  cloneChunkMaterials,
  commitGenerator,
  createFieldStore,
  createOpLog,
  extractFieldAprons,
  generatorById,
  getDensity,
  meshChunkField,
} from "@furnace/core/field";
import { FieldWorkerClient } from "../src/frontend/lib/field-client.ts";

// 3-class fixture with a kit class (stamps require one) — mirrors the
// field-protocol test table.
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

/** A store with a pocket carved into the default hall's south-shell footprint
 *  — under keep-existing-air the carve must survive both preview and commit. */
function carvedStore(): FieldStore {
  const s = createFieldStore();
  applyOp(
    s,
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: {
        kind: "box",
        center: [2.5, 1.5, 0.25],
        halfExtents: [0.5, 0.5, 0.25],
      },
    },
    TABLE,
  );
  return s;
}

/** The host's snapshot shape: density COPIES + cloned materials for every
 *  allocated chunk (the fixture is small — all chunks sit in the region+halo). */
const snapshotOf = (s: FieldStore) =>
  [...s.chunks].map(([key, density]) => {
    const mats = s.materials.get(key);
    return {
      key,
      density: density.slice().buffer as ArrayBuffer,
      materials: mats === undefined ? null : cloneChunkMaterials(mats),
    };
  });

test("preview and commit run the SAME evaluate: committed chunks mesh byte-identically to the ghost", async () => {
  const store = carvedStore();

  // Path A — preview: the client drives the real handler through the fake-
  // worker seam (postMessage → handler → onmessage), snapshot COPIES in.
  const handler = createFieldWorkerHandler((msg) => {
    worker.onmessage?.({ data: msg } as MessageEvent);
  });
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage(msg: unknown) {
      handler(msg as Parameters<typeof handler>[0]);
    },
    terminate() {
      // fake worker: nothing to tear down
    },
  };
  const client = new FieldWorkerClient(() => worker);
  const preview = await client.stampPreview({
    generator: "hall",
    params: HALL_PARAMS,
    seed: 7,
    region: REGION,
    policy: "keep-existing-air",
    table: TABLE,
    cellSize: store.cellSize,
    chunks: snapshotOf(store),
  });
  expect(preview.chunks.length).toBeGreaterThan(0);

  // Path B — commit on the REAL store (untouched by the preview).
  const log = createOpLog();
  const { dirty, entity } = commitGenerator(store, log, generatorById("hall"), {
    params: HALL_PARAMS,
    seed: 7,
    region: REGION,
    policy: "keep-existing-air",
    table: TABLE,
  });

  // Same evaluate both ways: the ghost's op count is the commit's span length.
  expect(preview.opCount).toBe(entity.opSpan[1] - entity.opSpan[0] + 1);

  // keep-existing-air kept the carved pocket open through the commit (the
  // pocket centre voxel [10,6,1] sits inside the hall's south shell).
  expect(getDensity(store, 10, 6, 1)).toBeGreaterThan(0);

  // Every committed chunk was previewed, and its ghost buckets are byte-
  // identical to a remesh of the committed store.
  const byKey = new Map(preview.chunks.map((c) => [c.key, c.buckets]));
  for (const key of dirty) {
    const ghost = byKey.get(key);
    expect(ghost).toBeDefined();
    if (ghost === undefined) continue;
    const local = meshChunkField(
      extractFieldAprons(store, key),
      TABLE,
      store.cellSize,
    ).buckets;
    expect(ghost.length).toBe(local.length);
    for (let i = 0; i < local.length; i++) {
      const g = ghost[i] as (typeof ghost)[0];
      const l = local[i] as (typeof local)[0];
      expect(g.classId).toBe(l.classId);
      expect(g.backing).toBe(l.backing);
      expect(l.mesh.positions).toEqual(new Float32Array(g.positions));
      expect(l.mesh.normals).toEqual(new Float32Array(g.normals));
      expect(l.mesh.indices).toEqual(new Uint32Array(g.indices));
    }
  }
});

test("the handler round drops nothing: a stale response for a superseded run leaves the pending map clean", async () => {
  // The client resolves by jobId; a session-level stale run is the pure
  // module's job (withPreviewResult returns null) — this pins the two layers
  // apart: the client ALWAYS resolves a live jobId, the session decides.
  const posts: FieldWorkerResponse[] = [];
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage(msg: unknown) {
      posts.push(msg as never);
    },
    terminate() {
      // fake worker: nothing to tear down
    },
  };
  const client = new FieldWorkerClient(() => worker);
  const p = client.stampPreview({
    generator: "hall",
    params: HALL_PARAMS,
    seed: 1,
    region: REGION,
    policy: "replace",
    table: TABLE,
    cellSize: 0.25,
    chunks: [],
  });
  const sent = posts[0] as { jobId: number };
  worker.onmessage?.({
    data: {
      kind: "stamp-previewed",
      jobId: sent.jobId,
      chunks: [],
      opCount: 4,
      evalMs: 0,
    },
  } as MessageEvent);
  const res = await p;
  const session = toPreviewing(withParams(fresh(), HALL_PARAMS, 2, "replace"));
  // run 1 owns the live job; the resolved response carries run 0 → dropped.
  expect(withPreviewResult(session, 0, res.opCount)).toBeNull();
});

// ——— listEntities (headless host: entity ops from a loaded oplog) ———

import type { FieldManifest, GeneratorEntity } from "@furnace/core/field";
import { DEFAULT_CELL_SIZE } from "@furnace/core/field";
import { createFieldHost } from "../src/viewport-host/field-host.ts";

test("listEntities returns CLONED entity ops from a loaded oplog, brush ops filtered out", () => {
  const manifest: FieldManifest = {
    version: 2,
    kind: "field",
    cellSize: DEFAULT_CELL_SIZE,
    playerStart: [0, 0, 0],
    playerYaw: 0,
    chunks: [],
    meshes: [],
  };
  const entity: GeneratorEntity = {
    entityId: 3,
    type: "generator",
    generator: "hall",
    params: { width: 8 },
    seed: 5,
    region: { min: [0, 0, 0], max: [5, 4, 5] },
    opSpan: [1, 2],
  };
  const host = createFieldHost();
  host.loadWorld({
    manifest,
    chunks: [],
    oplog: JSON.stringify([
      {
        id: 1,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [1, 1, 1], radius: 0.5 },
      },
      { id: 3, kind: "entity", action: "place", entity },
    ]),
  });
  const list = host.listEntities();
  expect(list).toEqual([entity]);
  // Clones: mutating the returned record must never rewrite the log.
  (list[0] as GeneratorEntity).seed = 999;
  expect((host.listEntities()[0] as GeneratorEntity).seed).toBe(5);
});

// ——— preview coalescing (latest-wins in-flight latch) ———

describe("preview coalescer", () => {
  test("rapid requests while in flight collapse to exactly ONE queued re-fire", () => {
    let fires = 0;
    const c = createPreviewCoalescer(() => {
      fires++;
      return true;
    });
    c.request(); // idle → fires the in-flight job
    c.request(); // in flight → queued
    c.request(); // still ONE queued flag, not a queue
    expect(fires).toBe(1);
    c.settle(); // the queue collapses into a single re-fire
    expect(fires).toBe(2);
    c.settle(); // nothing queued — no fire
    expect(fires).toBe(2);
  });

  test("a declined fire releases the latch instead of wedging it", () => {
    let allow = false;
    let fires = 0;
    const c = createPreviewCoalescer(() => {
      fires++;
      return allow;
    });
    c.request(); // declined (no session) — must NOT stick in-flight
    expect(fires).toBe(1);
    allow = true;
    c.request(); // would queue forever if the declined fire wedged the latch
    expect(fires).toBe(2);
  });

  test("a queued re-fire that declines (session cancelled at settle) leaves the latch idle", () => {
    const results = [true, false];
    let fires = 0;
    const c = createPreviewCoalescer(() => results[fires++] ?? true);
    c.request(); // fires (true)
    c.request(); // queued
    c.settle(); // re-fire declines (session gone)
    expect(fires).toBe(2);
    c.request(); // latch must be idle again — fires immediately
    expect(fires).toBe(3);
  });
});
