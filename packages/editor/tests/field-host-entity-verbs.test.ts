// FieldHost's entity DELETE and DUPLICATE verbs (F4.5b Task 4), headless.
//
// Neither verb needs a GPU: both route straight to core (deleteGeneratorEntity /
// commitGenerator) over the host's own store + op log, and the only host state
// they move afterwards — the dirty set, the prop layer's instance counts, the
// entity selection — is decided before any upload (`rebuildProps` builds its
// groups and defers the draws behind an `if (ctx)`). The ONE case that needs a
// worker is the live-session cancel, because a reconfigure session only exists
// after `openEntity` fires a ghost preview; it borrows field-stamp.test.ts's
// fake-worker recipe.
//
// The world arrives through `loadWorld` for the reason field-stamp.test.ts
// states: it is the only headless route to a committed entity (a stamp session
// needs a pointer-made selection the host exposes no seam for), and it puts the
// same span + entity ops in the same log a commit would.
//
// HERE and not in `tests/viewport-host/`, which the plan named: that directory
// holds this slice's PURE module tests (field-pick, box-edges, camera-control…)
// and `bun test` runs `tests/chrome/` — which registers happy-dom and replaces
// `globalThis.navigator`/`crypto` — before any sibling subdirectory. Every other
// headless FieldHost suite (field-host-headless, field-host-load, field-stamp)
// is a `tests/` root file for that reason.
import { expect, test } from "bun:test";
import type {
  FieldManifest,
  FieldOp,
  MaterialTable,
} from "@furnace/core/field";
import {
  CHUNK_DIM,
  chunkKey,
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  encodeMaterialFile,
  generatorById,
  parseOps,
  serializeOps,
} from "@furnace/core/field";
import type { EntityCatalog } from "../src/frontend/lib/catalog.ts";
import type { FieldWorkerRequest } from "../src/frontend/lib/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/frontend/lib/field-protocol.ts";
import { generatorFootprint } from "../src/viewport-host/field-ghost.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** 3-class fixture with a kit class (every stamp requires one) — the
 *  field-stamp.test.ts / field-protocol.test.ts table, trimmed to what a hall
 *  and a scatter read. */
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

/** One archetype, enough for the scatter to place something. */
const ENTITY_CATALOG: EntityCatalog = {
  archetypes: [
    {
      id: "rock",
      name: "Rock",
      color: [0.45, 0.42, 0.4],
      collision: { kind: "box", halfExtents: [0.4, 0.35, 0.4] },
      scatter: { density: 0.3, minSpacing: 1, variants: 3 },
    },
  ],
};

const HALL_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [5, 4, 5] as [number, number, number],
};

/** A cave big enough that its floors reliably take props (field-stamp's figure). */
const CAVE_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [12, 8, 12] as [number, number, number],
};

const scatterParams = (): Record<string, unknown> => ({
  ...structuredClone(generatorById("scatter").defaults),
  density: 0.8,
});

/** What one core commit puts in the scratch world, so a caller can name the id. */
type Committed = { id: string; seed: number; region: typeof HALL_REGION };

/** Builds a world with CORE (one commit per entry) and hands the whole thing to
 *  `host` through loadWorld — the only headless route to a committed entity.
 *  Returns the entity ids in commit order plus the log the commits produced, so
 *  a test can read the span layout the host is about to splice. */
function loadWorld(
  host: ReturnType<typeof createFieldHost>,
  commits: readonly Committed[],
): { ids: number[]; ops: FieldOp[] } {
  const store = createFieldStore();
  const log = createOpLog();
  const ids = commits.map(
    (c) =>
      commitGenerator(store, log, generatorById(c.id), {
        params:
          c.id === "scatter"
            ? scatterParams()
            : structuredClone(generatorById(c.id).defaults),
        seed: c.seed,
        region: c.region,
        policy: "replace",
        table: TABLE,
      }).entity.entityId,
  );
  host.setMaterialTable(TABLE);
  host.setEntityCatalog(ENTITY_CATALOG);
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
  return { ids, ops: log.ops };
}

const HALL: Committed = { id: "hall", seed: 7, region: HALL_REGION };

