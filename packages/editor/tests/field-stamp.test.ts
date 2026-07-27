// The stamp session's pure transitions (supersession semantics) + the
// preview→commit determinism round: the SAME evaluate runs on the worker's
// scratch store (ghost) and in commitGenerator (commit), so the committed
// chunks must mesh byte-identically to the previewed ghost buckets.
import { describe, expect, test } from "bun:test";
import { nudgeRegion, spanCells } from "../src/frontend/lib/field-brush.ts";
import type { FieldWorkerResponse } from "../src/frontend/lib/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/frontend/lib/field-protocol.ts";
import { deriveSizeDefaults } from "../src/frontend/lib/field-size.ts";
import {
  createPreviewCoalescer,
  previewIsEmpty,
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
    const s0 = withPreviewResult(toPreviewing(fresh()), 0, 9, 0);
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
    const s0 = withPreviewResult(toPreviewing(fresh()), 0, 9, 0);
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
    expect(withPreviewResult(nudged, 0, 55, 0)).toBeNull(); // run-0 reply: stale
    const live = withPreviewResult(toPreviewing(nudged), 1, 55, 0);
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
    const s = withPreviewResult(toPreviewing(fresh()), 0, 128, 0);
    expect(s).not.toBeNull();
    if (s === null) return;
    expect(s.phase).toBe("ready");
    expect(s.opCount).toBe(128);
    expect(s.error).toBeNull();
  });

  test("a stale run's result is dropped (returns null)", () => {
    expect(withPreviewResult(toPreviewing(fresh()), 3, 128, 0)).toBeNull();
  });

  test("a param change invalidates the in-flight preview", () => {
    const inFlight = toPreviewing(fresh()); // run 0 owns the in-flight job
    const changed = withParams(inFlight, { width: 10 }, 42, "replace"); // run 1
    expect(withPreviewResult(changed, 0, 55, 0)).toBeNull(); // run-0 reply: stale
    const live = withPreviewResult(toPreviewing(changed), 1, 55, 0);
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
    const s3 = withPreviewResult(toPreviewing(s2), s2.run, 4, 0);
    for (const s of [s1, s2, s3]) {
      expect(s?.mode).toBe("reconfigure");
      expect(s?.entityId).toBe(12);
    }
  });

  test("previewIsEmpty is true only for a SETTLED preview that produced nothing", () => {
    // The predicate behind the host's editor-side commit refusal. Both counts
    // null (no preview yet, or one in flight) must read FALSE — refusing a
    // session that has not evaluated would block the very first Enter.
    expect(previewIsEmpty(fresh())).toBe(false);
    expect(previewIsEmpty(toPreviewing(fresh()))).toBe(false);
    const empty = withPreviewResult(toPreviewing(fresh()), 0, 0, 0);
    expect(empty === null ? null : previewIsEmpty(empty)).toBe(true);
    // Anything at all to commit — ops OR props — is not empty.
    const ops = withPreviewResult(toPreviewing(fresh()), 0, 7, 0);
    expect(ops === null ? null : previewIsEmpty(ops)).toBe(false);
    const props = withPreviewResult(toPreviewing(fresh()), 0, 0, 7);
    expect(props === null ? null : previewIsEmpty(props)).toBe(false);
    // An ERRORED preview clears both counts back to null, so it reads false too
    // (there is no valid ghost to commit — the phase gate catches that one).
    const errored = withPreviewError(toPreviewing(fresh()), 0, "boom");
    expect(errored === null ? null : previewIsEmpty(errored)).toBe(false);
  });

  test("transitions never mutate their input session", () => {
    const s0 = fresh();
    const snapshot = structuredClone(s0);
    toPreviewing(s0);
    withParams(s0, { width: 9 }, 1, "keep-existing-air");
    withRegion(s0, { min: [9, 9, 9], max: [10, 10, 10] });
    withPreviewResult(toPreviewing(s0), 0, 3, 0);
    withPreviewError(toPreviewing(s0), 0, "x");
    expect(s0).toEqual(snapshot);
  });
});

// ——— selection-derived stamp size defaults (spec D-F3-13, Task 10) ———
//
// The pure derivation is tested directly, against the REAL generator schema
// bounds (read the same clone seam the host does) so the clamp cases stay
// single-sourced to core: a schema-bound change moves both the production
// behaviour and the expected value here together. The startStamp WIRING (snap →
// spanCells → deriveSizeDefaults → session params) is NOT exercised here — it
// needs a pointer-made selection, which the headless host exposes no seam for
// (the same limit the reconfigure suite notes); it is verified by construction.

/** The real schema `properties` map for a generator, the derivation's clamp
 *  source. Cast: paramSchema is typed Record<string, unknown> at the core edge. */
const schemaProps = (id: string): Record<string, unknown> =>
  generatorById(id).paramSchema["properties"] as Record<string, unknown>;

