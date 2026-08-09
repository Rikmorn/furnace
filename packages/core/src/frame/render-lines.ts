import type { Camera } from "../camera/index.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import * as gpu from "../gpu/index.ts";
import { warn } from "../log/internal.ts";
import { _ENGINE_DEPTH_FORMAT } from "../material/material.ts";
import { toWgsl } from "../shader/index.ts";
import { _cameraBinding } from "../shader/internal.ts";
import {
  _recordAlloc,
  _recordDestroy,
  _recordDraw,
} from "../stats/internal.ts";
import {
  _ensureCameraBuffer,
  _ensureDepthTexture,
  _ensureSceneColorTarget,
  _lastRenderUsedPostChain,
} from "./render.ts";

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
  pipelineOcclude: GPURenderPipeline; // depthCompare: "less-equal" (default)
  pipelineOverlay: GPURenderPipeline; // depthCompare: "always" (always-on-top)
  posBuffer: GPUBuffer;
  posCapacityBytes: number;
  colorBuffer: GPUBuffer;
  colorCapacityBytes: number;
};

const lineResByCtx = new WeakMap<Context, LineResources>();
// Bind group keyed by (pipeline, cameraBuffer). Both pipelines use layout:"auto"
// so their bind group layouts are distinct — a bind group built for one is not
// valid for the other.
const bindGroupByPipeline = new WeakMap<
  GPURenderPipeline,
  WeakMap<GPUBuffer, GPUBindGroup>
>();
let warnedMsaaPostChain = false;

function makeLinePipeline(
  ctx: Context,
  module: GPUShaderModule,
  depthCompare: GPUCompareFunction,
): GPURenderPipeline {
  return ctx.device.createRenderPipeline({
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
      // `ctx.format` (not `workingColorFormat`): on the no-MSAA path the pass
      // targets the swap chain directly, and on the MSAA path it targets the
      // scene colour target — whose format IS `ctx.format` whenever `hdr` is
      // false. HDR + MSAA + drawLines is unsupported (see `drawLines`).
      targets: [{ format: ctx.format }],
    },
    primitive: { topology: "line-list" },
    depthStencil: {
      format: _ENGINE_DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare,
    },
    // Must match the pass's attachments. A Context's sample count is fixed at
    // `requestContext` and never mutated, so baking it into the per-context
    // pipeline cache (`lineResByCtx`) can never hand a 1× pipeline to a 4× pass.
    multisample: { count: ctx._internal.sampleCount },
  });
}

function createLineResources(ctx: Context): LineResources {
  const module = ctx.device.createShaderModule({ code: LINE_WGSL });
  // Test against the scene depth, but never write — the wireframe shows on
  // the near surface of each collider and is occluded behind solid meshes.
  const pipelineOcclude = makeLinePipeline(ctx, module, "less-equal");
  // Always-on-top variant — skips depth test entirely, used for gizmos.
  const pipelineOverlay = makeLinePipeline(ctx, module, "always");
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
    pipelineOcclude,
    pipelineOverlay,
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
  let byBuffer = bindGroupByPipeline.get(pipeline);
  if (!byBuffer) {
    byBuffer = new WeakMap<GPUBuffer, GPUBindGroup>();
    bindGroupByPipeline.set(pipeline, byBuffer);
  }
  const cached = byBuffer.get(cameraBuffer);
  if (cached) return cached;
  const bg = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });
  byBuffer.set(cameraBuffer, bg);
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
 * - `occlude`: when `false`, draw always-on-top (`depthCompare: "always"`) —
 *   intended for gizmos that must remain visible regardless of depth. Default
 *   `true` preserves the original depth-tested (`"less-equal"`) behaviour, so
 *   existing callers (e.g. physics debug-draw) are unaffected.
 */
export type DrawLinesOptions = {
  vertices: Float32Array;
  colors: Float32Array;
  camera: Camera;
  /**
   * When `false`, lines are drawn always-on-top (`depthCompare: "always"`),
   * ignoring scene depth — use for gizmos that must remain visible in front of
   * all geometry. Default `true`: depth-tested (`"less-equal"`), so lines are
   * occluded behind meshes closer to the camera.
   */
  occlude?: boolean;
};