/** The host's LIVE op log, read back through the baked artifact (field-stamp's
 *  `hostOps` — the host exposes no other window onto it). */
function hostOps(host: ReturnType<typeof createFieldHost>): FieldOp[] {
  const file = host
    .exportArtifact("probe")
    .find((f) => f.path === "worlds/probe/oplog.json");
  if (file === undefined || typeof file.contents !== "string")
    throw new Error("test: no oplog.json in the artifact");
  return parseOps(file.contents);
}

/** Installs a fake `Worker` over the REAL protocol handler (field-stamp.test.ts's
 *  recipe); returns the uninstall. */
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

// --- deleteEntity -----------------------------------------------------------

test("deleteEntity splices the entity out of the log and ticks the list", () => {
  const host = createFieldHost();
  const { ids, ops } = loadWorld(host, [HALL]);
  const entityId = ids[0] as number;
  let ticks = 0;
  host.subscribeEntities(() => ticks++);
  const before = ticks; // the subscribe's own catch-up tick

  host.deleteEntity(entityId);

  expect(host.listEntities()).toEqual([]);
  // The whole SPAN went, not just the entity op: core removes both, so the log
  // reads as though the hall had never been committed.
  expect(hostOps(host)).toEqual([]);
  expect(ops.length).toBeGreaterThan(1); // the span was real
  expect(ticks).toBe(before + 1);
});

test("⌘Z after a delete puts the whole entity back — ONE undo entry", () => {
  const host = createFieldHost();
  const { ids, ops } = loadWorld(host, [HALL]);
  const entityId = ids[0] as number;
  const recorded = host.listEntities()[0];

  host.deleteEntity(entityId);
  expect(host.listEntities()).toEqual([]);

  host.undo();
  // One step, not one-per-op: a delete that pushed an entry per spliced op would
  // leave the span half-restored here.
  expect(host.listEntities()).toEqual(recorded === undefined ? [] : [recorded]);
  expect(hostOps(host).length).toBe(ops.length);
});

// The empty-`dirty` contract, from the side that breaks it. A scatter's whole
// span is ONE placement op, which writes no cells — so core's delete returns an
// EMPTY dirty set while the props DO leave the log. A host that re-derived the
// prop layer only on a non-empty `dirty` would leave every deleted prop drawn.
test("deleting a scatter takes its props with it, though it dirties NO chunk", () => {
  const host = createFieldHost();
  const { ids } = loadWorld(host, [
    { id: "cave", seed: 5, region: CAVE_REGION },
    { id: "scatter", seed: 3, region: CAVE_REGION },
  ]);
  const scatterId = ids[1] as number;
  expect(host.propInstanceCounts().get("rock")).toBeGreaterThan(0);

  host.deleteEntity(scatterId);

  // Derived from the LOG, which no longer holds the placement op.
  expect(host.propInstanceCounts().size).toBe(0);
  expect(host.listEntities().map((e) => e.entityId)).toEqual([
    ids[0] as number,
  ]);
});

test("deleting the SELECTED entity clears the selection; deleting another leaves it", () => {
  const host = createFieldHost();
  const { ids } = loadWorld(host, [
    HALL,
    { id: "hall", seed: 8, region: { min: [20, 0, 0], max: [25, 4, 5] } },
  ]);
  const [first, second] = ids as [number, number];
  const pushes: (number | null)[] = [];
  host.subscribeEntitySelection((id) => pushes.push(id));
  host.selectEntity(second);
  expect(pushes).toEqual([null, second]);

  // A delete elsewhere in the log must not disturb the selection.
  host.deleteEntity(first);
  expect(pushes).toEqual([null, second]);

  // …and deleting the selected one has to clear it: a box left over an entity
  // that has left the log outlines nothing.
  host.deleteEntity(second);
  expect(pushes).toEqual([null, second, null]);
});

