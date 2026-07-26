import { describe, expect, test } from "bun:test";
import type {
  AgentProfile,
  ChunkKey,
  FieldFlag,
  FieldStore,
} from "@furnace/core/field";
import {
  AIR,
  CHUNK_SAMPLES,
  createFieldStore,
  SOLID,
  setDensity,
} from "@furnace/core/field";
import {
  AnalyzerWorkerClient,
  createAnalyzePump,
} from "../src/frontend/lib/analyzer-client.ts";
import type {
  AnalyzerEngine,
  AnalyzerRequest,
  AnalyzerResponse,
  VerifyVerdictWire,
} from "../src/frontend/lib/analyzer-protocol.ts";
import { createAnalyzerWorkerHandler } from "../src/frontend/lib/analyzer-protocol.ts";

const CELL = 0.25;

/** The dungeon's shipped capsule (`packages/dungeon/catalog/agent.json`),
 *  restated as a literal: the editor is project-first and has no dependency on
 *  any project, so a profile crosses the worker boundary as DATA. These values
 *  are here to be a valid, realistic profile — nothing in the editor pins them. */
const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};

/** Inclusive cell box. Writing SOLID allocates a chunk without changing what it
 *  means, which is what gives a carved room its surrounding rock (the walk-probe
 *  fixture's rule). */
function box(
  store: FieldStore,
  b: readonly [number, number, number, number, number, number],
  density: number,
): void {
  const [x0, x1, y0, y1, z0, z1] = b;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) setDensity(store, x, y, z, density);
}

/** A 10 x 3 m corridor with one 0.5 m step up half way along. The step is above
 *  `stepHeight` (0.4), so the column pass flags the twelve floor cells beside it
 *  `ledge` — all in chunk "1,0,0", all anchored at x = 19. */
function steppedCorridor(): FieldStore {
  const store = createFieldStore(CELL);
  box(store, [-2, 41, -2, 17, -2, 13], SOLID);
  box(store, [0, 19, 0, 15, 0, 11], AIR); // low half, floor at y = 0
  box(store, [20, 39, 2, 15, 0, 11], AIR); // high half, floor at y = 0.5 m
  return store;
}

/** A 6 x 6 m room whose floor is at 1.0 m with a 3 x 3 m pit cut to 0 m: the
 *  rim is 1.0 m, past the 0.7 m climb ceiling, so a seed on the upper floor
 *  cannot reach the pit floor (where every flag anchors) and one on the pit
 *  floor can. */
function pitRoom(): FieldStore {
  const store = createFieldStore(CELL);
  box(store, [-2, 25, -2, 17, -2, 25], SOLID);
  box(store, [0, 23, 4, 15, 0, 23], AIR);
  box(store, [6, 17, 0, 15, 6, 17], AIR);
  return store;
}

/** Every allocated chunk as a sync upsert, buffers COPIED (the wire clones, so
 *  the fixture store keeps its own — and the mirror must not alias it). */
const upsertsOf = (
  store: FieldStore,
): { key: ChunkKey; density: ArrayBuffer }[] =>
  [...store.chunks].map(([key, density]) => ({
    key,
    density: density.slice().buffer as ArrayBuffer,
  }));

/** A fresh handler over a collecting `post` and an injectable engine loader. */
function runner(loadEngine?: (url: string) => Promise<AnalyzerEngine>) {
  const posts: AnalyzerResponse[] = [];
  const handle = createAnalyzerWorkerHandler({
    post: (msg) => posts.push(msg),
    loadEngine:
      loadEngine ??
      (() => Promise.reject(new Error("no engine wired in this test"))),
  });
  return { posts, handle };
}

/** The last post, asserted to be of `kind`. */
function lastOf<K extends AnalyzerResponse["kind"]>(
  posts: readonly AnalyzerResponse[],
  kind: K,
): Extract<AnalyzerResponse, { kind: K }> {
  const msg = posts.at(-1);
  if (msg === undefined || msg.kind !== kind)
    throw new Error(`expected a ${kind} post, got ${msg?.kind ?? "nothing"}`);
  return msg as Extract<AnalyzerResponse, { kind: K }>;
}

