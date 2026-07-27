// The FieldHost's half of the walkability advisor, with no GPU: what it POSTS
// to the analyzer worker, what it does with the findings that come back, and
// what the filters do to them. The marker layer is observable here too —
// `flagMarkerCount` settles before the context guard, exactly as
// `propInstanceCounts` does — so only the instanced UPLOAD needs a device
// (`field-host-analyzer.gpu.test.ts`).
//
// The worker is INJECTED (createFieldHost's spawnAnalyzer seam) and runs the
// REAL protocol handler in-process: a job posted to a Worker spawned from
// /analyzer-worker.js never settles under bun, so with a real one nothing past
// the request would run.
//
// One thing to know before adding a test here: the pump is a latest-wins LATCH.
// While a pass is unanswered every later request only queues, so a test that
// drives two world verbs without settling the first (`deliver` / `respond`)
// sees the second one's messages never posted. That is the production behaviour,
// not a fixture quirk.
import { expect, test } from "bun:test";
import type {
  AgentProfile,
  ChunkKey,
  FieldFlag,
  FieldManifest,
} from "@furnace/core/field";
import {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  SOLID,
} from "@furnace/core/field";
import type {
  AnalyzerEngine,
  AnalyzerRequest,
  AnalyzerResponse,
  VerifyVerdictWire,
} from "../src/frontend/lib/analyzer-protocol.ts";
import { createAnalyzerWorkerHandler } from "../src/frontend/lib/analyzer-protocol.ts";
import type { WorkerLike } from "../src/frontend/lib/field-client.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FlagsSummary } from "../src/viewport-host/index.ts";

/** The dungeon's shipped capsule, restated as a literal (the analyzer-protocol
 *  test's rationale: the editor is project-first and pins nobody's numbers). */
const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};

// A carved chamber in one chunk, in two halves that share a floor at cell y = 4
// and differ only in ceiling height. The TALL half clears the capsule (2.5 m
// against its 1.8 m), so its cells are walkable and their columns scan; the LOW
// half does not (1.5 m), so it is flagged `low-clearance` — a CANDIDATE — from
// the tall cells beside it.
//
// Both halves are needed. A chamber that is uniformly low produces NO flags at
// all: the column pass only scans cells that pass the walkable test, headroom
// included, so a floor nobody can stand on is never examined and never
// complained about. The finding is emitted by the neighbour that CAN stand.
const CHAMBER = {
  floorY: 4,
  tallTopY: 13,
  lowTopY: 9,
  tallX: [2, 7],
  lowX: [8, 13],
  z: [2, 13],
} as const;

/** A world point standing on the TALL half's floor, so the connectivity passes
 *  have a usable seed (a seed inside rock warns and skips). */
const CHAMBER_FLOOR: [number, number, number] = [
  4 * DEFAULT_CELL_SIZE,
  4.5 * DEFAULT_CELL_SIZE,
  6 * DEFAULT_CELL_SIZE,
];

const manifest = (
  playerStart: [number, number, number] = CHAMBER_FLOOR,
): FieldManifest => ({
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart,
  playerYaw: 0,
  chunks: [],
  meshes: [],
});

const solidChunk = (): Uint8Array =>
  encodeChunkFile(new Int8Array(CHUNK_SAMPLES).fill(SOLID));

const chamberChunk = (): Uint8Array => {
  const density = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
  const carve = (x0: number, x1: number, topY: number): void => {
    for (let z = CHAMBER.z[0]; z <= CHAMBER.z[1]; z++)
      for (let y = CHAMBER.floorY; y <= topY; y++)
        for (let x = x0; x <= x1; x++)
          density[x + CHUNK_DIM * (y + CHUNK_DIM * z)] = AIR;
  };
  carve(CHAMBER.tallX[0], CHAMBER.tallX[1], CHAMBER.tallTopY);
  carve(CHAMBER.lowX[0], CHAMBER.lowX[1], CHAMBER.lowTopY);
  return encodeChunkFile(density);
};

/** Drain rounds `deliver` allows before calling the host stuck. Each round is
 *  one settle→re-fire hop, and a world load takes two. */
const DELIVER_ROUNDS = 8;

