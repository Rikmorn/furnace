import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as physics from "../../src/physics/index.ts";
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

async function setup() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const cubeGeo = geometry.cube(ctx);
  const mat = await material.create(ctx, {
    shader: await shader.normalColor(ctx),
  });
  return { ctx, world, cubeGeo, mat };
}

test.skipIf(!bunWebGpuAvailable())(
  "create builds a body+mesh, seeds the mesh pose, counts in stats; destroy cascades + is idempotent",
  async () => {
    const { ctx, world, cubeGeo, mat } = await setup();

    const rm = rigidMesh.create(ctx, world, {
      body: {
        type: "dynamic",
        shape: { cuboid: [0.5, 0.5, 0.5] },
        position: [0, 5, 0],
      },
      mesh: { geometry: cubeGeo, material: mat },
    });

    expect(stats.snapshot(ctx).resources.rigidMeshes).toBe(1);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(1);
    expect(stats.snapshot(ctx).resources.meshes).toBe(1);

    // Accessors resolve to live handles.
    const body = rigidMesh.getBody(ctx, rm);
    const m = rigidMesh.getMesh(ctx, rm);
    const bodyPos = vec3.create();
    physics.getBodyTranslation(ctx, body, bodyPos);
    expect(bodyPos[1]).toBeCloseTo(5, 5);

    // create seeds the MESH pose to the body's initial pose (no first-frame glitch).
    const meshPos = vec3.create();
    mesh.getPosition(ctx, m, meshPos);
    expect(meshPos[1]).toBeCloseTo(5, 5);

    rigidMesh.destroy(ctx, rm);
    expect(stats.snapshot(ctx).resources.rigidMeshes).toBe(0);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(0);
    expect(stats.snapshot(ctx).resources.meshes).toBe(0);

    rigidMesh.destroy(ctx, rm); // idempotent — no throw

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "create throws on a malformed descriptor",
  async () => {
    const { ctx, world } = await setup();
    expect(() =>
      // @ts-expect-error deliberately missing mesh
      rigidMesh.create(ctx, world, {
        body: { type: "dynamic", shape: { ball: 0.5 }, position: [0, 0, 0] },
      }),
    ).toThrow(/body, mesh/);
    gpu.dispose(ctx);
  },
);
