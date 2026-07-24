// F3b Task 8 — THE PLACEMENT GATE: a baked field world's placement artifact loads into instanced
// prop draws + catalog-derived static colliders, and the two things that must hold both hold —
// props RENDER (one instanced group per archetype/variant) and props COLLIDE (the walk capsule
// stops at a placed prop). Plus the optional-field regression: a props-free world still loads clean.
//
// Plumbing is lifted from field-world.gpu.test.ts (bake in memory -> stub fetch -> loadWorld ->
// walk with the real CharacterMover via runWalk). The ONE addition is `fieldFetchStub`: the loader
// fetches the entity catalog (`/catalog/entities.json` + the archetype `.fmesh` meshes) which are
// NOT part of the in-memory bake — they are committed on disk — so the stub serves `/catalog/*`
// from the REAL committed files and delegates everything else to the baked-file stub. This exercises
// the actual catalog + actual meshes, not a synthetic stand-in.
//
// DEVIATIONS from the plan's literal recipe (each justified in place):
//   1. The fixtures are hand-DUG ROOMS (box brush) rather than the full cave generator, and the
//      collide test hand-AUTHORS one placement op (a big rock on a corridor lane) instead of
//      relying on the random scatter generator to drop a rock onto the mouth lane. The loader path
//      under test — placements.json -> catalog -> instanced render + DERIVED colliders — is
//      identical either way; hand-authoring the input makes the "walk INTO a rock stops" assertion
//      deterministic and sabotage-crisp (the exact analogue of the masonry-wall walk test, which
//      hand-places its wall), and decouples the prop-collision proof from cave-floor walkability
//      (already proven in field-cave-walk.gpu.test.ts / Task 4). One test (below) STILL drives the
//      REAL scatter generator end-to-end so the scatter->catalog variant compatibility is covered.
//
// BOOT TARGET (Task 8 step 4 — no code): the game boots the `default` world named in
// `worlds/index.json`. To PLAY a baked field world with props, set that file's `"default"` to the
// baked world's name (as the editor's World panel does at bake time). A world PICKER is F4+ UX, not
// this slice — this test drives loadWorld directly (its fetch stub synthesizes the index), so it
// never touches `worlds/`.

import { describe, expect, test } from "bun:test";
import {
  type BakedFile,
  BUILTIN_TABLE,
  bakeFieldWorld,
  commitGenerator,
  createFieldStore,
  createOpLog,
  type FieldStore,
  generatorById,
  logApply,
  type OpLog,
  type PlacementOp,
  type PlacementRecord,
  parsePlacements,
} from "@furnace/core/field";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { MaterialCache } from "../src/realize.ts";
import type { Vec3 } from "../src/region.ts";
import { loadWorld } from "../src/world-loader.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";
import {
  bakedFetchStub,
  REST_OFFSET,
  runWalk,
} from "./_helpers/walk-fixture.ts";

await ensureBunWebGpu();

const IDENTITY_QUAT: PlacementRecord["quat"] = [0, 0, 0, 1];

/** A fetch stub that serves the entity catalog (`/catalog/*`) from the REAL committed files on disk
 *  and delegates every other path to the baked-file stub (`/worlds/*` + the synthesized index). The
 *  placement loader fetches `/catalog/entities.json` + each archetype `.fmesh` — none of which are
 *  in the in-memory bake — so a plain `bakedFetchStub` would 404 them. */
function fieldFetchStub(files: BakedFile[], name: string): typeof fetch {
  const baked = bakedFetchStub(files, name);
  const pkgRoot = new URL("../", import.meta.url); // packages/dungeon/
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/catalog/")) {
      const file = Bun.file(new URL(url.slice(1), pkgRoot).pathname);
      if (!(await file.exists()))
        return new Response("Not found", { status: 404 });
      return url.endsWith(".json")
        ? new Response(await file.text())
        : new Response(await file.arrayBuffer());
    }
    return baked(input);
  }) as unknown as typeof fetch;
}

/** Push a hand-authored placement op onto the log (the loader-input analogue of the masonry-wall
 *  test's hand-placed brush ops): `bakeFieldWorld` folds every `kind:"placement"` op in `log.ops`
 *  into `placements.json`, so this is enough to drive the loader with an exact, deterministic set of
 *  placed props — independent of the (separately tested) scatter generator. */