describe("deriveSizeDefaults (selection-fit stamp size defaults)", () => {
  test("hall seeds width/height/depth = extent − 2 cells, clamped to schema", () => {
    // A 12×8×20 m selection = [24, 16, 40] coarse cells. width fits in-range;
    // height (16−2=14 → 12) and depth (40−2=38 → 32) clamp DOWN to the schema.
    expect(
      deriveSizeDefaults("hall", [24, 16, 40], schemaProps("hall"), 5),
    ).toEqual({ width: 22, height: 12, depth: 32 });
  });

  test("maze seeds the largest cell fit floor((extent − 1) / pitch), clamped", () => {
    // Same [24, 16, 40] selection at the REAL pitch. This pins the maze-formula
    // CORRECTION: the fitting inverse of the footprint pitch·cells+1 is
    // floor((extent−1)/pitch), NOT the plan's floor((extent+1)/pitch).
    //   x: floor((24−1)/5) = 4  (footprint 5·4+1 = 21 ≤ 24 fits; 5 → 26 overflows)
    //   z: floor((40−1)/5) = 7  (footprint 5·7+1 = 36 ≤ 40)
    const derived = deriveSizeDefaults(
      "maze",
      [24, 16, 40],
      schemaProps("maze"),
      MAZE_PITCH_CELLS,
    );
    expect(derived).toEqual({ cellsX: 4, cellsZ: 7 });
    // The fitted maze's footprint (pitch·cells + 1) never exceeds the extent:
    // x = 5·4+1 = 21 ≤ 24, z = 5·7+1 = 36 ≤ 40.
    expect(MAZE_PITCH_CELLS * 4 + 1).toBeLessThanOrEqual(24);
    expect(MAZE_PITCH_CELLS * 7 + 1).toBeLessThanOrEqual(40);
    // The plan's +1 formula would have overflowed the X extent (5·5+1 = 26 > 24).
    expect(MAZE_PITCH_CELLS * Math.floor((24 + 1) / 5) + 1).toBeGreaterThan(24);
  });

  test("out-of-range extents CLAMP up rather than throw (a 1 m selection)", () => {
    // [2, 2, 2] cells → every derived interior underflows the schema minimum.
    expect(() =>
      deriveSizeDefaults("hall", [2, 2, 2], schemaProps("hall"), 5),
    ).not.toThrow();
    expect(
      deriveSizeDefaults("hall", [2, 2, 2], schemaProps("hall"), 5),
    ).toEqual({ width: 4, height: 6, depth: 4 });
    expect(
      deriveSizeDefaults(
        "maze",
        [2, 2, 2],
        schemaProps("maze"),
        MAZE_PITCH_CELLS,
      ),
    ).toEqual({ cellsX: 2, cellsZ: 2 }); // floor(1/5)=0 → clamps to min 2
  });

  test("huge extents clamp DOWN to the schema maximum", () => {
    expect(
      deriveSizeDefaults("hall", [200, 200, 200], schemaProps("hall"), 5),
    ).toEqual({ width: 24, height: 12, depth: 32 });
    expect(
      deriveSizeDefaults(
        "maze",
        [200, 200, 200],
        schemaProps("maze"),
        MAZE_PITCH_CELLS,
      ),
    ).toEqual({ cellsX: 8, cellsZ: 8 });
  });

  test("the maze fit is exact at a footprint-aligned extent", () => {
    // extent 26 = pitch·5 + 1 exactly → 5 cells fit; 25 drops to 4.
    const at = (n: number) =>
      deriveSizeDefaults("maze", [n, 16, n], schemaProps("maze"), 5)["cellsX"];
    expect(at(26)).toBe(5);
    expect(at(25)).toBe(4);
  });

  test("MAZE_PITCH_CELLS is the exported pitch the derivation inverts", () => {
    expect(MAZE_PITCH_CELLS).toBe(5); // PASSAGE_CELLS 4 + 1 wall band
  });

  test("a generator with no derivable size params seeds nothing", () => {
    expect(deriveSizeDefaults("nonesuch", [10, 10, 10], {}, 5)).toEqual({});
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
  isBrushOp,
  MAZE_PITCH_CELLS,
  meshChunkField,
  opBounds,
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

// The editor's size-fit inverts core's FORWARD footprint (hall `dims+2`, maze
// `PITCH·cells+1`) but re-encodes the shell offsets editor-side; only the pitch
// is imported. Prose keeps them in sync, and the deriveSizeDefaults unit tests
// re-encode the `+1`/`+2` as their own literals — so if core's footprint formula
// ever changed, the derivation would silently start overflowing the selection
// with nothing red. This runs the REAL generator at the derived sizes and
// asserts the committed op footprint fits inside the selection box — a machine
// coupling that breaks (not the feature) if the two formulas drift apart. In-
// range extents only: the fit is the invariant just where clamp-up can't force
// a min-size stamp larger than a deliberately-undersized selection.
test("derived sizes commit to a real-generator footprint that fits the selection", () => {
  const cases: {
    id: string;
    region: { min: [number, number, number]; max: [number, number, number] };
  }[] = [
    // hall: extent [14, 10, 20] cells → width 12, height 8, depth 18 (in-range),
    // footprint = dims exactly = the selection. maze: extent [24, 10, 40] cells
    // → cellsX 4, cellsZ 7, footprint 21×36 coarse cells inside 24×40.
    { id: "hall", region: { min: [0, 0, 0], max: [7, 5, 10] } },
    { id: "maze", region: { min: [0, 0, 0], max: [12, 5, 20] } },
  ];
  const EPS = 1e-9;
  for (const { id, region } of cases) {
    const extentCells = [
      spanCells(region.min[0], region.max[0]),
      spanCells(region.min[1], region.max[1]),
      spanCells(region.min[2], region.max[2]),
    ] as const;
    const sizes = deriveSizeDefaults(
      id,
      extentCells,
      schemaProps(id),
      MAZE_PITCH_CELLS,
    );
    const store = createFieldStore();
    const log = createOpLog();
    const { entity } = commitGenerator(store, log, generatorById(id), {
      params: { ...generatorById(id).defaults, ...sizes },
      seed: 7,
      region,
      policy: "replace",
      table: TABLE,
    });
    // Union AABB of the committed brush span — core's actual emitted footprint.
    const bounds = [];
    for (const op of log.ops) {
      const inSpan = op.id >= entity.opSpan[0] && op.id <= entity.opSpan[1];
      if (inSpan && isBrushOp(op)) bounds.push(opBounds(op));
    }
    expect(bounds.length).toBeGreaterThan(0);
    for (const a of [0, 1, 2] as const) {
      const lo = Math.min(...bounds.map((b) => b.min[a]));
      const hi = Math.max(...bounds.map((b) => b.max[a]));
      expect(lo).toBeGreaterThanOrEqual(region.min[a] - EPS);
      expect(hi).toBeLessThanOrEqual(region.max[a] + EPS);
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
  expect(withPreviewResult(session, 0, res.opCount, 0)).toBeNull();
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
  // `placed` rides every record (F3b): empty here — this hall placed nothing.
  expect(list).toEqual([{ ...entity, placed: [] }]);
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
  CHUNK_DIM,
  encodeChunkFile,
  encodeMaterialFile,
  logApply,
  parseOps,
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

/** Build the committed hall + the overlapping downstream dig with core, then
 *  hand the whole log to the host through loadWorld (the headless route to a
 *  committed entity carrying real downstream history). Returns the ids a drift
 *  scenario needs. */
function loadDriftedWorld(host: ReturnType<typeof createFieldHost>): {
  entityId: number;
  digId: number;
  params: Record<string, unknown>;
} {
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
  return { entityId: entity.entityId, digId, params };
}

test("a drift-producing reconfigure pushes non-empty findings to subscribeDrift", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId, digId, params } = loadDriftedWorld(host);

    const reports: (DriftFinding[] | null)[] = [];
    host.subscribeDrift((r) => reports.push(r));
    // The subscribe push is null — no reconfigure has run yet.
    expect(reports).toEqual([null]);

    host.openEntity(entityId);
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

test("dismissDrift nulls the standing report and re-notifies subscribeDrift", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId, params } = loadDriftedWorld(host);
    const reports: (DriftFinding[] | null)[] = [];
    host.subscribeDrift((r) => reports.push(r));

    host.openEntity(entityId);
    await settle();
    host.updateStamp({ ...params, depth: 12 }, 7, "replace");
    await settle();
    host.applyReconfigure();
    // A real report is standing (guards the dismiss test against vacuity).
    expect(reports.at(-1)?.length).toBeGreaterThan(0);
    const pushesBefore = reports.length;

    host.dismissDrift();
    // It NULLED the report and RE-NOTIFIED — one more push, carrying null.
    expect(reports.length).toBe(pushesBefore + 1);
    expect(reports.at(-1)).toBeNull();
  } finally {
    uninstall();
  }
});

test("stepping history clears the standing drift report (F3a gate finding)", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { entityId, params } = loadDriftedWorld(host);
    const reports: (DriftFinding[] | null)[] = [];
    host.subscribeDrift((r) => reports.push(r));

    host.openEntity(entityId);
    await settle();
    host.updateStamp({ ...params, depth: 12 }, 7, "replace");
    await settle();
    host.applyReconfigure();
    expect(reports.at(-1)?.length).toBeGreaterThan(0);

    // ⌘Z rewinds the reconfigure the report describes — the report must go
    // with it (its findings name a replay the log no longer contains).
    host.undo();
    expect(reports.at(-1)).toBeNull();
    const pushesAfterUndo = reports.length;

    // Redo does NOT resurrect it: the report is cleared, never recomputed —
    // and an already-null report is not re-notified.
    host.redo();
    expect(reports.at(-1)).toBeNull();
    expect(reports.length).toBe(pushesAfterUndo);
  } finally {
    uninstall();
  }
});

// ——— frameChunks (headless: pose read back through the artifact manifest) ———
//
// The host exposes no direct camera-target seam, but exportArtifact bakes
// playerStart = cameraEye() into the manifest, and toEyeTarget makes the eye a
// FIXED spherical offset from the target (eye = target + distance·dir(yaw,pitch)
// — see camera-control.ts). frameChunks changes only the target, so the eye
// moves by exactly Δtarget: recovering the framed target from
// eyeAfter − eyeBefore + defaultTarget pins the centroid math without new host
// surface. defaultTarget is the host's documented initial orbit pivot.
const FIELD_DEFAULT_TARGET: [number, number, number] = [0, 1, 0];

/** Read cameraEye() back out of the artifact manifest (playerStart). */
function readCameraEye(
  host: ReturnType<typeof createFieldHost>,
): [number, number, number] {
  const files = host.exportArtifact("probe");
  const manifestFile = files.find(
    (f) => f.path === "worlds/probe/manifest.json",
  );
  if (manifestFile === undefined || typeof manifestFile.contents !== "string")
    throw new Error("test: no manifest.json in the artifact");
  return (
    JSON.parse(manifestFile.contents) as {
      playerStart: [number, number, number];
    }
  ).playerStart;
}

test("frameChunks re-points the orbit target to the chunk-set centroid", () => {
  const host = createFieldHost();
  const eyeBefore = readCameraEye(host); // target = FIELD_DEFAULT_TARGET
  host.frameChunks(["0,0,0", "1,0,0"]);
  const eyeAfter = readCameraEye(host); // target = the framed centroid

  // The eye is target + a fixed offset (distance/yaw/pitch unchanged), so the
  // framed target is eyeAfter − eyeBefore + defaultTarget.
  const recoveredTarget = [
    eyeAfter[0] - eyeBefore[0] + FIELD_DEFAULT_TARGET[0],
    eyeAfter[1] - eyeBefore[1] + FIELD_DEFAULT_TARGET[1],
    eyeAfter[2] - eyeBefore[2] + FIELD_DEFAULT_TARGET[2],
  ];
  // Centroid of the AABB over chunks (0,0,0)+(1,0,0): x ∈ [0, 2·dim], y,z ∈
  // [0, dim] → [dim, dim/2, dim/2]. The MAX corner is (c+1)·dim — computed here
  // from CHUNK_DIM·cellSize so the test pins that off-by-one.
  const dim = CHUNK_DIM * DEFAULT_CELL_SIZE;
  const expected = [dim, dim / 2, dim / 2];
  for (let i = 0; i < 3; i++)
    expect(recoveredTarget[i]).toBeCloseTo(expected[i] ?? 0, 6);
});

// ——— load-time compaction glue (spec D-F3-16) ———
//
// Core's compactRuns is well-covered; these pin the EDITOR glue: the
// > COMPACT_THRESHOLD_OPS direction, the after-resetWorld placement, and the
// defensive try/catch. Logs are built through the same serializeOps/parseOps
// path loadWorld actually uses.

/** A loadWorld payload of `n` consecutive foldable brush ops (one run), built
 *  with core so the chunks match the ops. `fill` ops carry `material` (so a
 *  fold's patch records that class); `dig` ops carry none. */
function buildBrushWorld(
  n: number,
  effect: "dig" | "fill",
  material: number,
): Parameters<ReturnType<typeof createFieldHost>["loadWorld"]>[0] {
  const store = createFieldStore();
  const log = createOpLog();
  for (let i = 0; i < n; i++) {
    const shape = {
      kind: "sphere" as const,
      center: [i * 0.5, 2, 2] as [number, number, number],
      radius: 0.6,
    };
    const op: BrushOp =
      effect === "fill"
        ? { id: 0, kind: "brush", effect: "fill", material, shape }
        : { id: 0, kind: "brush", effect: "dig", shape };
    logApply(store, log, op, TABLE);
  }
  return {
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
  };
}

/** Read log.ops length back out of the artifact (oplog.json = serializeOps of
 *  the CURRENT log — post-compaction after a load). */
function readOplogLength(host: ReturnType<typeof createFieldHost>): number {
  const files = host.exportArtifact("probe");
  const oplogFile = files.find((f) => f.path === "worlds/probe/oplog.json");
  if (oplogFile === undefined || typeof oplogFile.contents !== "string")
    throw new Error("test: no oplog.json in the artifact");
  return parseOps(oplogFile.contents).length;
}

// One over the threshold makes a single foldable run cross the gate.
const OVER_THRESHOLD_OPS = 201;
const UNDER_THRESHOLD_OPS = 50;

test("loadWorld folds a log above COMPACT_THRESHOLD_OPS (the log shrinks)", () => {
  const host = createFieldHost();
  host.loadWorld(buildBrushWorld(OVER_THRESHOLD_OPS, "dig", 0));
  // A run of 201 foldable ops (> 200) is compacted into far fewer.
  expect(readOplogLength(host)).toBeLessThan(OVER_THRESHOLD_OPS);
});

test("loadWorld leaves a log at/below the threshold uncompacted (the log is unchanged)", () => {
  const host = createFieldHost();
  host.loadWorld(buildBrushWorld(UNDER_THRESHOLD_OPS, "dig", 0));
  // 50 foldable ops (≤ 200) fall under the gate — every op is kept.
  expect(readOplogLength(host)).toBe(UNDER_THRESHOLD_OPS);
});

test("a load-time compaction that throws is caught: the world still loads and the skip reason surfaces", () => {
  const host = createFieldHost();
  // Fill ops recording class 1 (dirt), built with the 3-class TABLE, but loaded
  // into a host on the default rock-only BUILTIN_TABLE (no setMaterialTable):
  // the fold's patch carries a class id the table cannot resolve, so compactRuns
  // throws (verifyFold → assertPatchValid). loadWorld must swallow it.
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const world = buildBrushWorld(OVER_THRESHOLD_OPS, "fill", 1);
  // The load itself must not throw…
  expect(() => host.loadWorld(world)).not.toThrow();
  // …and the skip reason reached the status line (not swallowed silently).
  expect(errors.some((m) => /compaction/i.test(m))).toBe(true);
});

// ——— scatter authoring: catalog seeding, the ctx-threaded preview, the prop
// layer, prop drift, and the empty-result refusal (F3b Task 10) ———
//
// Everything below drives the REAL host headlessly: the fake worker over the
// real protocol handler answers previews, and worlds arrive through loadWorld.
// The prop layer's instance counts are read back through `propInstanceCounts()`,
// which is what `rebuildProps` decides and feeds to `createInstanced({count})`.
//
// COVERAGE BOUNDARY, stated rather than implied. loadWorld is the only headless
// route to a committed entity — a ready STAMP session needs a pointer-made
// selection the host exposes no seam for (the same limit the reconfigure suite
// notes at "applyReconfigure before the ghost settles"). So the rebuild that
// follows `commitStampSession` — the "stamp scatter → Enter → props appear"
// gesture — has NO automated coverage here; every other rebuild path does
// (load, reconfigure apply, ⌘Z/⇧⌘Z, newWorld, setEntityCatalog). The commit
// path is covered by gate checklist item 3, and building a headless selection
// seam for it is F4 cockpit-pass work, not a shortcut taken here.

import type { PlacementRecord } from "@furnace/core/field";
import type { EntityCatalog } from "../src/frontend/lib/catalog.ts";
import { groupPlacements } from "../src/viewport-host/field-placements.ts";
import type { FieldEntityInfo } from "../src/viewport-host/index.ts";

const CAVE_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [12, 8, 12] as [number, number, number],
};

/** Dense enough that the cave's floors reliably take props (the core
 *  reconfigure suite's figure). */
const scatterParams = (): Record<string, unknown> => ({
  ...structuredClone(generatorById("scatter").defaults),
  density: 0.8,
});

/** A catalog covering both dungeon archetypes, in the shape parseEntityCatalog
 *  produces (see catalog.test.ts, which parses the REAL file). */
const ENTITY_CATALOG: EntityCatalog = {
  archetypes: [
    {
      id: "rock",
      name: "Rock",
      color: [0.45, 0.42, 0.4],
      collision: { kind: "box", halfExtents: [0.4, 0.35, 0.4] },
      scatter: { density: 0.3, minSpacing: 1, variants: 3 },
    },
    {
      id: "stalagmite",
      name: "Stalagmite",
      color: [0.5, 0.48, 0.44],
      collision: { kind: "capsule", halfHeight: 0.5, radius: 0.22 },
      scatter: { density: 0.15, minSpacing: 1.4, variants: 2 },
    },
  ],
};

/** Build a cave + a scatter reading it with CORE, then hand the whole world to
 *  the host through loadWorld. `extraScatterSeed` appends a SECOND scatter of
 *  the same archetype over the same cave — the shape the world-wide prop-layer
 *  count cannot tell apart. Returns the entity ids (the second one null unless
 *  asked for) and the FIRST scatter's placement-record count. */
function loadCaveWithProps(
  host: ReturnType<typeof createFieldHost>,
  opts: { extraScatterSeed?: number } = {},
): {
  caveId: number;
  scatterId: number;
  secondScatterId: number | null;
  records: number;
} {
  const store = createFieldStore();
  const log = createOpLog();
  const cave = commitGenerator(store, log, generatorById("cave"), {
    params: structuredClone(generatorById("cave").defaults),
    seed: 5,
    region: CAVE_REGION,
    policy: "replace",
    table: TABLE,
  }).entity;
  const scatter = commitGenerator(store, log, generatorById("scatter"), {
    params: scatterParams(),
    seed: 3,
    region: CAVE_REGION,
    policy: "replace",
    table: TABLE,
  }).entity;
  const second =
    opts.extraScatterSeed === undefined
      ? null
      : commitGenerator(store, log, generatorById("scatter"), {
          params: scatterParams(),
          seed: opts.extraScatterSeed,
          region: CAVE_REGION,
          policy: "replace",
          table: TABLE,
        }).entity;
  // The FIRST placement op in the log — the first scatter's, whatever follows.
  const placement = log.ops.find((o) => o.kind === "placement");
  if (placement === undefined || placement.kind !== "placement")
    throw new Error("test: scatter committed no placement op");
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
  return {
    caveId: cave.entityId,
    scatterId: scatter.entityId,
    secondScatterId: second === null ? null : second.entityId,
    records: placement.records.length,
  };
}

/** The host's LIVE op log, read back through the baked artifact — the same
 *  source rebuildProps groups (readOplogLength's sibling). */
function hostOps(host: ReturnType<typeof createFieldHost>): FieldOp[] {
  const file = host
    .exportArtifact("probe")
    .find((f) => f.path === "worlds/probe/oplog.json");
  if (file === undefined || typeof file.contents !== "string")
    throw new Error("test: no oplog.json in the artifact");
  return parseOps(file.contents);
}

test("a cave + a scatter load as two entities, and the prop layer draws one instance per record", () => {
  const host = createFieldHost();
  const { records } = loadCaveWithProps(host);
  expect(records).toBeGreaterThan(0);

  const entities = host.listEntities();
  expect(entities.map((e) => e.generator)).toEqual(["cave", "scatter"]);

  // The LAYER, not the log: propInstanceCounts is what rebuildProps produced —
  // one instanced draw per archetype, its instance count the group's record
  // count. Reading the log instead would hold whether or not rebuildProps ran.
  expect([...host.propInstanceCounts()]).toEqual([["rock", records]]);
  // …and it agrees with the log the layer is derived FROM (the two can only
  // disagree if a rebuild was skipped).
  expect(groupPlacements(hostOps(host)).get("rock")).toHaveLength(records);
});

// ——— the entities list's prop rows (F3b Task 11) ———
//
// The row's two facts, both read off listEntities: WHICH archetype a stamp
// placed and HOW MANY. propInstanceCounts cannot answer either — it is
// world-wide, so two scatters of the same archetype are one number there.

test("listEntities carries each entity's OWN placements: the cave's row none, the scatter's its archetype + count", () => {
  const host = createFieldHost();
  const { caveId, scatterId, records } = loadCaveWithProps(host);
  const placedById = new Map(
    host.listEntities().map((e) => [e.entityId, e.placed]),
  );
  expect(placedById.get(scatterId)).toEqual([
    { archetypeId: "rock", count: records },
  ]);
  // A carver's row is EMPTY, not zeroed: the row shows no prop segment at all.
  expect(placedById.get(caveId)).toEqual([]);
  // The per-entity count agrees with the world-wide layer readback — the only
  // other place this number exists, and the two derive from the same log.
  expect(host.propInstanceCounts().get("rock")).toBe(records);
});

test("a second scatter of the SAME archetype gets its OWN row count (the world-wide layer number cannot tell them apart)", () => {
  const host = createFieldHost();
  const { scatterId, secondScatterId, records } = loadCaveWithProps(host, {
    extraScatterSeed: 9,
  });
  if (secondScatterId === null) throw new Error("test: no second scatter");
  const placedById = new Map(
    host.listEntities().map((e) => [e.entityId, e.placed]),
  );
  // The first scatter's row reads the count of ITS OWN span's records, not the
  // layer's total — this is what a row wired to propInstanceCounts would fail.
  expect(placedById.get(scatterId)).toEqual([
    { archetypeId: "rock", count: records },
  ]);
  const secondCount = placedById.get(secondScatterId)?.[0]?.count ?? 0;
  expect(secondCount).toBeGreaterThan(0);
  // …and the two rows account for the ONE number the prop layer draws.
  expect(host.propInstanceCounts().get("rock")).toBe(records + secondCount);
});

// THE FREE-NESS CHECK. A scatter is an ordinary GeneratorEntity, so F3a's
// reconfigure machinery is supposed to serve it with no scatter-specific seam:
// this drives the exact row gesture (Open → re-roll → Apply → ⌘Z) through the
// SAME host calls a hall row makes and asserts the record — not the prop layer,
// which the history-step test above already covers.
test("Open → re-roll → Apply on a SCATTER row rewrites the entity in place, and the row's count re-reads from the new span", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { scatterId, records } = loadCaveWithProps(host);
    let ticks = 0;
    host.subscribeEntities(() => {
      ticks++;
    });
    const row = (): FieldEntityInfo => {
      const found = host.listEntities().find((e) => e.entityId === scatterId);
      if (found === undefined) throw new Error("test: the scatter row is gone");
      return found;
    };
    const before = row();
    expect(before.placed).toEqual([{ archetypeId: "rock", count: records }]);
    const ticksAtOpen = ticks;

    host.openEntity(scatterId); // the row's Open button
    await settle();
    host.updateStamp(scatterParams(), 77, "replace"); // the ⚄ re-roll
    await settle();
    host.applyReconfigure(); // the session's Apply

    const after = row();
    expect(host.listEntities()).toHaveLength(2); // replaced, never appended
    expect(after.seed).toBe(77); // the re-roll landed in the record
    expect(after.opSpan).not.toEqual(before.opSpan); // re-cooked span, fresh ids
    expect(ticks).toBeGreaterThan(ticksAtOpen); // the list was told to re-read
    // The row's count came from the NEW span: one archetype still, and it equals
    // what the layer this same apply rebuilt is drawing (the cave is the only
    // other entity, and it places nothing).
    expect(after.placed).toHaveLength(1);
    expect(after.placed[0]?.archetypeId).toBe("rock");
    expect(after.placed[0]?.count).toBe(host.propInstanceCounts().get("rock"));

    // ⌘Z restores the recipe AND the count the row showed before.
    host.undo();
    expect(row().seed).toBe(3);
    expect(row().placed).toEqual([{ archetypeId: "rock", count: records }]);
  } finally {
    uninstall();
  }
});

