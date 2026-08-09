import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import type { Camera } from "../../src/camera/index.ts";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import type { Light } from "../../src/frame/lights.ts";
import * as geometry from "../../src/geometry/index.ts";
import { FurnaceGpuError } from "../../src/gpu/errors.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import type { Mesh } from "../../src/mesh/types.ts";
import * as shader from "../../src/shader/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture happy path: renders into a consumer-owned target",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });

    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    frame.renderToTexture(ctx, {
      texture: target,
      depthTexture: depth,
      meshes: [cube],
      camera: cam,
      clearColor: vec4.fromValues(0, 0, 0, 1),
    });

    expect(true).toBe(true); // No throw is the success criterion at this layer.
    depth.destroy();
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, cubeGeo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture on disposed ctx throws",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    gpu.dispose(ctx);
    expect(() =>
      frame.renderToTexture(ctx, { texture: target, meshes: [], camera: cam }),
    ).toThrow(FurnaceGpuError);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture throws when camera is null",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        meshes: [cube],
        camera: null as unknown as Camera,
      }),
    ).toThrow("camera is required");
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, cubeGeo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture throws when draw is null",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const cam = camera.perspective({ aspect: 1 });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        meshes: null as unknown as Mesh[],
        camera: cam,
      }),
    ).toThrow("meshes is required");
    target.destroy();
    gpu.dispose(ctx);
  },
);

// (A) depth presence — the headline fix: depth material, NO depthTexture → throws
test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture: depth material without depthTexture throws",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    // depthEnabled defaults true
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const geo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        meshes: [cube],
        camera: cam,
      }),
    ).toThrow(/no depthTexture/);
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

// (B) genuine depth-less offscreen: depthEnabled:false material, NO depthTexture → succeeds (no throw)
test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture: depthEnabled:false material without depthTexture succeeds",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
      { depth: false },
    );
    const geo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        meshes: [cube],
        camera: cam,
      }),
    ).not.toThrow();
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

// (C) reverse mismatch: depthEnabled:false material WITH depthTexture → throws
test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture: depthEnabled:false material with depthTexture throws",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
      { depth: false },
    );
    const geo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        depthTexture: depth,
        meshes: [cube],
        camera: cam,
      }),
    ).toThrow(/depthEnabled:false/);
    depth.destroy();
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

// (D) color format mismatch — isolate check (1) by making depth setup correct
test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture: color texture format != ctx.format throws",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    // depth material
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const geo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });
    // a renderable format guaranteed different from ctx.format:
    const wrongFormat: GPUTextureFormat =
      ctx.format === "rgba8unorm" ? "bgra8unorm" : "rgba8unorm";
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: wrongFormat,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        depthTexture: depth,
        meshes: [cube],
        camera: cam,
      }),
    ).toThrow(/must equal the working color format/);
    depth.destroy();
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

// (E) depth format mismatch — correct color + depth presence, wrong depth format
test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture: depthTexture format != depth24plus throws",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    // depth material
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const geo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        depthTexture: depth,
        meshes: [cube],
        camera: cam,
      }),
    ).toThrow(/must be 'depth24plus'/);
    depth.destroy();
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

// (F) mixed draw list — first depth-enabled (agrees), second depthEnabled:false (disagrees)
// → throws positionally on the offending index (draw[1]), not draw[0]. (spec test plan item 11)
test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture: mixed draw list throws on the offending index",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });

    // depthEnabled defaults true
    const { material: depthMat, binding: depthBinding } =
      await makeUnlitMaterial(ctx, vec4.fromValues(1, 0, 0, 1));
    const { material: noDepthMat, binding: noDepthBinding } =
      await makeUnlitMaterial(ctx, vec4.fromValues(0, 1, 0, 1), {
        depth: false,
      });
    const geo = geometry.cube(ctx);
    const depthMesh = mesh.create(ctx, { geometry: geo, material: depthMat });
    const noDepthMesh = mesh.create(ctx, {
      geometry: geo,
      material: noDepthMat,
    });

    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // passHasDepth = true (depthTexture provided): draw[0] depth-enabled agrees,
    // draw[1] depthEnabled:false disagrees → throws on index 1.
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        depthTexture: depth,
        meshes: [depthMesh, noDepthMesh],
        camera: cam,
      }),
    ).toThrow(/meshes\[1\]/);

    depth.destroy();
    target.destroy();
    mesh.destroy(ctx, noDepthMesh);
    mesh.destroy(ctx, depthMesh);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, noDepthMat);
    material.destroy(ctx, depthMat);
    binding.destroy(ctx, noDepthBinding);
    binding.destroy(ctx, depthBinding);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture throws when draw contains a null entry",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const cam = camera.perspective({ aspect: 1 });
    const { material: mat, binding: matBinding } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        meshes: [cube, null as unknown as Mesh],
        camera: cam,
      }),
    ).toThrow("meshes[1]: null/undefined mesh");
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, cubeGeo);
    material.destroy(ctx, mat);
    binding.destroy(ctx, matBinding);
    gpu.dispose(ctx);
  },
);

