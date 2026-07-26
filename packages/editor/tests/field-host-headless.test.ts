// FieldHost surfaces that need NO GPU init (a field-host-load.test.ts
// sibling): startStamp's no-selection guard, subscribeStamp's initial push,
// nudgeStamp's no-session no-op, and highlightEntity's unknown-id quiet no-op.
// Verified against the host source: none of these paths touch the GPU context,
// the render loop, or the lazily-spawned remesh worker — startStamp returns at
// the selection guard BEFORE any session/preview work, nudgeStamp returns at
// its own session guard BEFORE nudgeRegion/previewStamp, and highlightEntity
// only scans the op log.
import { expect, test } from "bun:test";
import {
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  SOLID,
} from "@furnace/core/field";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import type { FieldLayers } from "../src/viewport-host/index.ts";

test("startStamp with no selection reports 'select a region first' and opens no session", () => {
  const host = createFieldHost();
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  const pushes: unknown[] = [];
  host.subscribeStamp((s) => pushes.push(s));
  host.startStamp("hall");
  expect(errors).toEqual(["select a region first"]);
  // Only the initial subscribe push — the failed start must not notify.
  expect(pushes).toEqual([null]);
});

test("subscribeStamp immediately pushes the current state (null without a session)", () => {
  const host = createFieldHost();
  let pushed: unknown = "not-pushed";
  host.subscribeStamp((s) => {
    pushed = s;
  });
  expect(pushed).toBeNull();
});

test("nudgeStamp without a session is a quiet no-op (no push, no preview)", () => {
  const host = createFieldHost();
  const pushes: unknown[] = [];
  host.subscribeStamp((s) => pushes.push(s));
  expect(() => host.nudgeStamp(1, 0, -1)).not.toThrow();
  // Only the initial subscribe push — a session-less nudge must not notify
  // (a notify would mean it reached previewStamp and the worker spawn).
  expect(pushes).toEqual([null]);
});

test("highlightEntity is runtime-quiet on unknown ids and null", () => {
  const host = createFieldHost();
  expect(() => host.highlightEntity(999)).not.toThrow();
  expect(() => host.highlightEntity(null)).not.toThrow();
});

// --- void cast (F3b Task 12) ------------------------------------------------
// The refusals that need no GPU: they are decided before the context guard, so
// they are the half of the enable path a host with no device still runs. Once a
// cast can actually exist — the worker round trip, the meshes, the invalidation
// — the coverage moves to `field-host-void-cast.gpu.test.ts`, which drives the
// same host over a real bun-webgpu device with the worker injected.

const layersWithVoidCast = (on: boolean): FieldLayers => ({
  field: true,
  kit: true,
  props: true,
  ghost: true,
  selection: true,
  grid: true,
  flags: true,
  voidCast: on,
});

/** A host holding `count` allocated chunks, via loadWorld's decode path (the
 *  only way in without a pointer or a GPU). Contents are irrelevant — the
 *  budget counts chunks. */
function hostWithChunks(count: number): ReturnType<typeof createFieldHost> {
  const host = createFieldHost();
  const bytes = encodeChunkFile(new Int8Array(CHUNK_SAMPLES).fill(SOLID));
  const chunks = Array.from({ length: count }, (_, i) => ({
    key: chunkKey(i, 0, 0),
    bytes,
  }));
  host.loadWorld({
    manifest: {
      version: 2,
      kind: "field",
      cellSize: DEFAULT_CELL_SIZE,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [],
      meshes: [],
    },
    chunks,
    oplog: null,
  });
  return host;
}

test("enabling the void cast past the chunk budget refuses loudly", () => {
  const host = hostWithChunks(513);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setLayers(layersWithVoidCast(true));
  expect(errors.length).toBe(1);
  // The count AND the ceiling are both in the message: a refusal the user
  // cannot act on is a refusal that reads as a bug.
  expect(errors[0]).toContain("513");
  expect(errors[0]).toContain("512");
});

test("the budget refusal is decided BEFORE the GPU guard, and 512 is inside it", () => {
  // Ordering matters: check the context first and an over-budget enable would
  // go quiet in exactly the headless case this asserts. 512 must pass the
  // ceiling it names (an off-by-one here silently shrinks the tool).
  const host = hostWithChunks(512);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setLayers(layersWithVoidCast(true));
  expect(errors).toEqual([]);
});

test("enabling the void cast on a world with nothing dug says so", () => {
  // The feature's own rule (invalidateVoidCast's comment): a ticked box with
  // nothing behind it reads as a bug. An undug world has no air to cast, and
  // that refusal is the one the user is most likely to hit first.
  const host = createFieldHost();
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  host.setLayers(layersWithVoidCast(true));
  expect(errors).toEqual(["nothing to cast yet — dig something first"]);
});

test("the enable/disable edges are context-free until they need a context", () => {
  // The narrow claim this CAN make headlessly: every step the enable takes
  // before it gives up on a missing context dereferences no GPU state, so
  // neither edge throws and neither reports. It deliberately does NOT claim the
  // guard stopped a worker job — a spawned bun Worker for the browser's
  // /field-worker.js neither resolves nor rejects in-process, so removing the
  // guard is invisible from here. Proving THAT needs a worker-client injection
  // seam the host does not have (backlog: field-host-worker-injection-seam).
  const host = hostWithChunks(2);
  const errors: string[] = [];
  host.subscribeToolError((m) => errors.push(m));
  expect(() => host.setLayers(layersWithVoidCast(true))).not.toThrow();
  expect(() => host.setLayers(layersWithVoidCast(false))).not.toThrow();
  expect(errors).toEqual([]);
});
