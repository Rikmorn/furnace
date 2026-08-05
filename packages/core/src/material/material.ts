import { _bufferOf } from "../binding/internal.ts";
import type { LayoutSchema } from "../binding/types.ts";
import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocMaterial,
  _destroyMaterial,
  _lookupMaterial,
  _lookupShader,
  _lookupTexture,
} from "../resources/internal.ts";
import {
  _instancedOf,
  _layoutOf,
  _textureBindingOf,
  _usesSceneOf,
  _usesShadowsOf,
} from "../shader/internal.ts";
import type { ShaderSlot } from "../shader/types.ts";
import { _recordDestroy } from "../stats/internal.ts";
import { _getSampler } from "../texture/sampler-cache.ts";
import type { TextureSlot } from "../texture/types.ts";
import { _pipelineCache } from "./pipeline.ts";
import type { Material, MaterialDescriptor, MaterialSlot } from "./types.ts";

const VERTEX_STRIDE_BYTES = 32;
const POSITION_OFFSET = 0;
const NORMAL_OFFSET = 12;
const UV_OFFSET = 24;

const VERTEX_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE_BYTES,
  attributes: [
    { shaderLocation: 0, offset: POSITION_OFFSET, format: "float32x3" },
    { shaderLocation: 1, offset: NORMAL_OFFSET, format: "float32x3" },
    { shaderLocation: 2, offset: UV_OFFSET, format: "float32x2" },
  ],
};

// Per-instance vertex buffers for instanced shaders (slots 1 and 2). The matrix
// buffer at slot 1 supplies the four rows of a mat4 model transform as four
// float32x4 attributes (locations 3–6); the tint buffer at slot 2 supplies a
// float32x4 per-instance tint (location 7). Both step per-instance. Pulled into
// the pipeline only when the shader is instanced (`_instancedOf`).
const INSTANCE_MATRIX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 64,
  stepMode: "instance",
  attributes: [
    { shaderLocation: 3, offset: 0, format: "float32x4" },
    { shaderLocation: 4, offset: 16, format: "float32x4" },
    { shaderLocation: 5, offset: 32, format: "float32x4" },
    { shaderLocation: 6, offset: 48, format: "float32x4" },
  ],
};
const INSTANCE_TINT_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 16,
  stepMode: "instance",
  attributes: [{ shaderLocation: 7, offset: 0, format: "float32x4" }],
};

/** The depth-stencil format every depth-declaring material pipeline uses, and
 *  that the engine's depth attachment (frame.render) and any consumer-supplied
 *  depthTexture (frame.renderToTexture) must match. Single source of truth for
 *  the pipeline↔attachment depth-format invariant. Internal. */
export const _ENGINE_DEPTH_FORMAT: GPUTextureFormat = "depth24plus";

// FNV-1a (32-bit) hash for the pipeline cache key. OFFSET_BASIS and PRIME are
// fixed by the FNV-1a spec — don't change them. The separator (ASCII Unit
// Separator, 0x1f) is mixed in between parts so that ["ab","cd"] and ["abcd",""]
// hash differently. 0x1f never appears in WGSL or our format strings.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const FIELD_SEPARATOR_BYTE = 0x1f;

function hashKey(parts: readonly string[]): string {
  let hash = FNV_OFFSET_BASIS;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = (hash * FNV_PRIME) >>> 0;
    }
    hash ^= FIELD_SEPARATOR_BYTE;
    hash = (hash * FNV_PRIME) >>> 0;
  }
  return hash.toString(16);
}

export function _blendSignature(blend: GPUBlendState | undefined): string {
  if (!blend) return "none";
  const color = blend.color;
  const alpha = blend.alpha;
  return [
    color.srcFactor ?? "one",
    color.dstFactor ?? "zero",
    color.operation ?? "add",
    alpha.srcFactor ?? "one",
    alpha.dstFactor ?? "zero",
    alpha.operation ?? "add",
  ].join("|");
}

function resolveDepth(depth: MaterialDescriptor["depth"]): {
  enabled: boolean;
  write: boolean;
  compare: GPUCompareFunction;
} {
  if (depth === false) return { enabled: false, write: true, compare: "less" };
  return {
    enabled: true,
    write: depth?.write ?? true,
    compare: depth?.compare ?? "less",
  };
}