/** A worker whose "thread" is the real handler, run on demand. The handler is
 *  built ONCE — it owns the mirror, so a per-delivery one would forget every
 *  sync between messages.
 *
 *  `verifyWith` supplies the stage-2 engine the handler would otherwise import
 *  from /engine.js. Given one, the REAL `handleVerify` runs — `requireStore`
 *  included — so what a test drives is the whole worker path minus the project's
 *  mover. Omitted, the engine load rejects, which is the pre-verify default and
 *  what every stage-1 test wants. */
function analyzerWorker(verifyWith?: AnalyzerEngine) {
  const sent: AnalyzerRequest[] = [];
  // Tracked beside `sent` so `respond` still works after a test has cleared the
  // inspection log to isolate the messages of one verb.
  let lastAnalyzeJob: number | null = null;
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(msg) {
      // Structured-cloned like the real boundary: what a test then inspects is
      // the SHAPE the host built, not an object it can still reach into.
      const req = structuredClone(msg) as AnalyzerRequest;
      if (req.kind === "analyze") lastAnalyzeJob = req.jobId;
      sent.push(req);
    },
    terminate() {
      // nothing to tear down: there is no thread
    },
  };
  const handle = createAnalyzerWorkerHandler({
    post: (res: AnalyzerResponse) =>
      worker.onmessage?.({ data: res } as MessageEvent),
    loadEngine: () =>
      verifyWith === undefined
        ? Promise.reject(new Error("no engine wired in this test"))
        : Promise.resolve(verifyWith),
  });
  /** Drain the microtask queue. A response walks a two-link chain inside the
   *  client and the pump (`.then` for the result, `.catch` for a handler that
   *  threw), so a settled promise is not yet a rebuilt marker layer. */
  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));
  /** Run every request received so far through the real handler and post each
   *  answer back, exactly as a Worker would — then keep going while the host
   *  keeps talking. Settling one pass can fire the NEXT one (the pump re-fires a
   *  queued request on settle), so a single drain leaves the latch busy and the
   *  next verb silently queued behind it. */
  const deliver = async (): Promise<void> => {
    for (let round = 0; sent.length > 0; round++) {
      if (round > DELIVER_ROUNDS)
        throw new Error("test: the analyzer host will not go quiet");
      for (const req of sent.splice(0, sent.length)) await handle(req);
      await flush();
    }
  };
  /** Answer the most recent analyze with a CANNED payload — for the tests that
   *  care about the host's reaction rather than about what the column pass would
   *  really have found. */
  const respond = async (
    chunks: { key: ChunkKey; flags: FieldFlag[] }[],
    pits?: FieldFlag[],
  ): Promise<void> => {
    if (lastAnalyzeJob === null)
      throw new Error("test: no analyze has been posted to respond to");
    worker.onmessage?.({
      data: {
        kind: "flags",
        jobId: lastAnalyzeJob,
        chunks,
        ...(pits !== undefined && { pits }),
      },
    } as MessageEvent);
    await flush();
  };
  const of = <K extends AnalyzerRequest["kind"]>(
    kind: K,
  ): Extract<AnalyzerRequest, { kind: K }>[] =>
    sent.filter(
      (r): r is Extract<AnalyzerRequest, { kind: K }> => r.kind === kind,
    );
  return { worker, sent, deliver, respond, of, flush };
}

function fixture(
  profile: AgentProfile | null = AGENT,
  engine?: AnalyzerEngine,
) {
  const fake = analyzerWorker(engine);
  // Counted, not just returned: the client spawns LAZILY, so a stray post after
  // dispose shows up here as a second spawn — a live worker holding a
  // megabyte-scale mirror that nothing will ever reap.
  const spawns = { count: 0 };
  const host = createFieldHost({
    spawnAnalyzer: () => {
      spawns.count += 1;
      return fake.worker;
    },
  });
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const pushes: FlagsSummary[] = [];
  host.subscribeFlags((s) => pushes.push(s));
  if (profile !== null) host.setAgentProfile(profile);
  return { host, errors, pushes, spawns, ...fake };
}

/** A fixture with the chamber world loaded and its analyze PENDING — so exactly
 *  one `respond` is armed. One per test, deliberately: the client drops a
 *  response whose job it has already settled, which is the real staleness rule
 *  and not a fixture limitation. */