/** Sync a whole fixture store into a fresh handler. */
async function mirrored(
  store: FieldStore,
  loadEngine?: (url: string) => Promise<AnalyzerEngine>,
) {
  const r = runner(loadEngine);
  await r.handle({
    kind: "sync",
    jobId: 1,
    cellSize: store.cellSize,
    upserts: upsertsOf(store),
    removed: [],
  });
  expect(lastOf(r.posts, "acked").jobId).toBe(1);
  return r;
}

const analyze = (
  handle: (msg: AnalyzerRequest) => Promise<void>,
  jobId: number,
  dirty: ChunkKey[],
  extra?: { reachability: boolean; seeds: [number, number, number][] },
) =>
  handle({
    kind: "analyze",
    jobId,
    profile: AGENT,
    dirty,
    reachability: extra?.reachability ?? false,
    seeds: extra?.seeds ?? [],
  });

const flagsOf = (
  msg: Extract<AnalyzerResponse, { kind: "flags" }>,
  key: ChunkKey,
): FieldFlag[] => msg.chunks.find((c) => c.key === key)?.flags ?? [];

describe("analyzer worker: mirror + stage 1", () => {
  test("sync installs the mirror; analyze returns the dirty chunk's flags", async () => {
    const { posts, handle } = await mirrored(steppedCorridor());
    await analyze(handle, 2, ["1,0,0"]);
    const msg = lastOf(posts, "flags");
    expect(msg.jobId).toBe(2);
    const flags = flagsOf(msg, "1,0,0");
    expect(flags.length).toBe(12);
    expect(new Set(flags.map((f) => f.kind))).toEqual(new Set(["ledge"]));
    expect(new Set(flags.map((f) => f.cell[0]))).toEqual(new Set([19]));
  });

  test("a chunk that analyses to nothing still comes back, so the host can clear it", async () => {
    // "0,1,0" sits above the corridor's air and holds no floor anchor at all.
    // Omitting it would leave a stale flag list wherever an edit CLEANED a chunk.
    const { posts, handle } = await mirrored(steppedCorridor());
    await analyze(handle, 2, ["1,0,0"]);
    const keys = lastOf(posts, "flags").chunks.map((c) => c.key);
    expect(keys).toContain("1,1,0");
    expect(flagsOf(lastOf(posts, "flags"), "1,1,0")).toEqual([]);
  });

  test("sync removes chunks, and the flags of a removed neighbourhood go with them", async () => {
    const store = steppedCorridor();
    const { posts, handle } = await mirrored(store);
    await handle({
      kind: "sync",
      jobId: 2,
      cellSize: CELL,
      upserts: [],
      removed: ["1,0,0"],
    });
    await analyze(handle, 3, ["1,0,0"]);
    const keys = lastOf(posts, "flags").chunks.map((c) => c.key);
    expect(keys).not.toContain("1,0,0");
  });

  test("a short sync chunk posts analyzer-error carrying the jobId, never throws", async () => {
    const { posts, handle } = runner();
    await handle({
      kind: "sync",
      jobId: 9,
      cellSize: CELL,
      // Nothing downstream would catch it: the store reads past a short chunk as
      // unallocated rock and the analysis comes back plausible and wrong.
      upserts: [{ key: "0,0,0", density: new ArrayBuffer(8) }],
      removed: [],
    });
    const err = lastOf(posts, "analyzer-error");
    expect(err.jobId).toBe(9);
    expect(err.message).toContain("4096");
  });

  test("a bad chunk ANYWHERE in a sync batch leaves the mirror untouched", async () => {
    const { posts, handle } = await mirrored(steppedCorridor());
    await handle({
      kind: "sync",
      jobId: 2,
      cellSize: CELL,
      upserts: [
        // A well-formed upsert that would wipe the flagged chunk…
        {
          key: "1,0,0",
          density: new Int8Array(CHUNK_SAMPLES).fill(SOLID)
            .buffer as ArrayBuffer,
        },
        // …followed by a malformed one. Applied one at a time, the first lands
        // and the mirror silently loses air the host still has — a chunk that
        // reads as rock emits no flags at all, which is a false negative
        // arriving through the back door.
        { key: "0,0,0", density: new ArrayBuffer(8) },
      ],
      removed: [],
    });
    expect(lastOf(posts, "analyzer-error").jobId).toBe(2);
    await analyze(handle, 3, ["1,0,0"]);
    expect(flagsOf(lastOf(posts, "flags"), "1,0,0").length).toBe(12);
  });

  test("a non-positive cellSize is refused rather than mirrored", async () => {
    const { posts, handle } = runner();
    await handle({
      kind: "sync",
      jobId: 4,
      cellSize: 0,
      upserts: [],
      removed: [],
    });
    expect(lastOf(posts, "analyzer-error").message).toContain("cellSize");
  });

  test("a lattice change resets the mirror rather than mixing two cell sizes", async () => {
    const { posts, handle } = await mirrored(steppedCorridor());
    await handle({
      kind: "sync",
      jobId: 2,
      cellSize: 0.5,
      upserts: [],
      removed: [],
    });
    await analyze(handle, 3, ["1,0,0"]);
    // Nothing allocated at the new lattice: the corridor's chunks were measured
    // against 0.25 m and are gone, so there is nothing to analyse.
    expect(lastOf(posts, "flags").chunks).toEqual([]);
  });

  test("analyze before any sync is an error, not an empty (clean-looking) answer", async () => {
    const { posts, handle } = runner();
    await analyze(handle, 3, ["0,0,0"]);
    const err = lastOf(posts, "analyzer-error");
    expect(err.jobId).toBe(3);
    expect(err.message).toContain("before any sync");
  });

  test("an unrecognised request kind is refused, not run as the chain's last arm", async () => {
    const { posts, handle } = await mirrored(steppedCorridor());
    // Boundary cast: a message no version of this protocol declares — which is
    // what a stale host or a hand-posted message looks like at runtime.
    await handle({ kind: "nope", jobId: 7 } as unknown as AnalyzerRequest);
    const err = lastOf(posts, "analyzer-error");
    expect(err.jobId).toBe(7);
    expect(err.message).toContain("unrecognised request kind nope");
    // And the placement set survived. An if/else chain ending in a bare `else`
    // would have taken this message into the `placements` arm, set `groups` to
    // undefined, dropped the solidity memo and ACKED success — which only
    // surfaces on the next analyse, as a stage-1 failure with no obvious cause.
    await analyze(handle, 8, ["1,0,0"]);
    expect(flagsOf(lastOf(posts, "flags"), "1,0,0").length).toBe(12);
  });

  test("a bad agent profile surfaces as a typed error (core's setup-loud gate)", async () => {
    const { posts, handle } = await mirrored(steppedCorridor());
    await handle({
      kind: "analyze",
      jobId: 5,
      // clearance below the capsule's own height — core rejects it.
      profile: { ...AGENT, clearance: 0.1 },
      dirty: ["1,0,0"],
      reachability: false,
      seeds: [],
    });
    expect(lastOf(posts, "analyzer-error").message).toContain("clearance");
  });
});