test("a props-free world reports an empty prop layer; newWorld clears a populated one", () => {
  const host = createFieldHost();
  loadCaveWithProps(host);
  expect(host.propInstanceCounts().size).toBe(1);
  // newWorld drops the log, so the layer must go with it — otherwise the counts
  // describe a world that is gone.
  host.newWorld();
  expect(host.propInstanceCounts().size).toBe(0);
});

test("propInstanceCounts hands out a COPY (mutating it cannot rewrite the layer)", () => {
  const host = createFieldHost();
  const { records } = loadCaveWithProps(host);
  const counts = host.propInstanceCounts();
  counts.set("rock", 999);
  counts.set("intruder", 1);
  expect(host.propInstanceCounts()).toEqual(new Map([["rock", records]]));
});

// NOT asserted (no seam): that the host actually re-issues the instanced draws
// on a history step. The prop layer is GPU state with no readback, so what is
// pinned is its SOURCE — the log-derived grouping rebuildProps consumes — moving
// and coming back under one step. rebuildProps is called from stepHistory, the
// one function that owns it (the rebuildEntityHighlight precedent in this file).
test("a history step moves the prop layer's source: ⌘Z restores the previous records", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { scatterId } = loadCaveWithProps(host);
    const propsNow = (): PlacementRecord[] =>
      groupPlacements(hostOps(host)).get("rock") ?? [];
    const before = propsNow();
    expect(before.length).toBeGreaterThan(0);

    // A re-roll re-cooks the scatter against the same cave — new records under
    // ONE undo entry. A placement op dirties NO chunk, so nothing remeshes: the
    // prop layer is the only thing a ⌘Z can show here.
    host.openEntity(scatterId);
    await settle();
    host.updateStamp(scatterParams(), 77, "replace");
    await settle();
    host.applyReconfigure();
    expect(propsNow()).not.toEqual(before);
    // Apply's OWN rebuild — asserted here, immediately, and not left to the
    // undo/redo below: those each rebuild too, so they would mask an apply that
    // never rebuilt at all ("re-roll scatter → Apply → props re-seat").
    expect(host.propInstanceCounts().get("rock")).toBe(propsNow().length);

    host.undo();
    expect(propsNow()).toEqual(before);
    // The LAYER followed the step, not just the log behind it.
    expect(host.propInstanceCounts().get("rock")).toBe(before.length);
    host.redo();
    expect(propsNow()).not.toEqual(before);
    expect(host.propInstanceCounts().get("rock")).toBe(propsNow().length);
  } finally {
    uninstall();
  }
});

