import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _ENGINE_DEPTH_FORMAT } from "../material/material.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import {
  _recordBindGroupSwitch,
  _recordDraw,
  _recordPipelineSwitch,
} from "../stats/internal.ts";
import type { Vec4 } from "../transform/types.ts";
import { vec4 } from "../transform/vec4.ts";
import {
  _frameRenderInternals,
  type RenderPassBase,
  type ResolvedDraw,
} from "./render.ts";
import { trianglesForTopology } from "./triangles-for-topology.ts";

/**
 * Options accepted by {@link renderToTexture}.
 *
 * - `texture`: consumer-supplied color target. The consumer owns its
 *   creation and destruction; the engine does not register or pool it.
 *   Must have the same format as `ctx.format`; a mismatch throws
 *   `FurnaceGpuError`.
 * - `draw` / `camera` / `clearColor` / `clearDepth`: same semantics as
 *   `RenderOptions`. `clearColor` defaults to `[0, 0, 0, 1]` (linear);
 *   `clearDepth` defaults to `1.0`.
 * - `depthTexture`: optional consumer-supplied depth target. When omitted,
 *   the render pass is built without a depth-stencil attachment. Omit
 *   **only** when every drawn material was created with `depthEnabled: false`.
 *   Must be format `depth24plus` when supplied; any other format throws
 *   `FurnaceGpuError`.
 *
 * **Depth coupling — now loud:** `renderToTexture` validates that the depth
 * attachment presence agrees with each drawn material's `depthEnabled` flag.
 * A pass with `depthTexture` requires every material to have `depthEnabled:
 * true` (the default); a pass without `depthTexture` requires every material
 * to have `depthEnabled: false`. A mismatch in either direction throws
 * `FurnaceGpuError` immediately at call time. This replaces the previous
 * silent WebGPU validation failure (which produced a frozen previous-frame
 * output). To draw a genuinely depth-less off-screen pass, create all
 * materials with `depthEnabled: false` and omit `depthTexture`.
 */
export type RenderToTextureOptions = RenderPassBase & {
  texture: GPUTexture;
  depthTexture?: GPUTexture;
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
  resolved: ResolvedDraw,
  cameraBuffer: GPUBuffer,
  lastPipeline: GPURenderPipeline | null,
): GPURenderPipeline {
  const { mesh, material, geometry } = resolved;
  _recomputeModelIfDirty(ctx, mesh);
  const pipeline = material.pipeline;
  pass.setPipeline(pipeline);
  if (pipeline !== lastPipeline) {
    _recordPipelineSwitch(ctx);
  }
  pass.setBindGroup(
    0,
    _frameRenderInternals._ensureMeshGroup0(ctx, mesh, pipeline, cameraBuffer),
  );
  _recordBindGroupSwitch(ctx);
  if (material.group1) {
    pass.setBindGroup(1, material.group1);
    _recordBindGroupSwitch(ctx);
  }
  pass.setVertexBuffer(0, geometry.vertexBuffer);
  const { indexBuffer, indexFormat, indexCount, vertexCount } = geometry;
  if (indexBuffer && indexFormat) {
    pass.setIndexBuffer(indexBuffer, indexFormat);
    pass.drawIndexed(indexCount);
  } else {
    pass.draw(vertexCount);
  }
  const drawCount = indexCount || vertexCount;
  _recordDraw(ctx, {
    triangles: trianglesForTopology(material.topology, drawCount),
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
 * {@link RenderToTextureOptions} for the depth-coupling rules and the three
 * conditions that throw `FurnaceGpuError` (color-format mismatch, depth-
 * presence mismatch, depth-format mismatch).
 *
 * Setup-loud per the foreground failure policy. The shared
 * `validateDraw` resolves each mesh's material and geometry slots in
 * the same pass so the per-draw loop body consumes the resolved triple
 * with no further lookups.
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed, `opts.texture`
 *   is missing, `opts.camera` or `opts.draw` is null/undefined, any
 *   entry in `opts.draw` is null, invalid, destroyed, or belongs to a
 *   different context, or if a draw's mesh references a material or
 *   geometry that does not itself resolve to a live slot (defensive —
 *   the Mesh→Material and Mesh→Geometry refcounts normally keep these
 *   alive while a mesh references them).
 * @throws FurnaceGpuError - if `opts.texture.format` does not equal
 *   `ctx.format` (the format material pipelines render to).
 * @throws FurnaceGpuError - if any drawn material's `depthEnabled` flag
 *   disagrees with whether `opts.depthTexture` was supplied: a material
 *   created with `depthEnabled: false` in a depth-having pass, or a
 *   depth-enabled material in a pass without a `depthTexture`.
 * @throws FurnaceGpuError - if `opts.depthTexture` is supplied but its
 *   format is not `depth24plus`.
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
  const resolvedDraws = _frameRenderInternals._validateDraw(ctx, opts.draw);

  const passHasDepth = opts.depthTexture !== undefined;

  // (1) color-target format must match what material pipelines render to.
  if (opts.texture.format !== ctx.format) {
    throw new FurnaceGpuError(
      `renderToTexture: texture format '${opts.texture.format}' must equal the context format '${ctx.format}' that materials render to`,
    );
  }
  // (2) every drawn material's depth declaration must match the pass.
  const depthMismatch = _frameRenderInternals._firstDepthDisagreement(
    resolvedDraws,
    passHasDepth,
  );
  if (depthMismatch !== -1) {
    throw new FurnaceGpuError(
      passHasDepth
        ? `renderToTexture: draw[${depthMismatch}] was created with depthEnabled:false but a depthTexture was provided; omit it or set depthEnabled:true`
        : `renderToTexture: draw[${depthMismatch}] uses a depth-enabled material but no depthTexture was provided; pass a depthTexture or set depthEnabled:false`,
    );
  }
  // (3) consumer depthTexture must match the format material pipelines declare.
  if (opts.depthTexture && opts.depthTexture.format !== _ENGINE_DEPTH_FORMAT) {
    throw new FurnaceGpuError(
      `renderToTexture: depthTexture format '${opts.depthTexture.format}' must be '${_ENGINE_DEPTH_FORMAT}'`,
    );
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
  for (const resolved of resolvedDraws) {
    lastPipeline = recordDraw(pass, ctx, resolved, cameraBuffer, lastPipeline);
  }

  pass.end();
  ctx.device.queue.submit([encoder.finish()]);
}
