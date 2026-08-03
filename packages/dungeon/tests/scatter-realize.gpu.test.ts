import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { create as makeRng } from "@furnace/core/rng";
import * as stats from "@furnace/core/stats";
import { mat4, quat, vec3 } from "@furnace/core/transform";
import { instanceGroupsFromLayers, meshSurface } from "../src/props/scatter.ts";
import { cave } from "../src/themes/cave.ts";
import { aabbOfBoxes } from "../src/world/aabb.ts";
import { MaterialCache, realizeRegion } from "../src/world/realize.ts";
import type {
  InstanceGroup,
  MaterialDescriptor,
  RegionData,
  ScatterLayerSpec,
} from "../src/world/region.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "realizeRegion creates one instanced mesh per group, frees on destroy",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const data = cave({ theme: "cave", seed: "cv", origin: [0, 0, 0] });
    expect(data.instances.length).toBeGreaterThan(0); // precondition: cave has scatter

    const before = stats.snapshot(ctx).resources.instancedMeshes;
    const realized = await realizeRegion(ctx, world, cache, data);
    expect(realized.instanced.length).toBe(data.instances.length); // one InstancedMesh per group
    expect(stats.snapshot(ctx).resources.instancedMeshes - before).toBe(
      data.instances.length,
    );

    realized.destroy();
    expect(stats.snapshot(ctx).resources.instancedMeshes).toBe(before); // no leak

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "solid scatter realizes a static collider per instance that supports a dropped ball",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, {
      gravity: [0, -9.81, 0],
      lengthUnit: 1,
    });
    const cache = new MaterialCache(ctx);

    const xform = mat4.fromRotationTranslationScale(
      mat4.create(),
      quat.create(),
      vec3.fromValues(0, 0.5, 0),
      vec3.fromValues(1, 1, 1),
    );
    const group: InstanceGroup = {
      geometry: { primitive: "cube" },
      material: 0,
      posture: "lit",
      transforms: new Float32Array(xform),
      tints: new Float32Array([1, 1, 1, 1]),
      collision: "solid",
      placements: [
        {
          position: [0, 0.5, 0],
          rotation: [0, 0, 0, 1],
          scale: 1,
          tint: [1, 1, 1, 1],
        },
      ],
    };
    const data: RegionData = {
      meshes: [],
      colliders: [],
      materials: [{ color: [0.6, 0.6, 0.6, 1], specular: [0, 0, 0, 0] }],
      connections: [],
      instances: [group],
      origin: [0, 0, 0],
      // No meshes/colliders on this fixture (only a scatter instance); envelope the
      // instance's unit-cube geometry directly so `bounds` stays a correct footprint.
      bounds: aabbOfBoxes([{ center: [0, 0.5, 0], size: [1, 1, 1] }]),
      provenance: {
        generatorId: "dungeon",
        generatorVersion: 2,
        theme: "cave",
        seed: "t",
      },
    };

    const region = await realizeRegion(ctx, world, cache, data);

    // A ball dropped straight onto the solid cube (half 0.5, top at y=1.0) rests on it,
    // not through it. (Interaction asserted, not just body count.)
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.2 },
      position: [0, 3, 0],
    });
    for (let i = 0; i < 180; i++) physics.step(ctx, world, 1 / 60);
    const p = physics.getBodyTranslation(ctx, ball, vec3.create());
    expect(p[1] as number).toBeGreaterThan(1.0); // resting on top of the fixture, well above the y=0 void

    region.destroy();
    physics.destroyWorld(ctx, world);
    cache.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "dynamic scatter realizes shovable bodies; update() tracks them in the instance buffer",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, {
      gravity: [0, -9.81, 0],
      lengthUnit: 1,
    });
    const cache = new MaterialCache(ctx);

    const xform = mat4.fromRotationTranslationScale(
      mat4.create(),
      quat.create(),
      vec3.fromValues(0, 1, 0),
      vec3.fromValues(1, 1, 1),
    );
    const group: InstanceGroup = {
      geometry: { primitive: "cube" },
      material: 0,
      posture: "lit",
      transforms: new Float32Array(xform),
      tints: new Float32Array([1, 1, 1, 1]),
      collision: "dynamic",
      placements: [
        {
          position: [0, 1, 0],
          rotation: [0, 0, 0, 1],
          scale: 1,
          tint: [1, 1, 1, 1],
        },
      ],
    };
    const data: RegionData = {
      meshes: [],
      colliders: [],
      materials: [{ color: [0.6, 0.6, 0.6, 1], specular: [0, 0, 0, 0] }],
      connections: [],
      instances: [group],
      origin: [0, 0, 0],
      // No meshes/colliders on this fixture (only a scatter instance); envelope the
      // instance's unit-cube geometry directly so `bounds` stays a correct footprint.
      bounds: aabbOfBoxes([{ center: [0, 1, 0], size: [1, 1, 1] }]),
      provenance: {
        generatorId: "dungeon",
        generatorVersion: 2,
        theme: "cave",
        seed: "t",
      },
    };

    const region = await realizeRegion(ctx, world, cache, data);
    expect(region.dynamicProps.length).toBe(1);

    // Shove it: a velocity moves the body, and update() makes the instance matrix follow.
    physics.setBodyLinearVelocity(
      ctx,
      region.dynamicProps[0]?.body as physics.Body,
      [2, 0, 0],
    );
    for (let i = 0; i < 10; i++) physics.step(ctx, world, 1 / 60);
    region.update();

    const bp = physics.getBodyTranslation(
      ctx,
      region.dynamicProps[0]?.body as physics.Body,
      vec3.create(),
    );
    expect(bp[0]).toBeGreaterThan(0); // shove moved it
    // update() wrote the body's translation into the group's mat4 buffer (col-major: x at index 12).
    expect(data.instances[0]?.transforms[12] as number).toBeCloseTo(
      bp[0] as number,
      4,
    );

    region.destroy();
    physics.destroyWorld(ctx, world);
    cache.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "dynamic scatter seats on a bumpy cave floor and settles without explosive pop (spec §10)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, {
      gravity: [0, -9.81, 0],
      lengthUnit: 1,
    });
    const cache = new MaterialCache(ctx);

    // A real branching cave: a bumpy Surface-Nets floor (the render mesh) collided against
    // the region's field-derived voxel proxy. We scatter dynamic crates over the render
    // floor; seat()'s spawn-lift (0.5*scale + DROP_MARGIN along the LOCAL surface normal)
    // must drop them onto the uneven voxel floor so they come to rest — without spawning
    // interpenetrating and popping. This is the spec §10 "system-allows-anywhere" proof
    // that lift+settle is good enough on NON-FLAT ground (no cast-based seating).
    const region = cave({ theme: "cave", seed: "cv", origin: [0, 0, 0] });
    expect(region.colliders.length).toBeGreaterThan(0); // precondition: the bumpy floor exists in physics (voxel proxy)

    const meshEntry = region.meshes.find((m) => "custom" in m.geometry);
    if (!meshEntry || !("custom" in meshEntry.geometry)) {
      throw new Error("cave region has no Surface-Nets mesh to scatter on");
    }
    const surf = meshSurface(meshEntry.geometry.custom);

    // One dynamic floor layer: a handful of modestly-sized crates (not hundreds).
    const dynLayer: ScatterLayerSpec = {
      name: "test-crates",
      geometry: { primitive: "cube" },
      posture: "lit",
      collision: "dynamic",
      material: { color: [0.5, 0.4, 0.3, 1], specular: [0, 0, 0, 0] },
      target: "floor",
      spacing: { min: 1.6, max: 1.6 },
      scale: { min: 0.4, max: 0.5 },
    };
    const mats: MaterialDescriptor[] = [];
    const groups = instanceGroupsFromLayers(
      surf,
      [dynLayer],
      makeRng("cv"),
      [],
      mats,
      region.origin, // [0,0,0] → local frame == world frame
    );
    expect(groups.length).toBeGreaterThan(0); // precondition: the floor layer resolved to instances
    expect(groups[0]?.collision).toBe("dynamic");
    expect(groups[0]?.placements?.length).toBeGreaterThan(0);
    const expectedProps = groups.reduce(
      (n, g) => n + (g.placements?.length ?? 0),
      0,
    );

    const data: RegionData = {
      meshes: [],
      colliders: region.colliders, // the bumpy floor's voxel proxy
      materials: mats,
      connections: [],
      instances: groups,
      origin: [0, 0, 0],
      bounds: region.bounds, // same colliders → same envelope the cave() generator computed
      provenance: {
        generatorId: "dungeon",
        generatorVersion: 2,
        theme: "cave",
        seed: "cv",
      },
    };

    const realized = await realizeRegion(ctx, world, cache, data);
    expect(realized.dynamicProps.length).toBe(expectedProps);

    const snapshot = (): number[][] =>
      realized.dynamicProps.map((p) =>
        Array.from(physics.getBodyTranslation(ctx, p.body, vec3.create())),
      );
    const spawns = snapshot();
    // Settle, then sample two late frames 20 steps apart to confirm rest (no velocity export).
    for (let i = 0; i < 200; i++) physics.step(ctx, world, 1 / 60);
    const early = snapshot();
    for (let i = 0; i < 20; i++) physics.step(ctx, world, 1 / 60);
    const late = snapshot();

    // Bounds chosen from observed real output (seed "cv", 20 crates): the worst crate
    // slides 1.12 m horizontally, drops 0.69 m, rises 0.06 m, and its late-frame delta is
    // 0.00000. A genuine pop launches a body many metres / never rests; a sink-through (a
    // missing lift, verified by burying the spawns) drops it ~52 m and never settles. These
    // bounds pass the real settle comfortably yet fail any of those failure modes.
    const MAX_HORIZONTAL = 2.0; // observed worst 1.12 m
    const MAX_DROP = 2.0; // observed worst 0.69 m; sink-through gives ~52 m
    const MAX_RISE = 0.5; // observed worst 0.06 m; an upward ejection is metres
    const SETTLE_EPS = 0.05; // observed 0.00000; a still-moving body gives >> this

    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i] as number[];
      const e = early[i] as number[];
      const l = late[i] as number[];
      const [sx, sy, sz] = [s[0] as number, s[1] as number, s[2] as number];
      const [lx, ly, lz] = [l[0] as number, l[1] as number, l[2] as number];

      // Finite — no NaN/Inf blow-up.
      expect(
        Number.isFinite(lx) && Number.isFinite(ly) && Number.isFinite(lz),
      ).toBe(true);
      // No horizontal fly-away.
      expect(Math.hypot(lx - sx, lz - sz)).toBeLessThan(MAX_HORIZONTAL);
      // No upward launch.
      expect(ly - sy).toBeLessThan(MAX_RISE);
      // Didn't sink through the floor into the void below.
      expect(ly).toBeGreaterThan(sy - MAX_DROP);
      // Settled — the late-frame position barely moves.
      expect(
        Math.hypot(
          lx - (e[0] as number),
          ly - (e[1] as number),
          lz - (e[2] as number),
        ),
      ).toBeLessThan(SETTLE_EPS);
    }

    realized.destroy();
    physics.destroyWorld(ctx, world);
    cache.destroy();
    gpu.dispose(ctx);
  },
);