test("opening the scatter entity previews through a ctx-threaded evaluate (props, not an error)", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { scatterId, records } = loadCaveWithProps(host);
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));

    host.openEntity(scatterId);
    await settle();
    const opened = sessions.at(-1);
    // Without an EvaluateContext the worker's evaluate THROWS ("scatter:
    // evaluate requires an EvaluateContext") and the session lands in
    // `configuring` carrying that message — this is the assertion that pins the
    // preview's field access.
    expect(opened?.error).toBeNull();
    expect(opened?.phase).toBe("ready");
    // A pure reader emits no ops at all: props are its entire output.
    expect(opened?.opCount).toBe(0);
    expect(opened?.placementCount).toBe(records);
  } finally {
    uninstall();
  }
});

test("reconfiguring the CAVE reports the scatter's props as drifted (D-F3-4, in the chrome)", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { caveId, records } = loadCaveWithProps(host);
    const reports: (DriftFinding[] | null)[] = [];
    host.subscribeDrift((r) => reports.push(r));
    expect(reports).toEqual([null]);

    host.openEntity(caveId);
    await settle();
    // Re-roll the cave: its floors move out from under the props.
    host.updateStamp(
      structuredClone(generatorById("cave").defaults),
      9,
      "replace",
    );
    await settle();
    host.applyReconfigure();

    const report = reports.at(-1);
    expect(report?.length).toBeGreaterThan(0);
    // The placement op REPLAYS AS DATA (a cave reconfigure does not re-cook
    // scatter) — the records survive — but the props are flagged, with the
    // chunk-quantized locations the click-to-frame seam needs.
    expect(groupPlacements(hostOps(host)).get("rock")).toHaveLength(records);
    const placementId = hostOps(host).find((o) => o.kind === "placement")?.id;
    const finding = report?.find((d) => d.opId === placementId);
    expect(finding?.kind).toBe("drifted");
    expect(finding?.chunks.length ?? 0).toBeGreaterThan(0);
  } finally {
    uninstall();
  }
});

