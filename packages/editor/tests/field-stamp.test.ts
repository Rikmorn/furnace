// The stamp session's pure transitions (supersession semantics) + the
// preview→commit determinism round: the SAME evaluate runs on the worker's
// scratch store (ghost) and in commitGenerator (commit), so the committed
// chunks must mesh byte-identically to the previewed ghost buckets.
import { describe, expect, test } from "bun:test";
import { nudgeRegion } from "../src/frontend/lib/field-brush.ts";
import type { FieldWorkerResponse } from "../src/frontend/lib/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/frontend/lib/field-protocol.ts";
import {
  createPreviewCoalescer,
  startReconfigureSession,
  startSession,
  toPreviewing,
  withParams,
  withPreviewError,
  withPreviewResult,
  withRegion,
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

  test("withRegion replaces the region, bumps run, clears result state", () => {
    const s0 = withPreviewResult(toPreviewing(fresh()), 0, 9);
    expect(s0).not.toBeNull();
    if (s0 === null) return;
    const s1 = withRegion(s0, { min: [1, 1, 1], max: [6, 5, 6] });
    expect(s1.region).toEqual({ min: [1, 1, 1], max: [6, 5, 6] });
    expect(s1.phase).toBe("configuring");
    expect(s1.run).toBe(1);
    expect(s1.opCount).toBeNull();
    expect(s1.error).toBeNull();
    // params/seed/policy/identity are untouched — only the placement moved.
    expect(s1.params).toEqual(DEFAULTS);
    expect(s1.seed).toBe(42);
    expect(s1.policy).toBe("replace");
    expect(s1.generator).toBe("hall");
  });

  test("a region nudge invalidates the in-flight preview", () => {
    const inFlight = toPreviewing(fresh()); // run 0 owns the in-flight job
    const nudged = withRegion(
      inFlight,
      nudgeRegion(inFlight.region, [1, 0, 0]),
    );
    expect(withPreviewResult(nudged, 0, 55)).toBeNull(); // run-0 reply: stale
    const live = withPreviewResult(toPreviewing(nudged), 1, 55);
    expect(live?.phase).toBe("ready");
  });

  test("ONE nudge press moves the region exactly one lattice step and bumps run", () => {
    // The host's composition: nudgeRegion (whole 0.5 m steps, both corners)
    // fed through withRegion (supersession).
    let s = fresh();
    s = withRegion(s, nudgeRegion(s.region, [0, 0, -1])); // ↑ = −Z
    expect(s.region).toEqual({ min: [0, 0, -0.5], max: [5, 4, 4.5] });
    expect(s.run).toBe(1);
    s = withRegion(s, nudgeRegion(s.region, [0, 1, 0])); // ⇧↑ = +Y
    expect(s.region).toEqual({ min: [0, 0.5, -0.5], max: [5, 4.5, 4.5] });
    expect(s.run).toBe(2);
    // The origin region is untouched — every press builds a fresh one.
    expect(REGION).toEqual({ min: [0, 0, 0], max: [5, 4, 5] });
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

  test("startSession opens in stamp mode with no entity", () => {
    const s = fresh();
    expect(s.mode).toBe("stamp");
    expect(s.entityId).toBeNull();
  });

  test("startReconfigureSession seeds from provenance and names its entity", () => {
    const s = startReconfigureSession({
      entityId: 12,
      generator: "hall",
      params: DEFAULTS,
      seed: 99,
      region: REGION,
      policy: "keep-existing-air",
    });
    expect(s.mode).toBe("reconfigure");
    expect(s.entityId).toBe(12);
    expect(s.params).toEqual(DEFAULTS);
    expect(s.seed).toBe(99);
    expect(s.region).toEqual(REGION);
    // The policy is the CALLER's (it is not recorded provenance), unlike a
    // fresh stamp which always opens at replace.
    expect(s.policy).toBe("keep-existing-air");
    // Same state machine otherwise: run 0, configuring, no flood truncation.
    expect(s.phase).toBe("configuring");
    expect(s.run).toBe(0);
    expect(s.truncatedSelection).toBe(false);
  });

  test("the transitions carry mode + entityId through unchanged", () => {
    const s0 = startReconfigureSession({
      entityId: 12,
      generator: "hall",
      params: DEFAULTS,
      seed: 99,
      region: REGION,
      policy: "replace",
    });
    const s1 = withParams(s0, { width: 12 }, 7, "keep-existing-air");
    const s2 = withRegion(toPreviewing(s1), { min: [1, 1, 1], max: [2, 2, 2] });
    const s3 = withPreviewResult(toPreviewing(s2), s2.run, 4);
    for (const s of [s1, s2, s3]) {
      expect(s?.mode).toBe("reconfigure");
      expect(s?.entityId).toBe(12);
    }
  });

  test("transitions never mutate their input session", () => {
    const s0 = fresh();
    const snapshot = structuredClone(s0);
    toPreviewing(s0);
    withParams(s0, { width: 9 }, 1, "keep-existing-air");
    withRegion(s0, { min: [9, 9, 9], max: [10, 10, 10] });
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

/** The hall's params, read through the SAME host seam the panel seeds its form
 *  from (listGenerators clones the registry's schema defaults). Deliberately
 *  NOT a literal: F3a added five params that are OPTIONAL on input so old saves
 *  survive, and a hand-written set silently stops covering every key it
 *  predates — the drift is invisible because absent still evaluates. Cloned per
 *  call, so a caller may spread over it freely. */
function hallParams(): Record<string, unknown> {
  const hall = createFieldHost()
    .listGenerators()
    .find((g) => g.id === "hall");
  if (hall === undefined)
    throw new Error("the hall generator is no longer in the registry");
  return hall.defaults;
}

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
    params: hallParams(),
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
    params: hallParams(),
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
    params: hallParams(),
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
  const session = toPreviewing(withParams(fresh(), hallParams(), 2, "replace"));
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

// ——— reconfigure (headless host: open → preview → apply) ———
//
// The host needs NO GPU for any of this: openEntity/applyReconfigure touch the
// store, the op log and the worker client only, and the ghost meshes are built
// behind an `if (ctx)` guard. What it DOES need is a worker, because openEntity
// fires a ghost preview and applyReconfigure is ready-phase only — so the suite
// installs a fake Worker global over the REAL protocol handler (the same
// handler the fake-client round above drives), which answers synchronously.

import type { BrushOp, DriftFinding, FieldOp } from "@furnace/core/field";
import {
  encodeChunkFile,
  encodeMaterialFile,
  logApply,
  serializeOps,
} from "@furnace/core/field";
import type { FieldWorkerRequest } from "../src/frontend/lib/field-protocol.ts";
import type { StampSession } from "../src/viewport-host/field-stamp.ts";

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** Installs a fake `Worker` global routing postMessage into the real field
 *  worker handler; returns the uninstall. Transfer lists are ignored (the host
 *  sends density COPIES, so nothing is detached either way). */
function installFakeWorker(): () => void {
  const real = globalThis.Worker;
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    private readonly handle = createFieldWorkerHandler((msg) => {
      this.onmessage?.({ data: msg } as MessageEvent);
    });
    postMessage(msg: unknown): void {
      this.handle(msg as FieldWorkerRequest);
    }
    terminate(): void {
      // fake worker: nothing to tear down
    }
  }
  // Boundary cast: the host spawns through the DOM Worker constructor; the fake
  // implements the WorkerLike subset field-client.ts actually calls.
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  return () => {
    globalThis.Worker = real;
  };
}

/** Flush the preview promise chain (the fake worker answers synchronously; the
 *  client still resolves through microtasks). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** A world holding ONE committed hall, built with core and handed to the host
 *  through loadWorld — the only way to reach a committed entity headlessly
 *  (host.startStamp needs a pointer-driven selection). */
function loadCommittedHall(host: ReturnType<typeof createFieldHost>): {
  entityId: number;
  params: Record<string, unknown>;
  ops: FieldOp[];
} {
  const store = createFieldStore();
  const log = createOpLog();
  const params = hallParams();
  const { entity } = commitGenerator(store, log, generatorById("hall"), {
    params,
    seed: 7,
    region: REGION,
    policy: "replace",
    table: TABLE,
  });
  host.setMaterialTable(TABLE); // stamps need the kit class
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [...store.chunks].map(([key, density]) => ({
      key,
      bytes: encodeChunkFile(density),
    })),
    materials: [...store.materials].map(([key, m]) => ({
      key,
      bytes: encodeMaterialFile(m),
    })),
    oplog: serializeOps(log.ops),
  });
  return { entityId: entity.entityId, params, ops: log.ops };
}

test("openEntity seeds a reconfigure session from provenance; applyReconfigure rewrites the entity in place", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId, params } = loadCommittedHall(host);
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));
    const ticks: number[] = [];
    host.subscribeEntities(() => ticks.push(host.listEntities().length));

    host.openEntity(entityId);
    await settle();
    const opened = sessions.at(-1);
    expect(opened?.mode).toBe("reconfigure");
    expect(opened?.entityId).toBe(entityId);
    expect(opened?.generator).toBe("hall");
    expect(opened?.params).toEqual(params); // recorded provenance, not defaults
    expect(opened?.seed).toBe(7);
    expect(opened?.region).toEqual(REGION);
    // The ghost settled, so Apply is live.
    expect(opened?.phase).toBe("ready");
    expect(opened?.opCount).toBeGreaterThan(0);

    // Re-parameterize (the form's onUpdate) and re-preview.
    host.updateStamp({ ...params, width: 12 }, 7, "replace");
    await settle();
    expect(sessions.at(-1)?.phase).toBe("ready");

    host.applyReconfigure();
    const after = host.listEntities();
    expect(after).toHaveLength(1); // reconfigure REPLACES, never appends
    expect(after[0]?.entityId).toBe(entityId); // the id survives
    expect(after[0]?.params).toEqual({ ...params, width: 12 });
    // The session ended and the entity tick fired for the change.
    expect(sessions.at(-1)).toBeNull();
    expect(ticks.length).toBeGreaterThan(1);
  } finally {
    uninstall();
  }
});