function buildPipelineDescriptor(
  ctx: Context,
  module: GPUShaderModule,
  vertexEntry: string,
  fragmentEntry: string,
  cullMode: GPUCullMode,
  topology: GPUPrimitiveTopology,
  depthEnabled: boolean,
  depthWrite: boolean,
  depthCompare: GPUCompareFunction,
  blend: GPUBlendState | undefined,
  instanced: boolean,
): GPURenderPipelineDescriptor {
  const pipelineDescriptor: GPURenderPipelineDescriptor = {
    layout: "auto",
    vertex: {
      module,
      entryPoint: vertexEntry,
      buffers: instanced
        ? [VERTEX_BUFFER_LAYOUT, INSTANCE_MATRIX_LAYOUT, INSTANCE_TINT_LAYOUT]
        : [VERTEX_BUFFER_LAYOUT],
    },
    fragment: {
      module,
      entryPoint: fragmentEntry,
      targets: [{ format: ctx._internal.workingColorFormat, blend }],
    },
    primitive: { topology, cullMode },
    multisample: { count: ctx._internal.sampleCount },
  };
  if (depthEnabled) {
    pipelineDescriptor.depthStencil = {
      format: _ENGINE_DEPTH_FORMAT,
      depthWriteEnabled: depthWrite,
      depthCompare,
    };
  }
  return pipelineDescriptor;
}

// Both getBindGroupLayout and createBindGroup can throw synchronously
// (e.g. an OperationError in Chrome when entries don't match the layout).
// Either failure must release the pipeline-cache slot we acquired above,
// or the entry leaks: acquire ran but no release ever will, and the caller
// has no key to release with. Bun's WebGPU surfaces these as async device
// errors rather than throws, which is why this path is not covered by a
// black-box GPU test in this suite.
function buildGroup1(
  ctx: Context,
  pipeline: GPURenderPipeline,
  pipelineKey: string,
  bindings: GPUBindGroupEntry[],
): GPUBindGroup {
  let layout: GPUBindGroupLayout;
  try {
    layout = pipeline.getBindGroupLayout(1);
  } catch {
    _pipelineCache.release(ctx, pipelineKey);
    throw new FurnaceError(
      "MaterialDescriptor @group(1) data (binding/bindings) supplied but shader declares no @group(1) bindings",
    );
  }
  try {
    return ctx.device.createBindGroup({ layout, entries: bindings });
  } catch (e) {
    _pipelineCache.release(ctx, pipelineKey);
    throw e;
  }
}

function materialTeardown(ctx: Context, slot: MaterialSlot): void {
  // Length of ownedBuffers and ownedBufferBytes is the same by construction.
  for (let i = 0; i < slot.ownedBuffers.length; i++) {
    const buf = slot.ownedBuffers[i];
    if (buf) buf.destroy();
    const bytes = slot.ownedBufferBytes[i];
    if (bytes !== undefined) _recordDestroy(ctx, "buffer", bytes);
  }
  slot.ownedBuffers.length = 0;
  slot.ownedBufferBytes.length = 0;
  _pipelineCache.release(ctx, slot.pipelineKey);
}

