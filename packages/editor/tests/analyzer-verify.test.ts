// P-F4-2, the tranche-B spike: does the stage-2 verify actually RUN inside the
// analyzer worker? It needs four things to line up at once — the project's
// /engine.js bundle importing in a worker realm, a headless PhysicsContext with
// no GPU behind it, Rapier's wasm initialising there, and the shipped
// CharacterMover being driven at a flag. Any one of them missing is a NO-GO for
// the whole verify verb, and none of the unit tests can see it (they inject a
// fake engine).
//
// So this rides the REAL path: the real daemon, serving the real dungeon project,
// bundling the real extensions entry; the real AnalyzerWorkerClient; the real
// analyzer-worker.ts entry, spawned as an actual Worker.
//
// TWO honest deviations from "the real path", both about the RUNTIME and neither
// about the code under test:
//  1. Plain `bun test`, not a `.gpu.test.ts`. Nothing here needs a GPU — that is
//     half of what the spike is proving — so gating it on bun-webgpu would only
//     hide the answer on machines without it.
//  2. The worker imports the bundle from a FILE, not from the daemon's URL. Bun
//     cannot dynamically import over http (`import("http://…")` fails with
//     `ENOENT reading "http://…"`, measured 2026-07-26), so the test fetches
//     /engine.js from the running daemon and writes those exact bytes to a temp
//     file. The artifact is the daemon's; only the transport differs, and a Bun
//     Worker is an approximation of a browser worker regardless. The browser
//     truth is Task 13's job.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentProfile, FieldFlag, FieldStore } from "@furnace/core/field";
import {
  AIR,
  analyzeWorld,
  createFieldStore,
  encodeChunkFile,
  SOLID,
  setDensity,
} from "@furnace/core/field";
import { type RunningServer, startServer } from "../src/daemon/server.ts";
import { AnalyzerWorkerClient } from "../src/viewport-host/analyzer-client.ts";
import type { AnalyzerRequest } from "../src/viewport-host/analyzer-protocol.ts";
import type { WorkerLike } from "../src/viewport-host/field-client.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FlagsSummary } from "../src/viewport-host/index.ts";
import { stubCancelAnimationFrame } from "./_helpers/raf.ts";

const DUNGEON_ROOT = resolve(import.meta.dir, "../../dungeon");
const WORKER_ENTRY = new URL(
  "../src/frontend/analyzer-worker.ts",
  import.meta.url,
);
/** Generous: a 4-lane verify of a small fixture runs in ~100 ms (the dungeon's
 *  own walk-probe tests measure that), and a budget-starved verdict would prove
 *  less than the spike is asking for. */
const BUDGET_MS = 10_000;
const CELL = 0.25;

let server: RunningServer;
/** The daemon's own /engine.js bytes, on disk for the worker to import. */
let engineUrl: string;
/** The dungeon's shipped agent, read out of that same bundle — no restated
 *  literal to drift from `catalog/agent.json` (D-F4-4), and proof in passing
 *  that the bundle carries it. */
let agent: AgentProfile;

beforeAll(async () => {
  server = await startServer({
    root: DUNGEON_ROOT,
    port: 0,
    staticDir: join(tmpdir(), `furnace-no-chrome-${Date.now()}`),
  });
  const res = await fetch(`http://127.0.0.1:${server.port}/engine.js`);
  expect(res.status).toBe(200);
  const code = await res.text();
  engineUrl = join(
    mkdtempSync(join(tmpdir(), "furnace-analyzer-")),
    "engine.mjs",
  );
  writeFileSync(engineUrl, code);
  const mod = (await import(engineUrl)) as {
    extensions: { AGENT: AgentProfile };
  };
  agent = mod.extensions.AGENT;
}, 120_000);

afterAll(() => server.close());

/** Inclusive cell box (the walk-probe fixture's helper). */
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

/** A dug corridor with one 0.5 m step up half way along — above `stepHeight`
 *  (0.4 m) so stage 1 flags it, inside the mover's measured climb ceiling
 *  (0.7 m) so stage 2 has something real to drive at. */
function steppedCorridor(): FieldStore {
  const store = createFieldStore(CELL);
  box(store, [-2, 41, -2, 17, -2, 13], SOLID);
  box(store, [0, 19, 0, 15, 0, 11], AIR);
  box(store, [20, 39, 2, 15, 0, 11], AIR);
  return store;
}

/** A world point standing on the corridor's LOWER floor — the seed the
 *  connectivity passes flood from (an unseeded pass demotes nothing and finds no
 *  traps, which would make the fixture quieter than the code under test). */
const CORRIDOR_START: [number, number, number] = [
  4 * CELL,
  0.5 * CELL,
  5 * CELL,
];

const LANE_OUTCOMES = new Set([
  "clear",
  "trap",
  "no-lane",
  "blocked-upstream",
  "levitating",
  "fell",
  "budget",
]);