function loadedFixture() {
  const f = fixture();
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }],
    oplog: null,
  });
  return f;
}

const flag = (
  kind: FieldFlag["kind"],
  severity: FieldFlag["severity"],
  cell: [number, number, number],
  chunk: ChunkKey,
): FieldFlag => ({
  kind,
  severity,
  cell,
  world: [
    cell[0] * DEFAULT_CELL_SIZE,
    cell[1] * DEFAULT_CELL_SIZE,
    cell[2] * DEFAULT_CELL_SIZE,
  ],
  chunk,
});

/** The most recent push, asserted present — `expectDefined` for a summary, so
 *  the assertions below compare numbers rather than `number | undefined`. */
const lastSummary = (pushes: readonly FlagsSummary[]): FlagsSummary => {
  const s = pushes.at(-1);
  if (s === undefined) throw new Error("test: no flags summary was pushed");
  return s;
};

const kinds = (summary: FlagsSummary | undefined): string[] =>
  (summary?.visible ?? []).map((r) => r.flag.kind);

test("with no agent profile the advisor posts NOTHING and says so exactly once", () => {
  const f = fixture(null);
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: solidChunk() }],
    oplog: null,
  });
  expect(f.sent).toEqual([]);
  expect(f.errors).toEqual([
    "walkability advisor idle — this project installs no agent profile",
  ]);
  // Not once per pass: an edit loop would repeat it at stroke rate.
  f.host.loadWorld({ manifest: manifest(), chunks: [], oplog: null });
  expect(f.errors).toHaveLength(1);
});

test("a profile installed after the fact catches the world up in full", () => {
  const f = fixture(null);
  f.host.loadWorld({
    manifest: manifest([2, 3, 4]),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: solidChunk() }],
    oplog: null,
  });
  expect(f.sent).toEqual([]);

  f.host.setAgentProfile(AGENT);
  // The mirror never saw the load, so this must be a WHOLE-store sync and a
  // whole-world pass — not the empty incremental set the load left behind.
  const sync = f.of("sync").at(-1);
  expect(sync?.upserts.map((u) => u.key)).toEqual([chunkKey(0, 0, 0)]);
  const analyze = f.of("analyze").at(-1);
  expect(analyze?.reachability).toBe(true);
  expect(analyze?.seeds).toEqual([[2, 3, 4]]);
  expect(analyze?.dirty).toEqual([chunkKey(0, 0, 0)]);
});

test("a world load syncs every chunk and seeds the pass from manifest.playerStart", () => {
  const f = fixture();
  f.host.loadWorld({
    manifest: manifest([5, 6, 7]),
    chunks: [
      { key: chunkKey(0, 0, 0), bytes: solidChunk() },
      { key: chunkKey(1, 0, 0), bytes: solidChunk() },
    ],
    oplog: null,
  });
  const sync = f.of("sync").at(-1);
  expect(sync?.cellSize).toBe(DEFAULT_CELL_SIZE);
  expect(sync?.upserts.map((u) => u.key).sort()).toEqual([
    chunkKey(0, 0, 0),
    chunkKey(1, 0, 0),
  ]);
  expect(sync?.upserts[0]?.density.byteLength).toBe(CHUNK_SAMPLES);
  const analyze = f.of("analyze").at(-1);
  // The spawn IS the reachability/pit seed — it is where the agent starts, which
  // is what "can it get there" and "can it get back" are asked from.
  expect(analyze?.seeds).toEqual([[5, 6, 7]]);
  expect(analyze?.reachability).toBe(true);
  // Placements ride the same catch-up: props rasterize into the solidity stage 1
  // reads, so the analyzer and the runtime must see one prop set.
  expect(f.of("placements").length).toBeGreaterThan(0);
});

test("a NEW world lists the old chunks as removals and seeds nothing", async () => {
  const f = loadedFixture();
  await f.respond([]); // settle the load's pass, or the reset only queues
  f.sent.length = 0;

  f.host.newWorld();
  // The protocol has no reset verb: a world swap says so by listing the outgoing
  // keys, or the mirror keeps analysing a field that is gone.
  const sync = f.of("sync").at(-1);
  expect(sync?.removed).toEqual([chunkKey(0, 0, 0)]);
  expect(sync?.upserts).toEqual([]);
  // No pass follows — an empty world has no field and, with no manifest, no
  // spawn to seed from. Inventing one is the one thing an advisor must not do.
  expect(f.of("analyze")).toEqual([]);
});

