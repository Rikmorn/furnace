import { _flushDirtyBindings } from "../binding/binding.ts";
import type { Camera } from "../camera/index.ts";
import * as camera from "../camera/index.ts";
import type { GeometrySlot } from "../geometry/types.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import * as gpu from "../gpu/index.ts";
import { warn } from "../log/internal.ts";
import { _ENGINE_DEPTH_FORMAT } from "../material/material.ts";
import type { MaterialSlot } from "../material/types.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { Mesh, MeshSlot } from "../mesh/types.ts";
import type { Effect, EffectSlot } from "../post/effect.ts";
import { _evaluateChain } from "../post/evaluate.ts";
import { bytesPerTexel } from "../post/format-bytes.ts";
import { _acquirePoolTarget, _poolBeginFrame } from "../post/pool.ts";
import { _ensurePostSampler } from "../post/post-sampler.ts";
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
import {
  _packScene,
  type Ambient,
  type Light,
  MAX_LIGHTS,
  MAX_SHADOW_CASTERS,
  SCENE_BYTE_SIZE,
  type ShadowCaster,
} from "./lights.ts";
import {
  _collectShadowCasters,
  _ensureShadowMap,
  _recordShadowPasses,
} from "./shadow-map.ts";
import { trianglesForTopology } from "./triangles-for-topology.ts";

const CAMERA_UNIFORM_SIZE = 80; // mat4x4<f32> viewProjection (64) + vec4<f32> position (16)

type DepthEntry = {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  sampleCount: number;
};

type SceneColorEntry = {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  sampleCount: number;
  format: GPUTextureFormat;
};

const depthByCtx = new WeakMap<Context, DepthEntry>();
const sceneColorByCtx = new WeakMap<Context, SceneColorEntry>();
const cameraBuffers = new WeakMap<Context, Map<Camera, GPUBuffer>>();
// cameraBufferHandles deleted — every camera buffer is CAMERA_UNIFORM_SIZE bytes;
// the constant is in scope at destroy time, no per-instance lookup needed.

const sceneBuffers = new WeakMap<Context, GPUBuffer>();
// Reused across frames; render() is synchronous so one module scratch is safe.
const sceneScratch = new ArrayBuffer(SCENE_BYTE_SIZE);
let warnedLightOverflow = false;
let warnedShadowOverflow = false;

const DEPTH_BYTES_PER_PIXEL = 4; // depth24plus → 4 bytes/texel for accounting

function depthEntryBytes(entry: DepthEntry): number {
  return entry.width * entry.height * DEPTH_BYTES_PER_PIXEL * entry.sampleCount;
}

function sceneColorEntryBytes(entry: SceneColorEntry): number {
  return (
    entry.width * entry.height * bytesPerTexel(entry.format) * entry.sampleCount
  );
}