test("P-F4-2: the real analyzer worker verifies a flag against the daemon's own engine bundle", async () => {
  const store = steppedCorridor();
  const flags = [...analyzeWorld(store, agent).values()].flat();
  const flag: FieldFlag | undefined = flags[0];
  expect(flag).toBeDefined();
  if (flag === undefined) return;

  const client = new AnalyzerWorkerClient(
    () =>
      // Boundary cast: Bun's Worker stands in for the browser's, and the
      // entry is the .ts source rather than the built bundle (bun resolves it).
      new Worker(WORKER_ENTRY, { type: "module" }) as unknown as WorkerLike,
  );
  try {
    await client.sync(
      store.cellSize,
      [...store.chunks].map(([key, density]) => ({
        key,
        density: density.slice().buffer as ArrayBuffer,
      })),
      [],
    );
    const { verdict } = await client.verify({
      engineUrl,
      flag,
      profile: agent,
      budgetMs: BUDGET_MS,
    });

    // The GO condition: a verdict came back at all. Its VALUE is the dungeon's
    // business (walk-probe.test.ts pins the semantics) — what this proves is
    // that the whole stack ran off the main thread.
    expect(["trapped", "clear", "inconclusive"]).toContain(verdict.outcome);
    expect(verdict.ms).toBeGreaterThan(0);
    expect(verdict.lanes.length).toBeGreaterThan(0);
    for (const lane of verdict.lanes)
      expect(LANE_OUTCOMES).toContain(lane.outcome);
    // …and that the MOVER actually RAN, which is the load-bearing half of the
    // claim this test exists to make. `progressed` is the only field that
    // proves it: `walk-probe.ts` returns `no-lane` with `progressed: 0` BEFORE
    // it constructs the CharacterMover, and a non-zero value can only come from
    // `maxAlong - startAlong` after the drive loop. So a positive `progressed`
    // means a capsule was built, stepped and MOVED under the shipped
    // controller. (A weaker "some lane is not `budget`" is satisfied by an
    // all-`no-lane` verdict, in which the mover is never constructed at all.)
    expect(verdict.lanes.some((l) => l.progressed > 0)).toBe(true);
  } finally {
    client.dispose();
  }
}, 120_000);

// --- the same stack, driven from the HOST's verb (F4 Task 12) ----------------
//
// The spike above proves the analyzer worker CAN verify. This proves the editor
// does: `FieldHost.verifyFlag(key)` — the only thing the Flags panel calls — all
// the way to the project's shipped mover and back onto the row it was taken on.
// Everything between is real: the real host, its real analyzer client, the real
// worker entry as an actual Worker, the daemon's own /engine.js bytes.
//
// The ONE substitution is the engineUrl, for the transport reason in this file's
// header (Bun cannot `import()` over http). The host names "/engine.js"; the
// proxy below rewrites exactly that field of exactly the `verify` request, and
// nothing else crosses altered.

/** The real worker entry, spawned, with the verify request's engineUrl pointed
 *  at the on-disk copy of the daemon's bundle. */
function spawnRewritingAnalyzer(): WorkerLike {
  // Boundary cast: Bun's Worker stands in for the browser's (the spike's note).
  const real = new Worker(WORKER_ENTRY, {
    type: "module",
  }) as unknown as WorkerLike;
  return {
    postMessage(msg) {
      const req = msg as AnalyzerRequest;
      real.postMessage(req.kind === "verify" ? { ...req, engineUrl } : req);
    },
    terminate: () => real.terminate(),
    get onmessage() {
      return real.onmessage;
    },
    set onmessage(fn) {
      real.onmessage = fn;
    },
  };
}

/** Poll `read` until it returns a value, or fail with `what` in the message.
 *  A real Worker answers on its own schedule, so nothing here can be awaited
 *  directly — the host's seams are push-based and fire-and-forget. */
async function until<T>(
  what: string,
  read: () => T | undefined,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = read();
    if (got !== undefined) return got;
    if (Date.now() > deadline)
      throw new Error(`test: timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("FieldHost.verifyFlag drives the project's real mover end to end", async () => {
  const restoreCaf = stubCancelAnimationFrame();
  const host = createFieldHost({ spawnAnalyzer: spawnRewritingAnalyzer });
  const summaries: FlagsSummary[] = [];
  const errors: string[] = [];
  try {
    host.subscribeToolError((m) => errors.push(m));
    host.subscribeFlags((s) => summaries.push(s));
    // Every band, so the row this verifies is whichever one stage 1 finds —
    // the test is about the VERB, not about core's severity assignment.
    host.setFlagFilters({
      candidates: true,
      info: true,
      unreachable: true,
      pits: true,
    });
    host.setAgentProfile(agent);

    const store = steppedCorridor();
    host.loadWorld({
      manifest: {
        version: 2,
        kind: "field",
        cellSize: CELL,
        playerStart: CORRIDOR_START,
        playerYaw: 0,
        chunks: [],
        meshes: [],
      },
      chunks: [...store.chunks].map(([key, density]) => ({
        key,
        bytes: encodeChunkFile(density),
      })),
      oplog: null,
    });

    // Stage 1, in a real worker thread. A `pit` is refused by the verb (a
    // region-level finding), so the row picked here is any other kind.
    const row = await until("a verifiable stage-1 finding", () =>
      summaries.at(-1)?.visible.find((r) => r.flag.kind !== "pit"),
    );
    expect(errors).toEqual([]);

    host.verifyFlag(row.key);
    const verdict = await until(
      "the stage-2 verdict",
      () => summaries.at(-1)?.visible.find((r) => r.key === row.key)?.verdict,
    );

    // The GO condition, restated at the HOST's level: the panel's own verb put a
    // real verdict on the row the user clicked. Its VALUE is the dungeon's
    // business; that the shipped CharacterMover ran is `progressed`, for the
    // reason spelled out in the spike above.
    expect(["trapped", "clear", "inconclusive"]).toContain(verdict.outcome);
    expect(verdict.ms).toBeGreaterThan(0);
    expect(verdict.lanes.some((l) => l.progressed > 0)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    host.dispose();
    restoreCaf();
  }
}, 120_000);