describe("analyzer worker: the re-analysis set (D-F4-9, amended)", () => {
  /** An allocated-but-empty chunk: presence is what the set is computed over. */
  function sparse(keys: readonly ChunkKey[]): FieldStore {
    const store = createFieldStore(CELL);
    for (const key of keys) store.chunks.set(key, new Int8Array(CHUNK_SAMPLES));
    return store;
  }

  test("dirty chunk + allocated 26-neighbours + everything BELOW it in the own AND CARDINAL XZ columns", async () => {
    const { posts, handle } = await mirrored(
      sparse([
        "0,0,0", // dirty
        "1,0,0", // 26-neighbour
        "0,-1,0", // neighbour AND below
        // Far below in the anchor's OWN column: `ceilingAbove` is uncapped, so
        // its columns read up through the edit.
        "0,-4,0",
        // Far below in a CARDINALLY-adjacent column, x and z. `scanRise` reads
        // the 4 cardinal neighbour columns bounded by that same uncapped
        // ceiling, so these are just as exposed as the own column — the class
        // the letter of the amendment missed.
        "1,-4,0",
        "0,-4,1",
        // Far below in a DIAGONAL column: `scanRise` reads cardinals only, so
        // nothing down here can see the edit. The asymmetry is the algorithm's.
        "1,-4,1",
        "0,4,0", // far above: reads DOWN only at its own bottom row (a neighbour)
        "4,0,0", // far sideways at the same level: no read reaches that far
      ]),
    );
    await analyze(handle, 2, ["0,0,0"]);
    expect(new Set(lastOf(posts, "flags").chunks.map((c) => c.key))).toEqual(
      new Set(["0,0,0", "1,0,0", "0,-1,0", "0,-4,0", "1,-4,0", "0,-4,1"]),
    );
  });

  test("the cardinal-column term is load-bearing: a real flag four chunks below and one column across", async () => {
    // A 1-cell open shaft. The floor anchor at (16,-64,8) lives in "1,-4,0";
    // its −x neighbour column runs up through "0,0,0", four chunks above.
    // `scanRise` reads that column bounded by the anchor's OWN uncapped
    // ceiling, so a floor appearing up there is a brand-new `ledge` down here —
    // and a rule that only walked the anchor's own column would never
    // re-analyse the chunk holding it.
    const store = createFieldStore(CELL);
    box(store, [14, 18, -66, 22, 6, 10], SOLID);
    box(store, [15, 16, -64, 21, 8, 8], AIR);
    const { posts, handle } = await mirrored(store);
    const ledgeAtAnchor = () =>
      flagsOf(lastOf(posts, "flags"), "1,-4,0").filter(
        (f) => f.kind === "ledge" && f.cell.join(",") === "16,-64,8",
      );

    await analyze(handle, 2, ["0,0,0"]);
    expect(ledgeAtAnchor()).toEqual([]);

    setDensity(store, 15, 4, 8, SOLID);
    await handle({
      kind: "sync",
      jobId: 3,
      cellSize: CELL,
      upserts: upsertsOf(store).filter((u) => u.key === "0,0,0"),
      removed: [],
    });
    await analyze(handle, 4, ["0,0,0"]);
    expect(ledgeAtAnchor().length).toBe(1);
  });

  test("unallocated members of the set are dropped, not analysed into empty noise", async () => {
    const { posts, handle } = await mirrored(sparse(["0,0,0"]));
    await analyze(handle, 2, ["0,0,0"]);
    expect(lastOf(posts, "flags").chunks.map((c) => c.key)).toEqual(["0,0,0"]);
  });
});

