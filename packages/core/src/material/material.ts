import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
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
  return ctx.device.createBindGroup({ layout, entries: bindings });
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

  const data = {
    ctx,
    pipeline,
    pipelineKey,
    group1,
    ownedBuffers: [] as GPUBuffer[],
    cullMode,
    topology,
    depthWrite,
    depthCompare,
  };
  return data as unknown as Material;
}
