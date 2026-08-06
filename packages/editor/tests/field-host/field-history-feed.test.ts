import { describe, expect, test } from "bun:test";
import type * as binding from "@furnace/core/binding";
import * as field from "@furnace/core/field";
import type * as geometry from "@furnace/core/geometry";
import type * as gpu from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import type * as mesh from "@furnace/core/mesh";
import { FieldWorkerClient } from "../../src/field-host/field-client";
import { createFlagStore } from "../../src/field-host/field-flags";
import { createHistoryFeed } from "../../src/field-host/field-history-feed";
import {
  type ChunkRender,
  createHostSubstrate,
  type PropRender,
} from "../../src/field-host/substrate";

// ONE PROPERTY, and only because T3b1 proved nothing else pinned it: that
// `subscribe` records the change signature BEFORE the channel's snapshot fires,
// not after.
//
// Everything else about this seam is pinned where it has always been, through
// `FieldHost.subscribeHistory` in `tests/field-host-history.test.ts` — the
// multicast delivery, the per-subscriber release, the late arrival, the
// suppression of a tick that moved nothing, and the record-rather-than-CLEAR
// choice — and that file ran across the extraction with its ASSERTIONS unmodified
// (three comment lines were re-pointed at the feed's new name afterwards), which is
// what makes it the pin. Reversing the two statements in `field-history-feed.ts`'s
// `subscribe`, however, reddened NOTHING in the pre-existing editor suite (1,363/0
// either way, checked by sabotage): the host's tests reach the seam through verbs,
// and no verb subscribes a callback that calls back into the host from inside its
// own first push. That is the one thing this file covers — with it in place the
// same reversal reddens exactly one test, the one below — and it is deliberately
// not a second home for history coverage.

/** The spawn the fake worker client never makes — this suite issues no request, so
 *  a thrower here is a tripwire rather than a stub (`field-stats.test.ts`'s). */
const noWorker = () => {
  throw new Error("field-history-feed.test: no worker should be spawned");
};

const noContext: typeof gpu.requestContext = () =>
  Promise.reject(
    new Error("field-history-feed.test: no GPU context should be requested"),
  );

/** The substrate members this module never touches. Only `log` is read; the rest
 *  are here because the record's whole point is that the shape is complete. */
const substrateOver = (log: field.OpLog) =>
  createHostSubstrate({
    store: field.createFieldStore(),
    log,
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

describe("createHistoryFeed", () => {
  test("a subscriber that notifies from inside its own first push hears it ONCE", () => {
    const feed = createHistoryFeed({
      substrate: substrateOver(field.createOpLog()),
    });

    // The re-entrant subscriber the ordering comment describes: a surface whose
    // arrival push provokes a read of the host that reaches `notify` again. Guarded
    // to the FIRST delivery so the test terminates under either ordering rather
    // than proving its point by hanging.
    let pushes = 0;
    let reentered = false;
    feed.subscribe(() => {
      pushes++;
      if (reentered) return;
      reentered = true;
      feed.notify();
    });

    // With the signature recorded FIRST, the re-entrant notify compares the
    // arrival's own history against itself and publishes nothing. With the two
    // statements reversed, the signature is still null when the snapshot fires, so
    // the guard sees "never published" and hands this subscriber a second copy of
    // the history it was handed a microsecond earlier.
    //
    // The log is empty, which costs the test nothing: what is under test is the
    // order of two statements, and neither of them reads a log entry's content.
    expect(pushes).toBe(1);
  });
});
