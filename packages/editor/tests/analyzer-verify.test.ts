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
  SOLID,
  setDensity,
} from "@furnace/core/field";
import { type RunningServer, startServer } from "../src/daemon/server.ts";
import { AnalyzerWorkerClient } from "../src/frontend/lib/analyzer-client.ts";
import type { WorkerLike } from "../src/frontend/lib/field-client.ts";

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
    console.log(
      `P-F4-2 verdict: ${JSON.stringify(verdict)} (flag ${flag.kind} @ ${flag.cell.join(",")})`,
    );
  } finally {
    client.dispose();
  }
}, 120_000);