test("a reused chunk key is UPSERTED, never removed alongside itself", async () => {
  const f = fixture();
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [
      { key: chunkKey(0, 0, 0), bytes: solidChunk() },
      { key: chunkKey(9, 0, 0), bytes: solidChunk() },
    ],
    oplog: null,
  });
  // Load the SECOND world with the first pass still unanswered — the ordinary
  // case, since a pass is in flight for most of an edit session. Both worlds'
  // messages then collapse into the one fire that follows, which is what puts
  // an outgoing key and an incoming one in the SAME sync.
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: solidChunk() }],
    oplog: null,
  });
  f.sent.length = 0;
  await f.respond([]);

  // The second world keeps "0,0,0" and drops "9,0,0". The worker applies upserts
  // BEFORE removals, so listing "0,0,0" in both would delete the chunk that was
  // just sent — and the analyzer would then read a hole that is not there.
  const sync = f.of("sync").at(-1);
  expect(sync?.upserts.map((u) => u.key)).toEqual([chunkKey(0, 0, 0)]);
  expect(sync?.removed).toEqual([chunkKey(9, 0, 0)]);
});

test("subscribeFlags pushes on subscribe and on every response", async () => {
  const f = loadedFixture();
  // The subscribe catch-up plus the world reset the load did — both empty.
  expect(f.pushes.length).toBeGreaterThan(0);
  expect(f.pushes.at(-1)?.total).toBe(0);

  await f.respond([
    {
      key: "0,0,0",
      flags: [
        flag("narrow", "candidate", [1, 0, 0], "0,0,0"),
        flag("ledge", "info", [2, 0, 0], "0,0,0"),
      ],
    },
  ]);
  expect(f.pushes.at(-1)?.total).toBe(2);
  // Default filters: candidates shown, info hidden.
  expect(kinds(f.pushes.at(-1))).toEqual(["narrow"]);
  // The marker layer agrees with the list — one draw per VISIBLE finding.
  expect(f.host.flagMarkerCount()).toBe(1);
});

test("setFlagFilters re-publishes: the view changes, the findings do not", async () => {
  const f = loadedFixture();
  await f.respond([
    {
      key: "0,0,0",
      flags: [
        flag("narrow", "candidate", [1, 0, 0], "0,0,0"),
        flag("ledge", "info", [2, 0, 0], "0,0,0"),
      ],
    },
  ]);
  f.host.setFlagFilters({ candidates: true, info: true, unreachable: false });
  expect(f.host.flagMarkerCount()).toBe(2);
  expect(f.pushes.at(-1)?.visible).toHaveLength(2);

  // A filter never deletes (D-F4-1): hiding everything empties the VIEW and
  // leaves the findings standing.
  f.host.setFlagFilters({ candidates: false, info: false, unreachable: false });
  expect(f.host.flagMarkerCount()).toBe(0);
  expect(f.pushes.at(-1)?.visible).toEqual([]);
  expect(f.pushes.at(-1)?.total).toBe(2);
});

test("a world reset clears the findings and tells the subscriber", async () => {
  const f = loadedFixture();
  await f.respond([
    { key: "0,0,0", flags: [flag("narrow", "candidate", [1, 0, 0], "0,0,0")] },
  ]);
  expect(f.host.flagMarkerCount()).toBe(1);
  f.host.newWorld();
  expect(f.pushes.at(-1)?.total).toBe(0);
  expect(f.host.flagMarkerCount()).toBe(0);
});

test("the whole-world trap set rides the same response and reaches the view", async () => {
  const f = loadedFixture();
  await f.respond(
    [
      {
        key: "0,0,0",
        flags: [flag("narrow", "candidate", [1, 0, 0], "0,0,0")],
      },
    ],
    [flag("pit", "candidate", [4, 0, 4], "0,0,0")],
  );
  // Traps are held BESIDE the per-chunk findings (they fit no owner chunk) and
  // presented with them. What the two stores do to each other across responses
  // is `field-flags.test.ts`' subject; this is the host's plumbing of `pits`.
  expect(kinds(f.pushes.at(-1))).toEqual(["narrow", "pit"]);
  expect(f.host.flagMarkerCount()).toBe(2);
});

