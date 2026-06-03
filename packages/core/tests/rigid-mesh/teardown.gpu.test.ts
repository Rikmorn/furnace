import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as physics from "../../src/physics/index.ts";
import * as resources from "../../src/resources/index.ts";
import * as rigidMesh from "../../src/rigid-mesh/index.ts";
import * as shader from "../../src/shader/index.ts";
import * as stats from "../../src/stats/index.ts";
import { vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

async function setupWithRigidMesh() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const cubeGeo = geometry.cube(ctx);
  const mat = await material.create(ctx, {
    shader: await shader.normalColor(ctx),
  });
  const rm = rigidMesh.create(ctx, world, {
    body: {
      type: "dynamic",
      shape: { cuboid: [0.5, 0.5, 0.5] },
      position: [0, 5, 0],
    },
    mesh: { geometry: cubeGeo, material: mat },
  });
  return { ctx, world, rm };
}

test.skipIf(!bunWebGpuAvailable())(
  "destroy frees the owned body + mesh and is idempotent",
  async () => {
    const { ctx, world, rm } = await setupWithRigidMesh();
    expect(stats.snapshot(ctx).resources.rigidMeshes).toBe(1);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(1);
    expect(stats.snapshot(ctx).resources.meshes).toBe(1);

    rigidMesh.destroy(ctx, rm);
    expect(stats.snapshot(ctx).resources.rigidMeshes).toBe(0);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(0);
    expect(stats.snapshot(ctx).resources.meshes).toBe(0);

    rigidMesh.destroy(ctx, rm); // idempotent

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "resources.disposeAll cascade frees an undestroyed rigid-mesh's body + mesh",
  async () => {
    const { ctx } = await setupWithRigidMesh(); // intentionally not destroyed

    resources.disposeAll(ctx);
    expect(stats.snapshot(ctx).resources.rigidMeshes).toBe(0);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(0);
    expect(stats.snapshot(ctx).resources.meshes).toBe(0);

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "after destroy, getBody/getMesh return a stale-safe sentinel (physics op on it no-ops)",
  async () => {
    const { ctx, world, rm } = await setupWithRigidMesh();
    rigidMesh.destroy(ctx, rm);

    // getBody/getMesh on a stale rm return a sentinel; a physics read on that
    // sentinel must be a safe no-op (leaves the out-param untouched), not a crash.
    const body = rigidMesh.getBody(ctx, rm);
    const out = vec3.fromValues(-1, -1, -1);
    physics.getBodyTranslation(ctx, body, out);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBe(-1);
    expect(out[2]).toBe(-1);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
