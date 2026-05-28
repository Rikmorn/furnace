import type { Camera } from "../camera/index.ts";
import * as camera from "../camera/index.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import * as gpu from "../gpu/index.ts";
import { _resolveGeometry } from "../mesh/internal.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { Mesh } from "../mesh/types.ts";
import type { Effect } from "../post/effect.ts";
import {
  _ensureSceneIntermediates,
  type IntermediateEntry,
} from "../post/intermediate.ts";
import {
  _recordBindGroupSwitch,
  _recordDraw,
  _recordPipelineSwitch,
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
} from "../stats/internal.ts";
import type { Vec4 } from "../transform/types.ts";
import { vec4 } from "../transform/vec4.ts";
import { trianglesForTopology } from "./triangles-for-topology.ts";

const CAMERA_UNIFORM_SIZE = 64; // one mat4x4<f32>

type DepthEntry = {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
};

const depthByCtx = new WeakMap<Context, DepthEntry>();
const depthHandleByCtx = new WeakMap<Context, ResourceHandle>();
const cameraBuffers = new WeakMap<Context, Map<Camera, GPUBuffer>>();
const cameraBufferHandles = new WeakMap<Context, Map<Camera, ResourceHandle>>();

function _ensureDepthTexture(ctx: Context): DepthEntry {
  const existing = depthByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  if (existing) {
    existing.texture.destroy();
    const oldHandle = depthHandleByCtx.get(ctx);
    if (oldHandle) _unregisterResource(ctx, oldHandle);
  }
  const texture = ctx.device.createTexture({
    size: { width, height },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const handle = _registerResource(ctx, {
    kind: "texture",
    bytes: width * height * 4,
  });
  depthHandleByCtx.set(ctx, handle);
  const entry: DepthEntry = {
    texture,
    view: texture.createView(),
    width,
    height,
  };
  depthByCtx.set(ctx, entry);
  if (existing === undefined) {
    _onDispose(ctx, () => _disposeDepth(ctx));
  }
  return entry;
}

function _disposeDepth(ctx: Context): void {
  const entry = depthByCtx.get(ctx);
  if (!entry) return;
  entry.texture.destroy();
  const handle = depthHandleByCtx.get(ctx);
  if (handle) _unregisterResource(ctx, handle);
  depthByCtx.delete(ctx);
  depthHandleByCtx.delete(ctx);
}

function _ensureCameraBuffer(ctx: Context, cam: Camera): GPUBuffer {
  let perCam = cameraBuffers.get(ctx);
  if (!perCam) {
    perCam = new Map();
    cameraBuffers.set(ctx, perCam);
    _onDispose(ctx, () => _disposeCameraBuffers(ctx));
  }
  let buffer = perCam.get(cam);
  if (!buffer) {
    buffer = ctx.device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    perCam.set(cam, buffer);
    let handles = cameraBufferHandles.get(ctx);
    if (!handles) {
      handles = new Map();
      cameraBufferHandles.set(ctx, handles);
    }
    handles.set(
      cam,
      _registerResource(ctx, { kind: "buffer", bytes: CAMERA_UNIFORM_SIZE }),
    );
  }
  const matrices = camera.getMatrices(cam);
  ctx.queue.writeBuffer(buffer, 0, matrices.viewProjection);
  return buffer;
}

function _disposeCameraBuffers(ctx: Context): void {
  const perCam = cameraBuffers.get(ctx);
  if (perCam) {
    for (const buffer of perCam.values()) buffer.destroy();
    cameraBuffers.delete(ctx);
  }
  const handles = cameraBufferHandles.get(ctx);
  if (handles) {
    for (const h of handles.values()) _unregisterResource(ctx, h);
    cameraBufferHandles.delete(ctx);
  }
}

/**
 * Options accepted by {@link render}.
 *
 * - `draw`: meshes to render, in order. The engine submits them as one render
 *   pass with no automatic sorting — caller controls draw order.
 * - `camera`: camera whose view/projection matrices populate `@group(0)
 *   @binding(0)` for each draw (see `engine-conventions.md` §"Binding
 *   contract").
 * - `effects`: optional post-process chain. When non-empty the scene is
 *   rendered to an off-screen target and ping-ponged through the effects to
 *   the swap chain. Final attachment.
 * - `clearColor`: linear-space RGBA used to clear the color attachment.
 *   Default `[0, 0, 0, 1]`. The sRGB encoding is applied on swap-chain write
 *   via the view format (see `engine-conventions.md` §"Color space").
 *   Components are read each frame and uploaded to the GPU verbatim;
 *   passing non-finite components produces undefined output (no engine-
 *   side validation per the hot-path-adjacent posture in
 *   `engine-conventions.md` §Failure policy).
 * - `clearDepth`: depth value cleared into the engine-managed depth texture
 *   each frame. Default `1.0` (far plane).
 */
export type RenderOptions = {
  draw: Mesh[];
  camera: Camera;
  effects?: Effect[];
  clearColor?: Vec4;
  clearDepth?: number;
};

const DEFAULT_CLEAR_COLOR: Vec4 = vec4.fromValues(0, 0, 0, 1);
const DEFAULT_CLEAR_DEPTH = 1.0;

// Per-mesh map from (pipeline, cameraBuffer) -> group-0 bind group. The outer
// WeakMap lets entries get GC'd when the mesh itself is dropped. The inner Maps
// exist because a mesh's material may swap pipelines over time AND the same
// mesh may be rendered with multiple cameras (e.g. main pass + render-to-texture
// pass) — each (pipeline, cameraBuffer) pair needs its own bind group.
const group0Cache = new WeakMap<
  Mesh,
  Map<GPURenderPipeline, Map<GPUBuffer, GPUBindGroup>>
>();

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
  let perPipeline = perMesh.get(pipeline);
  if (!perPipeline) {
    perPipeline = new Map();
    perMesh.set(pipeline, perPipeline);
  }
  const cached = perPipeline.get(cameraBuffer);
  if (cached) return cached;
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: mesh.objectBuffer } },
    ],
  });
  perPipeline.set(cameraBuffer, bindGroup);
  return bindGroup;
}

