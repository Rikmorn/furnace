import { expect, spyOn, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { decodeMeshBlob } from "@furnace/core/scene";
import { type BakeFile, bakeWorld, type WorldManifest } from "../src/bake.ts";
import { placePiece } from "../src/connect.ts";
import { MaterialCache } from "../src/realize.ts";
import {
  GENERATOR_VERSION,
  type InstanceGroup,
  type MaterialDescriptor,
  type RegionData,
} from "../src/region.ts";
import { type CaveParams, caveDressing } from "../src/themes/cave.ts";
import { realizeWorldSpec } from "../src/world-build.ts";
import { loadWorld } from "../src/world-loader.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

// W1 Task 6: the GAME-side world loader mirrors wing-loader against the world manifest.
// The core NEW behaviour vs wings: the connector carries NO cuboids, so its collision is a
// VOXEL PROXY re-expanded at load from (a, b, seed, radius, overshoot). The gpu round-trip
// asserts exactly 3 voxel bodies are created (2 cave proxies + 1 connector proxy); the
// non-skipped parity test guards dressing re-derivation at PLACEMENT level (the 3.1 lesson:
// count-level parity passed while placements differed).

// @furnace/core/scene auto-registers built-ins at module import (side-effect in
// scene/index.ts). No explicit registerBuiltins() call is needed.

await ensureBunWebGpu();

/** The manifest is the LAST file bakeWorld emits (crash-safety contract). */
const manifestOf = (files: BakeFile[]): WorldManifest =>
  JSON.parse(files[files.length - 1]?.contents as string) as WorldManifest;

/** A fetch stub over the baked file set: `/worlds/index.json` → the index we write here
 *  (bakeWorld does not emit it), each baked path (leading-slash) → its contents, everything
 *  else → 404. JSON files resolve as text; `.fmesh` bytes resolve as a fresh ArrayBuffer. */
function bakedFetchStub(files: BakeFile[]): typeof fetch {
  const byPath = new Map<string, string | Uint8Array>();
  for (const f of files) byPath.set(`/${f.path}`, f.contents);
  const index = JSON.stringify({ version: 1, default: "default" });
  const respond = (url: string): Response => {
    if (url === "/worlds/index.json") return new Response(index);
    const contents = byPath.get(url);
    if (contents === undefined)
      return new Response("Not found", { status: 404 });
    if (typeof contents === "string") return new Response(contents);
    // Fresh copy → a plain (never Shared) ArrayBuffer sized to the view.
    return new Response(new Uint8Array(contents).buffer);
  };
  return ((input: RequestInfo | URL) =>
    Promise.resolve(
      respond(typeof input === "string" ? input : input.toString()),
    )) as unknown as typeof fetch;
}

/** A fetch stub that 404s everything except (optionally) `/worlds/index.json`. Drives the
 *  setup-loud "broken clone" throws — index missing, or index-ok-but-manifest-missing. */
function brokenCloneFetchStub(serveIndex: boolean): typeof fetch {
  const index = JSON.stringify({ version: 1, default: "default" });
  return ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(
      serveIndex && url === "/worlds/index.json"
        ? new Response(index)
        : new Response("Not found", { status: 404 }),
    );
  }) as unknown as typeof fetch;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

