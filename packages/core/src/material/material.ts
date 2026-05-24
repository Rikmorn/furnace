import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import { _registerResource, _unregisterResource } from "../stats/internal.ts";
import { _pipelineCache } from "./pipeline.ts";
import type { Material, MaterialDescriptor } from "./types.ts";

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

function buildPipelineDescriptor(
  ctx: Context,
  descriptor: MaterialDescriptor,
  cullMode: GPUCullMode,
  topology: GPUPrimitiveTopology,
  depthWrite: boolean,
  depthCompare: GPUCompareFunction,
): GPURenderPipelineDescriptor {
  const vsModule = ctx.device.createShaderModule({ code: descriptor.vertex });
  const fsModule = ctx.device.createShaderModule({ code: descriptor.fragment });
  return {
    layout: "auto",
    vertex: {
      module: vsModule,
      entryPoint: "vs_main",
      buffers: [VERTEX_BUFFER_LAYOUT],
    },
    fragment: {
      module: fsModule,
      entryPoint: "fs_main",
      targets: [{ format: ctx.format }],
    },
    primitive: { topology, cullMode },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: depthWrite,
      depthCompare,
    },
  };
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
    _pipelineCache.release(pipelineKey);
    throw new FurnaceError(
      "MaterialDescriptor.bindings provided but shader declares no @group(1) bindings",
    );
  }
  try {
    return ctx.device.createBindGroup({ layout, entries: bindings });
  } catch (e) {
    _pipelineCache.release(pipelineKey);
    throw e;
  }
}

export async function create(
  ctx: Context,
  descriptor: MaterialDescriptor,
): Promise<Material> {
  if (!descriptor.vertex || !descriptor.fragment) {
    throw new FurnaceError("vertex and fragment WGSL are required");
  }

  const cullMode = descriptor.cullMode ?? "back";
  const topology = descriptor.topology ?? "triangle-list";
  const depthWrite = descriptor.depthWrite ?? true;
  const depthCompare = descriptor.depthCompare ?? "less";

  const pipelineKey = hashKey([
    descriptor.vertex,
    descriptor.fragment,
    cullMode,
    topology,
    String(depthWrite),
    depthCompare,
    ctx.format,
  ]);

  const build = async (): Promise<GPURenderPipeline> => {
    ctx.device.pushErrorScope("validation");
    const pipelineDescriptor = buildPipelineDescriptor(
      ctx,
      descriptor,
      cullMode,
      topology,
      depthWrite,
      depthCompare,
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

  const pipeline = await _pipelineCache.acquire(pipelineKey, build);

  const bindings = descriptor.bindings;
  const group1 =
    bindings !== undefined && bindings.length > 0
      ? buildGroup1(ctx, pipeline, pipelineKey, bindings)
      : null;

  const _materialHandle = _registerResource(ctx, { kind: "material" });

  const data: Material = {
    ctx,
    pipeline,
    pipelineKey,
    group1,
    ownedBuffers: [],
    ownedBufferHandles: [],
    _materialHandle,
    cullMode,
    topology,
    depthWrite,
    depthCompare,
  };
  return data;
}

export function destroy(material: Material): void {
  // Length of ownedBuffers and ownedBufferHandles is the same by construction.
  for (let i = 0; i < material.ownedBuffers.length; i++) {
    const handle = material.ownedBufferHandles[i];
    if (handle) _unregisterResource(material.ctx, handle);
    const buf = material.ownedBuffers[i];
    if (buf) buf.destroy();
  }
  material.ownedBuffers.length = 0;
  material.ownedBufferHandles.length = 0;
  _unregisterResource(material.ctx, material._materialHandle);
  _pipelineCache.release(material.pipelineKey);
}