/**
 * Options accepted by {@link drawLinesToTexture} — {@link DrawLinesOptions}
 * plus the consumer-owned attachments the pass composites over.
 *
 * - `texture`: colour target, loaded (never cleared) so the lines composite
 *   over whatever is already there — normally a `frame.renderToTexture` result.
 *   Must have format `ctx.format`, which is what the line pipelines are built
 *   to write. On an LDR context that is also `ctx._internal.workingColorFormat`,
 *   so the very texture `renderToTexture` drew into is valid. A mismatch throws
 *   `FurnaceGpuError`.
 * - `depthTexture`: **required**, unlike `renderToTexture`'s optional one. Both
 *   line pipelines declare a `depth24plus` depth-stencil state, so WebGPU
 *   requires a matching attachment in every pass that binds them — even in
 *   `occlude: false` mode, where the state is `depthCompare: "always"`. Pass
 *   the same depth texture the `renderToTexture` call used: it is loaded, so
 *   `occlude: true` tests against that pass's real scene depth.
 *
 * Both attachments are `loadOp: "load"` / `storeOp: "store"`, so repeated calls
 * compose (occluded wireframes first, always-on-top gizmos second).
 */
export type DrawLinesToTextureOptions = DrawLinesOptions & {
  /** Consumer-owned colour target, composited over (`loadOp: "load"`). Must be
   *  format `ctx.format`. */
  texture: GPUTexture;
  /** Consumer-owned depth target, loaded and stored. Required — both line
   *  pipelines declare a depth-stencil state. Must be format `depth24plus`. */
  depthTexture: GPUTexture;
};

/** Shared precondition guard for both line commands. Setup/warm-path-loud on
 *  the inputs the caller controls; the per-target preconditions are checked by
 *  each command, which knows what its attachments are. */
function validateLineInputs(
  ctx: Context,
  opts: DrawLinesOptions,
  fn: "drawLines" | "drawLinesToTexture",
): void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  if (opts.camera == null) {
    throw new FurnaceGpuError(`${fn}: camera is required`);
  }
  if (opts.vertices == null || opts.colors == null) {
    throw new FurnaceGpuError(`${fn}: vertices and colors are required`);
  }
}

/** The attachments one line pass renders over. A named bag rather than three
 *  positional views: `colorView` and `resolveTarget` are the same type, and the
 *  on-screen caller picks both from one ternary — positionally that pairing is
 *  unreadable at the call site (a swap would not compile-error, only fail GPU
 *  validation at run time). */
type LinePassTargets = {
  colorView: GPUTextureView;
  /** Non-`undefined` only on the MSAA on-screen path, where `colorView` is the
   *  multisampled scene target and this is the swap-chain view it resolves to. */
  resolveTarget: GPUTextureView | undefined;
  depthView: GPUTextureView;
};

/**
 * The whole body both line commands share: grow-and-upload the engine-owned
 * vertex/colour buffers, pick the depth-mode pipeline, then record and submit
 * one `line-list` pass over the supplied attachments.
 *
 * The two commands differ ONLY in where those attachments come from — the swap
 * chain / MSAA scene target + engine depth for {@link drawLines}, consumer-owned
 * textures for {@link drawLinesToTexture} — which is exactly why the split is
 * two functions over one options bag: the target decision is made by the caller
 * *choosing a command*, not by the presence of an optional field.
 */
function submitLinePass(
  ctx: Context,
  opts: DrawLinesOptions,
  targets: LinePassTargets,
): void {
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

  const pipeline =
    opts.occlude === false ? res.pipelineOverlay : res.pipelineOcclude;
  const cameraBuffer = _ensureCameraBuffer(ctx, opts.camera);
  const encoder = ctx.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: targets.colorView,
        resolveTarget: targets.resolveTarget,
        loadOp: "load",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: targets.depthView,
      depthLoadOp: "load",
      depthStoreOp: "store",
    },
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, lineBindGroup(ctx, pipeline, cameraBuffer));
  pass.setVertexBuffer(0, res.posBuffer);
  pass.setVertexBuffer(1, res.colorBuffer);
  pass.draw(opts.vertices.length / FLOATS_PER_POINT);
  pass.end();
  ctx.queue.submit([encoder.finish()]);
  _recordDraw(ctx, { triangles: 0 }); // line-list contributes no triangles
}

