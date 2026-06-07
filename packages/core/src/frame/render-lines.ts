import type { Camera } from "../camera/index.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import * as gpu from "../gpu/index.ts";
import { _ENGINE_DEPTH_FORMAT } from "../material/material.ts";
import { _cameraBinding } from "../shader/preamble.ts";
import { toWgsl } from "../shader/source.ts";
import {
  _recordAlloc,
  _recordDestroy,
  _recordDraw,
} from "../stats/internal.ts";
import { _ensureCameraBuffer, _ensureDepthTexture } from "./render.ts";

const FLOATS_PER_POINT = 3; // xyz
const POINT_STRIDE_BYTES = 12; // 3 × f32
const COLOR_STRIDE_BYTES = 16; // 4 × f32
// Initial buffer capacity (in lines) — grows on demand. Two points per line.
const INITIAL_LINES = 256;

const LINE_WGSL = /* wgsl */ `
${toWgsl(_cameraBinding)}

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
};
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * vec4<f32>(v.position, 1.0);
  out.color = v.color;
  return out;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return in.color;
}
`;

type LineResources = {
  pipeline: GPURenderPipeline;
  posBuffer: GPUBuffer;
  posCapacityBytes: number;
  colorBuffer: GPUBuffer;
  colorCapacityBytes: number;
};

const lineResByCtx = new WeakMap<Context, LineResources>();
// Bind group keyed by the (stable per ctx+camera) camera VP buffer.
const bindGroupByCameraBuffer = new WeakMap<GPUBuffer, GPUBindGroup>();

function createLineResources(ctx: Context): LineResources {
  const module = ctx.device.createShaderModule({ code: LINE_WGSL });
  const pipeline = ctx.device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: POINT_STRIDE_BYTES,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
        {
          arrayStride: COLOR_STRIDE_BYTES,
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [{ format: ctx.format }],
    },
    primitive: { topology: "line-list" },
    // Test against the scene depth, but never write — the wireframe shows on
    // the near surface of each collider and is occluded behind solid meshes.
    depthStencil: {
      format: _ENGINE_DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
  });
  const posCapacityBytes = INITIAL_LINES * 2 * POINT_STRIDE_BYTES;
  const colorCapacityBytes = INITIAL_LINES * 2 * COLOR_STRIDE_BYTES;
  const posBuffer = ctx.device.createBuffer({
    size: posCapacityBytes,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const colorBuffer = ctx.device.createBuffer({
    size: colorCapacityBytes,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  _recordAlloc(ctx, "buffer", posCapacityBytes + colorCapacityBytes);
  const res: LineResources = {
    pipeline,
    posBuffer,
    posCapacityBytes,
    colorBuffer,
    colorCapacityBytes,
  };
  _onDispose(ctx, () => {
    res.posBuffer.destroy();
    res.colorBuffer.destroy();
    _recordDestroy(
      ctx,
      "buffer",
      res.posCapacityBytes + res.colorCapacityBytes,
    );
  });
  return res;
}

function ensureLineResources(ctx: Context): LineResources {
  let res = lineResByCtx.get(ctx);
  if (!res) {
    res = createLineResources(ctx);
    lineResByCtx.set(ctx, res);
  }
  return res;
}

function growBuffer(
  ctx: Context,
  buffer: GPUBuffer,
  currentCapacity: number,
  neededBytes: number,
): { buffer: GPUBuffer; capacity: number } {
  if (neededBytes <= currentCapacity)
    return { buffer, capacity: currentCapacity };
  buffer.destroy();
  _recordDestroy(ctx, "buffer", currentCapacity);
  const next = ctx.device.createBuffer({
    size: neededBytes,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  _recordAlloc(ctx, "buffer", neededBytes);
  return { buffer: next, capacity: neededBytes };
}

function lineBindGroup(
  ctx: Context,
  pipeline: GPURenderPipeline,
  cameraBuffer: GPUBuffer,
): GPUBindGroup {
  const cached = bindGroupByCameraBuffer.get(cameraBuffer);
  if (cached) return cached;
  const bg = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  bindGroupByCameraBuffer.set(cameraBuffer, bg);
  return bg;
}

/**
 * Options accepted by {@link drawLines}.
 *
 * - `vertices`: flat line-list positions — two consecutive points per line,
 *   three floats (xyz) per point (the shape `physics.getDebugLines` returns).
 * - `colors`: RGBA per vertex (four floats); `colors.length` must equal
 *   `(vertices.length / 3) * 4`.
 * - `camera`: camera whose view-projection transforms the (world-space) points.
 */
export type DrawLinesOptions = {
  vertices: Float32Array;
  colors: Float32Array;
  camera: Camera;
};

/**
 * Draw a `line-list` overlay on top of the current frame — an immediate,
 * raw-buffer primitive (distinct from the managed, Mesh-based {@link render}).
 *
 * Runs a second render pass over the current swap-chain texture (`loadOp:
 * "load"`, so it does not clear) and against the engine's scene depth texture
 * (read-only `less-equal`), so the lines overlay the already-rendered meshes
 * and are occluded where a mesh is in front. **Call after `frame.render` in the
 * same frame** so the depth/colour it tests against are present.
 *
 * The line pipeline, shader and grow-on-demand vertex buffers are engine-owned
 * per context and reused across frames. Warm-path-validate: throws on a disposed
 * context or a null `camera`/`vertices`/`colors`; an empty `vertices` is a no-op.
 *
 * @throws FurnaceGpuError - if `ctx` is disposed, or `camera`/`vertices`/
 *   `colors` is null/undefined.
 */
export function drawLines(ctx: Context, opts: DrawLinesOptions): void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  if (opts.camera == null) {
    throw new FurnaceGpuError("drawLines: camera is required");
  }
  if (opts.vertices == null || opts.colors == null) {
    throw new FurnaceGpuError("drawLines: vertices and colors are required");
  }
  if (opts.vertices.length === 0) return;

  const res = ensureLineResources(ctx);
  const posBytes = opts.vertices.byteLength;
  const colorBytes = opts.colors.byteLength;
  const grownPos = growBuffer(
    ctx,
    res.posBuffer,
    res.posCapacityBytes,
    posBytes,
  );
  res.posBuffer = grownPos.buffer;
  res.posCapacityBytes = grownPos.capacity;
  const grownColor = growBuffer(
    ctx,
    res.colorBuffer,
    res.colorCapacityBytes,
    colorBytes,
  );
  res.colorBuffer = grownColor.buffer;
  res.colorCapacityBytes = grownColor.capacity;

  ctx.queue.writeBuffer(res.posBuffer, 0, opts.vertices);
  ctx.queue.writeBuffer(res.colorBuffer, 0, opts.colors);

  const cameraBuffer = _ensureCameraBuffer(ctx, opts.camera);
  const depth = _ensureDepthTexture(ctx);
  const colorView = gpu.getCurrentTextureView(ctx);
  const encoder = ctx.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view: colorView, loadOp: "load", storeOp: "store" }],
    depthStencilAttachment: {
      view: depth.view,
      depthLoadOp: "load",
      depthStoreOp: "store",
    },
  });
  pass.setPipeline(res.pipeline);
  pass.setBindGroup(0, lineBindGroup(ctx, res.pipeline, cameraBuffer));
  pass.setVertexBuffer(0, res.posBuffer);
  pass.setVertexBuffer(1, res.colorBuffer);
  const vertexCount = opts.vertices.length / FLOATS_PER_POINT;
  pass.draw(vertexCount);
  pass.end();
  ctx.queue.submit([encoder.finish()]);
  _recordDraw(ctx, { triangles: 0 }); // line-list contributes no triangles
}