test("a scatter that places NOTHING is refused legibly — core never sees the empty commit", async () => {
  const uninstall = installFakeWorker();
  try {
    const host = createFieldHost();
    const { scatterId } = loadCaveWithProps(host);
    const errors: string[] = [];
    host.subscribeToolError((m) => errors.push(m));
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));
    const before = host.listEntities();

    host.openEntity(scatterId);
    await settle();
    // Move the region 50 m up into untouched solid rock: no rock→air crossing,
    // so the re-cook resolves zero surfaces and evaluates to {ops:[], placements:[]}.
    host.nudgeStamp(0, 100, 0);
    await settle();
    const empty = sessions.at(-1);
    expect(empty?.phase).toBe("ready"); // the PREVIEW succeeded — it found nothing
    expect(empty?.opCount).toBe(0);
    expect(empty?.placementCount).toBe(0);

    host.applyReconfigure();
    // The refusal is a sentence about props, not core's "evaluated to an empty
    // result" (which core would throw if this reached it).
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/placed no props/);
    expect(errors[0]).not.toMatch(/empty result/);
    // Nothing landed: the entity is untouched and the session stands to re-tune.
    expect(host.listEntities()).toEqual(before);
    expect(sessions.at(-1)?.mode).toBe("reconfigure");
  } finally {
    uninstall();
  }
});