test("the real handler answers a loaded world end to end", async () => {
  const f = fixture();
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }],
    oplog: null,
  });
  await f.deliver();
  expect(f.errors).toEqual([]);
  // The chamber's LOW half has 1.5 m of headroom under a 1.8 m capsule
  // clearance, so the tall half's cells flag it `low-clearance` — a CANDIDATE,
  // which the default filters show.
  const summary = lastSummary(f.pushes);
  expect(summary.total).toBeGreaterThan(0);
  expect(summary.visible.length).toBeGreaterThan(0);
  expect(summary.visible.every((r) => r.flag.severity === "candidate")).toBe(
    true,
  );
  expect(f.host.flagMarkerCount()).toBe(summary.visible.length);
});

test("a worker-side failure surfaces as a tool problem, not a silent stall", async () => {
  const f = loadedFixture();
  await f.respond([]); // settle the load's pass, or the bad profile only queues
  // Core's profile gate is setup-loud, and the worker turns its throw into a
  // typed analyzer-error rather than a dropped job. An advisor that had gone
  // quiet with no explanation would read as "your world is clean".
  f.host.setAgentProfile({ ...AGENT, climbCeiling: AGENT.stepHeight });
  await f.deliver();
  expect(f.errors.at(-1)).toContain("walkability analyzer:");
  expect(f.errors.at(-1)).toContain("climbCeiling");
});

// --- stage 2: the verify verb (D-F4-13) --------------------------------------
//
// `verifyFlag` is the ONE host path that reaches the project's own mover. What
// it must get right is small and all refusal: the right flag, the right profile,
// one at a time, and four things it declines to post at all. The verdict's
// CONTENT is the dungeon's business (`walk-probe.test.ts`), and that the whole
// stack actually runs off-thread is `analyzer-verify.test.ts`' — which drives
// this same verb against the real engine bundle.

const VERDICT: VerifyVerdictWire = {
  outcome: "clear",
  lanes: [{ dir: [1, 0], outcome: "clear", progressed: 3.5 }],
  ms: 42,
};

/** A stage-2 engine that answers with {@link VERDICT} and records what it was
 *  asked, so a test can check the host handed over the flag the user clicked. */
function cannedEngine(): AnalyzerEngine & {
  asked: { flag: FieldFlag; budgetMs: number }[];
} {
  const asked: { flag: FieldFlag; budgetMs: number }[] = [];
  return {
    asked,
    analyzerVerify: (opts) => {
      asked.push({ flag: opts.flag, budgetMs: opts.budgetMs });
      return Promise.resolve(VERDICT);
    },
  };
}

/** An engine whose verify never settles on its own — the in-flight state, held
 *  open so a second request can be attempted against it. */
function hangingEngine(): AnalyzerEngine & { release: () => void } {
  let release = (): void => undefined;
  return {
    release: () => release(),
    analyzerVerify: () =>
      new Promise<VerifyVerdictWire>((resolve) => {
        release = () => resolve(VERDICT);
      }),
  };
}

/** The chamber loaded, stage 1 settled, and the key of a finding the panel would
 *  actually show — the state every verify starts from. */
async function verifiableFixture(engine: AnalyzerEngine) {
  const f = fixture(AGENT, engine);
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }],
    oplog: null,
  });
  await f.deliver();
  const row = lastSummary(f.pushes).visible[0];
  if (row === undefined)
    throw new Error("test: stage 1 found nothing to verify");
  return { ...f, row };
}

// `deliver` SPLICES `sent`, so every assertion about what was POSTED is taken
// before it runs — the request lands synchronously (postMessage is called inside
// the client's promise executor), so there is nothing to wait for.