/**
 * Draw a `line-list` overlay on top of the current frame — an immediate,
 * raw-buffer primitive (distinct from the managed, Mesh-based {@link render}).
 *
 * Runs a second render pass over the frame's colour target (`loadOp: "load"`,
 * so it does not clear) and against the engine's scene depth texture.
 * **Call after `frame.render` in the same frame** so the depth/colour it reads
 * are present. To overlay lines on an off-screen target instead, use
 * {@link drawLinesToTexture} — the attachments are the only difference, but the
 * failure posture is not (see that function's note).
 *
 * On a `sampleCount: 1` context the colour target is the swap-chain texture
 * directly. On an MSAA context (`sampleCount: 4`) it is the multisampled scene
 * colour target `frame.render` drew into — the engine-managed depth texture is
 * multisampled too, and WebGPU requires every attachment in a pass to share a
 * sample count — and the pass resolves over the swap chain. Repeated calls in
 * one frame compose (each loads the accumulated colour and re-resolves).
 *
 * **MSAA + a post chain draws nothing.** When `ctx` is multisampled AND the
 * frame's most recent {@link render} routed the scene through `effects` (which
 * `hdr` always implies), the swap chain holds the chain's output and this
 * pass's resolve would overwrite it with the raw, pre-post scene colour. Rather
 * than corrupt the frame, the call is skipped and a once-only `warn` is routed
 * to the engine log helper (see `@furnace/core/log`); the frame renders
 * correctly, just without the overlay. It does NOT throw — this is a per-frame
 * render-path call, so it follows the runtime-quiet half of
 * `engine-conventions.md` §"Failure policy". Use a `sampleCount: 1` context to
 * combine line overlays with post effects. The same skip applies before the
 * first {@link render} on a multisampled context, where there is no scene
 * colour to load.
 *
 * Depth behaviour is controlled by `opts.occlude` (default `true`):
 * - `true` (default) — `depthCompare: "less-equal"`, no depth write: lines are
 *   occluded behind meshes closer to the camera (physics wireframes, AABB
 *   highlights).
 * - `false` — `depthCompare: "always"`, no depth write: lines draw always on
 *   top, ignoring scene depth (translate/rotate gizmos).
 *
 * Two pipelines are cached per context (one per depth mode); the bind group is
 * cached per `(pipeline, cameraBuffer)` pair. Grow-on-demand vertex buffers are
 * also engine-owned. Warm-path-validate: throws on a disposed context or a null
 * `camera`/`vertices`/`colors`; an empty `vertices` is a no-op.
 *
 * @throws FurnaceGpuError - if `ctx` is disposed, or `camera`/`vertices`/
 *   `colors` is null/undefined.
 */
