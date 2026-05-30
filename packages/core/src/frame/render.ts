import type { Camera } from "../camera/index.ts";
import * as camera from "../camera/index.ts";
import type { GeometrySlot } from "../geometry/types.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import * as gpu from "../gpu/index.ts";
import { _ENGINE_DEPTH_FORMAT } from "../material/material.ts";
import type { MaterialSlot } from "../material/types.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { Mesh, MeshSlot } from "../mesh/types.ts";
import type { Effect, EffectSlot } from "../post/effect.ts";
import {
  _ensureSceneIntermediates,
  type IntermediateEntry,
} from "../post/intermediate.ts";
import {
  _lookupEffect,
  _lookupGeometry,
  _lookupMaterial,
  _lookupMesh,
} from "../resources/internal.ts";
import {
  _recordAlloc,
  _recordBindGroupSwitch,
  _recordDestroy,
  _recordDraw,
  _recordPipelineSwitch,
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
const cameraBuffers = new WeakMap<Context, Map<Camera, GPUBuffer>>();
// cameraBufferHandles deleted — every camera buffer is CAMERA_UNIFORM_SIZE bytes;
// the constant is in scope at destroy time, no per-instance lookup needed.

const DEPTH_BYTES_PER_PIXEL = 4; // depth24plus → 4 bytes/texel for accounting

function depthEntryBytes(entry: DepthEntry): number {
  return entry.width * entry.height * DEPTH_BYTES_PER_PIXEL;
}

function _ensureDepthTexture(ctx: Context): DepthEntry {
  const existing = depthByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  if (existing) {
    existing.texture.destroy();
    _recordDestroy(ctx, "texture", depthEntryBytes(existing));
  }
  const texture = ctx.device.createTexture({
    size: { width, height },
    format: _ENGINE_DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  _recordAlloc(ctx, "texture", width * height * DEPTH_BYTES_PER_PIXEL);
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
  _recordDestroy(ctx, "texture", depthEntryBytes(entry));
  depthByCtx.delete(ctx);
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
    _recordAlloc(ctx, "buffer", CAMERA_UNIFORM_SIZE);
  }
  const matrices = camera.getMatrices(cam);
  ctx.queue.writeBuffer(buffer, 0, matrices.viewProjection);
  return buffer;
}

function _disposeCameraBuffers(ctx: Context): void {
  const perCam = cameraBuffers.get(ctx);
  if (perCam) {
    for (const buffer of perCam.values()) {
      buffer.destroy();
      _recordDestroy(ctx, "buffer", CAMERA_UNIFORM_SIZE);
    }
    cameraBuffers.delete(ctx);
  }
}

/** Internal — shared fields of the render commands. Not a public export. */
export type RenderPassBase = {
  /** Meshes to render, in order. The engine submits them as one render pass
   *  with no automatic sorting — caller controls draw order. */
  draw: Mesh[];
  /** Camera whose view/projection matrices populate `@group(0) @binding(0)`
   *  for each draw (see `engine-conventions.md` §"Binding contract"). */
  camera: Camera;
  /** Linear-space RGBA used to clear the color attachment. Default
   *  `[0, 0, 0, 1]`. The sRGB encoding is applied on swap-chain write via the
   *  view format (see `engine-conventions.md` §"Color space"). Components are
   *  read each frame and uploaded to the GPU verbatim; passing non-finite
   *  components produces undefined output (no engine-side validation per the
   *  hot-path-adjacent posture in `engine-conventions.md` §Failure policy). */
  clearColor?: Vec4;
  /** Depth value cleared into the engine-managed depth texture each frame.
   *  Default `1.0` (far plane). */
  clearDepth?: number;
};

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
export type RenderOptions = RenderPassBase & {
  effects?: Effect[];
};

const DEFAULT_CLEAR_COLOR: Vec4 = vec4.fromValues(0, 0, 0, 1);
const DEFAULT_CLEAR_DEPTH = 1.0;

// Per-mesh map from (pipeline, cameraBuffer) -> group-0 bind group. Keyed by
// MeshSlot (the slot object reference) so a WeakMap suffices: when the slot is
// recycled by the pool, the old reference becomes unreachable and its cache
// drops naturally. The inner Maps exist because a mesh's material may swap
// pipelines over time AND the same mesh may be rendered with multiple cameras
// (e.g. main pass + render-to-texture pass) — each (pipeline, cameraBuffer)
// pair needs its own bind group.
const group0Cache = new WeakMap<
  MeshSlot,
  Map<GPURenderPipeline, Map<GPUBuffer, GPUBindGroup>>
>();

function ensureGroup0(
  ctx: Context,
  slot: MeshSlot,
  pipeline: GPURenderPipeline,
  cameraBuffer: GPUBuffer,
): GPUBindGroup {
  let perMesh = group0Cache.get(slot);
  if (!perMesh) {
    perMesh = new Map();
    group0Cache.set(slot, perMesh);
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
      { binding: 1, resource: { buffer: slot.objectBuffer } },
    ],
  });
  perPipeline.set(cameraBuffer, bindGroup);
  return bindGroup;
}

