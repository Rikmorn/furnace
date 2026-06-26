import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import { renderToTexture } from "../../src/frame/render-to-texture.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as shader from "../../src/shader/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
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

test.skipIf(!bunWebGpuAvailable())(
  "frame.render draws an InstancedMesh as N instances in one draw",
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
      count: 4,
    });
    for (let i = 0; i < 4; i++)
      mesh.setInstanceTransform(ctx, im, i, [i * 2, 0, 0], [0, 0, 0, 1], 1);
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    render(ctx, { meshes: [], instanced: [im], camera: cam });
    // 4 instances of a 12-triangle cube = 48 triangles in ONE draw call
    expect(ctx._internal.stats.drawCalls).toBe(1);
    expect(ctx._internal.stats.triangles).toBe(48);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "per-instance tint renders distinctly (red vs green instance, pixel readback)",
  async () => {
    const W = 64;
    const H = 64;
    const canvas = await makeOffscreenCanvas(W, H);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const tex = ctx.device.createTexture({
      size: { width: W, height: H },
      format: ctx._internal.workingColorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const depth = ctx.device.createTexture({
      size: { width: W, height: H },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const sh = await shader.unlitInstanced(ctx);
    const bind = binding.create(ctx, sh);
    binding.set(ctx, bind, { color: [1, 1, 1, 1] }); // white material; tint comes from the instance
    const mat = await material.create(ctx, { shader: sh, binding: bind });
    const geo = geometry.cube(ctx, { size: 1.4 });
    const im = mesh.createInstanced(ctx, {
      geometry: geo,
      material: mat,
      count: 2,
    });
    // instance 0 → left, RED ; instance 1 → right, GREEN
    mesh.setInstanceTransform(ctx, im, 0, [-1.2, 0, -4], [0, 0, 0, 1], 1);
    mesh.setInstanceTint(ctx, im, 0, [1, 0, 0, 1]);
    mesh.setInstanceTransform(ctx, im, 1, [1.2, 0, -4], [0, 0, 0, 1], 1);
    mesh.setInstanceTint(ctx, im, 1, [0, 1, 0, 1]);
    const cam = camera.perspective({ aspect: 1 });
    renderToTexture(ctx, {
      texture: tex,
      depthTexture: depth,
      camera: cam,
      meshes: [],
      instanced: [im],
      clearColor: vec4.fromValues(0, 0, 0, 1),
    });

    const bytesPerRow = 256; // 64*4 == 256 (already 256-aligned)
    const buf = ctx.device.createBuffer({
      size: bytesPerRow * H,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = ctx.device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: tex },
      { buffer: buf, bytesPerRow, rowsPerImage: H },
      { width: W, height: H },
    );
    ctx.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buf.getMappedRange().slice(0));
    buf.unmap();
    const px = (x: number, y: number): [number, number, number, number] => {
      const o = y * bytesPerRow + x * 4;
      return [
        data[o] ?? 0,
        data[o + 1] ?? 0,
        data[o + 2] ?? 0,
        data[o + 3] ?? 0,
      ];
    };
    const left = px(Math.floor(W * 0.28), Math.floor(H / 2)); // red instance
    const right = px(Math.floor(W * 0.72), Math.floor(H / 2)); // green instance
    // The GREEN channel is byte[1] in BOTH rgba and bgra layouts — a layout-agnostic discriminator.
    expect(left[1]).toBeLessThan(96); // red cube → low green
    expect(right[1]).toBeGreaterThan(160); // green cube → high green
    expect(Math.max(left[0], left[2])).toBeGreaterThan(160); // red-ish channel high on the left (rgba byte0 or bgra byte2)
    gpu.dispose(ctx);
  },
);