test("verifyFlag drives stage 2 at the named finding and joins the verdict on", async () => {
  const engine = cannedEngine();
  const f = await verifiableFixture(engine);
  f.host.verifyFlag(f.row.key);

  const req = f.of("verify").at(-1);
  // The project's OWN bundle, its OWN capsule — stage 2 exists to test the code,
  // not a generic mover, so both have to be the project's.
  expect(req?.engineUrl).toBe("/engine.js");
  expect(req?.profile).toEqual(AGENT);
  expect(req?.budgetMs).toBeGreaterThan(0);
  // The flag the ROW named, not merely some flag: a verify taken on the wrong
  // finding answers a question nobody asked and badges the wrong row.
  expect(req?.flag.cell).toEqual(f.row.flag.cell);

  await f.deliver();
  // …and the worker handed the SAME flag and budget to the engine — the request
  // shape above is only half the path.
  expect(engine.asked.at(-1)?.flag.cell).toEqual(f.row.flag.cell);
  expect(engine.asked.at(-1)?.budgetMs).toBe(req?.budgetMs ?? -1);

  // The answer comes back JOINED onto the row it was taken on — one summary, no
  // separate verdict channel for the panel to line up itself.
  const verified = lastSummary(f.pushes).visible.find(
    (r) => r.key === f.row.key,
  );
  expect(verified?.verdict).toEqual(VERDICT);
  expect(f.errors).toEqual([]);
});

test("a verdict that outlives its WORLD is dropped, not attached", async () => {
  // The one staleness case the flag store's own rule cannot reach: `resetWorld`
  // has already run `clear()`, so a verdict landing afterwards is a fresh entry
  // in an emptied map rather than a stale one waiting to be dropped.
  //
  // The reload is what makes it OBSERVABLE. Findings key on (kind, cell), so a
  // world reloaded from the same chunks produces the very same keys — which is
  // exactly when an ungated late verdict stops being inert and starts badging a
  // row of a field it was never taken on.
  const engine = hangingEngine();
  const f = fixture(AGENT, engine);
  const chunks = [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }];
  f.host.loadWorld({ manifest: manifest(), chunks, oplog: null });
  const canned = [
    {
      key: "0,0,0" as ChunkKey,
      flags: [flag("narrow", "candidate", [1, 0, 0], "0,0,0")],
    },
  ];
  await f.respond(canned);
  const key = lastSummary(f.pushes).visible[0]?.key;
  if (key === undefined) throw new Error("test: no row to verify");

  f.host.verifyFlag(key);
  const draining = f.deliver();
  await f.flush(); // the verify is now suspended inside the engine

  // Swap the world out and back in while it hangs, and let the SAME finding
  // return — answered directly, so it lands before the verdict does.
  f.host.newWorld();
  f.host.loadWorld({ manifest: manifest(), chunks, oplog: null });
  await f.respond(canned);
  expect(lastSummary(f.pushes).visible.map((r) => r.key)).toEqual([key]);

  engine.release();
  await draining;
  // The row is back and carries NO verdict: a wrong verdict wearing a current
  // row's clothes is worse than none, and the finding simply stands unverified.
  expect(
    lastSummary(f.pushes).visible.find((r) => r.key === key)?.verdict,
  ).toBe(undefined);
  expect(f.errors).toEqual([]);
});

test("a second verify while one runs is REFUSED, never queued", async () => {
  const engine = hangingEngine();
  const f = await verifiableFixture(engine);
  const second = lastSummary(f.pushes).visible[1];
  if (second === undefined) throw new Error("test: need two findings");

  f.host.verifyFlag(f.row.key);
  expect(f.of("verify")).toHaveLength(1);
  // Drive it INTO the worker and leave it there. The flush is load-bearing: the
  // protocol dispatches off a promise TAIL, so `deliver` alone has not yet
  // entered `analyzerVerify` and the release below would arm nothing. After it,
  // `deliver` has spliced the queue and is suspended inside the hanging verify,
  // so anything the host posts from here on appends to an empty `sent`.
  const draining = f.deliver();
  await f.flush();

  f.host.verifyFlag(second.key);
  // Budgeted seconds of real mover: a queued second one would run against a
  // field the first may have outlived, with nothing on screen saying so.
  expect(f.sent).toEqual([]);
  expect(f.errors.at(-1)).toBe("a verify is already running");

  // …and the latch RELEASES: once the first answers, the next is accepted.
  engine.release();
  await draining;
  f.host.verifyFlag(second.key);
  expect(f.of("verify").at(-1)?.flag.cell).toEqual(second.flag.cell);
});