/**
 * A draw entry pre-resolved by {@link validateDraw}: the mesh, material,
 * and geometry slots fetched in one upfront pass so the per-draw loop
 * body can consume them directly with no further lookups.
 *
 * Engine-internal; not part of the public surface.
 */
export type ResolvedDraw = {
  mesh: MeshSlot;
  material: MaterialSlot;
  geometry: GeometrySlot;
};

export const _frameRenderInternals = {
  _ensureDepthTexture,
  _ensureCameraBuffer,
  _ensureMeshGroup0: ensureGroup0,
  _validateDraw: validateDraw,
  _firstDepthDisagreement: firstDepthDisagreement,
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
  pass.setBindGroup(0, ensureGroup0(ctx, mesh, pipeline, cameraBuffer));
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

function validateEffects(
  ctx: Context,
  effects: readonly Effect[],
): EffectSlot[] {
  const resolved: EffectSlot[] = [];
  for (let i = 0; i < effects.length; i++) {
    const fx = effects[i];
    if (fx == null) {
      throw new FurnaceGpuError(`effects[${i}]: null/undefined effect`);
    }
    const slot = _lookupEffect<EffectSlot>(ctx, fx);
    if (slot === null) {
      throw new FurnaceGpuError(
        `effects[${i}]: effect is invalid, destroyed, or belongs to a different context`,
      );
    }
    resolved.push(slot);
  }
  return resolved;
}

function validateDraw(ctx: Context, draw: readonly Mesh[]): ResolvedDraw[] {
  const resolved: ResolvedDraw[] = [];
  for (let i = 0; i < draw.length; i++) {
    const m = draw[i];
    if (m == null) {
      throw new FurnaceGpuError(`draw[${i}]: null/undefined mesh`);
    }
    const meshSlot = _lookupMesh<MeshSlot>(ctx, m);
    if (meshSlot === null) {
      throw new FurnaceGpuError(
        `draw[${i}]: mesh handle is invalid, destroyed, or belongs to a different context`,
      );
    }
    const materialSlot = _lookupMaterial<MaterialSlot>(ctx, meshSlot.material);
    if (materialSlot === null) {
      throw new FurnaceGpuError(
        `draw[${i}]: mesh.material handle is invalid or destroyed`,
      );
    }
    const geometrySlot = _lookupGeometry<GeometrySlot>(ctx, meshSlot.geometry);
    if (geometrySlot === null) {
      throw new FurnaceGpuError(
        `draw[${i}]: mesh.geometry handle is invalid or destroyed`,
      );
    }
    resolved.push({
      mesh: meshSlot,
      material: materialSlot,
      geometry: geometrySlot,
    });
  }
  return resolved;
}

/**
 * Returns the index of the first draw whose `material.depthEnabled` disagrees
 * with `passHasDepth`, or `-1` if all draws agree with `passHasDepth`.
 * Query only — no side effects.
 */
function firstDepthDisagreement(
  resolvedDraws: readonly ResolvedDraw[],
  passHasDepth: boolean,
): number {
  for (let i = 0; i < resolvedDraws.length; i++) {
    const draw = resolvedDraws[i];
    if (!draw) continue; // unreachable — dense array from validateDraw; satisfies noUncheckedIndexedAccess
    if (draw.material.depthEnabled !== passHasDepth) return i;
  }
  return -1;
}

function recordScenePass(
  ctx: Context,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  draw: readonly ResolvedDraw[],
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
  for (const resolved of draw) {
    lastPipeline = recordDraw(pass, ctx, resolved, cameraBuffer, lastPipeline);
  }
  pass.end();
  ctx.device.queue.submit([encoder.finish()]);
}

function renderEffectPass(
  ctx: Context,
  slot: EffectSlot,
  inputView: GPUTextureView,
  sampler: GPUSampler,
  outputView: GPUTextureView,
): void {
  const group0 = ctx.device.createBindGroup({
    layout: slot.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: inputView },
      { binding: 1, resource: sampler },
    ],
  });
  const loadOp: GPULoadOp = slot.blend ? "load" : "clear";
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
  pass.setPipeline(slot.pipeline);
  _recordPipelineSwitch(ctx);
  pass.setBindGroup(0, group0);
  _recordBindGroupSwitch(ctx);
  if (slot.bindings && slot.bindings.length > 0) {
    const group1 = ctx.device.createBindGroup({
      layout: slot.pipeline.getBindGroupLayout(1),
      entries: slot.bindings,
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
  effects: readonly EffectSlot[],
  im: IntermediateEntry,
): void {
  let inputView = im.aView;
  let outputView = im.bView;
  for (let i = 0; i < effects.length - 1; i++) {
    const slot = effects[i];
    if (!slot) continue; // unreachable after validateEffects; satisfies noUncheckedIndexedAccess
    renderEffectPass(ctx, slot, inputView, im.sampler, outputView);
    [inputView, outputView] = [outputView, inputView];
  }
  const finalSlot = effects[effects.length - 1];
  if (!finalSlot) return; // unreachable after validateEffects
  const swapView = gpu.getCurrentTextureView(ctx);
  renderEffectPass(ctx, finalSlot, inputView, im.sampler, swapView);
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
 * lists are validated up front; `validateDraw` resolves each mesh's
 * material and geometry slots in the same pass so the per-draw loop
 * body consumes the resolved triple with no further lookups.
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed; if
 *   `opts.camera` or `opts.draw` is null/undefined; if any entry in
 *   `opts.draw` is null, invalid, destroyed, or belongs to a different
 *   context; if the resolved mesh's `material` or `geometry` does not
 *   itself resolve to a live slot (defensive — the Mesh→Material and
 *   Mesh→Geometry refcounts normally keep these alive while a mesh
 *   references them); if any drawn material was created with
 *   `depthEnabled:false` (`frame.render` always renders with a depth
 *   attachment — depth-less materials must use `renderToTexture` without
 *   a `depthTexture`); or if any `opts.effects` entry is null, already
 *   destroyed, or belongs to a different context (a single "invalid
 *   handle" diagnostic — the handle-pool generation counter does not
 *   distinguish destroyed from never-existed).
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
  const resolvedDraws = validateDraw(ctx, opts.draw);
  const depthMismatch = firstDepthDisagreement(resolvedDraws, true);
  if (depthMismatch !== -1) {
    throw new FurnaceGpuError(
      `render: draw[${depthMismatch}] was created with depthEnabled:false but frame.render always renders with a depth attachment; ` +
        `depth-less materials can only be drawn via renderToTexture without a depthTexture`,
    );
  }
  const effects = opts.effects ?? [];
  const resolvedEffects = validateEffects(ctx, effects);

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
      resolvedDraws,
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
    resolvedDraws,
    cameraBuffer,
    clearColor,
    clearDepth,
  );
  runEffectsPingPong(ctx, resolvedEffects, im);
}