describe("analyzer worker: reachability demotion", () => {
  const PIT_FLOOR: [number, number, number] = [1.625, 0.1, 1.625];
  const UPPER_FLOOR: [number, number, number] = [0.5, 1.1, 0.5];
  const DIRTY = ["0,0,0", "1,0,0", "0,0,1", "1,0,1"];

  const pitFlags = async (extra?: {
    reachability: boolean;
    seeds: [number, number, number][];
  }) => {
    const { posts, handle } = await mirrored(pitRoom());
    await analyze(handle, 2, DIRTY, extra);
    return lastOf(posts, "flags").chunks.flatMap((c) => c.flags);
  };

  test("without the pass every tag stays undefined — the 'show it' state", async () => {
    const flags = await pitFlags();
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => f.unreachable === undefined)).toBe(true);
  });

  test("a seed the flags are cut off from demotes them", async () => {
    const flags = await pitFlags({
      reachability: true,
      seeds: [UPPER_FLOOR],
    });
    // Every flag anchors on the PIT floor, 1.0 m below the rim — past the 0.7 m
    // climb ceiling, so the flood never gets down there.
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => f.unreachable === true)).toBe(true);
  });

  test("a seed standing among them clears the demotion", async () => {
    const flags = await pitFlags({ reachability: true, seeds: [PIT_FLOOR] });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => f.unreachable === false)).toBe(true);
  });
});