function pushPlacements(log: OpLog, records: PlacementRecord[]): void {
  const op: PlacementOp = { id: log.nextId++, kind: "placement", records };
  log.ops.push(op);
}

/** Dig an axis-aligned air box (a room / corridor) into `store`/`log` — the walkable-floor fixture
 *  the masonry-wall test uses, floor at y≈0. */
function digRoom(
  store: FieldStore,
  log: OpLog,
  center: Vec3,
  halfExtents: Vec3,
): void {
  logApply(
    store,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center, halfExtents },
    },
    BUILTIN_TABLE,
  );
}

/** The ground-truth number of instanced groups the loader SHOULD build from a bake: distinct
 *  (archetype, variantIndex) pairs across the placement artifact. Computed from the artifact the
 *  bake emitted (via the SAME `parsePlacements` the loader uses), so the render assertion checks the
 *  loader's grouping fidelity against the data — not a hand-counted magic number. 0 when the bake
 *  emitted no placement artifact (a props-free world). */
function expectedGroupCount(files: BakedFile[]): number {
  const pf = files.find((f) => f.path.endsWith("/placements.json"));
  if (pf === undefined) return 0;
  const groups = parsePlacements(pf.contents as string);
  return groups.reduce(
    (n, g) => n + new Set(g.records.map((r) => r.variantIndex)).size,
    0,
  );
}

/** Bake a field world (built by `build`), serve it + the real catalog through `fieldFetchStub`,
 *  load it through the REAL `loadWorld` (v2 gate -> loadFieldWorld), then run `body` against the
 *  loaded world — restoring fetch and tearing down GPU/physics afterwards. Mirrors
 *  field-world.gpu.test.ts's per-test harness. */
