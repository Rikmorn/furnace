import { describe, expect, test } from "bun:test";
import type * as binding from "@furnace/core/binding";
import * as field from "@furnace/core/field";
import type * as geometry from "@furnace/core/geometry";
import type * as gpu from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import type * as mesh from "@furnace/core/mesh";
import { FieldWorkerClient } from "../../src/field-host/field-client";
import { createFlagStore } from "../../src/field-host/field-flags";
import type { FieldLayers } from "../../src/field-host/field-host";
import { createView } from "../../src/field-host/field-view";
import {
  type ChunkRender,
  createHostSubstrate,
  type PropRender,
} from "../../src/field-host/substrate";

// TWO DECISIONS, BOTH FOUND UNPINNED BY SABOTAGE during T3b1 Task 5, and neither
// of them new — this file covers behaviour the closure had all along and nothing
// ever asserted. The transcript, run against the full editor suite (1364 pass):
//
//   - delete `if (y === sliceY) return` from `setSlice`      → 1364 pass, 0 fail
//   - `else if (!wasVoidCast)` → `else` in `setLayers`       → 1364 pass, 0 fail
//   - never call `discardVoidCast` on the off transition     → 1364 pass, 0 fail
//
// Why the thirteen `setLayers` calls in `field-host-void-cast.gpu.test.ts` miss
// all three: every one of them toggles, so the edge and the level agree in each
// case, and what they assert is what the WORKER was sent — which `requestVoidCast`
// decides for itself behind four refusals of its own. The discard is worse still:
// its whole effect is on GPU meshes nothing headless can look at and on a
// generation the module keeps private. So the gap is not that the void cast is
// untested; it is that `setLayers`' own DECISION — the three-way choice between
// discard, request and do-nothing — had no window onto it until this module gave
// it a seam, and `setSlice`'s guard had none at all (no host test calls it; the
// chrome suites drive a mock).
//
// The guard matters for the reason `useFieldHostState` names on the other side of
// the seam: the chrome re-sends view state on identity alone, so an unguarded
// `setSlice` would re-mark every allocated chunk for a remesh on renders that
// changed nothing.

/** The spawn the fake worker client never makes: `FieldWorkerClient` spawns
 *  lazily on its first request, and this suite never issues one — so a thrower
 *  here is a tripwire rather than a stub. */
const noWorker = () => {
  throw new Error("field-view.test: no worker should be spawned");
};

const noContext: typeof gpu.requestContext = () =>
  Promise.reject(
    new Error("field-view.test: no GPU context should be requested"),
  );

/** The substrate members this module never touches, as cheap stand-ins. Only
 *  `store` and `dirty` are read by the view state; the rest are here because the
 *  record's whole point is that the shape is complete. */
const otherSubstrateMembers = () => ({
  log: field.createOpLog(),
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

/** A view over a store holding `chunks` allocated chunks, with the two void-cast
 *  verbs counted. `setDensity` allocates on first touch, so one write per chunk
 *  is the cheapest way to give `setSlice` something to re-mark. */
const viewUnderTest = (chunks = 3) => {
  const store = field.createFieldStore();
  for (let i = 0; i < chunks; i++)
    field.setDensity(store, i * field.CHUNK_DIM, 0, 0, field.AIR);
  const dirty = new Set<string>();
  const calls = { discard: 0, request: 0 };
  const view = createView({
    substrate: createHostSubstrate({
      ...otherSubstrateMembers(),
      store,
      dirty,
    }),
    discardVoidCast: () => {
      calls.discard++;
    },
    requestVoidCast: () => {
      calls.request++;
    },
  });
  return { view, dirty, calls, chunkCount: store.chunks.size };
};

/** The default flags with `voidCast` set — the shape the chrome sends. */
const layers = (voidCast: boolean): FieldLayers => ({
  field: true,
  kit: true,
  props: true,
  ghost: true,
  selection: true,
  grid: true,
  flags: true,
  voidCast,
});

describe("createView", () => {
  test("setSlice value-guards, and a real move re-marks every allocated chunk", () => {
    const { view, dirty, chunkCount } = viewUnderTest();
    expect(chunkCount).toBe(3);

    // The plane starts off, so `null` is a repeat of the value already held —
    // the first call in a session can be a no-op, which is exactly what the
    // chrome's boot sequence sends.
    view.setSlice(null);
    expect(dirty.size).toBe(0);
    expect(view.sliceY()).toBe(null);

    // A genuine move: every allocated chunk owes a remesh through the new clip.
    view.setSlice(4);
    expect(view.sliceY()).toBe(4);
    expect(dirty.size).toBe(3);

    // The guard's teeth. A slider drag re-sends the same number many times, and
    // an unguarded setter would re-mark the whole world on each one. Drain the
    // set first so a repeat that did any work would show as a non-empty set
    // rather than as an unchanged one.
    dirty.clear();
    view.setSlice(4);
    view.setSlice(4);
    expect(dirty.size).toBe(0);
    expect(view.sliceY()).toBe(4);

    // …and the guard is a VALUE compare, not a truthiness one: switching the
    // plane off from y=0 is a real change.
    view.setSlice(0);
    dirty.clear();
    view.setSlice(null);
    expect(view.sliceY()).toBe(null);
    expect(dirty.size).toBe(3);
  });

  test("setLayers drives the void cast on the EDGE, and frees it on every off", () => {
    const { view, calls } = viewUnderTest();

    // off → off. The layer boots false (an X-ray costs a whole-world remesh), so
    // this is the state every host starts in and the call the chrome makes when
    // it restores any OTHER flag from config.
    view.setLayers(layers(false));
    expect(calls).toEqual({ discard: 1, request: 0 });

    // off → on: the one edge that builds anything.
    view.setLayers(layers(true));
    expect(calls).toEqual({ discard: 1, request: 1 });

    // on → on. THE case the toggling GPU suite cannot reach: a call that leaves
    // the flag true rebuilds NOTHING, which is what makes "re-toggle to refresh"
    // the documented way back after an edit drops the cast. Without the
    // `!wasVoidCast` term this would post a second whole-world worker job every
    // time an unrelated layer moved.
    view.setLayers(layers(true));
    expect(calls).toEqual({ discard: 1, request: 1 });

    // on → off frees it, and the free is unconditional on the way down — the
    // level, not the edge, so an off state can never be left holding meshes.
    view.setLayers(layers(false));
    expect(calls).toEqual({ discard: 2, request: 1 });
    view.setLayers(layers(false));
    expect(calls).toEqual({ discard: 3, request: 1 });
  });

  test("layers() hands back the host's copy, never the caller's object", () => {
    const { view } = viewUnderTest();
    // The copy rule (`host state never aliases panel objects`) in its observable
    // form: the panel goes on owning the object it passed, and a later mutation
    // of it must not reach the host's flags.
    const sent = layers(false);
    view.setLayers(sent);
    sent.grid = false;
    expect(view.layers().grid).toBe(true);
    expect(view.layers()).not.toBe(sent);
  });
});