describe("analyzer worker: placement solidity", () => {
  /** A wall at x = 19 from the corridor floor to 2 m, covering the twelve cells
   *  the `ledge` flags anchor on. Props carry their own colliders at runtime, so
   *  the analyzer only sees them through this channel. */
  const WALL: Extract<AnalyzerRequest, { kind: "placements" }>["groups"] = [
    {
      collision: { kind: "box", halfExtents: [0.125, 1, 1.5] },
      records: [
        {
          archetypeId: "test-wall",
          position: [4.875, 1, 1.5],
          quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          variantIndex: 0,
        },
      ],
    },
  ];

  const anchoredAtStep = (msg: Extract<AnalyzerResponse, { kind: "flags" }>) =>
    flagsOf(msg, "1,0,0").filter((f) => f.cell[0] === 19);

  test("a placement collider is solid to stage 1, and swapping the set re-rasterizes", async () => {
    const { posts, handle } = await mirrored(steppedCorridor());
    await analyze(handle, 2, ["1,0,0"]);
    expect(anchoredAtStep(lastOf(posts, "flags")).length).toBe(12);

    await handle({ kind: "placements", jobId: 3, groups: WALL });
    expect(lastOf(posts, "acked").jobId).toBe(3);
    await analyze(handle, 4, ["1,0,0"]);
    // Those cells are inside a collider now: not floor anchors, so not flagged.
    expect(anchoredAtStep(lastOf(posts, "flags"))).toEqual([]);

    // …and clearing the set puts them back, which is the memo being invalidated
    // rather than a one-way widening.
    await handle({ kind: "placements", jobId: 5, groups: [] });
    await analyze(handle, 6, ["1,0,0"]);
    expect(anchoredAtStep(lastOf(posts, "flags")).length).toBe(12);
  });

  test("a malformed collision primitive surfaces as a typed error", async () => {
    const { posts, handle } = await mirrored(steppedCorridor());
    await handle({
      kind: "placements",
      jobId: 3,
      groups: [{ collision: { kind: "sphere", radius: -1 }, records: [] }],
    });
    // voxelizePlacements is memoized, so the throw lands on the ANALYZE that
    // needs the solidity — still typed, still carrying that job's id.
    await analyze(handle, 4, ["1,0,0"]);
    const err = lastOf(posts, "analyzer-error");
    expect(err.jobId).toBe(4);
    expect(err.message).toContain("radius");
  });
});