// --- Lit off-screen passes (T4c Task 1) ------------------------------------
//
// `RenderToTextureOptions.lights`/`ambient` are threaded into the same
// `_writeSceneBuffer` call `frame.render` uses. The pin below is a PIXEL
// difference, not a no-throw: before this landed, RTT hard-coded
// `_writeSceneBuffer(ctx, undefined, undefined, [])`, so a lit material drew
// ambient-only no matter what the caller passed. Drop the pass-through and the
// two readbacks become identical and this test reds.

const RTT_SIZE = 64;
const RTT_BYTES_PER_ROW = 256; // 64 px × 4 B — already 256-aligned

/** A white directional light travelling away from the default camera, so it
 *  strikes the cube's camera-facing +Z face head-on (the shader uses
 *  `L = -direction`, giving N·L = 1 on that face). */
const KEY_LIGHT: Light = {
  type: "directional",
  direction: [0, 0, -1],
  color: [1, 1, 1],
  intensity: 1,
};

/** Render one off-screen frame of a lit cube and read back its centre pixel.
 *  `lights: undefined` exercises the ambient-only default. */
async function litCubeCentrePixel(
  lights: Light[] | undefined,
): Promise<[number, number, number, number]> {
  const canvas = await makeOffscreenCanvas(RTT_SIZE, RTT_SIZE);
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const litShader = await shader.lit(ctx);
  const bind = binding.create(ctx, litShader);
  binding.set(ctx, bind, { color: [0.6, 0.6, 0.65, 1] }); // matte (no specular)
  const mat = await material.create(ctx, { shader: litShader, binding: bind });
  const geo = geometry.cube(ctx, { size: 1 });
  const cube = mesh.create(ctx, { geometry: geo, material: mat });

  const tex = ctx.device.createTexture({
    size: { width: RTT_SIZE, height: RTT_SIZE },
    format: ctx._internal.workingColorFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = ctx.device.createTexture({
    size: { width: RTT_SIZE, height: RTT_SIZE },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  frame.renderToTexture(ctx, {
    texture: tex,
    depthTexture: depth,
    meshes: [cube],
    camera: camera.perspective({ aspect: 1 }), // default pose: [0,0,3] → origin
    clearColor: vec4.fromValues(0, 0, 0, 1),
    lights,
  });

  const buf = ctx.device.createBuffer({
    size: RTT_BYTES_PER_ROW * RTT_SIZE,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = ctx.device.createCommandEncoder();
  enc.copyTextureToBuffer(
    { texture: tex },
    { buffer: buf, bytesPerRow: RTT_BYTES_PER_ROW, rowsPerImage: RTT_SIZE },
    { width: RTT_SIZE, height: RTT_SIZE },
  );
  ctx.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const data = new Uint8Array(buf.getMappedRange().slice(0));
  buf.unmap();
  const o = (RTT_SIZE / 2) * RTT_BYTES_PER_ROW + (RTT_SIZE / 2) * 4;
  const px: [number, number, number, number] = [
    data[o] ?? 0,
    data[o + 1] ?? 0,
    data[o + 2] ?? 0,
    data[o + 3] ?? 0,
  ];
  depth.destroy();
  tex.destroy();
  gpu.dispose(ctx);
  return px;
}

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture: lights reach the off-screen Scene UBO (lit pixel ≫ ambient-only pixel)",
  async () => {
    const unlit = await litCubeCentrePixel(undefined);
    const lit = await litCubeCentrePixel([KEY_LIGHT]);

    // byte[1] is the GREEN channel in both rgba8unorm and bgra8unorm — a
    // swap-chain-layout-agnostic discriminator.
    const unlitG = unlit[1];
    const litG = lit[1];

    // Ambient-only: base 0.6 × the default hemisphere ambient (intensity 0.05)
    // lands in the single digits out of 255 — dark, but the cube IS drawn
    // (alpha is opaque), so this is not the "nothing rendered" case.
    expect(unlit[3]).toBe(255);
    expect(lit[3]).toBe(255);
    expect(unlitG).toBeLessThan(40);

    // One white key light at N·L = 1 on a 0.6 base drives the channel past
    // half scale. Absolute floor, not just "brighter than".
    expect(litG).toBeGreaterThan(120);
    expect(litG - unlitG).toBeGreaterThan(80);
  },
);
