import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocMaterial,
  _destroyMaterial,
  _lookupMaterial,
  _lookupShader,
} from "../resources/internal.ts";
import type { ShaderSlot } from "../shader/types.ts";
import { _recordDestroy } from "../stats/internal.ts";
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

/** Translate a built-in factory's flat render-state options to the grouped
 *  MaterialDescriptor fields. Used by `unlit`/`normalColor` (their public flat
 *  options are unchanged in D-1; reconciled in E). */
export function _flatRenderState(o: {
  topology?: GPUPrimitiveTopology;
  cullMode?: GPUCullMode;
  depthEnabled?: boolean;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
}): Pick<MaterialDescriptor, "primitive" | "depth"> {
  const primitive =
    o.topology !== undefined || o.cullMode !== undefined
      ? { topology: o.topology, cullMode: o.cullMode }
      : undefined;
  let depth: MaterialDescriptor["depth"];
  if (o.depthEnabled === false) depth = false;
  else if (o.depthWrite !== undefined || o.depthCompare !== undefined)
    depth = { write: o.depthWrite, compare: o.depthCompare };
  return { primitive, depth };
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
): GPURenderPipelineDescriptor {
  const pipelineDescriptor: GPURenderPipelineDescriptor = {
    layout: "auto",
    vertex: {
      module,
      entryPoint: vertexEntry,
      buffers: [VERTEX_BUFFER_LAYOUT],
    },
    fragment: {
      module,
      entryPoint: fragmentEntry,
      targets: [{ format: ctx.format, blend }],
    },
    primitive: { topology, cullMode },
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
      "MaterialDescriptor.bindings provided but shader declares no @group(1) bindings",
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
 * topology, depthEnabled, depthWrite, depthCompare, ctx format, blend
 * signature)`. When `depth` is `false`, `depthWrite` and `depthCompare`
 * are normalized out of the key so they don't produce spurious cache misses.
 * Two `create` calls on the same ctx with identical keys share one underlying
 * `GPURenderPipeline`; the cache holds a refcount that `destroy` releases.
 * The cache is per-ctx — a pipeline built against ctx A cannot be reused
 * in ctx B (different `GPUDevice`).
 *
 * Allocation: when consumer-supplied `descriptor.bindings` are non-empty, a
 * `@group(1)` `GPUBindGroup` is created over the auto-derived layout. The
 * bind-group resources themselves (buffers, textures) are consumer-owned —
 * `destroy` does not touch them. Built-in factories may allocate uniform
 * buffers and push them onto the slot's `ownedBuffers` so the slot's
 * teardown cleans them up (e.g. `unlit` registers a 16-byte color buffer;
 * `normalColor` has no owned buffers since it uses only engine-provided
 * `@group(0)` uniforms).
 *
 * Setup-loud per the foreground failure policy
 * (`engine-conventions.md` §"Failure policy").
 *
 * @throws FurnaceError - if `descriptor.shader` is missing.
 * @throws FurnaceError - if the shader handle is invalid or destroyed.
 * @throws FurnaceError - if WebGPU pipeline creation reports a validation
 *   error (surfaced from `pushErrorScope("validation")`).
 * @throws FurnaceError - if `bindings` are supplied but the shader declares
 *   no `@group(1)` bindings (layout mismatch).
 */
export async function create(
  ctx: Context,
  descriptor: MaterialDescriptor,
): Promise<Material> {
  if (descriptor.shader == null) {
    throw new FurnaceError("material.create: shader is required");
  }
  const shaderSlot = _lookupShader<ShaderSlot>(ctx, descriptor.shader);
  if (shaderSlot === null) {
    throw new FurnaceError(
      "material.create: shader handle is invalid or destroyed",
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
    ctx.format,
    _blendSignature(descriptor.blend),
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

  const bindings = descriptor.bindings;
  const group1 =
    bindings !== undefined && bindings.length > 0
      ? buildGroup1(ctx, pipeline, pipelineKey, bindings)
      : null;

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
    userCount: 0,
    markedDestroyed: false,
    _teardown: () => materialTeardown(ctx, slot),
  };
  return _allocMaterial(ctx, slot);
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
 * `MaterialDescriptor.bindings` (buffers/textures the consumer created and
 * handed in) — the consumer destroys those.
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
