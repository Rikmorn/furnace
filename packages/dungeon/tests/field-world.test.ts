import { describe, expect, test } from "bun:test";
import * as field from "@furnace/core/field";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { isFieldManifest } from "../src/field/field-world.ts";
import { MaterialCache } from "../src/world/realize.ts";
import type { MaterialDescriptor } from "../src/world/region.ts";
import type { LoadedWorld } from "../src/world/world-loader.ts";
import { loadWorld } from "../src/world/world-loader.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";
import { bakedFetchStub } from "./_helpers/walk-fixture.ts";

// One Field · F1 Task 11: the v2 field-manifest gate. `world-loader.loadWorld` fetches ONE
// `manifest.json` for both world classes, so the (version:2, kind:"field") discriminant is the
// only thing that routes a bake to the field loader instead of the v1 `assertCompatible` path.
describe("field manifest gate", () => {
  test("accepts v2 field manifests, rejects everything else", () => {
    expect(isFieldManifest({ version: 2, kind: "field" })).toBe(true);
    // v1 region manifest: no kind, version 1.
    expect(isFieldManifest({ version: 1 })).toBe(false);
    // Right kind, wrong (future) version.
    expect(isFieldManifest({ version: 3, kind: "field" })).toBe(false);
    // Right version, wrong kind.
    expect(isFieldManifest({ version: 2, kind: "region" })).toBe(false);
    expect(isFieldManifest(null)).toBe(false);
    expect(isFieldManifest("nope")).toBe(false);
    expect(isFieldManifest(undefined)).toBe(false);
    expect(isFieldManifest(42)).toBe(false);
  });
});

// One Field · F2a Task 13 — the game-side material + kit load. These exercise the real
// `loadFieldWorld` (via `loadWorld` + the fetch stub), so they need a GPU device and are
// gated on bun-webgpu; only the pure manifest-gate test above runs GPU-free.
await ensureBunWebGpu();

// This file's copy of the 3-class fixture table (rock id0 organic, dirt id1 organic,
// masonry id2 kit) — mirrors field-skin-topology.test.ts's TABLE.
const TABLE: field.MaterialTable = {
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

// The STONE colour the F1 loader shares (field-world.ts STONE.color) — the back-compat
// assertion checks a table-less manifest still lands on exactly this descriptor.
const STONE_COLOR: [number, number, number, number] = [0.62, 0.6, 0.58, 1];

/** Task-4 wall fixture enriched with a dirt block: a dug room (rock organic surface), a
 *  masonry wall (kit class 2 → a backing bucket + kit pieces), and a floating dirt cube
 *  (dirt organic surface) — three distinct solid-side classes so the render pass allocates
 *  three distinct materials. */
function enrichedFixture(): { s: field.FieldStore; log: field.OpLog } {
  const s = field.createFieldStore();
  const log = field.createOpLog();
  // Room: air x 0..4, y 0.5..3.5, z 0..4.
  field.logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 1.5, 2] },
    },
    TABLE,
  );
  // Masonry wall (kit class 2): x 2..2.5, y 0.5..2.5, z 1..3 — every face on the 0.5 lattice.
  field.logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: { kind: "box", center: [2.25, 1.5, 2], halfExtents: [0.25, 1, 1] },
    },
    TABLE,
  );
  // Dirt block (organic class 1): a floating solid cube x 0.5..1.5, y 1.5..2.5, z 0.5..1.5 —
  // all six faces exposed to room air, so the mesher emits a dirt organic surface bucket.
  field.logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 1,
      shape: { kind: "box", center: [1, 2, 1], halfExtents: [0.5, 0.5, 0.5] },
    },
    TABLE,
  );
  return { s, log };
}

/** Strip the F2-additive material fields from a bake's manifest so it round-trips as an
 *  F1-shape artifact (no materialTable / materials / kit; mesh entries carry no classId /
 *  backing). Mirrors the pre-Task-7 F1 worlds committed under `worlds/**`. */