async function withLoadedField(
  opts: {
    name: string;
    playerStart: Vec3;
    build: (store: FieldStore, log: OpLog) => void;
  },
  body: (args: {
    ctx: gpu.Context;
    world: physics.World;
    loaded: Awaited<ReturnType<typeof loadWorld>>;
    files: BakedFile[];
  }) => void | Promise<void>,
): Promise<void> {
  const store = createFieldStore();
  const log = createOpLog();
  opts.build(store, log);
  const files = bakeFieldWorld(store, log, BUILTIN_TABLE, {
    name: opts.name,
    playerStart: opts.playerStart,
    playerYaw: 0,
  });

  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const matCache = new MaterialCache(ctx);
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = fieldFetchStub(files, opts.name);
    const loaded = await loadWorld(ctx, world, matCache);
    globalThis.fetch = orig; // any walk casts against the world; no more fetches
    try {
      await body({ ctx, world, loaded, files });
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

describe("field world: placement loading (F3b Task 8)", () => {
  test.skipIf(!bunWebGpuAvailable())(
    "renders one instanced group per (archetype, variant)",
    async () => {
      // Six records collapsing to FIVE groups: rock variant 0 ×2 (share one group) + variants 1, 2
      // (3 rock groups), stalagmite variants 0, 1 (2 groups). If the loader failed to split by
      // variant, or grouped by record instead, the count would differ.
      const at = (
        x: number,
        z: number,
      ): Pick<PlacementRecord, "position" | "quat" | "scale"> => ({
        position: [x, 1.5, z],
        quat: IDENTITY_QUAT,
        scale: [1, 1, 1],
      });
      const records: PlacementRecord[] = [
        { archetypeId: "rock", ...at(2, 2), variantIndex: 0 },
        { archetypeId: "rock", ...at(3, 2), variantIndex: 0 },
        { archetypeId: "rock", ...at(4, 2), variantIndex: 1 },
        { archetypeId: "rock", ...at(5, 2), variantIndex: 2 },
        { archetypeId: "stalagmite", ...at(2, 5), variantIndex: 0 },
        { archetypeId: "stalagmite", ...at(4, 5), variantIndex: 1 },
      ];
      await withLoadedField(
        {
          name: "placements-render",
          playerStart: [4, 1.5, 4],
          build: (store, log) => {
            digRoom(store, log, [4, 1.75, 4], [4, 1.75, 4]);
            pushPlacements(log, records);
          },
        },
        ({ loaded, files }) => {
          expect(expectedGroupCount(files)).toBe(5); // artifact ground truth
          expect(loaded.instanced.length).toBe(expectedGroupCount(files)); // loader fidelity
          expect(loaded.meshes.length).toBeGreaterThan(0); // the room surface still renders
        },
      );
    },
  );

  test.skipIf(!bunWebGpuAvailable())(
    "derives a collider so the capsule stops at a placed prop",
    async () => {
      // A 2 m-wide corridor (air x 0..8, z 1..3) with ONE big rock at x=5 on the floor. Its derived
      // box collider (catalog half-extents [0.4,0.35,0.4] × scale 2.5 = [1.0,0.875,1.0], centred at
      // the surface y≈0) spans x 4.0..6.0 and z 1.0..3.0 — filling the corridor width, so the capsule
      // cannot slip past — and rises 0.875 m above the floor, well over the mover's step-up + rim-ride
      // climb reach, so it BLOCKS rather than being stepped over: the capsule halts at the rock's near
      // face (x ≈ 4.0), settling around x ≈ 3.6.
      //
      // A deliberately LARGE rock is used because the collide proof is about the derived collider
      // existing and stopping the capsule — NOT about the mover's short-obstacle behaviour. A
      // half-buried prop shorter than ~0.6 m above the floor (a scatter rock at scale ≲ 1.7) is
      // CLIMBED by the step-up + rim-ride, so it renders but does not block; that mover/prop-size
      // interaction is a tuning matter tracked separately (docs/backlog), out of Task 8's scope.
      //
      // SABOTAGE-VERIFIED: comment out the `createPlacementColliders` call in field-world.ts and the
      // capsule walks THROUGH to the far wall (x ≈ 7.9) — the `< 4.5` assertion goes red.
      const rock: PlacementRecord = {
        archetypeId: "rock",
        position: [5, 0, 2],
        quat: IDENTITY_QUAT,
        scale: [2.5, 2.5, 2.5],
        variantIndex: 0,
      };
      await withLoadedField(
        {
          name: "placements-collide",
          playerStart: [2, REST_OFFSET + 0.1, 2],
          build: (store, log) => {
            digRoom(store, log, [4, 1.75, 2], [4, 1.75, 1]);
            pushPlacements(log, [rock]);
          },
        },
        ({ ctx, world, loaded, files }) => {
          expect(loaded.instanced.length).toBe(expectedGroupCount(files)); // the rock renders (1)
          expect(loaded.instanced.length).toBe(1);

          // Drive +x straight at the rock. expectStop drives the full budget while still asserting
          // no teleport/launch/fall-through per frame; the capsule must halt before the rock.
          const res = runWalk(ctx, world, {
            start: [2, REST_OFFSET + 0.1, 2],
            dir: [1, 0, 0],
            expectStop: true,
            floorY: -1,
            ceilY: 4,
          });
          expect(res.pos[0]).toBeGreaterThan(2.8); // it walked toward the rock (no wedge at spawn)
          expect(res.pos[0]).toBeLessThan(4.5); // …and the collider stopped it before passing through
        },
      );
    },
  );

  test.skipIf(!bunWebGpuAvailable())(
    "derives a CAPSULE collider (stalagmite) that stops the capsule",
    async () => {
      // Gives the NEW `placementCollider` capsule branch end-to-end teeth — it exists only because
      // of the stalagmite archetype (v1 `colliderFor` handled ball/cylinder/cuboid only), and until
      // now was merely construct-verified (a collider gets created without error, but nothing WALKS
      // into one). Mirrors the rock walk-stop, but with the stalagmite's catalog capsule
      // (halfHeight 0.5, radius 0.22).
      //
      // ANCHORING QUIRK (see docs/backlog): the stalagmite MESH is base-origin (y∈[0,1]), but its
      // catalog collider is a CENTRED capsule. Placed at the surface point [5,0,2] × scale 2, the
      // derived capsule (halfHeight 1.0, radius 0.44) spans ±(1.0+0.44) = ±1.44 m about that point —
      // above-floor extent 1.44 m, well over the mover's step-up + rim-ride climb reach (~0.56 m),
      // and radius 0.44 leaves 0.56 m gaps in the 2 m corridor (< the 0.6 m capsule diameter), so it
      // BLOCKS. The walk aims +x at the collider's FOOTPRINT (the surface point's XZ), not the mesh
      // top. Measured: the capsule halts at x ≈ 4.18 (near face 4.56).
      //
      // SABOTAGE-VERIFIED two ways: (1) comment out `createPlacementColliders` → walks through to
      // x ≈ 7.9; (2) aim the walk PAST the footprint → no stop. Either makes `< 4.5` go red.
      const stalagmite: PlacementRecord = {
        archetypeId: "stalagmite",
        position: [5, 0, 2],
        quat: IDENTITY_QUAT,
        scale: [2, 2, 2],
        variantIndex: 0,
      };
      await withLoadedField(
        {
          name: "placements-collide-capsule",
          playerStart: [2, REST_OFFSET + 0.1, 2],
          build: (store, log) => {
            digRoom(store, log, [4, 1.75, 2], [4, 1.75, 1]);
            pushPlacements(log, [stalagmite]);
          },
        },
        ({ ctx, world, loaded, files }) => {
          expect(loaded.instanced.length).toBe(expectedGroupCount(files));
          expect(loaded.instanced.length).toBe(1);
          const res = runWalk(ctx, world, {
            start: [2, REST_OFFSET + 0.1, 2],
            dir: [1, 0, 0],
            expectStop: true,
            floorY: -1,
            ceilY: 4,
          });
          expect(res.pos[0]).toBeGreaterThan(2.8); // walked toward the stalagmite (no wedge at spawn)
          expect(res.pos[0]).toBeLessThan(4.5); // …and the capsule collider stopped it short
        },
      );
    },
  );

  test.skipIf(!bunWebGpuAvailable())(
    "a placement-free world still loads (optional-field regression)",
    async () => {
      // No placement op -> manifest.placements absent -> the loader must not require it, and must
      // build zero prop groups (a plain dug room has no kit either, so instanced is empty).
      await withLoadedField(
        {
          name: "placements-none",
          playerStart: [4, 1.5, 4],
          build: (store, log) => {
            digRoom(store, log, [4, 1.75, 4], [4, 1.75, 4]);
          },
        },
        ({ loaded, files }) => {
          expect(expectedGroupCount(files)).toBe(0); // the bake emitted no placement artifact
          expect(loaded.instanced.length).toBe(0); // …and the loader built no prop groups
          expect(loaded.meshes.length).toBeGreaterThan(0); // the world still loaded
        },
      );
    },
  );

  test.skipIf(!bunWebGpuAvailable())(
    "real scatter placements round-trip through the loader",
    async () => {
      // The end-to-end integration lane: the REAL scatter generator emits placements onto the dug
      // floor, they bake into placements.json, and the loader resolves them against the catalog.
      // This is where a scatter `variants` that outran the catalog's mesh count would throw
      // ("no mesh for variant") — the default variants (3) match the catalog's 3 rock meshes.
      const SCATTER = generatorById("scatter");
      // The floor is dug to y≈0.1 — deliberately OFF the 0.25 m voxel lattice. Scatter's floor scan
      // needs a strict rock(d<0)→air(d>0) sample pair; a floor landing EXACTLY on a sample reads
      // d=0 there (neither strict), so scatter finds nothing. An off-lattice floor puts the crossing
      // cleanly between samples. `region.min.y` dips below the floor so that crossing is in scan
      // range. (The sample-aligned-floor blind spot is a scatter/core concern, filed to backlog.)
      const region = {
        min: [0.5, -1, 0.5] as Vec3,
        max: [7.5, 3.5, 7.5] as Vec3,
      };
      await withLoadedField(
        {
          name: "placements-scatter",
          playerStart: [4, 1.5, 4],
          build: (store, log) => {
            digRoom(store, log, [4, 1.8, 4], [4, 1.7, 4]); // air y 0.1..3.5 (floor off-lattice)
            commitGenerator(store, log, SCATTER, {
              params: { ...SCATTER.defaults, archetypeId: "rock" },
              seed: 7,
              region,
              policy: "replace",
              table: BUILTIN_TABLE,
            });
          },
        },
        ({ loaded, files }) => {
          const expected = expectedGroupCount(files);
          expect(expected).toBeGreaterThan(0); // scatter placed some rocks
          expect(loaded.instanced.length).toBe(expected); // the loader built exactly those groups
        },
      );
    },
  );
});