export function _ensureDepthTexture(ctx: Context): DepthEntry {
  const existing = depthByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const sampleCount = ctx._internal.sampleCount;
  if (
    existing &&
    existing.width === width &&
    existing.height === height &&
    existing.sampleCount === sampleCount
  ) {
    return existing;
  }
  if (existing) {
    existing.texture.destroy();
    _recordDestroy(ctx, "texture", depthEntryBytes(existing));
  }
  const texture = ctx.device.createTexture({
    size: { width, height },
    format: _ENGINE_DEPTH_FORMAT,
    sampleCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  _recordAlloc(
    ctx,
    "texture",
    width * height * DEPTH_BYTES_PER_PIXEL * sampleCount,
  );
  const entry: DepthEntry = {
    texture,
    view: texture.createView(),
    width,
    height,
    sampleCount,
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

/**
 * When `sampleCount > 1`, lazily allocates (and resize-reallocates) the
 * multisampled color target that the scene renders into, resolving into the
 * single-sample destination after the pass. Returns `null` when
 * `sampleCount === 1` — the scene renders directly into the destination.
 * Module-private: used only by `render`; exercised via `frame.render`.
 */
function _ensureSceneColorTarget(ctx: Context): SceneColorEntry | null {
  const sampleCount = ctx._internal.sampleCount;
  if (sampleCount === 1) return null;

  const existing = sceneColorByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const format = ctx._internal.workingColorFormat;
  if (
    existing &&
    existing.width === width &&
    existing.height === height &&
    existing.sampleCount === sampleCount &&
    existing.format === format
  ) {
    return existing;
  }
  if (existing) {
    existing.texture.destroy();
    _recordDestroy(ctx, "texture", sceneColorEntryBytes(existing));
  }
  const texture = ctx.device.createTexture({
    size: { width, height },
    format,
    sampleCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  _recordAlloc(
    ctx,
    "texture",
    width * height * bytesPerTexel(format) * sampleCount,
  );
  const entry: SceneColorEntry = {
    texture,
    view: texture.createView(),
    width,
    height,
    sampleCount,
    format,
  };
  sceneColorByCtx.set(ctx, entry);
  if (existing === undefined) {
    _onDispose(ctx, () => _disposeSceneColor(ctx));
  }
  return entry;
}

function _disposeSceneColor(ctx: Context): void {
  const entry = sceneColorByCtx.get(ctx);
  if (!entry) return;
  entry.texture.destroy();
  _recordDestroy(ctx, "texture", sceneColorEntryBytes(entry));
  sceneColorByCtx.delete(ctx);
}

export function _ensureCameraBuffer(ctx: Context, cam: Camera): GPUBuffer {
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
  // Eye world-position at offset 64 (vec4 lane; .w unwritten, reads as zero — shader uses only .xyz).
  ctx.queue.writeBuffer(buffer, 64, cam.position);
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

function _ensureSceneBuffer(ctx: Context): GPUBuffer {
  let buffer = sceneBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.device.createBuffer({
      size: SCENE_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    sceneBuffers.set(ctx, buffer);
    _recordAlloc(ctx, "buffer", SCENE_BYTE_SIZE);
    _onDispose(ctx, () => _disposeSceneBuffer(ctx));
  }
  return buffer;
}

function _disposeSceneBuffer(ctx: Context): void {
  const buffer = sceneBuffers.get(ctx);
  if (!buffer) return;
  buffer.destroy();
  _recordDestroy(ctx, "buffer", SCENE_BYTE_SIZE);
  sceneBuffers.delete(ctx);
}

/** Pack + upload the per-frame Scene UBO. Clamps to MAX_LIGHTS and warns ONCE
 *  on overflow (runtime-quiet — never throws on the render path). */
function _writeSceneBuffer(
  ctx: Context,
  lights: readonly Light[] | undefined,
  ambient: Ambient | undefined,
  casters: readonly ShadowCaster[],
): GPUBuffer {
  const buffer = _ensureSceneBuffer(ctx);
  const { overflowed } = _packScene(sceneScratch, lights, ambient, casters);
  if (overflowed && !warnedLightOverflow) {
    warnedLightOverflow = true;
    warn(
      "frame",
      `render: more than ${MAX_LIGHTS} lights supplied; extra lights ignored (clamped). This warning fires once.`,
    );
  }
  ctx.queue.writeBuffer(buffer, 0, sceneScratch);
  return buffer;
}

/** Internal — shared fields of the render commands. Not a public export. */
export type RenderPassBase = {
  /** Meshes to render, in order. The engine submits them as one render pass
   *  with no automatic sorting — caller controls draw order. */
  meshes: Mesh[];
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
 * - `meshes`: meshes to render, in order. The engine submits them as one render
 *   pass with no automatic sorting — caller controls draw order.
 * - `camera`: camera whose view/projection matrices populate `@group(0)
 *   @binding(0)` for each mesh (see `engine-conventions.md` §"Binding
 *   contract").
 * - `effects`: optional post-process chain. When non-empty the scene is
 *   rendered to a pool-backed off-screen target and evaluated through the
 *   effects' passes (a flattened linear sequence) to the swap chain. Each
 *   mid-chain pass renders into a pool-backed transient; the final pass writes
 *   the swap chain.
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
  /** Per-frame lights. Omitted/empty → ambient-only. Clamped to `MAX_LIGHTS`
   *  (16) with a once-only `log.warn` (never throws — render hot path). */
  lights?: Light[];
  /** Per-frame hemisphere ambient. Omitted → a neutral low default
   *  (`intensity ≈ 0.05`). Recompute per frame for day/night or volume schemes
   *  (consumer policy). */
  ambient?: Ambient;
};

const DEFAULT_CLEAR_COLOR: Vec4 = vec4.fromValues(0, 0, 0, 1);
const DEFAULT_CLEAR_DEPTH = 1.0;

// The per-draw bind state is split across two groups:
// - `@group(0)` carries per-frame scene data — the camera UBO at binding 0;
//   for pipelines whose shader sets `usesScene`, the Scene UBO (lights/ambient)
//   at binding 1; and for pipelines whose shader sets `usesShadows`, the shadow
//   depth array at binding 2 + the comparison sampler at binding 3. Shared by
//   every mesh drawn with the same (pipeline, cameraBuffer). Keyed by pipeline
//   (a long-lived object), then by cameraBuffer — the same pipeline may be drawn
//   with multiple cameras (e.g. main pass + render-to-texture pass). usesScene /
//   usesShadows are invariant per pipeline (the shader fixes them) and the Scene
//   buffer + shadow map are per-ctx singletons, so none of them widen the cache key.
// - `@group(2)` carries per-draw object data (the model matrix). Keyed by
//   MeshSlot (the slot object reference) so a WeakMap suffices: when the slot is
//   recycled by the pool, the old reference becomes unreachable and its cache
//   drops naturally. The inner Map exists because a mesh's material may swap
//   pipelines over time — each (slot, pipeline) pair needs its own bind group.

// Per-frame group 0: one bind group per (pipeline, cameraBuffer). Conditionally
// also holds the scene buffer (binding 1) for usesScene pipelines and the shadow
// array + sampler (bindings 2/3) for usesShadows pipelines — all per-ctx
// singletons, so neither widens the cache key.
const perFrameGroup0Cache = new WeakMap<
  GPURenderPipeline,
  Map<GPUBuffer, GPUBindGroup>
>();
// Per-draw group 2 (object): one bind group per (MeshSlot, pipeline).
const objectGroup2Cache = new WeakMap<
  MeshSlot,
  Map<GPURenderPipeline, GPUBindGroup>
>();

function ensurePerFrameGroup0(
  ctx: Context,
  pipeline: GPURenderPipeline,
  cameraBuffer: GPUBuffer,
  sceneBuffer: GPUBuffer,
  usesScene: boolean,
  usesShadows: boolean,
): GPUBindGroup {
  let perPipeline = perFrameGroup0Cache.get(pipeline);
  if (!perPipeline) {
    perPipeline = new Map();
    perFrameGroup0Cache.set(pipeline, perPipeline);
  }
  const cached = perPipeline.get(cameraBuffer);
  if (cached) return cached;
  const entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: { buffer: cameraBuffer } },
  ];
  if (usesScene) {
    entries.push({ binding: 1, resource: { buffer: sceneBuffer } });
  }
  if (usesShadows) {
    const sm = _ensureShadowMap(ctx);
    entries.push({ binding: 2, resource: sm.arrayView });
    entries.push({ binding: 3, resource: sm.comparisonSampler });
  }
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries,
  });
  perPipeline.set(cameraBuffer, bindGroup);
  return bindGroup;
}

function ensureObjectGroup2(
  ctx: Context,
  slot: MeshSlot,
  pipeline: GPURenderPipeline,
): GPUBindGroup {
  let perSlot = objectGroup2Cache.get(slot);
  if (!perSlot) {
    perSlot = new Map();
    objectGroup2Cache.set(slot, perSlot);
  }
  const cached = perSlot.get(pipeline);
  if (cached) return cached;
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(2),
    entries: [{ binding: 0, resource: { buffer: slot.objectBuffer } }],
  });
  perSlot.set(pipeline, bindGroup);
  return bindGroup;
}

// Empty `@group(1)` fallback for material-less shaders (e.g. normalColor declares
// no `@group(1)`). With object now at `@group(2)`, such a pipeline spans bind-group
// slots 0 and 2 with an EMPTY intermediate slot 1 — and an unbound intermediate
// slot below a bound higher slot is a WebGPU validation error. Binding an empty
// bind group at slot 1 keeps the 0→1→2 sequence contiguous and valid. Cached per
// pipeline (the empty layout is pipeline-specific under `auto`).
const emptyGroup1Cache = new WeakMap<GPURenderPipeline, GPUBindGroup>();

function ensureEmptyGroup1(
  ctx: Context,
  pipeline: GPURenderPipeline,
): GPUBindGroup {
  const cached = emptyGroup1Cache.get(pipeline);
  if (cached) return cached;
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(1),
    entries: [],
  });
  emptyGroup1Cache.set(pipeline, bindGroup);
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
  _ensurePerFrameGroup0: ensurePerFrameGroup0,
  _writeSceneBuffer,
  _ensureObjectGroup2: ensureObjectGroup2,
  _ensureEmptyGroup1: ensureEmptyGroup1,
  _validateDraw: validateDraw,
  _firstDepthDisagreement: firstDepthDisagreement,
};

function beginRenderPass(
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  clearColor: Vec4,
  clearDepth: number,
  resolveTarget?: GPUTextureView,
): GPURenderPassEncoder {
  const [r = 0, g = 0, b = 0, a = 1] = clearColor;
  const msaa = resolveTarget !== undefined;
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorView,
        resolveTarget: msaa ? resolveTarget : undefined,
        clearValue: { r, g, b, a },
        loadOp: "clear",
        storeOp: msaa ? "discard" : "store",
      },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: clearDepth,
      depthLoadOp: "clear",
      depthStoreOp: msaa ? "discard" : "store",
    },
  });
}