test("openEntity refuses a frozen entity — no session, an explained tool error", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId } = loadCommittedHall(host);
    const errors: string[] = [];
    host.subscribeToolError((m) => errors.push(m));
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));
    let ticks = 0;
    host.subscribeEntities(() => {
      ticks++;
    });
    const ticksAfterSubscribe = ticks;

    host.setEntityFrozen(entityId, true);
    // Freeze dirties NO chunk — the tick is the only signal it happened.
    expect(ticks).toBe(ticksAfterSubscribe + 1);
    expect(host.listEntities()[0]?.frozen).toBe(true);

    host.openEntity(entityId);
    await settle();
    expect(errors).toEqual([
      `entity ${entityId} is frozen — unfreeze it to edit`,
    ]);
    expect(sessions).toEqual([null]); // only the initial subscribe push

    // Unfreezing DELETES the flag (absent is the only spelling of "not frozen")
    // and re-enables the open.
    host.setEntityFrozen(entityId, false);
    expect(host.listEntities()[0]?.frozen).toBeUndefined();
    host.openEntity(entityId);
    await settle();
    expect(sessions.at(-1)?.mode).toBe("reconfigure");

    // Freezing the entity a session is OPEN on ends that session: the list sits
    // beside the reconfigure card, so this is one click away, and core would
    // refuse the Apply it was offering.
    host.setEntityFrozen(entityId, true);
    expect(sessions.at(-1)).toBeNull();
  } finally {
    uninstall();
  }
});

