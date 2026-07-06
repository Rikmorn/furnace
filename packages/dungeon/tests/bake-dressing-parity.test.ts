import { expect, test } from "bun:test";
import { decodeMeshBlob } from "@furnace/core/scene";
import { bakeWing, type WingManifest } from "../src/bake.ts";
import { placePiece } from "../src/connect.ts";
import {
  GENERATOR_VERSION,
  type InstanceGroup,
  type MaterialDescriptor,
  type RegionCollider,
  type RegionData,
  type ThemeName,
  themes,
} from "../src/region.ts";
import {
  type CaveParams,
  caveDressing,
  caveProxy,
} from "../src/themes/cave.ts";
import { buildWorld } from "../src/world.ts";

// REGRESSION (found at the 3.1 visual gate, seed 2222:1): the baked wing's re-derived
// collision — cuboids, cave voxel proxies, AND dressing placements — must reproduce the
// LIVE wing byte-for-byte for the same seed. The gate found box rooms re-run bare at
// load ({theme,seed,origin} only), dropping the materializer's graph-derived multi-door
// specs → different scatter keep-outs → solid dressing landed in real doorways
// ("blocked rooms"). Fix: WorldNode.themeParams records the exact extra generator
// params; bake stamps them; load re-runs with them. This test is placement-LEVEL —
// the earlier count-level assertion passed while placements differed.
// Cost note: two full generates + five voxelizations (~5–10 s) — priced as the guard
// for the slice's core promise ("freeze bakes exactly what you previewed").

const SEED = "2222:1"; // the gate repro: 10 rooms, loops → multi-door pillar halls
const CFG = {
  sectors: [1, 1] as [number, number],
  targetRooms: 10,
  loopChance: 0.35,
  attempts: 1,
};
const BUDGET = {
  maxAttempts: 2000,
  maxRestarts: 2,
  maxSaLayoutRestarts: 1,
  maxSaMoves: 200,
  maxSaRestarts: 2,
};

function wrap(
  colliders: RegionCollider[],
  instances: InstanceGroup[],
  materials: MaterialDescriptor[],
): RegionData {
  return {
    meshes: [],
    colliders,
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

const cuboidKey = (c: RegionCollider): string =>
  "cuboid" in c.shape
    ? JSON.stringify([c.position, c.shape.cuboid, c.rotation ?? [0, 0, 0, 1]])
    : "";

// Explicit timeout: two full generates + five cave voxelizations (~11 s measured) —
// see the cost note above; the default 5 s is too tight for this guard.
test("baked wing re-derivation reproduces the live wing exactly (colliders + proxies + dressing placements)", () => {
  const live = buildWorld(SEED, CFG, BUDGET);
  const { files } = bakeWing(SEED, CFG, BUDGET);
  const manifestFile = files.find((f) => f.path.endsWith("manifest.json"));
  if (!manifestFile) throw new Error("no manifest baked");
  const manifest = JSON.parse(manifestFile.contents as string) as WingManifest;

  const liveRegions = live.graph.nodes
    .map((n, i) => ({ node: n, placed: live.layout.regions[i] }))
    .filter((x) => x.node.region.provenance.theme !== "authored");

  // PRECONDITION (keeps the test's teeth): the repro seed must contain at least one
  // multi-door pillar hall — the geometry class the original bug lived in. If generator
  // constants shift and this fails, pick a new seed with a multi-door hall.
  const multiDoorHalls = liveRegions.filter(
    (x) =>
      x.node.region.provenance.theme === "pillarHall" &&
      x.node.region.connections.length >= 2,
  );
  expect(multiDoorHalls.length).toBeGreaterThanOrEqual(1);

  // 1) Cuboid collider multiset parity.
  const count = (keys: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const liveCuboids = count([
    ...liveRegions.flatMap((x) => (x.placed?.colliders ?? []).map(cuboidKey)),
    ...live.layout.connectors.flatMap((c) => c.colliders.map(cuboidKey)),
  ]);
  const bakedCuboids = count([
    ...manifest.regions.flatMap((r) => r.colliders.map(cuboidKey)),
    ...manifest.connectors.flatMap((c) => c.colliders.map(cuboidKey)),
  ]);
  expect(Object.fromEntries(bakedCuboids)).toEqual(
    Object.fromEntries(liveCuboids),
  );

  for (const mr of manifest.regions) {
    const liveEntry = liveRegions.find((x) => x.node.id === mr.id);
    if (!liveEntry?.placed) throw new Error(`live region ${mr.id} missing`);

    // 2) Cave voxel proxy parity (coords + seat + rotation).
    if (mr.theme === "cave") {
      expect(mr.themeParams).toBeDefined();
      const liveVox = liveEntry.placed.colliders.find(
        (c) => "voxels" in c.shape,
      );
      if (!liveVox || !("voxels" in liveVox.shape)) {
        throw new Error(`live cave ${mr.id} has no voxels collider`);
      }
      const local = caveProxy({
        theme: "cave",
        seed: mr.seed,
        origin: [0, 0, 0],
        ...mr.themeParams,
      } as CaveParams);
      const placedProxy = placePiece(
        wrap([{ shape: local.shape, position: local.position }], [], []),
        mr.placement,
      ).colliders[0];
      if (!placedProxy || !("voxels" in placedProxy.shape)) {
        throw new Error(`re-derived proxy for ${mr.id} lost voxels`);
      }
      expect([...placedProxy.shape.voxels.coords]).toEqual([
        ...liveVox.shape.voxels.coords,
      ]);
      expect(placedProxy.position).toEqual(liveVox.position);
    }

    // 3) Dressing placement parity — the wing-loader's exact re-derivation path.
    let local: { instances: InstanceGroup[]; materials: MaterialDescriptor[] };
    if (mr.theme === "cave") {
      const fm = files.find((f) => f.path.endsWith(`${mr.id}-0.fmesh`));
      if (!fm) throw new Error(`no fmesh sidecar for ${mr.id}`);
      const u8 = fm.contents as Uint8Array;
      // Fresh copy → a plain (never Shared) ArrayBuffer sized to the view, as the
      // decoder's signature requires.
      const surface = decodeMeshBlob(new Uint8Array(u8).buffer).render;
      local = caveDressing(
        {
          theme: "cave",
          seed: mr.seed,
          origin: [0, 0, 0],
          ...mr.themeParams,
        } as CaveParams,
        surface,
      );
    } else {
      const gen = themes[mr.theme as ThemeName];
      if (!gen) continue; // connectors carry no dressing
      const full = gen({
        theme: mr.theme as ThemeName,
        seed: mr.seed,
        origin: [0, 0, 0],
        ...(mr.themeParams ?? {}),
      } as Parameters<typeof gen>[0]);
      local = { instances: full.instances, materials: full.materials };
    }
    const placed = placePiece(
      wrap([], local.instances, local.materials),
      mr.placement,
    );

    const liveGroups = liveEntry.placed.instances;
    const bakedGroups = placed.instances;
    expect(bakedGroups.length).toBe(liveGroups.length);
    for (let g = 0; g < liveGroups.length; g++) {
      const lg = liveGroups[g];
      const bg = bakedGroups[g];
      if (!lg || !bg) throw new Error(`group ${g} missing on one side`);
      // Full instance parity: transforms cover EVERY instance (visual placement);
      // placements cover the collision-carrying ones (solid/dynamic bodies).
      expect([...bg.transforms]).toEqual([...lg.transforms]);
      expect(bg.placements ?? []).toEqual(lg.placements ?? []);
    }
  }
}, 30_000);
