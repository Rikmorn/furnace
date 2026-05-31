import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as shader from "../../src/shader/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "mesh.create: registers 1 mesh + 1 buffer; destroy unregisters both",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });
    const geo = geometry.cube(ctx);
    const before = snapshot(ctx);
    const m = mesh.create(ctx, { geometry: geo, material: mat });
    const after = snapshot(ctx);
    expect(after.resources.meshes - before.resources.meshes).toBe(1);
    expect(after.memory.bufferBytes - before.memory.bufferBytes).toBe(64);
    mesh.destroy(ctx, m);
    const final = snapshot(ctx);
    expect(final.resources.meshes).toBe(before.resources.meshes);
    expect(final.memory.bufferBytes).toBe(before.memory.bufferBytes);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);