export function drawLines(ctx: Context, opts: DrawLinesOptions): void {
  validateLineInputs(ctx, opts, "drawLines");
  if (opts.vertices.length === 0) return;

  // MSAA + a post chain is unsupported. The swap chain holds the chain's
  // output; this pass must attach the multisampled scene colour to match the
  // depth texture's sample count, and its resolve would overwrite that output
  // with the raw, pre-post scene colour. Skipping leaves the frame intact and
  // the lines absent.
  //
  // Runtime-quiet rather than throwing, per `engine-conventions.md` §Failure
  // policy: this is a per-frame render-path call, and hello-world's bowling
  // demo genuinely runs 4x + hdr + effects + drawLines on its MSAA toggle — a
  // throw would turn a missing overlay into a per-frame crash. The warn-once
  // makes the absence discoverable without flooding the log.
  if (ctx._internal.sampleCount > 1 && _lastRenderUsedPostChain(ctx)) {
    if (!warnedMsaaPostChain) {
      warnedMsaaPostChain = true;
      warn(
        "frame",
        "drawLines: skipped — line overlays are unsupported on a multisampled context whose frame was rendered through a post-process chain (the overlay's resolve would overwrite the chain's output). Use a sampleCount:1 context to combine line overlays with effects. This warning fires once.",
      );
    }
    return;
  }

  const depth = _ensureDepthTexture(ctx);
  const singleSampleDest = gpu.getCurrentTextureView(ctx);
  // The shared depth texture is allocated at the context's sample count, and
  // every attachment in a pass must agree on it. On an MSAA context the swap
  // chain view (always 1×) therefore cannot be the colour attachment: the pass
  // renders into the same multisampled scene colour target `frame.render` used
  // (which stores, not discards, so "load" picks up the rendered frame) and
  // resolves the result over the swap chain. Repeated calls in one frame
  // compose: each loads the accumulated multisampled colour, adds its lines,
  // stores, and re-resolves the superset over the swap chain.
  const msaa = _ensureSceneColorTarget(ctx);
  submitLinePass(ctx, opts, {
    colorView: msaa ? msaa.view : singleSampleDest,
    resolveTarget: msaa ? singleSampleDest : undefined,
    depthView: depth.view,
  });
}

/**
 * Off-screen variant of {@link drawLines}: composite a `line-list` over a
 * consumer-supplied `GPUTexture` + depth texture instead of the frame's swap
 * chain. The off-screen counterpart of `frame.renderToTexture`, and its
 * intended partner — `renderToTexture` writes the meshes, this adds the
 * overlays, and the caller reads back one texture holding both.
 *
 * **Why a second command and not a `{texture, depthTexture}` field on
 * {@link DrawLinesOptions}?** The two differ in every way that matters beyond
 * the attachments: this one has no swap chain to protect, so it is
 * *setup-loud* (throws on each precondition below, like `renderToTexture`), while
 * {@link drawLines} is deliberately *runtime-quiet* about the one combination
 * it cannot serve. Folding them would put two failure postures behind one name
 * and make `drawLines`'s MSAA + post-chain skip — which is about the swap chain
 * holding post-chain output — meaningless-but-still-reachable in the off-screen
 * half. `api-posture.md` R4 already names `render<Target>` as the verb family
 * for "same command, different target" (`render` → `renderToTexture`); this is
 * that pattern composed with R4's `draw<Primitive>` for immediate primitives.
 * The buffer upload, pipeline choice and pass recording are shared internally
 * (`submitLinePass`), so the duplication is the TSDoc contract, not the code.
 *
 * **LDR contexts only.** The line pipelines' fragment target is `ctx.format`,
 * while `renderToTexture` writes `ctx._internal.workingColorFormat`. Those are
 * the same value on an LDR context and differ on an HDR one (`rgba16float`),
 * where no single texture can be both. Rather than let that surface as a GPU
 * validation error inside the pass, an HDR context is refused at the door.
 *
 * Depth is **required** here (it is optional on `renderToTexture`): both line
 * pipelines declare a `depth24plus` depth-stencil state, so WebGPU demands a
 * matching attachment even in `occlude: false` mode. Attachments are loaded and
 * stored, so repeated calls compose over one another.
 *
 * `opts.occlude` behaves exactly as it does on-screen: `true` (default) tests
 * against the depth the mesh pass stored; `false` draws always-on-top.
 *
 * Setup-loud per `engine-conventions.md` §"Failure policy" — each `@throws`
 * below fires at call time with the reason, matching its `renderToTexture`
 * sibling. An empty `vertices` is a no-op (after validation).
 *
 * **What is NOT engine-checked**, so you get WebGPU's own error instead: the
 * two attachments must agree on size, and `texture` must carry
 * `RENDER_ATTACHMENT` usage. Both produce a WebGPU validation message that
 * names the problem directly, which is why they are left where the spec puts
 * them; `renderToTexture` draws the same line. (The attachment *sample count*
 * is checked here, because a 4× attachment against a 1× pipeline does not.)
 *
 * @throws FurnaceGpuError - if `ctx` is disposed, or `camera`/`vertices`/
 *   `colors` is null/undefined.
 * @throws FurnaceGpuError - if `opts.texture` or `opts.depthTexture` is
 *   missing. Unlike `renderToTexture`, the depth target is not optional.
 * @throws FurnaceGpuError - if `ctx._internal.sampleCount` is not `1`. The line
 *   pipelines are built at the context's sample count, so a multisampled
 *   context cannot draw them into a single-sample off-screen pass.
 * @throws FurnaceGpuError - if `ctx` is an HDR context (its working colour
 *   format differs from `ctx.format`, which the line pipelines target).
 * @throws FurnaceGpuError - if `opts.texture.format` is not `ctx.format`.
 * @throws FurnaceGpuError - if `opts.depthTexture.format` is not `depth24plus`.
 * @throws FurnaceGpuError - if either attachment's `sampleCount` is not `1`.
 *   The ctx guard proves the pipelines are single-sample; the consumer's
 *   textures are independent and must agree.
 */
