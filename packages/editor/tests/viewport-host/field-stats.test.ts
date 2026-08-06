import { describe, expect, test } from "bun:test";
import type * as binding from "@furnace/core/binding";
import * as field from "@furnace/core/field";
import type * as geometry from "@furnace/core/geometry";
import type * as gpu from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import type * as mesh from "@furnace/core/mesh";
import { FieldWorkerClient } from "../../src/viewport-host/field-client";
import { createFlagStore } from "../../src/viewport-host/field-flags";
import type { FieldStats } from "../../src/viewport-host/field-host";
import { createStatsMeter } from "../../src/viewport-host/field-stats";
import {
  type ChunkRender,
  createHostSubstrate,
  type PropRender,
} from "../../src/viewport-host/substrate";

// THE NEW SEAM ONLY. The eleven payload numbers themselves are pinned where they
// have always been — through `FieldHost.subscribeStats` in the GPU suites
// (`field-host-reinit`, `field-host-analyzer`, `field-host-void-cast`,
// `bundle`) — and those ran unmodified across the extraction, which is what
// makes them the pins. What did not exist before T3b1 is a meter that can be
// asked WITHOUT a host: `noteReconfigureMs` (the boundary write `stamp` used to
// perform as an assignment) and `publishIfWatched` (the guard `tick` used to
// hold). Those two are what this file covers.

/** The spawn the fake worker client never makes: `FieldWorkerClient` spawns
 *  lazily on its first request, and this suite never issues one — so a thrower
 *  here is a tripwire rather than a stub. */
const noWorker = () => {
  throw new Error("field-stats.test: no worker should be spawned");
};

const noContext: typeof gpu.requestContext = () =>
  Promise.reject(
    new Error("field-stats.test: no GPU context should be requested"),
  );

/** An op log whose `ops` array reports every READ of it.
 *
 *  The instrument behind the zero-subscriber case. `currentLogStats` touches
 *  `log.ops.length` first thing on every call and `field.logStats` walks `ops`
 *  again, so a read count of zero across a `publishIfWatched()` is proof the
 *  cache was never consulted — the one payload input that is not an injected
 *  thunk and therefore cannot be counted like one. */
const countingLog = (): { log: field.OpLog; reads: () => number } => {
  const log = field.createOpLog();
  const ops = log.ops;
  let reads = 0;
  Object.defineProperty(log, "ops", {
    get() {
      reads++;
      return ops;
    },
    configurable: true,
  });
  return { log, reads: () => reads };
};

/** The substrate members this module never touches, as cheap stand-ins. Only
 *  `store` and `log` are read by the meter; the rest are here because the
 *  record's whole point is that the shape is complete. */
const otherSubstrateMembers = () => ({
  dirty: new Set<string>(),
  worker: new FieldWorkerClient(noWorker),
  chunkMeshes: new Map<string, ChunkRender>(),
  flagStore: createFlagStore(),
  requestContext: noContext,
  litByClass: new Map<
    string,
    { mat: material.Material; bind: binding.Binding }
  >(),
  propMeshes: [] as PropRender[],
  ghostMeshes: new Map<string, { m: mesh.Mesh; g: geometry.Geometry }[]>(),
  voidCastMeshes: new Map<string, { m: mesh.Mesh; g: geometry.Geometry }[]>(),
  table: () => field.BUILTIN_TABLE,
  archetypeById: () => new Map(),
  ctx: () => null,
  disposed: () => false,
  canvasEl: () => null,
});

/** A meter over counted dependencies. Every payload input is either an injected
 *  thunk with a call counter or the counting log above, so "built nothing" is a
 *  claim the test can check rather than infer. */
const meterUnderTest = () => {
  const { log, reads: logReads } = countingLog();
  const calls = {
    lastRemeshMs: 0,
    remeshVersion: 0,
    voidCastJobGen: 0,
    analyzerPendingCount: 0,
  };
  const store = field.createFieldStore();
  const meter = createStatsMeter({
    substrate: createHostSubstrate({
      ...otherSubstrateMembers(),
      store,
      log,
    }),
    lastRemeshMs: () => {
      calls.lastRemeshMs++;
      return 4;
    },
    remeshVersion: () => {
      calls.remeshVersion++;
      return 7;
    },
    voidCastJobGen: () => {
      calls.voidCastJobGen++;
      return null;
    },
    analyzerPendingCount: () => {
      calls.analyzerPendingCount++;
      return 1;
    },
  });
  // AFTER construction, deliberately: `cachedLogStats` is initialised with an
  // eager `field.logStats(log)` (moved verbatim from the closure), so the log
  // has already been read once by the time the meter exists. Counting from zero
  // here is what makes the assertions below about `publishIfWatched` alone.
  const before = logReads();
  return { meter, calls, logReads: () => logReads() - before };
};

describe("createStatsMeter", () => {
  test("noteReconfigureMs is visible in the NEXT publish", () => {
    const { meter } = meterUnderTest();
    const seen: FieldStats[] = [];
    meter.subscribe((s) => seen.push(s));

    // Nothing has landed yet: the field reads 0, which is its documented "no
    // reconfigure has run this session" value rather than an absence.
    meter.publishIfWatched();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.lastReconfigureMs).toBe(0);

    // The boundary write `applyReconfigureSession` performs. It publishes
    // nothing itself — the readout is frame-paced, so the number surfaces on the
    // next tick, exactly as the bare assignment it replaced did.
    meter.noteReconfigureMs(12.5);
    expect(seen).toHaveLength(1);

    meter.publishIfWatched();
    expect(seen).toHaveLength(2);
    expect(seen[1]?.lastReconfigureMs).toBe(12.5);
  });

  test("publishIfWatched with ZERO subscribers builds nothing", () => {
    const { meter, calls, logReads } = meterUnderTest();

    meter.publishIfWatched();
    meter.publishIfWatched();
    meter.publishIfWatched();

    // The claim in full: not one payload input was evaluated. This is what the
    // `size() > 0` guard is for — an unwatched host runs the loop at 60 Hz, and
    // every headless test that drives `tick` is such a host, so a payload built
    // for nobody is an O(ops) log scan plus an analyzer poll per frame, forever.
    expect(calls).toEqual({
      lastRemeshMs: 0,
      remeshVersion: 0,
      voidCastJobGen: 0,
      analyzerPendingCount: 0,
    });
    // And the log-signature cache was never consulted either — the guard wraps
    // `currentLogStats()`, which the closure ran one line ABOVE it. That is the
    // one behavioural change T3b1 took here, and this is the line that pins it.
    expect(logReads()).toBe(0);

    // Same meter, now watched: every input is read exactly once, so the zeros
    // above are the guard's doing and not a meter that cannot count.
    const heard: FieldStats[] = [];
    meter.subscribe((s) => heard.push(s));
    meter.publishIfWatched();
    expect(heard).toHaveLength(1);
    expect(calls).toEqual({
      lastRemeshMs: 1,
      remeshVersion: 1,
      voidCastJobGen: 1,
      analyzerPendingCount: 1,
    });
    expect(logReads()).toBeGreaterThan(0);
  });
});