test("the entity catalog fills archetypeId's picker options; without one the schema passes through", () => {
  const host = createFieldHost();
  const schemaOf = (id: string): Record<string, Record<string, unknown>> =>
    (host.listGenerators().find((g) => g.id === id)?.paramSchema[
      "properties"
    ] ?? {}) as Record<string, Record<string, unknown>>;

  // No catalog: free text, exactly the registry's own schema.
  expect(schemaOf("scatter")["archetypeId"]?.["enum"]).toBeUndefined();

  host.setEntityCatalog(ENTITY_CATALOG);
  expect(schemaOf("scatter")["archetypeId"]?.["enum"]).toEqual([
    "rock",
    "stalagmite",
  ]);
  // Only the archetype property learns anything — sibling generators are inert.
  expect(schemaOf("hall")["width"]?.["enum"]).toBeUndefined();

  // Uninstalling (a project whose catalog fetch 404s) returns it to free text.
  host.setEntityCatalog(null);
  expect(schemaOf("scatter")["archetypeId"]?.["enum"]).toBeUndefined();
});

/** A fake Worker that answers EVERY stamp preview with an empty result — the
 *  one way to put a CARVER session into the `0 ops, 0 props` state the
 *  editor-side refusal keys on. No carver reachable today can actually evaluate
 *  to nothing (hall/maze always emit their shell fill, the cave always emits its
 *  patch), so the worker seam is where that state has to come from. */
