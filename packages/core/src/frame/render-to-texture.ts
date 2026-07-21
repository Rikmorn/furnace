import { _flushDirtyBindings } from "../binding/binding.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _ENGINE_DEPTH_FORMAT } from "../material/material.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { InstancedMesh } from "../mesh/types.ts";
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
  type ResolvedMeshDraw,
} from "./render.ts";
import { trianglesForTopology } from "./triangles-for-topology.ts";

/**
 * Options accepted by {@link renderToTexture}.
 *
 * - `texture`: consumer-supplied color target. The consumer owns its
 *   creation and destruction; the engine does not register or pool it.
 *   Must have the same format as `ctx._internal.workingColorFormat` (the
 *   format material pipelines render to — `ctx.format` for LDR contexts,
 *   `rgba16float` for HDR contexts). A mismatch throws `FurnaceGpuError`.
 * - `meshes` / `camera` / `clearColor` / `clearDepth`: same semantics as
 *   `RenderOptions`. `clearColor` defaults to `[0, 0, 0, 1]` (linear);
 *   `clearDepth` defaults to `1.0`.
 * - `instanced`: optional instanced draw groups, recorded after `meshes` in
 *   the same off-screen pass. Each is drawn as one instanced draw call sourcing
 *   its per-instance model matrix + tint from the instance vertex buffers (slots
 *   1/2). Resolved against the dedicated instanced-mesh pool — never inferred
 *   from a shared handle. Same invalid-handle semantics as `meshes`. Instanced
 *   materials default `depthEnabled: true`, so a `depthTexture` is required.
 * - `depthTexture`: optional consumer-supplied depth target. When omitted,
 *   the render pass is built without a depth-stencil attachment. Omit
 *   **only** when every drawn material was created with `depthEnabled: false`.
 *   Must be format `depth24plus` when supplied; any other format throws
 *   `FurnaceGpuError`.
 *
 * **Strict submission order — no blend partitioning.** Unlike `frame.render`,
 * which records blended materials after every opaque draw, this pass records
 * `meshes` then `instanced` exactly as supplied. A translucent draw submitted
 * before opaque geometry is therefore overdrawn by it. Deliberate: the
 * off-screen path serves ID/data passes (e.g. GPU picking) where a reordering
 * the caller did not ask for is a hazard, not a fix. A consumer that needs
 * translucent overlays composited here must order its own list opaques-first.
 *
 * **MSAA contexts not supported:** `renderToTexture` renders a single-sample
 * off-screen pass. When the context was created with `sampleCount: 4`, every
 * material pipeline is multisampled and cannot be drawn in this single-sample
 * pass. Calling `renderToTexture` on an MSAA context throws `FurnaceGpuError`.
 * Use a `sampleCount: 1` context for off-screen render targets.
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
  /** Instanced draw groups, recorded after `meshes` in the same off-screen
   *  pass — strict submission order, with no blend partitioning (unlike
   *  `frame.render`). Each is drawn as one instanced draw call (per-instance
   *  transform + tint from the instance vertex buffers). Resolved against the
   *  dedicated instanced-mesh pool. Same invalid-handle semantics as `meshes`. */
  instanced?: InstancedMesh[];
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
  resolved: ResolvedMeshDraw,
  cameraBuffer: GPUBuffer,
  sceneBuffer: GPUBuffer,
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
    _frameRenderInternals._ensurePerFrameGroup0(
      ctx,
      pipeline,
      cameraBuffer,
      sceneBuffer,
      material.usesScene,
      // usesShadows binds the shadow array/sampler even in RTT: the array is cleared
      // (depth = 1.0) and fr_shadowFactor returns 1.0 (lit) for non-casting slots — a
      // harmless no-op. RTT runs no shadow passes (see the RTT deferral note above).
      material.usesShadows,
    ),
  );
  _recordBindGroupSwitch(ctx);
  pass.setBindGroup(
    1,
    material.group1 ?? _frameRenderInternals._ensureEmptyGroup1(ctx, pipeline),
  );
  _recordBindGroupSwitch(ctx);
  pass.setBindGroup(
    2,
    _frameRenderInternals._ensureObjectGroup2(ctx, mesh, pipeline),
  );
  _recordBindGroupSwitch(ctx);
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
 * Off-screen variant of `render`: draw `opts.meshes` against `opts.camera`
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
 *   is missing, `opts.camera` or `opts.meshes` is null/undefined, any
 *   entry in `opts.meshes` is null, invalid, destroyed, or belongs to a
 *   different context, or if a drawn mesh references a material or
 *   geometry that does not itself resolve to a live slot (defensive —
 *   the Mesh→Material and Mesh→Geometry refcounts normally keep these
 *   alive while a mesh references them). The same invalid-handle
 *   semantics apply to every entry in `opts.instanced` (resolved against
 *   the instanced-mesh pool, with its bound material/geometry).
 * @throws FurnaceGpuError - if `ctx._internal.sampleCount` is not `1`.
 *   MSAA contexts build multisampled material pipelines that are
 *   incompatible with the single-sample off-screen pass. Use a
 *   `sampleCount: 1` context for off-screen render targets.
 * @throws FurnaceGpuError - if `opts.texture.format` does not equal
 *   `ctx._internal.workingColorFormat` (the format material pipelines
 *   render to — `ctx.format` for LDR, `rgba16float` for HDR).
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
  if (opts.meshes == null) {
    throw new FurnaceGpuError("renderToTexture: meshes is required");
  }
  // (1) MSAA guard: renderToTexture is a single-sample pass; multisampled
  // material pipelines cannot be drawn in it. Reject early with a clear error
  // rather than letting the GPU layer surface a silent validation failure.
  if (ctx._internal.sampleCount !== 1) {
    throw new FurnaceGpuError(
      `renderToTexture: MSAA contexts are not supported (ctx sampleCount is ${ctx._internal.sampleCount}); its material pipelines are built multisampled but renderToTexture renders a single-sample pass. Use a sampleCount:1 context for off-screen render targets`,
    );
  }

  // Flush all dirty bindings to the GPU before any draw work begins — mirrors
  // frame.render. Without it, material uniforms set via binding.set (lazy,
  // dirty-marked) read as their zero-initialized GPU value (e.g. mat.color = 0).
  _flushDirtyBindings(ctx);
  const resolvedDraws: ResolvedDraw[] = [
    ..._frameRenderInternals._validateDraw(ctx, opts.meshes),
    ..._frameRenderInternals._validateInstancedDraw(ctx, opts.instanced ?? []),
  ];

  const passHasDepth = opts.depthTexture !== undefined;

  // (2) color-target format must match the working color format that material
  // pipelines render to (ctx.format for LDR, rgba16float for HDR).
  if (opts.texture.format !== ctx._internal.workingColorFormat) {
    throw new FurnaceGpuError(
      `renderToTexture: texture format '${opts.texture.format}' must equal the working color format '${ctx._internal.workingColorFormat}' that material pipelines render to`,
    );
  }
  // (3) every drawn material's depth declaration must match the pass.
  const depthMismatch = _frameRenderInternals._firstDepthDisagreement(
    resolvedDraws,
    passHasDepth,
  );
  if (depthMismatch !== -1) {
    const at = _frameRenderInternals._drawLabel(
      depthMismatch,
      opts.meshes.length,
    );
    throw new FurnaceGpuError(
      passHasDepth
        ? `renderToTexture: ${at} was created with depthEnabled:false but a depthTexture was provided; omit it or set depthEnabled:true`
        : `renderToTexture: ${at} uses a depth-enabled material but no depthTexture was provided; pass a depthTexture or set depthEnabled:false`,
    );
  }
  // (4) consumer depthTexture must match the format material pipelines declare.
  if (opts.depthTexture && opts.depthTexture.format !== _ENGINE_DEPTH_FORMAT) {
    throw new FurnaceGpuError(
      `renderToTexture: depthTexture format '${opts.depthTexture.format}' must be '${_ENGINE_DEPTH_FORMAT}'`,
    );
  }

  const cameraBuffer = _frameRenderInternals._ensureCameraBuffer(
    ctx,
    opts.camera,
  );
  // Off-screen passes carry no lights param — write a default (ambient-only)
  // Scene so lit materials still validate + draw. No shadow casters in the
  // off-screen path. (Off-screen lighting + shadows: backlog.)
  const sceneBuffer = _frameRenderInternals._writeSceneBuffer(
    ctx,
    undefined,
    undefined,
    [],
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
    // Instanced groups reuse the shared recorder from render.ts (no duplicated
    // instanced draw body); RTT's local recordDraw stays mesh-only typed.
    lastPipeline =
      resolved.kind === "instanced"
        ? _frameRenderInternals._recordInstancedDraw(
            pass,
            ctx,
            resolved,
            cameraBuffer,
            sceneBuffer,
            lastPipeline,
          )
        : recordDraw(
            pass,
            ctx,
            resolved,
            cameraBuffer,
            sceneBuffer,
            lastPipeline,
          );
  }

  pass.end();
  ctx.queue.submit([encoder.finish()]);
}