describe("analyzer worker: stage-2 verify", () => {
  const VERDICT: VerifyVerdictWire = {
    outcome: "trapped",
    lanes: [{ dir: [1, 0], outcome: "trap", progressed: 0.4 }],
    ms: 12,
  };

  const FLAG: FieldFlag = {
    kind: "ledge",
    severity: "info",
    cell: [19, 0, 0],
    world: [4.875, 0, 0.125],
    chunk: "1,0,0",
  };

  const verify = (
    handle: (msg: AnalyzerRequest) => Promise<void>,
    jobId: number,
  ) =>
    handle({
      kind: "verify",
      jobId,
      engineUrl: "/engine.js",
      flag: FLAG,
      profile: AGENT,
      budgetMs: 250,
    });

  /** Records what analyzerVerify was handed, and how often the bundle loaded. */
  function fakeEngine(verdict: () => Promise<VerifyVerdictWire>) {
    const calls: Parameters<AnalyzerEngine["analyzerVerify"]>[0][] = [];
    let loads = 0;
    const loadEngine = () => {
      loads++;
      return Promise.resolve({
        analyzerVerify: (
          opts: Parameters<AnalyzerEngine["analyzerVerify"]>[0],
        ) => {
          calls.push(opts);
          return verdict();
        },
      });
    };
    return { calls, loadEngine, loadCount: () => loads };
  }

  test("verify hands the MIRROR store, the flag, the profile and the budget to the bundle", async () => {
    const engine = fakeEngine(() => Promise.resolve(VERDICT));
    const { posts, handle } = await mirrored(
      steppedCorridor(),
      engine.loadEngine,
    );
    await verify(handle, 2);
    const msg = lastOf(posts, "verified");
    expect(msg.jobId).toBe(2);
    expect(msg.verdict).toEqual(VERDICT);
    const opts = engine.calls[0];
    expect(opts).toBeDefined();
    if (opts === undefined) return;
    expect(opts.flag).toBe(FLAG);
    expect(opts.profile).toBe(AGENT);
    expect(opts.budgetMs).toBe(250);
    expect(opts.store.cellSize).toBe(CELL);
    expect(opts.store.chunks.size).toBe(24);
  });

  test("stage 2 sees the SAME prop set stage 1 rasterized", async () => {
    const engine = fakeEngine(() => Promise.resolve(VERDICT));
    const { handle } = await mirrored(steppedCorridor(), engine.loadEngine);
    const groups: Extract<AnalyzerRequest, { kind: "placements" }>["groups"] = [
      { collision: { kind: "sphere", radius: 0.5 }, records: [] },
    ];
    await handle({ kind: "placements", jobId: 2, groups });
    await verify(handle, 3);
    expect(engine.calls[0]?.placements).toEqual(groups);
  });

  test("a sync landing MID-VERIFY waits: the verify reads the pre-sync mirror", async () => {
    // The real `analyzerVerify` awaits `physics.createWorld` BEFORE
    // `buildChunkBodies` reads the store (walk-probe.ts), and the first verify
    // also awaits the bundle import. `self.onmessage` fires handlers
    // concurrently, so without serialization a `sync` arriving in either window
    // mutates the very FieldStore the in-flight verify captured, and the verdict
    // describes a half-updated mirror. This drives exactly that interleaving.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sizeSeenAfterTheAwait = -1;
    const { posts, handle } = await mirrored(steppedCorridor(), () =>
      Promise.resolve({
        analyzerVerify: async (
          opts: Parameters<AnalyzerEngine["analyzerVerify"]>[0],
        ) => {
          await gate; // stands in for `await physics.createWorld`
          sizeSeenAfterTheAwait = opts.store.chunks.size;
          return VERDICT;
        },
      }),
    );
    expect(steppedCorridor().chunks.size).toBe(24);

    const verifying = verify(handle, 2);
    // Posted while the verify is suspended, and it REMOVES a chunk — so a
    // mid-verify application is visible as a smaller store.
    const syncing = handle({
      kind: "sync",
      jobId: 3,
      cellSize: CELL,
      upserts: [],
      removed: ["1,0,0"],
    });
    release();
    await Promise.all([verifying, syncing]);

    expect(sizeSeenAfterTheAwait).toBe(24);
    // Arrival order, not completion order: the verify answers first even though
    // the sync would have finished in an instant.
    expect(posts.map((p) => p.kind)).toEqual(["acked", "verified", "acked"]);
    // …and the sync still landed once its turn came.
    await analyze(handle, 4, ["1,0,0"]);
    expect(lastOf(posts, "flags").chunks.map((c) => c.key)).not.toContain(
      "1,0,0",
    );
  });

  test("the bundle loads ONCE across verifies — the shared physics context depends on it", async () => {
    const engine = fakeEngine(() => Promise.resolve(VERDICT));
    const { handle } = await mirrored(steppedCorridor(), engine.loadEngine);
    await verify(handle, 2);
    await verify(handle, 3);
    expect(engine.loadCount()).toBe(1);
    expect(engine.calls.length).toBe(2);
  });

  test("a verify that REJECTS keeps the loaded module; a verify that cannot LOAD retries", async () => {
    let fail = true;
    const engine = fakeEngine(() =>
      fail
        ? Promise.reject(new Error("mover blew up"))
        : Promise.resolve(VERDICT),
    );
    const { posts, handle } = await mirrored(
      steppedCorridor(),
      engine.loadEngine,
    );
    await verify(handle, 2);
    expect(lastOf(posts, "analyzer-error").message).toBe("mover blew up");
    fail = false;
    await verify(handle, 3);
    expect(lastOf(posts, "verified").jobId).toBe(3);
    expect(engine.loadCount()).toBe(1);

    let loads = 0;
    const flaky = runner(() => {
      loads++;
      return loads === 1
        ? Promise.reject(new Error("bundle 500"))
        : Promise.resolve({ analyzerVerify: () => Promise.resolve(VERDICT) });
    });
    await flaky.handle({
      kind: "sync",
      jobId: 1,
      cellSize: CELL,
      upserts: [],
      removed: [],
    });
    await verify(flaky.handle, 2);
    expect(lastOf(flaky.posts, "analyzer-error").message).toBe("bundle 500");
    await verify(flaky.handle, 3);
    expect(lastOf(flaky.posts, "verified").jobId).toBe(3);
    expect(loads).toBe(2);
  });

  test("verify before any sync is an error", async () => {
    const engine = fakeEngine(() => Promise.resolve(VERDICT));
    const { posts, handle } = runner(engine.loadEngine);
    await verify(handle, 2);
    expect(lastOf(posts, "analyzer-error").message).toContain(
      "before any sync",
    );
  });
});

