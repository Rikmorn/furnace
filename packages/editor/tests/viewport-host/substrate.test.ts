import { describe, expect, test } from "bun:test";
import type * as binding from "@furnace/core/binding";
import * as field from "@furnace/core/field";
import type * as geometry from "@furnace/core/geometry";
import type * as gpu from "@furnace/core/gpu";
import type { Context } from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import type * as mesh from "@furnace/core/mesh";
import type { EntityArchetype } from "../../src/shared/catalog";
import { FieldWorkerClient } from "../../src/viewport-host/field-client";
import { createFlagStore } from "../../src/viewport-host/field-flags";
import {
  type ChunkRender,
  createHostSubstrate,
  type HostSubstrate,
  type PropRender,
} from "../../src/viewport-host/substrate";

/** The spawn the fake worker client never makes: `FieldWorkerClient` spawns
 *  lazily on its first request, and this suite never issues one — so a thrower
 *  here is a tripwire rather than a stub. */
const noWorker = () => {
  throw new Error("substrate.test: no worker should be spawned");
};

const noContext: typeof gpu.requestContext = () =>
  Promise.reject(
    new Error("substrate.test: no GPU context should be requested"),
  );

/** The eleven frozen-side members, as cheap stand-ins. Only `dirty`,
 *  `chunkMeshes` and `propMeshes` are ever looked at; the rest are here because
 *  the record's whole point is that the shape is complete. */
const frozen = () => ({
  store: field.createFieldStore(),
  log: field.createOpLog(),
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
});

/** Sentinels for the two members whose real values need a GPU device and a DOM.
 *  Nothing here is ever dereferenced — these tests compare identities, which is
 *  the strongest form of "the record read the current value". */
const fakeCtx = {} as unknown as Context;
const fakeCanvas = {} as unknown as HTMLCanvasElement;

const archetype: EntityArchetype = {
  id: "torch",
  name: "Torch",
  color: [1, 0.8, 0.4],
  collision: { kind: "sphere", radius: 0.25 },
  scatter: {},
};

describe("createHostSubstrate", () => {
  test("every thunk reads the host's `let` as it is NOW, not as it was", () => {
    // The five locals stand in for the host's lifecycle and catalog `let`s.
    const tableA: field.MaterialTable = { classes: [] };
    const tableB: field.MaterialTable = { classes: [] };
    const catalogA: ReadonlyMap<string, EntityArchetype> = new Map();
    const catalogB: ReadonlyMap<string, EntityArchetype> = new Map([
      [archetype.id, archetype],
    ]);
    let table = tableA;
    let archetypeById = catalogA;
    let ctx: Context | null = null;
    let disposed = false;
    let canvasEl: HTMLCanvasElement | null = null;

    const sub: HostSubstrate = createHostSubstrate({
      ...frozen(),
      table: () => table,
      archetypeById: () => archetypeById,
      ctx: () => ctx,
      disposed: () => disposed,
      canvasEl: () => canvasEl,
    });

    expect(sub.table()).toBe(tableA);
    expect(sub.archetypeById()).toBe(catalogA);
    expect(sub.ctx()).toBeNull();
    expect(sub.disposed()).toBe(false);
    expect(sub.canvasEl()).toBeNull();

    // EVERY reassignment happens AFTER construction, and that ordering is the
    // whole test: flipping first would pass just as happily against a record
    // that had snapshotted these five, which is the bug the thunk side exists
    // to make unrepresentable. Each line is the host method that really does it.
    table = tableB; // setMaterialTable
    archetypeById = catalogB; // setEntityCatalog
    ctx = fakeCtx; // init
    disposed = true; // dispose
    canvasEl = fakeCanvas; // bindCanvas

    expect(sub.table()).toBe(tableB);
    expect(sub.archetypeById()).toBe(catalogB);
    expect(sub.ctx()).toBe(fakeCtx);
    expect(sub.disposed()).toBe(true);
    expect(sub.canvasEl()).toBe(fakeCanvas);
  });

  test("the frozen side is the host's own object, not a copy of it", () => {
    const dirty = new Set<string>();
    const chunkMeshes = new Map<string, ChunkRender>();
    const propMeshes: PropRender[] = [];

    const sub = createHostSubstrate({
      ...frozen(),
      dirty,
      chunkMeshes,
      propMeshes,
      table: () => field.BUILTIN_TABLE,
      archetypeById: () => new Map(),
      ctx: () => null,
      disposed: () => false,
      canvasEl: () => null,
    });

    // The mirror image of the thunk law, and the reason the frozen eleven are
    // NOT calls: these are `const` in the host, so its writes land THROUGH the
    // identity it handed over. A record that cloned or froze them would leave a
    // module reading a dead snapshot of a live map — so this pins the factory's
    // deliberate do-nothing as behaviour, not as an implementation detail.
    dirty.add("0,0,0");
    chunkMeshes.set("0,0,0", { entries: [], kit: null, kitGeo: null });

    expect(sub.dirty.has("0,0,0")).toBe(true);
    expect(sub.chunkMeshes.get("0,0,0")).toBe(chunkMeshes.get("0,0,0"));
    expect(sub.propMeshes).toBe(propMeshes);

    // And the sharing runs both ways — a cluster draining the dirty set is the
    // host's drain, not a private one that leaves the host's own copy full.
    sub.dirty.delete("0,0,0");
    expect(dirty.size).toBe(0);
  });
});
