import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as physics from "../../src/physics/index.ts";
import * as rigidMesh from "../../src/rigid-mesh/index.ts";
import * as shader from "../../src/shader/index.ts";
import { quat, vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

async function setup() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, 0, 0] }); // zero-g: clean integration
  const cubeGeo = geometry.cube(ctx);
  const mat = await material.create(ctx, {
    shader: await shader.normalColor(ctx),
  });
  return { ctx, world, cubeGeo, mat };
}

test.skipIf(!bunWebGpuAvailable())(
  "interpolate lerps position between the previous and current tick",
  async () => {
    const { ctx, world, cubeGeo, mat } = await setup();
    const rm = rigidMesh.create(ctx, world, {
      body: {
        type: "dynamic",
        shape: { ball: 0.5 },
        position: [0, 0, 0],
        linearVelocity: [10, 0, 0],
      },
      mesh: { geometry: cubeGeo, material: mat },
    });

    physics.step(ctx, world, 1 / 60);
    rigidMesh.commit(ctx, rm); // prev = [0,0,0]; curr = body pose (~x=0.1667)

    const curr = vec3.create();
    physics.getBodyTranslation(ctx, rigidMesh.getBody(ctx, rm), curr);
    const m = rigidMesh.getMesh(ctx, rm);
    const mp = vec3.create();

    rigidMesh.interpolate(ctx, rm, 0);
    mesh.getPosition(ctx, m, mp);
    expect(mp[0]).toBeCloseTo(0, 5); // prev

    rigidMesh.interpolate(ctx, rm, 1);
    mesh.getPosition(ctx, m, mp);
    expect(mp[0]).toBeCloseTo(curr[0] as number, 5); // curr

    rigidMesh.interpolate(ctx, rm, 0.5);
    mesh.getPosition(ctx, m, mp);
    expect(mp[0]).toBeCloseTo((curr[0] as number) / 2, 5); // midpoint (prev = 0)

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "interpolate slerps rotation between the previous and current tick",
  async () => {
    const { ctx, world, cubeGeo, mat } = await setup();
    const rm = rigidMesh.create(ctx, world, {
      body: {
        type: "dynamic",
        shape: { ball: 0.5 },
        position: [0, 0, 0],
        angularVelocity: [0, Math.PI, 0],
      },
      mesh: { geometry: cubeGeo, material: mat },
    });

    physics.step(ctx, world, 1 / 60);
    rigidMesh.commit(ctx, rm); // prev = identity; curr = spun

    const curr = quat.create();
    physics.getBodyRotation(ctx, rigidMesh.getBody(ctx, rm), curr);
    const prev = quat.create(); // identity (the seeded initial rotation)
    const expectedHalf = quat.create();
    quat.slerp(expectedHalf, prev, curr, 0.5);

    rigidMesh.interpolate(ctx, rm, 0.5);
    const mr = quat.create();
    mesh.getRotation(ctx, rigidMesh.getMesh(ctx, rm), mr);

    expect(mr[0]).toBeCloseTo(expectedHalf[0] as number, 5);
    expect(mr[1]).toBeCloseTo(expectedHalf[1] as number, 5);
    expect(mr[2]).toBeCloseTo(expectedHalf[2] as number, 5);
    expect(mr[3]).toBeCloseTo(expectedHalf[3] as number, 5);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "commit/interpolate are silent no-ops on a stale handle",
  async () => {
    const { ctx, world, cubeGeo, mat } = await setup();
    const rm = rigidMesh.create(ctx, world, {
      body: { type: "dynamic", shape: { ball: 0.5 }, position: [0, 0, 0] },
      mesh: { geometry: cubeGeo, material: mat },
    });
    rigidMesh.destroy(ctx, rm);
    // No throw on a stale handle.
    rigidMesh.commit(ctx, rm);
    rigidMesh.interpolate(ctx, rm, 0.5);
    gpu.dispose(ctx);
  },
);