/**
 * Build (or reuse, via the internal per-ctx pipeline cache) a render
 * pipeline from a {@link MaterialDescriptor} and return an opaque
 * {@link Material} handle.
 *
 * The pipeline is keyed on `(shader handle, entry points, cullMode,
 * topology, depthEnabled, depthWrite, depthCompare, sampleCount, working
 * color format, blend signature, instanced)`. The `instanced` flag (whether
 * the shader declares per-instance vertex attributes — see `_instancedOf`)
 * is part of the key so an instanced and a non-instanced pipeline built from
 * the same shader never alias in the cache. The working color format (the fragment
 * target — `ctx.format` for LDR, `rgba16float` for HDR) subsumes the swap-chain
 * format, so it is keyed instead of `ctx.format`. When `depth` is `false`,
 * `depthWrite` and `depthCompare` are normalized out of the key so they don't
 * produce spurious cache misses.
 * Two `create` calls on the same ctx with identical keys share one underlying
 * `GPURenderPipeline`; the cache holds a refcount that `destroy` releases.
 * The cache is per-ctx — a pipeline built against ctx A cannot be reused
 * in ctx B (different `GPUDevice`).
 *
 * Allocation: the `@group(1)` bind group is built from exactly one of three
 * sources — `descriptor.texture` (sampler@0 + texture-view@1 for a
 * `textureBinding` shader), `descriptor.binding` (typed uniform path), or
 * `descriptor.bindings` (raw entries). All three are consumer-owned; `destroy`
 * does not free any of them. The slot's `ownedBuffers` array exists for
 * factory-allocated uniform buffers freed by the slot's teardown, but no
 * current factory uses it.
 *
 * Setup-loud per the foreground failure policy
 * (`engine-conventions.md` §"Failure policy").
 *
 * @throws FurnaceError - if `descriptor.shader` is missing.
 * @throws FurnaceError - if the shader handle is invalid or destroyed.
 * @throws FurnaceError - if WebGPU pipeline creation reports a validation
 *   error (surfaced from `pushErrorScope("validation")`).
 * @throws FurnaceError - if `descriptor.shader` declares a `@group(1)` layout
 *   but neither `descriptor.binding` nor a non-empty `descriptor.bindings` is
 *   supplied (completeness check — setup-loud).
 * @throws FurnaceError - if `binding` or `bindings` are supplied but the shader
 *   declares no `@group(1)` bindings (layout mismatch).
 * @throws FurnaceError - if `descriptor.binding` is invalid or destroyed.
 * @throws FurnaceError - if `descriptor.texture` and `descriptor.binding` or
 *   `descriptor.bindings` are both supplied (mutually exclusive `@group(1)` sources).
 * @throws FurnaceError - if the shader declares a `textureBinding` but no
 *   `descriptor.texture` is supplied (texture-completeness check — setup-loud).
 * @throws FurnaceError - if `descriptor.texture.texture` is invalid or destroyed.
 */