test("commitStamp refuses a reconfigure session — it would append a SECOND entity", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId } = loadCommittedHall(host);
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));

    host.openEntity(entityId);
    await settle();
    expect(sessions.at(-1)?.phase).toBe("ready"); // the commit gate is OPEN

    // The wrong verb for this session: a stamp commit here would run
    // commitGenerator and leave two entities over one region.
    host.commitStamp();
    expect(host.listEntities()).toHaveLength(1);
    expect(sessions.at(-1)?.mode).toBe("reconfigure"); // the session survives

    // The right verb still lands.
    host.applyReconfigure();
    expect(host.listEntities()).toHaveLength(1);
    expect(sessions.at(-1)).toBeNull();
  } finally {
    uninstall();
  }
});

test("bakeEntity severs the recipe, cancels a live session on it, and refuses a second bake", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId } = loadCommittedHall(host);
    const errors: string[] = [];
    host.subscribeToolError((m) => errors.push(m));
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));

    host.openEntity(entityId);
    await settle();
    expect(sessions.at(-1)?.mode).toBe("reconfigure");

    host.bakeEntity(entityId);
    expect(host.listEntities()[0]?.baked).toBe(true);
    // The live session could never land — it is cancelled, not left dangling.
    expect(sessions.at(-1)).toBeNull();

    host.openEntity(entityId);
    await settle();
    expect(errors).toEqual([
      `entity ${entityId} is baked — its recipe was severed`,
    ]);
    // A second bake is a category error core refuses, surfaced not swallowed.
    host.bakeEntity(entityId);
    expect(errors.at(-1)).toMatch(/already baked/);
  } finally {
    uninstall();
  }
});