function installEmptyPreviewWorker(): () => void {
  const real = globalThis.Worker;
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage(msg: unknown): void {
      const req = msg as FieldWorkerRequest;
      if (req.kind !== "stamp-preview") return;
      this.onmessage?.({
        data: {
          kind: "stamp-previewed",
          jobId: req.jobId,
          chunks: [],
          opCount: 0,
          evalMs: 0,
          placements: [],
        },
      } as MessageEvent);
    }
    terminate(): void {
      // fake worker: nothing to tear down
    }
  }
  // Boundary cast: the fake implements the WorkerLike subset field-client calls.
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  return () => {
    globalThis.Worker = real;
  };
}

test("a CARVER whose preview came back empty still goes to CORE — the refusal is prop-generators-only", () => {
  // The editor-side refusal exists because "0 props" is a legitimate outcome for
  // a READER. For a carver, nothing-to-build is a misconfiguration and core's own
  // wording is the accurate one — "raise density, lower spacing" would be
  // nonsense advice for a hall. So the gate is `emits !== "ops"` (D-F4-15), and
  // this pins that it did not quietly become "every generator".
  //
  // The registry's own declaration, read straight off the def: `emits` replaced
  // the editor-side `placesArchetypes` schema sniff, which inferred the same fact
  // from an `archetypeId` param and would have mis-read a future placer that
  // takes its archetype any other way.
  expect(generatorById("hall").emits).toBe("ops");
  expect(generatorById("cave").emits).toBe("ops");
  expect(generatorById("maze").emits).toBe("ops");
  expect(generatorById("scatter").emits).toBe("placements");
});

