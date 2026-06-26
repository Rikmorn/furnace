import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as shader from "../../src/shader/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "instanced built-in shaders compile and report instanced:true",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const li = await shader.litInstanced(ctx);
    const ui = await shader.unlitInstanced(ctx);
    expect(li).toBeDefined();
    expect(ui).toBeDefined();
    expect(shader._instancedOf(ctx, li)).toBe(true);
    expect(shader._instancedOf(ctx, ui)).toBe(true);
    const plain = await shader.lit(ctx);
    expect(shader._instancedOf(ctx, plain)).toBe(false);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create from an instanced shader builds a pipeline (no validation error)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const sh = await shader.unlitInstanced(ctx);
    const bind = binding.create(ctx, sh);
    binding.set(ctx, bind, { color: [1, 1, 1, 1] });
    const mat = await material.create(ctx, { shader: sh, binding: bind });
    expect(mat).toBeDefined(); // material.create throws on a pipeline validation error
    material.destroy(ctx, mat);
    binding.destroy(ctx, bind);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createInstanced allocates, setters write, destroy frees",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const sh = await shader.unlitInstanced(ctx);
    const bind = binding.create(ctx, sh);
    binding.set(ctx, bind, { color: [1, 1, 1, 1] });
    const mat = await material.create(ctx, { shader: sh, binding: bind });
    const geo = geometry.cube(ctx, { size: 1 });

    const im = mesh.createInstanced(ctx, {
      geometry: geo,
      material: mat,
      count: 3,
    });
    expect(im).toBeDefined();
    mesh.setInstanceTransform(ctx, im, 0, [5, 0, 0], [0, 0, 0, 1], 1);
    mesh.setInstanceTint(ctx, im, 1, [1, 0, 0, 1]);
    mesh.setInstanceCount(ctx, im, 2);
    expect(() => mesh.setInstanceCount(ctx, im, 99)).toThrow(); // n > count

    mesh.destroyInstanced(ctx, im);
    material.destroy(ctx, mat);
    binding.destroy(ctx, bind);
    geometry.destroy(ctx, geo);
    gpu.dispose(ctx);
  },
);