test("applyReconfigure before the ghost settles is a no-op (and a no-op with no session)", async () => {
  // The mode half of the guard is NOT exercised here and cannot be headlessly:
  // reaching a ready STAMP session needs startStamp, which needs a pointer-made
  // selection. It is also defensive today — a stamp session carries
  // `entityId: null`, which the same guard line already catches — and the
  // reachable half (commitStamp on a reconfigure session) has its own test.
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId, ops } = loadCommittedHall(host);
    const committedSpan = (ops.at(-1) as { entity: GeneratorEntity }).entity
      .opSpan;
    // No session at all.
    expect(() => host.applyReconfigure()).not.toThrow();
    expect(host.listEntities()[0]?.opSpan).toEqual(committedSpan);

    // A session whose ghost has NOT settled: open it, then CHANGE a param so a
    // wrongly-landing apply would be visible. Applying here would write params
    // the user has not seen evaluated.
    host.openEntity(entityId);
    host.updateStamp({ ...hallParams(), width: 20 }, 7, "replace");
    host.applyReconfigure(); // phase is `previewing` — swallowed
    await settle();
    // Two independent witnesses, because the params alone are not enough: a
    // session opened from provenance holds the SAME params it would write back,
    // so an apply that wrongly lands is invisible in `params` unless they were
    // changed first (they were), and invisible in `opSpan` never — every apply
    // takes a FRESH span from log.nextId.
    expect(host.listEntities()[0]?.params).toEqual(hallParams());
    expect(host.listEntities()[0]?.opSpan).toEqual(committedSpan);

    // The session itself is intact and now ready — the apply was swallowed, not
    // consumed — so the same call lands once the ghost has settled.
    host.applyReconfigure();
    expect(host.listEntities()[0]?.params).toEqual({
      ...hallParams(),
      width: 20,
    });
    expect(host.listEntities()[0]?.opSpan).not.toEqual(committedSpan);
  } finally {
    uninstall();
  }
});

// NOT asserted here (no seam): the same step rebuilds the entity-highlight box,
// which is host-private CPU state ({vertices, colors} from aabbEdgeBatch) with
// no reader. Verified by construction — stepHistory calls
// rebuildEntityHighlight, the one function that owns it.
test("undo/redo step the field's history: the entity is restored and the panel is ticked", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId, params, ops } = loadCommittedHall(host);
    const committedSpan = (ops.at(-1) as { entity: GeneratorEntity }).entity
      .opSpan;
    let ticks = 0;
    host.subscribeEntities(() => {
      ticks++;
    });

    // Reconfigure to a WIDER hall, which also moves the recorded region…
    host.openEntity(entityId);
    await settle();
    host.updateStamp({ ...params, width: 20 }, 7, "replace");
    await settle();
    host.applyReconfigure();
    const reconfigured = host.listEntities()[0];
    expect(reconfigured?.params).toEqual({ ...params, width: 20 });
    expect(reconfigured?.opSpan).not.toEqual(committedSpan); // a fresh span
    const ticksAfterApply = ticks;

    // …and ⌘Z puts every part of it back under ONE step.
    host.undo();
    const restored = host.listEntities()[0];
    expect(restored?.params).toEqual(params);
    // The span the COMMIT wrote, not the fresh one the apply took: undo
    // restores the spliced-out ops, it does not re-evaluate.
    expect(restored?.opSpan).toEqual(committedSpan);
    expect(restored?.entityId).toBe(entityId); // the id never moves
    // The tick is the panel's ONLY signal here — an entity-record step can
    // dirty nothing at all, so no remesh follows it.
    expect(ticks).toBe(ticksAfterApply + 1);

    // ⇧⌘Z re-applies it.
    host.redo();
    expect(host.listEntities()[0]?.params).toEqual({ ...params, width: 20 });
    expect(ticks).toBe(ticksAfterApply + 2);
  } finally {
    uninstall();
  }
});

