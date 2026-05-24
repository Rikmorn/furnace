import type { Camera } from "../camera/index.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { Mesh } from "../mesh/types.ts";
import {
  _recordBindGroupSwitch,
  _recordDraw,
  _recordPipelineSwitch,
} from "../stats/internal.ts";
import { _frameRenderInternals, type ClearColor } from "./render.ts";

export type RenderToTextureOptions = {
  texture: GPUTexture;
  draw: Mesh[];
  camera: Camera;
  depthTexture?: GPUTexture;
  clearColor?: ClearColor;
  clearDepth?: number;
};

const DEFAULT_CLEAR_COLOR: ClearColor = [0, 0, 0, 1];
const DEFAULT_CLEAR_DEPTH = 1.0;

function beginRenderPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView | undefined,
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
    depthStencilAttachment: depthView
      ? {
          view: depthView,
          depthClearValue: clearDepth,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        }
      : undefined,
  });
}

function recordDraw(
  pass: GPURenderPassEncoder,
  ctx: Context,
  mesh: Mesh,
  cameraBuffer: GPUBuffer,
  lastPipeline: GPURenderPipeline | null,
): GPURenderPipeline {
  _recomputeModelIfDirty(mesh);
  const pipeline = mesh.material.pipeline;
  pass.setPipeline(pipeline);
  if (pipeline !== lastPipeline) {
    _recordPipelineSwitch(ctx);
  }
  pass.setBindGroup(
    0,
    _frameRenderInternals._ensureMeshGroup0(ctx, mesh, pipeline, cameraBuffer),
  );
  _recordBindGroupSwitch(ctx);
  if (mesh.material.group1) {
    pass.setBindGroup(1, mesh.material.group1);
    _recordBindGroupSwitch(ctx);
  }
  pass.setVertexBuffer(0, mesh.geometry.vertexBuffer);
  const { indexBuffer, indexFormat, indexCount, vertexCount } = mesh.geometry;
  if (indexBuffer && indexFormat) {
    pass.setIndexBuffer(indexBuffer, indexFormat);
    pass.drawIndexed(indexCount);
  } else {
    pass.draw(vertexCount);
  }
  _recordDraw(ctx, { triangles: mesh.geometry.triangleCount });
  return pipeline;
}

export function renderToTexture(
  ctx: Context,
  opts: RenderToTextureOptions,
): void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  if (!opts.texture) {
    throw new FurnaceGpuError("renderToTexture: texture is required");
  }

  const cameraBuffer = _frameRenderInternals._ensureCameraBuffer(
    ctx,
    opts.camera,
  );
  const colorView = opts.texture.createView();
  const depthView = opts.depthTexture?.createView();
  const clearColor = opts.clearColor ?? DEFAULT_CLEAR_COLOR;
  const clearDepth = opts.clearDepth ?? DEFAULT_CLEAR_DEPTH;

  const encoder = ctx.device.createCommandEncoder();
  const pass = beginRenderPass(
    encoder,
    colorView,
    depthView,
    clearColor,
    clearDepth,
  );

  let lastPipeline: GPURenderPipeline | null = null;
  for (const mesh of opts.draw) {
    lastPipeline = recordDraw(pass, ctx, mesh, cameraBuffer, lastPipeline);
  }

  pass.end();
  ctx.device.queue.submit([encoder.finish()]);
}
