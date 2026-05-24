import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
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
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    const before = snapshot(ctx);
    const m = mesh.create(ctx, { geometry: geo, material: mat });
    const after = snapshot(ctx);
    expect(after.resources.meshes - before.resources.meshes).toBe(1);
    expect(after.memory.bufferBytes - before.memory.bufferBytes).toBe(64);
    mesh.destroy(m);
    const final = snapshot(ctx);
    expect(final.resources.meshes).toBe(before.resources.meshes);
    expect(final.memory.bufferBytes).toBe(before.memory.bufferBytes);
    mesh.destroyGeometry(geo);
    material.destroy(mat);
    gpu.dispose(ctx);
  },
);