export const _frameRenderInternals = {
  _ensureDepthTexture,
  _ensureCameraBuffer,
  _ensureMeshGroup0: ensureGroup0,
  _validateDraw: validateDraw,
};

function beginRenderPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
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
  lastPipeline: GPURenderPipeline | null,
): GPURenderPipeline {
  _recomputeModelIfDirty(mesh);
  const pipeline = mesh.material.pipeline;
  pass.setPipeline(pipeline);
  if (pipeline !== lastPipeline) {
    _recordPipelineSwitch(ctx);
  }
  pass.setBindGroup(0, ensureGroup0(ctx, mesh, pipeline, cameraBuffer));
  _recordBindGroupSwitch(ctx);
  if (mesh.material.group1) {
    pass.setBindGroup(1, mesh.material.group1);
    _recordBindGroupSwitch(ctx);
  }
  const geom = _resolveGeometry(ctx, mesh.geometry);
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
    triangles: trianglesForTopology(mesh.material.topology, drawCount),
  });
  return pipeline;
}

function validateEffects(ctx: Context, effects: readonly Effect[]): void {
  for (let i = 0; i < effects.length; i++) {
    const fx = effects[i];
    if (fx == null) {
      throw new FurnaceGpuError(`effects[${i}]: null/undefined effect`);
    }
    if (fx._internal.destroyed) {
      throw new FurnaceGpuError(`effects[${i}]: effect was destroyed`);
    }
    if (fx.ctx !== ctx) {
      throw new FurnaceGpuError(
        `effects[${i}]: effect belongs to a different context`,
      );
    }
  }
}

function validateDraw(ctx: Context, draw: readonly Mesh[]): void {
  for (let i = 0; i < draw.length; i++) {
    const m = draw[i];
    if (m == null) {
      throw new FurnaceGpuError(`draw[${i}]: null/undefined mesh`);
    }
    if (m.ctx !== ctx) {
      throw new FurnaceGpuError(
        `draw[${i}]: mesh belongs to a different context`,
      );
    }
  }
}

function recordScenePass(
  ctx: Context,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  draw: readonly Mesh[],
  cameraBuffer: GPUBuffer,
  clearColor: Vec4,
  clearDepth: number,
): void {
  const encoder = ctx.device.createCommandEncoder();
  const pass = beginRenderPass(
    encoder,
    colorView,
    depthView,
    clearColor,
    clearDepth,
  );
  let lastPipeline: GPURenderPipeline | null = null;
  for (const mesh of draw) {
    lastPipeline = recordDraw(pass, ctx, mesh, cameraBuffer, lastPipeline);
  }
  pass.end();
  ctx.device.queue.submit([encoder.finish()]);
}