test("a frozen entity refuses deletion with CORE's own message on the tool-error seam", () => {
  const host = createFieldHost();
  const { ids } = loadWorld(host, [HALL]);
  const entityId = ids[0] as number;
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setEntityFrozen(entityId, true);

  host.deleteEntity(entityId);

  // Setup-loud core, runtime-visible editor: the throw has to REACH the seam,
  // not be swallowed into a console line.
  expect(errors).toEqual([
    `deleteGeneratorEntity: entity ${entityId} is frozen — unfreeze it to delete`,
  ]);
  expect(host.listEntities()).toHaveLength(1);

  // Unfreezing is the way through.
  host.setEntityFrozen(entityId, false);
  host.deleteEntity(entityId);
  expect(host.listEntities()).toEqual([]);
  expect(errors).toHaveLength(1);
});

test("a baked entity refuses deletion permanently, and says why", () => {
  const host = createFieldHost();
  const { ids } = loadWorld(host, [HALL]);
  const entityId = ids[0] as number;
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.bakeEntity(entityId);

  host.deleteEntity(entityId);

  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/^deleteGeneratorEntity: entity \d+ is baked\b/);
  expect(host.listEntities()).toHaveLength(1);
});

test("deleteEntity on an unknown id reports rather than throwing", () => {
  const host = createFieldHost();
  loadWorld(host, [HALL]);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));

  expect(() => host.deleteEntity(9999)).not.toThrow();
  expect(errors).toHaveLength(1);
  expect(host.listEntities()).toHaveLength(1);
});

test("deleting an entity with a live reconfigure session on it cancels that session first", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { ids } = loadWorld(host, [HALL]);
    const entityId = ids[0] as number;
    const sessions: (unknown | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));

    host.openEntity(entityId);
    await settle();
    expect(sessions.at(-1)).not.toBeNull();

    host.deleteEntity(entityId);
    // The setEntityFrozen/bakeEntity precedent: an Apply that can never land
    // must not be left on screen offering itself.
    expect(sessions.at(-1)).toBeNull();
    expect(host.listEntities()).toEqual([]);
  } finally {
    uninstall();
  }
});

// --- duplicateEntity --------------------------------------------------------

/** The +X shift the host is supposed to apply: the footprint's X extent snapped
 *  UP to the 0.5 m lattice, floored at one lattice step. The footprint itself is
 *  core's (pinned in core's own tests) — what this recomputes is the SNAP, so a
 *  host that shifted by the raw extent, or by the region's extent, is caught. */
const LATTICE_M = 0.5;
function expectedShift(ops: FieldOp[], entityId: number): number {
  const op = ops.find(
    (o) => o.kind === "entity" && o.entity.entityId === entityId,
  );
  if (op === undefined || op.kind !== "entity")
    throw new Error("test: no entity op for that id");
  const box =
    generatorFootprint(ops, op.entity, DEFAULT_CELL_SIZE) ?? op.entity.region;
  const extentX = box.max[0] - box.min[0];
  const shift = Math.max(LATTICE_M, Math.ceil(extentX / LATTICE_M) * LATTICE_M);
  // Independent of the footprint's value: the snap is UP, and onto the lattice.
  expect(shift).toBeGreaterThanOrEqual(extentX);
  expect(shift % LATTICE_M).toBe(0);
  return shift;
}

test("duplicateEntity commits a copy shifted +X clear of the original's footprint", () => {
  const host = createFieldHost();
  const { ids, ops } = loadWorld(host, [HALL]);
  const entityId = ids[0] as number;
  const original = host.listEntities()[0];
  if (original === undefined) throw new Error("test: no committed hall");

  host.duplicateEntity(entityId);

  const list = host.listEntities();
  expect(list).toHaveLength(2);
  const copy = list[1];
  if (copy === undefined) throw new Error("test: no copy");
  const shift = expectedShift(ops, entityId);
  expect(copy.region.min[0]).toBe(original.region.min[0] + shift);
  expect(copy.region.max[0]).toBe(original.region.max[0] + shift);
  // Only X moves — a duplicate is a step sideways, not a re-placement.
  expect(copy.region.min[1]).toBe(original.region.min[1]);
  expect(copy.region.min[2]).toBe(original.region.min[2]);
  expect(copy.region.max[1]).toBe(original.region.max[1]);
  expect(copy.region.max[2]).toBe(original.region.max[2]);
  // Same recipe, and a NEW entity — not the same record listed twice.
  expect(copy.generator).toBe(original.generator);
  expect(copy.params).toEqual(original.params);
  expect(copy.entityId).not.toBe(original.entityId);
});