function recordDraw(
  pass: GPURenderPassEncoder,
  ctx: Context,
  resolved: ResolvedDraw,
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
    ensurePerFrameGroup0(
      ctx,
      pipeline,
      cameraBuffer,
      sceneBuffer,
      material.usesScene,
      material.usesShadows,
    ),
  );
  _recordBindGroupSwitch(ctx);
  pass.setBindGroup(1, material.group1 ?? ensureEmptyGroup1(ctx, pipeline));
  _recordBindGroupSwitch(ctx);
  pass.setBindGroup(2, ensureObjectGroup2(ctx, mesh, pipeline));
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
      throw new FurnaceGpuError(`meshes[${i}]: null/undefined mesh`);
    }
    const meshSlot = _lookupMesh<MeshSlot>(ctx, m);
    if (meshSlot === null) {
      throw new FurnaceGpuError(
        `meshes[${i}]: mesh handle is invalid, destroyed, or belongs to a different context`,
      );
    }
    const materialSlot = _lookupMaterial<MaterialSlot>(ctx, meshSlot.material);
    if (materialSlot === null) {
      throw new FurnaceGpuError(
        `meshes[${i}]: mesh.material handle is invalid or destroyed`,
      );
    }
    const geometrySlot = _lookupGeometry<GeometrySlot>(ctx, meshSlot.geometry);
    if (geometrySlot === null) {
      throw new FurnaceGpuError(
        `meshes[${i}]: mesh.geometry handle is invalid or destroyed`,
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
  encoder: GPUCommandEncoder,
  colorView: GPUTextureView,
  depthView: GPUTextureView,
  draw: readonly ResolvedDraw[],
  cameraBuffer: GPUBuffer,
  sceneBuffer: GPUBuffer,
  clearColor: Vec4,
  clearDepth: number,
  resolveTarget?: GPUTextureView,
): void {
  const pass = beginRenderPass(
    encoder,
    colorView,
    depthView,
    clearColor,
    clearDepth,
    resolveTarget,
  );
  let lastPipeline: GPURenderPipeline | null = null;
  for (const resolved of draw) {
    lastPipeline = recordDraw(
      pass,
      ctx,
      resolved,
      cameraBuffer,
      sceneBuffer,
      lastPipeline,
    );
  }
  pass.end();
}

/**
 * Submit one frame: clear, draw `opts.meshes` against `opts.camera`, optionally
 * evaluate `opts.effects` (a pool-backed multi-pass post chain) to the swap chain.
 *
 * Allocation semantics — all lazy, engine-owned and reused across frames:
 * - One depth texture per context (`depth24plus`, multisampled to match
 *   `ctx._internal.sampleCount`), allocated on first call and reallocated when
 *   the canvas backing-store size changes. Always attached; the engine has no
 *   depth-less render path here (see `engine-conventions.md` §"Binding contract").
 * - One multisampled scene color target per context (`workingColorFormat`),
 *   allocated only when `ctx._internal.sampleCount > 1` (skipped entirely for
 *   the no-MSAA path) and reallocated on resize. The scene renders into it and
 *   resolves into the single-sample destination (swap chain, or a pool-backed
 *   scene target when effects are present).
 * - When effects are present, transient post-chain color targets are drawn from
 *   the per-context pool (`post/pool.ts`) — the scene target plus one per
 *   mid-chain pass — and released back to the pool's free list at chain end,
 *   reused across frames rather than reallocated.
 * - One camera uniform buffer (80 bytes: `viewProjection` mat4x4 + `position`
 *   vec4) per `(context, camera)` pair, allocated on first sighting of a given
 *   camera. The buffer is written each call from `camera.getMatrices` and
 *   `camera.position`. Per-frame `@group(0)` bind groups are cached keyed by
 *   `(pipeline, cameraBuffer)`; per-draw `@group(2)` object bind groups are
 *   cached on the mesh keyed by `(mesh, pipeline)`.
 * - One Scene uniform buffer (`SCENE_BYTE_SIZE`: hemisphere ambient + a fixed
 *   `array<Light, 16>`) per context, allocated on first call and rewritten each
 *   frame from `opts.lights`/`opts.ambient` (clamped to `MAX_LIGHTS`, warn-once
 *   on overflow). It is bound at `@group(0) @binding(1)` only for pipelines
 *   whose shader declares `usesScene` (the built-in `lit`/`texturedLit` shaders
 *   and any custom shader created with `shader.create(ctx, src, { usesScene:
 *   true })`); pipelines that don't never see it, so their group-0 bind group
 *   has only binding 0.
 *
 * Setup-loud per the foreground failure policy. The draw and effects
 * lists are validated up front; `validateDraw` resolves each mesh's
 * material and geometry slots in the same pass so the per-draw loop
 * body consumes the resolved triple with no further lookups.
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed; if
 *   `opts.camera` or `opts.meshes` is null/undefined; if any entry in
 *   `opts.meshes` is null, invalid, destroyed, or belongs to a different
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
  if (opts.meshes == null) {
    throw new FurnaceGpuError("render: meshes is required");
  }
  // Setup-loud, before any GPU work. HDR renders the scene into an rgba16float
  // intermediate, so it needs at least one effect to reach the LDR swap chain
  // (zero effects has no pass to get there — e.g. supply post.tonemap as the
  // final pass). Multi-pass HDR chains are supported: each pass builds its
  // pipeline for its resolved target format (mid-chain = rgba16float, final =
  // ctx.format) lazily via _resolvePassPipeline.
  if (ctx._internal.hdr) {
    const effectCount = opts.effects?.length ?? 0;
    if (effectCount === 0) {
      throw new FurnaceGpuError(
        "render: hdr is enabled but no effects were supplied — an rgba16float scene target needs at least one effect (e.g. post.tonemap) to reach the LDR swap chain",
      );
    }
  }
  // Flush all dirty bindings to the GPU before any draw work begins.
  // Generalises the per-mesh transform dirty-flush to the binding layer.
  _flushDirtyBindings(ctx);
  const resolvedDraws = validateDraw(ctx, opts.meshes);
  const depthMismatch = firstDepthDisagreement(resolvedDraws, true);
  if (depthMismatch !== -1) {
    throw new FurnaceGpuError(
      `render: meshes[${depthMismatch}] was created with depthEnabled:false but frame.render always renders with a depth attachment; ` +
        `depth-less materials can only be drawn via renderToTexture without a depthTexture`,
    );
  }
  const effects = opts.effects ?? [];
  const resolvedEffects = validateEffects(ctx, effects);

  const cameraBuffer = _ensureCameraBuffer(ctx, opts.camera);
  const { casters, overflowed: shadowOverflow } = _collectShadowCasters(
    opts.lights,
  );
  if (shadowOverflow && !warnedShadowOverflow) {
    warnedShadowOverflow = true;
    warn(
      "frame",
      `render: more than ${MAX_SHADOW_CASTERS} shadow casters supplied; extra ignored (clamped). This warning fires once.`,
    );
  }
  const sceneBuffer = _writeSceneBuffer(
    ctx,
    opts.lights,
    opts.ambient,
    casters,
  );
  const depth = _ensureDepthTexture(ctx);
  const msaa = _ensureSceneColorTarget(ctx);
  const clearColor = opts.clearColor ?? DEFAULT_CLEAR_COLOR;
  const clearDepth = opts.clearDepth ?? DEFAULT_CLEAR_DEPTH;

  const encoder = ctx.device.createCommandEncoder();
  // Depth-only caster passes run first, into the per-slot shadow array layers,
  // so the main scene pass can sample them. No-op when there are no casters.
  _recordShadowPasses(ctx, encoder, casters, resolvedDraws);

  if (effects.length === 0) {
    const singleSampleDest = gpu.getCurrentTextureView(ctx);
    const sceneColorView = msaa ? msaa.view : singleSampleDest;
    const resolveTarget = msaa ? singleSampleDest : undefined;
    recordScenePass(
      ctx,
      encoder,
      sceneColorView,
      depth.view,
      resolvedDraws,
      cameraBuffer,
      sceneBuffer,
      clearColor,
      clearDepth,
      resolveTarget,
    );
  } else {
    // Free any pool targets left at a stale canvas size (resize) before this
    // frame's chain acquires fresh ones — otherwise old-size targets accumulate.
    _poolBeginFrame(ctx, ctx.canvas.width, ctx.canvas.height);
    // Render the scene into a pool-backed transient (working format = rgba16float
    // under HDR, else ctx.format); the post chain reads it as its "scene" input.
    const sceneTarget = _acquirePoolTarget(
      ctx,
      ctx.canvas.width,
      ctx.canvas.height,
      ctx._internal.workingColorFormat,
    );
    const sceneColorView = msaa ? msaa.view : sceneTarget.view;
    const resolveTarget = msaa ? sceneTarget.view : undefined;
    recordScenePass(
      ctx,
      encoder,
      sceneColorView,
      depth.view,
      resolvedDraws,
      cameraBuffer,
      sceneBuffer,
      clearColor,
      clearDepth,
      resolveTarget,
    );
    _evaluateChain(
      ctx,
      encoder,
      resolvedEffects,
      sceneTarget,
      _ensurePostSampler(ctx),
    );
  }

  ctx.queue.submit([encoder.finish()]);
}