// --- client ----------------------------------------------------------------

/** Captures postMessage traffic — the client's injectable spawn seam. */
function fakeWorker() {
  const sent: AnalyzerRequest[] = [];
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage(msg: unknown) {
      sent.push(msg as AnalyzerRequest);
    },
    terminate() {
      // fake worker: nothing to tear down
    },
  };
  const reply = (msg: AnalyzerResponse): void => {
    worker.onmessage?.({ data: msg } as MessageEvent);
  };
  return { worker, sent, reply };
}

const ANALYZE_INPUT = {
  profile: AGENT,
  dirty: ["0,0,0"],
  reachability: false,
  seeds: [] as [number, number, number][],
};

/** A macrotask turn — drains the whole microtask queue, whatever its length
 *  (the client's promise chains are several `then`s deep). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("analyzer client", () => {
  test("analyze stamps a jobId and resolves the flags response", async () => {
    const { worker, sent, reply } = fakeWorker();
    const client = new AnalyzerWorkerClient(() => worker);
    const promise = client.analyze(ANALYZE_INPUT);
    const req = sent[0];
    expect(req?.kind).toBe("analyze");
    if (req === undefined) return;
    reply({ kind: "flags", jobId: req.jobId, chunks: [] });
    expect((await promise).chunks).toEqual([]);
  });

  test("sync and placements resolve on their ack, so a failed mirror update is not silent", async () => {
    const { worker, sent, reply } = fakeWorker();
    const client = new AnalyzerWorkerClient(() => worker);
    const ok = client.sync(CELL, [], ["0,0,0"]);
    reply({ kind: "acked", jobId: sent[0]?.jobId ?? -1 });
    expect((await ok).kind).toBe("acked");

    const bad = client.placements([]);
    reply({
      kind: "analyzer-error",
      jobId: sent[1]?.jobId ?? -1,
      message: "boom",
    });
    await expect(bad).rejects.toThrow("boom");
  });

  test("a wrong-kind reply rejects loud (protocol bug, not a cast)", async () => {
    const { worker, sent, reply } = fakeWorker();
    const client = new AnalyzerWorkerClient(() => worker);
    const p = client.analyze(ANALYZE_INPUT);
    reply({ kind: "acked", jobId: sent[0]?.jobId ?? -1 });
    await expect(p).rejects.toThrow("expected flags, got acked");
  });

  test("a synchronous postMessage throw rejects the call rather than hanging", async () => {
    const worker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage(): void {
        throw new Error("detached");
      },
      terminate(): void {
        // fake worker: nothing to tear down
      },
    };
    const client = new AnalyzerWorkerClient(() => worker);
    await expect(client.analyze(ANALYZE_INPUT)).rejects.toThrow("detached");
    // `send` also deletes the job's pending entry on that path. Deliberately NOT
    // asserted: the throw happens inside the promise executor, so the promise is
    // already rejected and the leftover entry has no observable consequence (no
    // response will ever carry that jobId — the worker never got the message).
    // It is map hygiene against a dead worker, not behaviour, and a test that
    // pretended otherwise would be theatre.
    client.dispose();
  });

  test("dispose rejects everything still in flight", async () => {
    const { worker } = fakeWorker();
    const client = new AnalyzerWorkerClient(() => worker);
    const p = client.analyze(ANALYZE_INPUT);
    client.dispose();
    await expect(p).rejects.toThrow("analyzer worker disposed");
  });

  test("a reply for an unknown job is dropped, not thrown on", () => {
    const { worker, reply } = fakeWorker();
    const client = new AnalyzerWorkerClient(() => worker);
    void client.analyze(ANALYZE_INPUT).catch(() => undefined);
    expect(() =>
      reply({ kind: "flags", jobId: 999, chunks: [] }),
    ).not.toThrow();
    client.dispose();
  });
});

describe("analyze pump (latest-wins)", () => {
  function harness(
    onFlags?: (r: Extract<AnalyzerResponse, { kind: "flags" }>) => void,
  ) {
    const { worker, sent, reply } = fakeWorker();
    const client = new AnalyzerWorkerClient(() => worker);
    const dirty = new Set<string>();
    const flags: number[] = [];
    const errors: string[] = [];
    const pump = createAnalyzePump(client, {
      next: () =>
        dirty.size === 0 ? undefined : { ...ANALYZE_INPUT, dirty: [...dirty] },
      onFlags: onFlags ?? ((r) => flags.push(r.jobId)),
      onError: (e) => errors.push(e.message),
    });
    return { sent, reply, dirty, flags, errors, pump, client };
  }

  const settleLast = async (h: ReturnType<typeof harness>): Promise<void> => {
    h.reply({ kind: "flags", jobId: h.sent.at(-1)?.jobId ?? -1, chunks: [] });
    await flush();
  };

  test("requests during a pass collapse into ONE re-fire that reads the LATEST dirty set", async () => {
    const h = harness();
    h.dirty.add("0,0,0");
    h.pump.request();
    expect(h.sent.length).toBe(1);

    h.dirty.add("1,0,0");
    h.pump.request();
    h.dirty.add("2,0,0");
    h.pump.request();
    h.pump.request();
    expect(h.sent.length).toBe(1); // still latched

    await settleLast(h);
    await settleLast(h); // settle the re-fire too
    expect(h.sent.length).toBe(2);
    // The re-fire read the set at FIRE time, so it carries everything that
    // accumulated while the first pass was out.
    expect(h.sent[1]?.kind === "analyze" && h.sent[1].dirty).toEqual([
      "0,0,0",
      "1,0,0",
      "2,0,0",
    ]);
    expect(h.flags.length).toBe(2);
  });

  test("nothing to analyse leaves the latch idle rather than wedging it", async () => {
    const h = harness();
    h.pump.request(); // next() returns undefined
    expect(h.sent.length).toBe(0);
    h.dirty.add("0,0,0");
    h.pump.request();
    expect(h.sent.length).toBe(1);
    await settleLast(h);
  });

  test("a failed pass reports and still releases the latch", async () => {
    const h = harness();
    h.dirty.add("0,0,0");
    h.pump.request();
    h.reply({
      kind: "analyzer-error",
      jobId: h.sent[0]?.jobId ?? -1,
      message: "stage 1 blew up",
    });
    await flush();
    expect(h.errors).toEqual(["stage 1 blew up"]);
    h.pump.request();
    expect(h.sent.length).toBe(2);
    await settleLast(h);
  });

  test("a throw out of onFlags reports like a failed pass and still releases the latch", async () => {
    // The one failure channel the pump documents. Wedging on a host-side render
    // bug would stop analysis for the rest of the session, so it must not be a
    // property that merely happens to hold.
    const h = harness(() => {
      throw new Error("render blew up");
    });
    h.dirty.add("0,0,0");
    h.pump.request();
    await settleLast(h);
    expect(h.errors).toEqual(["render blew up"]);
    h.pump.request();
    expect(h.sent.length).toBe(2);
    await settleLast(h);
  });
});