// No fake worker here on purpose: nothing in this flow previews, so nothing
// spawns one — freeze and its undo touch the log alone.
test("a freeze/unfreeze step ticks the panel even though it dirties NO chunk", () => {
  const host = createFieldHost();
  const { entityId } = loadCommittedHall(host);
  let ticks = 0;
  host.subscribeEntities(() => {
    ticks++;
  });
  host.setEntityFrozen(entityId, true);
  expect(host.listEntities()[0]?.frozen).toBe(true);
  const ticksAfterFreeze = ticks;

  // The undo entry for a freeze carries an EMPTY dirty set, so nothing
  // remeshes and the tick is the only way the badge can ever come off.
  host.undo();
  expect(host.listEntities()[0]?.frozen).toBeUndefined();
  expect(ticks).toBe(ticksAfterFreeze + 1);
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

// The try in applyReconfigureSession wraps the core call and nothing else, so a
// failure in the post-success work — most plausibly a SUBSCRIBER, which Task 9
// wires to subscribeDrift — cannot be reported as a reconfigure failure. This
// bites: widening the try back over notifyDrift makes it fail.
test("a throwing drift subscriber cannot make a landed apply report as failed", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId, params } = loadCommittedHall(host);
    const errors: string[] = [];
    host.subscribeToolError((m) => errors.push(m));
    let pushes = 0;
    host.subscribeDrift(() => {
      // Not on the initial subscribe push — only on the apply's.
      if (pushes++ > 0) throw new Error("subscriber blew up");
    });
    host.openEntity(entityId);
    await settle();
    host.updateStamp({ ...params, width: 12 }, 7, "replace");
    await settle();
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((x) => sessions.push(x));

    // The subscriber's throw propagates — it is the subscriber's bug and the
    // host does not swallow it…
    expect(() => host.applyReconfigure()).toThrow("subscriber blew up");
    // …but the apply LANDED, and was not reported as a failure.
    expect(host.listEntities()[0]?.params).toEqual({ ...params, width: 12 });
    expect(errors).toEqual([]);
    // …and the session teardown reached the panel BEFORE drift did, so the
    // chrome is never left showing a card for a session that already applied.
    expect(sessions.at(-1)).toBeNull();
  } finally {
    uninstall();
  }
});

// The drift REPORT itself (Task 9's meter/list feed), driven through the host:
// the core reconfigure suite's proven recipe (a downstream dig straddling the
// hall's depth-8 north shell → depth 12 turns that band into interior air, so
// the dig replays onto changed context and is reported drifted) reaches the
// panel through subscribeDrift. An 8-deep region gives the depth-12 hall room.
const DRIFT_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [8, 8, 8] as [number, number, number],
};
const DRIFT_DIG: BrushOp = {
  id: 0, // logApply assigns the real id
  kind: "brush",
  effect: "dig",
  shape: { kind: "sphere", center: [2, 2, 4.6], radius: 0.8 },
};
const lastOpId = (ops: FieldOp[]): number => {
  const id = ops.at(-1)?.id;
  if (id === undefined) throw new Error("test: the log is empty");
  return id;
};

test("a drift-producing reconfigure pushes non-empty findings to subscribeDrift", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    // Build the committed hall + the overlapping downstream dig with core, then
    // hand the whole log to the host through loadWorld (the headless route to a
    // committed entity with real downstream history).
    const store = createFieldStore();
    const log = createOpLog();
    const params = hallParams();
    const { entity } = commitGenerator(store, log, generatorById("hall"), {
      params,
      seed: 7,
      region: DRIFT_REGION,
      policy: "replace",
      table: TABLE,
    });
    logApply(store, log, DRIFT_DIG, TABLE);
    const digId = lastOpId(log.ops);
    host.setMaterialTable(TABLE);
    host.loadWorld({
      manifest: MANIFEST,
      chunks: [...store.chunks].map(([key, density]) => ({
        key,
        bytes: encodeChunkFile(density),
      })),
      materials: [...store.materials].map(([key, m]) => ({
        key,
        bytes: encodeMaterialFile(m),
      })),
      oplog: serializeOps(log.ops),
    });

    const reports: (DriftFinding[] | null)[] = [];
    host.subscribeDrift((r) => reports.push(r));
    // The subscribe push is null — no reconfigure has run yet.
    expect(reports).toEqual([null]);

    host.openEntity(entity.entityId);
    await settle();
    host.updateStamp({ ...params, depth: 12 }, 7, "replace");
    await settle();
    host.applyReconfigure();

    const report = reports.at(-1);
    expect(report).not.toBeNull();
    expect(report?.length).toBeGreaterThan(0);
    // The dig is drifted, and its finding carries the chunk-quantized location
    // the click-to-frame seam needs.
    const dig = report?.find((d) => d.opId === digId);
    expect(dig?.kind).toBe("drifted");
    expect(dig?.chunks.length).toBeGreaterThan(0);
  } finally {
    uninstall();
  }
});