function renderEffectPass(
  ctx: Context,
  effect: Effect,
  inputView: GPUTextureView,
  sampler: GPUSampler,
  outputView: GPUTextureView,
): void {
  const group0 = ctx.device.createBindGroup({
    layout: effect.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: inputView },
      { binding: 1, resource: sampler },
    ],
  });
  const loadOp: GPULoadOp = effect.blend ? "load" : "clear";
  const encoder = ctx.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp,
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(effect.pipeline);
  _recordPipelineSwitch(ctx);
  pass.setBindGroup(0, group0);
  _recordBindGroupSwitch(ctx);
  if (effect.bindings && effect.bindings.length > 0) {
    const group1 = ctx.device.createBindGroup({
      layout: effect.pipeline.getBindGroupLayout(1),
      entries: effect.bindings,
    });
    pass.setBindGroup(1, group1);
    _recordBindGroupSwitch(ctx);
  }
  pass.draw(3);
  _recordDraw(ctx, { triangles: 1 });
  pass.end();
  ctx.device.queue.submit([encoder.finish()]);
}

function runEffectsPingPong(
  ctx: Context,
  effects: readonly Effect[],
  im: IntermediateEntry,
): void {
  let inputView = im.aView;
  let outputView = im.bView;
  for (let i = 0; i < effects.length - 1; i++) {
    const effect = effects[i];
    if (!effect) continue; // unreachable after validateEffects; satisfies noUncheckedIndexedAccess
    renderEffectPass(ctx, effect, inputView, im.sampler, outputView);
    [inputView, outputView] = [outputView, inputView];
  }
  const finalEffect = effects[effects.length - 1];
  if (!finalEffect) return; // unreachable after validateEffects
  const swapView = gpu.getCurrentTextureView(ctx);
  renderEffectPass(ctx, finalEffect, inputView, im.sampler, swapView);
}

/**
 * Submit one frame: clear, draw `opts.draw` against `opts.camera`, optionally
 * ping-pong through `opts.effects` to the swap chain.
 *
 * Allocation semantics — both lazy, both engine-owned and reused across
 * frames:
 * - One depth texture per context (`depth24plus`), allocated on first call
 *   and reallocated when the canvas backing-store size changes. Always
 *   attached; the engine has no depth-less render path here (see
 *   `engine-conventions.md` §"Binding contract").
 * - One camera uniform buffer (64 bytes) per `(context, camera)` pair,
 *   allocated on first sighting of a given camera. The buffer is written each
 *   call from `camera.getMatrices`. Per-mesh `@group(0)` bind groups are
 *   cached on the mesh keyed by `(pipeline, cameraBuffer)`.
 *
 * Setup-loud per the foreground failure policy. The draw and effects
 * lists are validated up front; any null, destroyed, or cross-context
 * entry throws before any GPU work is recorded.
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed; if
 *   `opts.camera` or `opts.draw` is null/undefined; if any entry in
 *   `opts.draw` is null or belongs to a different context; or if any
 *   `opts.effects` entry is null, destroyed, or belongs to a different
 *   context.
 */
export function render(ctx: Context, opts: RenderOptions): void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  if (opts.camera == null) {
    throw new FurnaceGpuError("render: camera is required");
  }
  if (opts.draw == null) {
    throw new FurnaceGpuError("render: draw is required");
  }
  validateDraw(ctx, opts.draw);
  const effects = opts.effects ?? [];
  if (effects.length > 0) validateEffects(ctx, effects);

  const cameraBuffer = _ensureCameraBuffer(ctx, opts.camera);
  const depth = _ensureDepthTexture(ctx);
  const clearColor = opts.clearColor ?? DEFAULT_CLEAR_COLOR;
  const clearDepth = opts.clearDepth ?? DEFAULT_CLEAR_DEPTH;

  if (effects.length === 0) {
    const colorView = gpu.getCurrentTextureView(ctx);
    recordScenePass(
      ctx,
      colorView,
      depth.view,
      opts.draw,
      cameraBuffer,
      clearColor,
      clearDepth,
    );
    return;
  }

  const im = _ensureSceneIntermediates(ctx);
  recordScenePass(
    ctx,
    im.aView,
    depth.view,
    opts.draw,
    cameraBuffer,
    clearColor,
    clearDepth,
  );
  runEffectsPingPong(ctx, effects, im);
}