// The snap-UP half of the shift rule, and it needs its own fixture: EVERY
// registry generator's footprint happens to land on the 0.5 m lattice already
// (a hall's spans whole cells, a sphere of radius 0.75 measures exactly 1.5), so
// against them `ceil(extent / 0.5) * 0.5` and a raw `extent` shift are the same
// number and a dropped snap is INVISIBLE — the first version of this suite
// asserted the snap against a hall and could not go red for it. A hand-written
// span with an odd radius is the only shape that can observe it, so the case
// carries its own guard: if a future footprint change lands this on the lattice
// too, the `not.toBe(0)` fails loudly rather than quietly stopping testing
// anything.
test("the +X shift snaps UP: an off-lattice footprint still lands on the grid", () => {
  const host = createFieldHost();
  host.setMaterialTable(TABLE);
  const entityId = 2;
  const region = { min: [0, 0, 0], max: [5, 4, 5] } as const;
  const ops: FieldOp[] = [
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [3, 3, 3], radius: 0.7 },
    },
    {
      id: entityId,
      kind: "entity",
      action: "place",
      entity: {
        entityId,
        type: "generator",
        generator: "hall",
        params: structuredClone(generatorById("hall").defaults),
        seed: 7,
        region: {
          min: [...region.min] as [number, number, number],
          max: [...region.max] as [number, number, number],
        },
        opSpan: [1, 1],
      },
    },
  ];
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [],
    oplog: JSON.stringify(ops),
  });

  const extentX = 2 * 0.7; // the sphere's own bounds — its diameter
  expect(extentX % LATTICE_M).not.toBe(0); // the case has teeth only while this holds
  const snapped = Math.ceil(extentX / LATTICE_M) * LATTICE_M;
  expect(snapped).toBeGreaterThan(extentX);

  host.duplicateEntity(entityId);

  const copy = host.listEntities()[1];
  if (copy === undefined) throw new Error("test: no copy");
  expect(copy.region.min[0]).toBeCloseTo(region.min[0] + snapped, 10);
  // …and the copy's own min lands ON the lattice, which is the point of snapping
  // rather than merely clearing.
  expect(copy.region.min[0] % LATTICE_M).toBe(0);
});

test("the copy becomes the selected entity", () => {
  const host = createFieldHost();
  const { ids } = loadWorld(host, [HALL]);
  const pushes: (number | null)[] = [];
  host.subscribeEntitySelection((id) => pushes.push(id));

  host.duplicateEntity(ids[0] as number);

  const copyId = host.listEntities()[1]?.entityId;
  expect(copyId).toBeDefined();
  expect(pushes).toEqual([null, copyId as number]);
});

test("duplicateEntity is ONE undo step", () => {
  const host = createFieldHost();
  const { ids, ops } = loadWorld(host, [HALL]);

  host.duplicateEntity(ids[0] as number);
  expect(host.listEntities()).toHaveLength(2);

  host.undo();
  // A commit that pushed an entry per op would leave half a copy standing here.
  expect(host.listEntities().map((e) => e.entityId)).toEqual([
    ids[0] as number,
  ]);
  expect(hostOps(host).length).toBe(ops.length);
});

// `usesSeed` (core, F4.5b Task 1) is what decides this, and the two answers are
// visible in the RECORD: a re-roll on a generator whose evaluate never reads the
// seed would leave two identical halls wearing different seed numbers, which is
// a row that lies about why they look alike.
test("a seeded generator's copy re-rolls; the hall's keeps its recorded seed", () => {
  const host = createFieldHost();
  const { ids } = loadWorld(host, [
    HALL,
    { id: "cave", seed: 5, region: CAVE_REGION },
  ]);
  const [hallId, caveId] = ids as [number, number];
  const stubbed = stubRandomSeed(4242);
  try {
    host.duplicateEntity(hallId);
    host.duplicateEntity(caveId);
  } finally {
    stubbed();
  }
  const byGenerator = new Map(
    host.listEntities().map((e) => [`${e.generator}:${e.entityId}`, e.seed]),
  );
  const seeds = [...byGenerator].map(([k, seed]) => ({ k, seed }));
  const halls = seeds.filter((s) => s.k.startsWith("hall:"));
  const caves = seeds.filter((s) => s.k.startsWith("cave:"));
  expect(halls.map((h) => h.seed)).toEqual([7, 7]); // usesSeed: false — inert
  expect(caves.map((c) => c.seed)).toEqual([5, 4242]); // usesSeed: true
});

