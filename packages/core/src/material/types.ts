import type { Context } from "../gpu/index.ts";
import type { ResourceHandle } from "../stats/internal.ts";

export type MaterialDescriptor = {
  vertex: string;
  fragment: string;
  bindings?: GPUBindGroupEntry[];
  cullMode?: GPUCullMode;
  topology?: GPUPrimitiveTopology;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  blend?: GPUBlendState;
};

export type Material = {
  ctx: Context;
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  group1: GPUBindGroup | null;
  ownedBuffers: GPUBuffer[];
  ownedBufferHandles: ResourceHandle[];
  _materialHandle: ResourceHandle;
  cullMode: GPUCullMode;
  topology: GPUPrimitiveTopology;
  depthWrite: boolean;
  depthCompare: GPUCompareFunction;
};