test("a key no finding holds is refused — the analyzer moved on", async () => {
  const f = await verifiableFixture(cannedEngine());
  // The reachable race: the panel renders a row, an edit's re-analysis replaces
  // that chunk's findings, and the click lands on a key nothing answers to. The
  // host must SAY so — a silent no-op reads as a dead button.
  f.host.verifyFlag("narrow@999,999,999");
  await f.deliver();
  expect(f.of("verify")).toEqual([]);
  expect(f.errors.at(-1)).toBe("that flag was re-analyzed away");
});

test("a pit is refused HERE, not only greyed out in the panel", async () => {
  const f = fixture(AGENT, cannedEngine());
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }],
    oplog: null,
  });
  await f.respond([], [flag("pit", "candidate", [4, 0, 4], "0,0,0")]);
  const pit = lastSummary(f.pushes).visible.find((r) => r.flag.kind === "pit");
  if (pit === undefined) throw new Error("test: no pit row");

  // The panel disables this button, but the panel is not the enforcement point
  // — a stale render, a keyboard activation on a control React has not
  // re-disabled yet, or any future caller all reach the host directly. Stage 2
  // drives DIRECTED lanes at ONE anchor cell, and a pit is a whole region: one
  // anchor's lanes would prove nothing about it, so the answer would be
  // meaningless rather than merely expensive.
  f.host.verifyFlag(pit.key);
  await f.deliver();
  expect(f.of("verify")).toEqual([]);
  expect(f.errors.at(-1)).toContain("region-level — walk it");
});

test("with no agent profile a verify refuses instead of posting a bad request", async () => {
  // Unreachable through the panel today (no profile means no findings, so no
  // row and no button) — but the profile arrives off an async fetch and the
  // request cannot even be BUILT without one, so the guard is what stops a
  // malformed post rather than a decoration.
  const f = fixture(null, cannedEngine());
  f.host.verifyFlag("narrow@0,0,0");
  await f.deliver();
  expect(f.of("verify")).toEqual([]);
  expect(f.errors.at(-1)).toContain("agent profile");
});

test("a stage-2 failure surfaces as a tool problem and releases the latch", async () => {
  const failing: AnalyzerEngine = {
    analyzerVerify: () => Promise.reject(new Error("rapier wasm never loaded")),
  };
  const f = await verifiableFixture(failing);
  f.host.verifyFlag(f.row.key);
  await f.deliver();
  expect(f.errors.at(-1)).toContain("rapier wasm never loaded");

  // The latch must not wedge on a failure: a verify that died has to leave the
  // verb usable, or one bad bundle costs the rest of the session.
  f.host.verifyFlag(f.row.key);
  expect(f.of("verify")).toHaveLength(1);
});

/** `dispose()` calls `cancelAnimationFrame`, which bun does not define. Stubbed
 *  only for the one test that disposes — nothing here schedules a frame. */
function stubCancelAnimationFrame(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = "cancelAnimationFrame" in g;
  const prev = g["cancelAnimationFrame"];
  g["cancelAnimationFrame"] = () => undefined;
  return () => {
    if (had) g["cancelAnimationFrame"] = prev;
    else delete g["cancelAnimationFrame"];
  };
}

test("dispose stops the advisor — no stray pass, no second worker", async () => {
  const restoreCaf = stubCancelAnimationFrame();
  const f = fixture();
  f.host.loadWorld({
    manifest: manifest(),
    chunks: [{ key: chunkKey(0, 0, 0), bytes: chamberChunk() }],
    oplog: null,
  });
  // Deliberately NOT drained: a pass is in flight and another is queued behind
  // it, which is the ordinary state of an edit session and the only state this
  // path is reachable from.
  expect(f.spawns.count).toBe(1);
  const before = f.sent.length;

  f.host.dispose();
  // `analyzer.dispose()` rejects the in-flight job, the pump's catch settles its
  // latch, and the queued request re-fires — from inside a disposed host. With
  // no guard that fire posts sync + placements + analyze, and the client's lazy
  // `ensure()` spawns a FRESH worker to take them.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.sent.length).toBe(before);
  expect(f.spawns.count).toBe(1);
  restoreCaf();
});
