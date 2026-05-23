import type { Camera } from "../camera/index.ts";
import * as camera from "../camera/index.ts";
import type { Context } from "../gpu/index.ts";
import * as gpu from "../gpu/index.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { Mesh } from "../mesh/types.ts";

const CAMERA_UNIFORM_SIZE = 64; // one mat4x4<f32>

type DepthEntry = {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
};

const depthByCtx = new WeakMap<Context, DepthEntry>();
const cameraBuffers = new WeakMap<Context, Map<Camera, GPUBuffer>>();

function _ensureDepthTexture(ctx: Context): DepthEntry {
  const existing = depthByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  if (existing) existing.texture.destroy();
  const texture = ctx.device.createTexture({
    size: { width, height },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const entry: DepthEntry = {
    texture,
    view: texture.createView(),
    width,
    height,
  };
  depthByCtx.set(ctx, entry);
  return entry;
}

function _ensureCameraBuffer(ctx: Context, cam: Camera): GPUBuffer {
  let perCam = cameraBuffers.get(ctx);
  if (!perCam) {
    perCam = new Map();
    cameraBuffers.set(ctx, perCam);
  }
  let buffer = perCam.get(cam);
  if (!buffer) {
    buffer = ctx.device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    perCam.set(cam, buffer);
  }
  const matrices = camera.getMatrices(cam);
  ctx.queue.writeBuffer(buffer, 0, matrices.viewProjection);
  return buffer;
}

export const _frameRenderInternals = {
  _ensureDepthTexture,
  _ensureCameraBuffer,
};

export type ClearColor = [number, number, number, number];

export type RenderOptions = {
  draw: Mesh[];
  camera: Camera;
  clearColor?: ClearColor;
  clearDepth?: number;
};

const DEFAULT_CLEAR_COLOR: ClearColor = [0, 0, 0, 1];
const DEFAULT_CLEAR_DEPTH = 1.0;

// Per-mesh map from pipeline -> group-0 bind group. The outer WeakMap lets the
// entries get GC'd when the mesh itself is dropped. The inner Map exists because
// a mesh's material may swap pipelines over time.
const group0Cache = new WeakMap<Mesh, Map<GPURenderPipeline, GPUBindGroup>>();

function ensureGroup0(
  ctx: Context,
  mesh: Mesh,
  pipeline: GPURenderPipeline,
  cameraBuffer: GPUBuffer,
): GPUBindGroup {
  let perMesh = group0Cache.get(mesh);
  if (!perMesh) {
    perMesh = new Map();
    group0Cache.set(mesh, perMesh);
  }
  const cached = perMesh.get(pipeline);
  if (cached) return cached;
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: mesh.objectBuffer } },
    ],
  });
  perMesh.set(pipeline, bindGroup);
  return bindGroup;
}

function beginRenderPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  clearColor: ClearColor,
  clearDepth: number,
): GPURenderPassEncoder {
  const [r, g, b, a] = clearColor;
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        clearValue: { r, g, b, a },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: clearDepth,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
}

function recordDraw(
  pass: GPURenderPassEncoder,
  ctx: Context,
  mesh: Mesh,
  cameraBuffer: GPUBuffer,
): void {
  _recomputeModelIfDirty(mesh);
  const pipeline = mesh.material.pipeline;
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, ensureGroup0(ctx, mesh, pipeline, cameraBuffer));
  if (mesh.material.group1) pass.setBindGroup(1, mesh.material.group1);
  pass.setVertexBuffer(0, mesh.geometry.vertexBuffer);
  const { indexBuffer, indexFormat, indexCount, vertexCount } = mesh.geometry;
  if (indexBuffer && indexFormat) {
    pass.setIndexBuffer(indexBuffer, indexFormat);
    pass.drawIndexed(indexCount);
    return;
  }
  pass.draw(vertexCount);
}

export function render(ctx: Context, opts: RenderOptions): void {
  const cameraBuffer = _ensureCameraBuffer(ctx, opts.camera);
  const depth = _ensureDepthTexture(ctx);
  const colorView = gpu.getCurrentTextureView(ctx);
  const clearColor = opts.clearColor ?? DEFAULT_CLEAR_COLOR;
  const clearDepth = opts.clearDepth ?? DEFAULT_CLEAR_DEPTH;

  const encoder = ctx.device.createCommandEncoder();
  const pass = beginRenderPass(
    encoder,
    colorView,
    depth.view,
    clearColor,
    clearDepth,
  );

  for (const mesh of opts.draw) {
    recordDraw(pass, ctx, mesh, cameraBuffer);
  }

  pass.end();
  ctx.device.queue.submit([encoder.finish()]);
}