test.skipIf(!bunWebGpuAvailable())(
  "loadWorld: fragment scene + deterministic re-expansion (3 voxel proxies) + baked spawn + setup-loud throws",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const matCache = new MaterialCache(ctx);

    const files = bakeWorld(DEFAULT_WORLD);
    const manifest = manifestOf(files);

    const orig = globalThis.fetch;
    try {
      globalThis.fetch = bakedFetchStub(files);

      // Capture every shape passed to createBody (call-through preserves real behaviour so
      // the scene/dressing populate). Spy on the shared physics namespace the loader uses.
      const realCreateBody = physics.createBody;
      const shapes: unknown[] = [];
      const spy = spyOn(physics, "createBody").mockImplementation(((
        c: Parameters<typeof physics.createBody>[0],
        w: Parameters<typeof physics.createBody>[1],
        d: Parameters<typeof physics.createBody>[2],
      ) => {
        shapes.push(d.shape);
        return realCreateBody(c, w, d);
      }) as typeof physics.createBody);

      // (a) resolves without throwing.
      let loaded: Awaited<ReturnType<typeof loadWorld>>;
      try {
        loaded = await loadWorld(ctx, world, matCache);
      } finally {
        spy.mockRestore();
      }

      // (b) baked player spawn round-trips.
      expect(loaded.playerStart).toEqual(manifest.playerStart);
      expect(loaded.playerYaw).toBe(manifest.playerYaw);

      // (c) EXACTLY 3 voxel bodies: 2 cave proxies + 1 connector proxy (the new behaviour —
      // the connector's collision re-expanded from its portals, carrying no serialized cuboids).
      const voxelBodies = shapes.filter((s) => isRecord(s) && "voxels" in s);
      expect(voxelBodies.length).toBe(3);

      loaded.destroy();

      // (d) setup-loud: a broken clone (missing index or manifest) throws a fix-it message,
      // NOT a silent live-generation fallback (wing-loader's null-return retires here).
      globalThis.fetch = brokenCloneFetchStub(false); // index itself 404s
      await expect(loadWorld(ctx, world, matCache)).rejects.toThrow(
        /worlds index missing/,
      );

      globalThis.fetch = brokenCloneFetchStub(true); // index ok, manifest 404s
      await expect(loadWorld(ctx, world, matCache)).rejects.toThrow(
        /manifest missing/,
      );
    } finally {
      globalThis.fetch = orig;
    }

    matCache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

// ── Placement-level dressing parity (NON-skipped: pure data, no GPU) ─────────────────────
// realizeWorldSpec is the live oracle. For each region entry, re-derive its dressing from
// the DECODED baked fmesh + recorded params/seed → placePiece(entry.placement), and assert
// EVERY instance group's transforms + placements deep-equal the live placed region's. This
// is the world analog of tests/bake-dressing-parity.test.ts — placement-LEVEL, not count.

function wrap(
  instances: InstanceGroup[],
  materials: MaterialDescriptor[],
): RegionData {
  return {
    meshes: [],
    colliders: [],
    materials,
    connections: [],
    instances,
    origin: [0, 0, 0],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "connector",
      seed: "parity",
    },
  };
}

test("baked world dressing re-derivation reproduces the live world exactly (placement-level)", () => {
  const live = realizeWorldSpec(DEFAULT_WORLD);
  const files = bakeWorld(DEFAULT_WORLD);
  const manifest = manifestOf(files);

  expect(manifest.regions.length).toBeGreaterThanOrEqual(1);
  // PRECONDITION teeth: a running tally of every compared instance. If a future config
  // zeroed cave scatter, the per-group deep-equals would pass vacuously — the tally assert
  // at the end catches that (mirrors bake-dressing-parity's multi-door precondition).
  let comparedTransforms = 0;

  for (const mr of manifest.regions) {
    const fm = files.find((f) => f.path.endsWith(`${mr.id}-0.fmesh`));
    if (!fm) throw new Error(`no fmesh sidecar for ${mr.id}`);
    const u8 = fm.contents as Uint8Array;
    // Fresh copy → a plain (never Shared) ArrayBuffer sized to the view, as the decoder needs.
    const surface = decodeMeshBlob(new Uint8Array(u8).buffer).render;
    const local = caveDressing(
      {
        theme: "cave",
        seed: mr.seed,
        origin: [0, 0, 0],
        ...mr.params,
      } as CaveParams,
      surface,
    );
    const placed = placePiece(
      wrap(local.instances, local.materials),
      mr.placement,
    );

    const livePlaced = live.regions.get(mr.id);
    if (!livePlaced) throw new Error(`live region ${mr.id} missing`);
    const liveGroups = livePlaced.instances;
    const bakedGroups = placed.instances;
    expect(bakedGroups.length).toBe(liveGroups.length);
    for (let g = 0; g < liveGroups.length; g++) {
      const lg = liveGroups[g];
      const bg = bakedGroups[g];
      if (!lg || !bg) throw new Error(`group ${g} missing on one side`);
      // transforms cover EVERY instance (visual placement); placements cover the
      // collision-carrying ones (solid/dynamic bodies).
      expect([...bg.transforms]).toEqual([...lg.transforms]);
      expect(bg.placements ?? []).toEqual(lg.placements ?? []);
      comparedTransforms += lg.transforms.length;
    }
  }

  expect(comparedTransforms).toBeGreaterThan(0);
});