export function drawLinesToTexture(
  ctx: Context,
  opts: DrawLinesToTextureOptions,
): void {
  validateLineInputs(ctx, opts, "drawLinesToTexture");
  if (!opts.texture) {
    throw new FurnaceGpuError("drawLinesToTexture: texture is required");
  }
  if (!opts.depthTexture) {
    throw new FurnaceGpuError(
      "drawLinesToTexture: depthTexture is required (both line pipelines declare a depth-stencil state, so every pass binding them needs a depth attachment — even with occlude:false)",
    );
  }
  if (ctx._internal.sampleCount !== 1) {
    throw new FurnaceGpuError(
      `drawLinesToTexture: MSAA contexts are not supported (ctx sampleCount is ${ctx._internal.sampleCount}); the line pipelines are built multisampled but this renders a single-sample off-screen pass. Use a sampleCount:1 context for off-screen line overlays`,
    );
  }
  // HDR refusal, not an HDR feature. The line pipelines write `ctx.format`;
  // renderToTexture writes `workingColorFormat`. On HDR those differ, so no one
  // texture can hold both the meshes and their overlays — the pairing this
  // command exists for is impossible. Refuse with the reason rather than let a
  // pipeline/attachment format mismatch surface from inside the pass.
  if (ctx._internal.workingColorFormat !== ctx.format) {
    throw new FurnaceGpuError(
      `drawLinesToTexture: HDR contexts are not supported (working colour format '${ctx._internal.workingColorFormat}' differs from ctx.format '${ctx.format}', which the line pipelines are built to write); a renderToTexture target and a line target cannot be the same texture on an HDR context. Use an hdr:false context for off-screen line overlays`,
    );
  }
  if (opts.texture.format !== ctx.format) {
    throw new FurnaceGpuError(
      `drawLinesToTexture: texture format '${opts.texture.format}' must equal ctx.format '${ctx.format}', which the line pipelines are built to write`,
    );
  }
  if (opts.depthTexture.format !== _ENGINE_DEPTH_FORMAT) {
    throw new FurnaceGpuError(
      `drawLinesToTexture: depthTexture format '${opts.depthTexture.format}' must be '${_ENGINE_DEPTH_FORMAT}'`,
    );
  }
  // The ctx guard above only proves the PIPELINES are 1×; the consumer's own
  // textures are independent and a 4× one attaches just as readily. Same class
  // of mismatch the HDR guard catches, so it gets the same treatment rather
  // than being left to surface as a GPU validation error inside the pass.
  const attachmentSamples = Math.max(
    opts.texture.sampleCount,
    opts.depthTexture.sampleCount,
  );
  if (attachmentSamples !== 1) {
    throw new FurnaceGpuError(
      `drawLinesToTexture: attachments must be single-sample (texture sampleCount ${opts.texture.sampleCount}, depthTexture sampleCount ${opts.depthTexture.sampleCount}); the line pipelines are built at the context's sample count, which this call has already established is 1`,
    );
  }
  if (opts.vertices.length === 0) return;

  submitLinePass(ctx, opts, {
    colorView: opts.texture.createView(),
    resolveTarget: undefined, // never resolves — this pass IS the final target
    depthView: opts.depthTexture.createView(),
  });
}
