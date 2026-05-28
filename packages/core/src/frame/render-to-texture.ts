import type { Camera } from "../camera/index.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _resolveMaterial } from "../material/internal.ts";
import { _resolveGeometry, _resolveMesh } from "../mesh/internal.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { Mesh } from "../mesh/types.ts";
import {
  _recordBindGroupSwitch,
  _recordDraw,
  _recordPipelineSwitch,
} from "../stats/internal.ts";
import type { Vec4 } from "../transform/types.ts";
import { vec4 } from "../transform/vec4.ts";
import { _frameRenderInternals } from "./render.ts";
import { trianglesForTopology } from "./triangles-for-topology.ts";

/**
 * Options accepted by {@link renderToTexture}.
 *
 * - `texture`: consumer-supplied color target. The consumer owns its
 *   creation and destruction; the engine does not register or pool it.
 * - `draw` / `camera` / `clearColor` / `clearDepth`: same semantics as
 *   `RenderOptions`. `clearColor` defaults to `[0, 0, 0, 1]` (linear);
 *   `clearDepth` defaults to `1.0`.
 * - `depthTexture`: optional consumer-supplied depth target. When omitted,
 *   the render pass is built without a depth-stencil attachment.
 *
 * **Caveat — depth coupling:** stock materials (`material.unlit`,
 * `material.normalColor`, and any `material.create` call) currently build
 * pipelines that declare depth-stencil state. WebGPU validation requires the
 * pass match the pipeline, so omitting `depthTexture` while drawing any
 * stock material causes the pass to fail validation silently at submit time
 * (consumers see a frozen previous-frame output). Genuine depth-less
 * off-screen rendering is tracked in
 * `docs/backlog/engine-architecture/render-to-texture-depth-coupling.md`.
 */
export type RenderToTextureOptions = {
  texture: GPUTexture;
  draw: Mesh[];
  camera: Camera;
  depthTexture?: GPUTexture;
  clearColor?: Vec4;
  clearDepth?: number;
};

const DEFAULT_CLEAR_COLOR: Vec4 = vec4.fromValues(0, 0, 0, 1);
const DEFAULT_CLEAR_DEPTH = 1.0;

function beginRenderPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView | undefined,
  clearColor: Vec4,
  clearDepth: number,
): GPURenderPassEncoder {
  const [r = 0, g = 0, b = 0, a = 1] = clearColor;
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
  const slot = _resolveMesh(ctx, mesh);
  _recomputeModelIfDirty(slot);
  const materialSlot = _resolveMaterial(ctx, slot.material);
  const pipeline = materialSlot.pipeline;
  pass.setPipeline(pipeline);
  if (pipeline !== lastPipeline) {
    _recordPipelineSwitch(ctx);
  }
  pass.setBindGroup(
    0,
    _frameRenderInternals._ensureMeshGroup0(ctx, slot, pipeline, cameraBuffer),
  );
  _recordBindGroupSwitch(ctx);
  if (materialSlot.group1) {
    pass.setBindGroup(1, materialSlot.group1);
    _recordBindGroupSwitch(ctx);
  }
  const geom = _resolveGeometry(ctx, slot.geometry);
  pass.setVertexBuffer(0, geom.vertexBuffer);
  const { indexBuffer, indexFormat, indexCount, vertexCount } = geom;
  if (indexBuffer && indexFormat) {
    pass.setIndexBuffer(indexBuffer, indexFormat);
    pass.drawIndexed(indexCount);
  } else {
    pass.draw(vertexCount);
  }
  const drawCount = indexCount || vertexCount;
  _recordDraw(ctx, {
    triangles: trianglesForTopology(materialSlot.topology, drawCount),
  });
  return pipeline;
}

/**
 * Off-screen variant of `render`: draw `opts.draw` against `opts.camera`
 * into a consumer-supplied `GPUTexture` instead of the swap chain. No
 * post-effects chain — pipe the result through another `render` call (as a
 * shader input) for compositing.
 *
 * Reuses the engine-owned per-camera uniform buffer and `@group(0)` bind
 * group cache shared with `render`, so calling both with the same camera
 * does not allocate twice. The depth attachment is consumer-supplied — see
 * the {@link RenderToTextureOptions} caveat about the silent validation
 * failure when omitted with depth-declaring materials.
 *
 * Setup-loud per the foreground failure policy.
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed, `opts.texture`
 *   is missing, `opts.camera` or `opts.draw` is null/undefined, or any
 *   entry in `opts.draw` is null or belongs to a different context.
 */
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
  if (opts.camera == null) {
    throw new FurnaceGpuError("renderToTexture: camera is required");
  }
  if (opts.draw == null) {
    throw new FurnaceGpuError("renderToTexture: draw is required");
  }
  _frameRenderInternals._validateDraw(ctx, opts.draw);

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