function stripToF1(files: field.BakedFile[]): field.BakedFile[] {
  const out = [...files];
  const i = out.length - 1; // the manifest is emitted LAST (crash-safety contract)
  const last = out[i];
  if (!last) throw new Error("stripToF1: empty file set");
  const m = JSON.parse(last.contents as string) as field.FieldManifest;
  m.materialTable = undefined;
  m.materials = undefined;
  m.kit = undefined;
  m.meshes = m.meshes.map((e) => ({
    key: e.key,
    file: e.file,
    origin: e.origin,
  }));
  out[i] = { path: last.path, contents: JSON.stringify(m, null, 2) };
  return out;
}

/** Bake-then-load harness: serve `files` through the fetch stub, spy on `matCache.get` so a
 *  test can count the DISTINCT render-material descriptors the load requested, run `body`, then
 *  tear the GPU/physics resources down. Mirrors walk-fixture.ts's `withLoadedWorld`. */
async function withFieldLoad(
  files: field.BakedFile[],
  name: string,
  body: (args: { loaded: LoadedWorld; seen: string[] }) => void,
): Promise<void> {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const matCache = new MaterialCache(ctx);
  const seen: string[] = [];
  const realGet = matCache.get.bind(matCache);
  matCache.get = (d: MaterialDescriptor) => {
    seen.push(JSON.stringify(d));
    return realGet(d);
  };
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = bakedFetchStub(files, name);
    const loaded = await loadWorld(ctx, world, matCache);
    globalThis.fetch = orig; // load done; no more fetches
    try {
      body({ loaded, seen });
    } finally {
      loaded.destroy();
    }
  } finally {
    globalThis.fetch = orig;
    matCache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  }
}

describe("field world: per-class materials + instanced kit", () => {
  test.skipIf(!bunWebGpuAvailable())(
    "creates one render mesh per manifest entry with a per-class material and an instanced kit mesh per kit chunk",
    async () => {
      const { s, log } = enrichedFixture();
      const files = field.bakeFieldWorld(s, log, TABLE, {
        name: "matworld",
        playerStart: [1, 1.5, 1],
        playerYaw: 0,
      });
      const manifest = JSON.parse(
        (files[files.length - 1]?.contents as string) ?? "{}",
      ) as field.FieldManifest;

      await withFieldLoad(files, "matworld", ({ loaded, seen }) => {
        // One render mesh per manifest mesh entry.
        expect(loaded.meshes.length).toBe(manifest.meshes.length);
        // At least three DISTINCT render-material descriptors: rock organic, dirt organic,
        // masonry backing (the white instanced-kit base rides matCache.getInstanced, not get).
        expect(new Set(seen).size).toBeGreaterThanOrEqual(3);
        // One instanced mesh per kit chunk (the masonry wall carries kit pieces).
        expect(loaded.instanced.length).toBe(manifest.kit?.length ?? 0);
        expect(loaded.instanced.length).toBeGreaterThan(0);
      });
    },
  );

  test.skipIf(!bunWebGpuAvailable())(
    "an F1-shape manifest (no materialTable/kit/materials) still loads with the single STONE material",
    async () => {
      const s = field.createFieldStore();
      const log = field.createOpLog();
      for (let x = 1; x <= 4; x += 0.5) {
        field.logApply(
          s,
          log,
          {
            id: 0,
            kind: "brush",
            effect: "dig",
            shape: { kind: "sphere", center: [x, 1.4, 1.5], radius: 1.4 },
          },
          field.BUILTIN_TABLE,
        );
      }
      const baked = field.bakeFieldWorld(s, log, field.BUILTIN_TABLE, {
        name: "f1world",
        playerStart: [1.5, 1.5, 1.5],
        playerYaw: 0,
      });
      const files = stripToF1(baked);

      await withFieldLoad(files, "f1world", ({ loaded, seen }) => {
        expect(loaded.meshes.length).toBeGreaterThan(0);
        expect(loaded.instanced.length).toBe(0); // no kit in an F1 bake
        // Every render mesh shares the ONE STONE descriptor.
        expect(new Set(seen).size).toBe(1);
        const d = JSON.parse(seen[0] as string) as MaterialDescriptor;
        expect(d.color).toEqual(STONE_COLOR);
      });
    },
  );
});