test("…and the host acts on that: an empty-previewed HALL applies, it is not intercepted", async () => {
  const uninstall = installEmptyPreviewWorker();
  try {
    const host = createFieldHost();
    const { entityId, params } = loadCommittedHall(host);
    const errors: string[] = [];
    host.subscribeToolError((m) => errors.push(m));
    const sessions: (StampSession | null)[] = [];
    host.subscribeStamp((s) => sessions.push(s));

    host.openEntity(entityId);
    await settle();
    // The session is in exactly the state the refusal keys on…
    expect(sessions.at(-1)?.opCount).toBe(0);
    expect(sessions.at(-1)?.placementCount).toBe(0);

    host.updateStamp({ ...params, width: 12 }, 7, "replace");
    await settle();
    host.applyReconfigure();
    // …and the host let it through anyway, because a hall places no props. Core
    // re-evaluated the real generator (which emits plenty) and the apply LANDED.
    // With the gate widened to every generator this is refused instead.
    expect(errors).toEqual([]);
    expect(host.listEntities()[0]?.params).toMatchObject({ width: 12 });
  } finally {
    uninstall();
  }
});

// COVERAGE BOUNDARY (stated, not implied): this pins that the prop layer's SIZE
// is catalog-INDEPENDENT — installing, emptying or dropping the catalog never
// changes how many props the layer accounts for. It does NOT reach the
// uncatalogued RENDER branch (FALLBACK_COLLISION geometry + FALLBACK_TINT):
// those live inside rebuildProps' GPU-guarded loop, which no headless test
// enters, and a sabotage that drops uncatalogued archetypes there passes this
// suite. field-placements.test.ts pins the GHOST's half of the same fallback
// (`placementGhostBatch` is pure); the committed layer's half has no coverage.
test("props whose archetype the catalog does not define STILL count in the layer (never gates)", () => {
  const host = createFieldHost();
  loadCaveWithProps(host); // scatter's records are all archetype "rock"
  const withCatalog = host.propInstanceCounts().get("rock");
  expect(withCatalog).toBeGreaterThan(0);

  host.setEntityCatalog({ archetypes: [] }); // a catalog that knows nothing
  expect(host.propInstanceCounts().get("rock")).toBe(withCatalog as number);
  host.setEntityCatalog(null); // …and no catalog at all
  expect(host.propInstanceCounts().get("rock")).toBe(withCatalog as number);
});