/** Pin `randomStampSeed`'s only entropy source to `value`; returns the restore.
 *  The host reads ONE uint16 out of `crypto.getRandomValues`, so a stub makes
 *  the re-roll assertion deterministic instead of 1-in-65536 flaky. */
function stubRandomSeed(value: number): () => void {
  const real = crypto.getRandomValues;
  Object.defineProperty(crypto, "getRandomValues", {
    configurable: true,
    writable: true,
    value: <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint16Array) array[0] = value;
      return array;
    },
  });
  return () => {
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      writable: true,
      value: real,
    });
  };
}

// Neither flag blocks a duplicate, and that is a decision rather than an
// oversight: the copy is a FRESH commit from recorded provenance, not an edit of
// the protected record. Freeze guards this entity; bake severed this entity's
// recipe. Duplicating is how a baked stamp's recipe becomes live again.
test("a frozen or baked entity can still be duplicated, and the copy carries neither flag", () => {
  const host = createFieldHost();
  const { ids } = loadWorld(host, [
    HALL,
    { id: "hall", seed: 8, region: { min: [20, 0, 0], max: [25, 4, 5] } },
  ]);
  const [frozenId, bakedId] = ids as [number, number];
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setEntityFrozen(frozenId, true);
  host.bakeEntity(bakedId);

  host.duplicateEntity(frozenId);
  host.duplicateEntity(bakedId);

  expect(errors).toEqual([]);
  const copies = host.listEntities().slice(2);
  expect(copies).toHaveLength(2);
  for (const c of copies) {
    expect(c.frozen).toBeUndefined();
    expect(c.baked).toBeUndefined();
  }
});

test("duplicateEntity on an unknown id reports rather than throwing", () => {
  const host = createFieldHost();
  loadWorld(host, [HALL]);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));

  expect(() => host.duplicateEntity(9999)).not.toThrow();
  expect(errors).toHaveLength(1);
  expect(host.listEntities()).toHaveLength(1);
});

// --- footprintChunks: the row's Δ badge input --------------------------------

// The drift report addresses findings by CHUNK KEY, and the chrome cannot
// value-import core to quantize an AABB — so the host has to hand each row its
// footprint already in that space.
test("every entity row carries its footprint's chunk keys, in the drift report's space", () => {
  const host = createFieldHost();
  const { ops } = loadWorld(host, [HALL]);
  const info = host.listEntities()[0];
  if (info === undefined) throw new Error("test: no committed hall");

  const op = ops.find((o) => o.kind === "entity");
  if (op === undefined || op.kind !== "entity")
    throw new Error("test: no entity op");
  const box =
    generatorFootprint(ops, op.entity, DEFAULT_CELL_SIZE) ?? op.entity.region;
  const dim = CHUNK_DIM * DEFAULT_CELL_SIZE;
  const corner = chunkKey(
    Math.floor(box.min[0] / dim),
    Math.floor(box.min[1] / dim),
    Math.floor(box.min[2] / dim),
  );
  const far = chunkKey(
    Math.floor(box.max[0] / dim),
    Math.floor(box.max[1] / dim),
    Math.floor(box.max[2] / dim),
  );
  expect(info.footprintChunks).toContain(corner);
  expect(info.footprintChunks).toContain(far);
  // No duplicates — the badge does a set intersection over this.
  expect(new Set(info.footprintChunks).size).toBe(info.footprintChunks.length);
  // A copy per call, like every other field of the record.
  expect(host.listEntities()[0]?.footprintChunks).not.toBe(
    info.footprintChunks,
  );
});