export async function create<L extends LayoutSchema = LayoutSchema>(
  ctx: Context,
  descriptor: MaterialDescriptor<L>,
): Promise<Material<L>> {
  if (descriptor.shader == null) {
    throw new FurnaceError("material.create: shader is required");
  }
  const shaderSlot = _lookupShader<ShaderSlot>(ctx, descriptor.shader);
  if (shaderSlot === null) {
    throw new FurnaceError(
      "material.create: shader handle is invalid or destroyed",
    );
  }

  // Completeness check: if the shader declares @group(1) data, the caller must
  // supply either a typed binding or raw bindings — a no-data material against
  // a data-expecting shader is almost certainly a mistake (setup-loud).
  const shaderLayout = _layoutOf(ctx, descriptor.shader);
  const hasBinding = descriptor.binding != null;
  const hasRawBindings =
    descriptor.bindings != null && descriptor.bindings.length > 0;
  if (shaderLayout !== null && !hasBinding && !hasRawBindings) {
    throw new FurnaceError(
      "material.create: shader declares @group(1) data but no binding/bindings supplied",
    );
  }

  const needsTexture = _textureBindingOf(ctx, descriptor.shader);
  const hasTexture = descriptor.texture != null;
  const usesScene = _usesSceneOf(ctx, descriptor.shader);
  const usesShadows = _usesShadowsOf(ctx, descriptor.shader);
  const instanced = _instancedOf(ctx, descriptor.shader);

  // `texture` and `binding`/`bindings` are competing @group(1) sources — exactly one.
  if (hasTexture && (hasBinding || hasRawBindings)) {
    throw new FurnaceError(
      "material.create: `texture` is mutually exclusive with `binding`/`bindings` — supply only one @group(1) source",
    );
  }
  // A textureBinding shader requires a texture.
  if (needsTexture && !hasTexture) {
    throw new FurnaceError(
      "material.create: shader declares a @group(1) texture binding but no `texture` was supplied",
    );
  }

  const vertexEntry = descriptor.entryPoints?.vertex ?? "vs_main";
  const fragmentEntry = descriptor.entryPoints?.fragment ?? "fs_main";
  const cullMode = descriptor.primitive?.cullMode ?? "back";
  const topology = descriptor.primitive?.topology ?? "triangle-list";
  const {
    enabled: depthEnabled,
    write: depthWrite,
    compare: depthCompare,
  } = resolveDepth(descriptor.depth);

  const pipelineKey = hashKey([
    String(descriptor.shader),
    vertexEntry,
    fragmentEntry,
    cullMode,
    topology,
    String(depthEnabled),
    depthEnabled ? String(depthWrite) : "-",
    depthEnabled ? depthCompare : "-",
    String(ctx._internal.sampleCount),
    ctx._internal.workingColorFormat,
    _blendSignature(descriptor.blend),
    String(instanced),
  ]);

  const build = async (): Promise<GPURenderPipeline> => {
    ctx.device.pushErrorScope("validation");
    const pipelineDescriptor = buildPipelineDescriptor(
      ctx,
      shaderSlot.module,
      vertexEntry,
      fragmentEntry,
      cullMode,
      topology,
      depthEnabled,
      depthWrite,
      depthCompare,
      descriptor.blend,
      instanced,
    );
    const pipeline = ctx.device.createRenderPipeline(pipelineDescriptor);
    const err = await ctx.device.popErrorScope();
    if (err) {
      throw new FurnaceError(
        `material pipeline creation failed: ${err.message}`,
      );
    }
    return pipeline;
  };

  const pipeline = await _pipelineCache.acquire(ctx, pipelineKey, build);

  // Resolve @group(1) bind group: texture path, then typed binding, then raw
  // bindings. The mutual-exclusion guard above ensures only one branch fires.
  // The texture is consumer-owned — do NOT free it in teardown.
  let group1: GPUBindGroup | null = null;
  if (descriptor.texture != null) {
    const texSlot = _lookupTexture<TextureSlot>(
      ctx,
      descriptor.texture.texture,
    );
    if (texSlot === null) {
      _pipelineCache.release(ctx, pipelineKey);
      throw new FurnaceError(
        "material.create: texture handle is invalid or destroyed",
      );
    }
    const sampler = _getSampler(ctx, descriptor.texture.sampler);
    group1 = buildGroup1(ctx, pipeline, pipelineKey, [
      { binding: 0, resource: sampler },
      { binding: 1, resource: texSlot.view },
    ]);
  } else if (descriptor.binding != null) {
    const buf = _bufferOf(ctx, descriptor.binding);
    if (buf === null) {
      // Stale/destroyed binding — fail setup-loud rather than silently leaving
      // group1 null (which would surface as a GPU error at draw time). Release
      // the pipeline-cache slot acquired above, mirroring buildGroup1's discipline.
      _pipelineCache.release(ctx, pipelineKey);
      throw new FurnaceError(
        "material.create: binding handle is invalid or destroyed",
      );
    }
    group1 = buildGroup1(ctx, pipeline, pipelineKey, [
      { binding: 0, resource: { buffer: buf } },
    ]);
  } else if (descriptor.bindings != null && descriptor.bindings.length > 0) {
    group1 = buildGroup1(ctx, pipeline, pipelineKey, descriptor.bindings);
  }

  const slot: MaterialSlot = {
    pipeline,
    pipelineKey,
    group1,
    ownedBuffers: [],
    ownedBufferBytes: [],
    cullMode,
    topology,
    depthWrite,
    depthCompare,
    depthEnabled,
    // `!= null` mirrors `_blendSignature`'s falsy check, so a material that
    // keys as "no blend" in the pipeline cache is never classified as blended.
    blended: descriptor.blend != null,
    usesScene,
    usesShadows,
    userCount: 0,
    markedDestroyed: false,
    _teardown: () => materialTeardown(ctx, slot),
  };
  // Boundary cast: phantom L is compile-time only; _allocMaterial returns
  // MaterialHandle which is structurally identical to Material<L> at runtime.
  return _allocMaterial(ctx, slot) as Material<L>;
}

/**
 * Destroy a {@link Material}. If a Mesh still references it
 * (`userCount > 0`), the slot is marked-destroyed and actual GPU teardown
 * waits until the last referencing mesh is destroyed (symmetric to
 * Mesh→Geometry). When teardown runs it destroys any factory-owned
 * uniform buffers (e.g. `unlit`'s color buffer), records the matching
 * stats destroy for each, and releases one ref on the cached pipeline.
 * The pipeline itself is freed when its refcount drops to zero.
 *
 * Does not destroy the consumer-owned resources passed via
 * `MaterialDescriptor.bindings`, `MaterialDescriptor.binding`, or
 * `MaterialDescriptor.texture` — the consumer destroys those independently
 * (e.g. `texture.destroy` for a texture handle).
 *
 * Silent on stale or already-destroyed handles (idempotent).
 */
export function destroy(ctx: Context, material: Material): void {
  const slot = _lookupMaterial<MaterialSlot>(ctx, material);
  if (slot === null) return;
  if (slot.userCount > 0) {
    slot.markedDestroyed = true;
    return;
  }
  _destroyMaterial<MaterialSlot>(ctx, material, (s) => {
    s._teardown();
  });
}
