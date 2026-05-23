import type { Context } from "../gpu/index.ts";

export type MaterialDescriptor = {
  vertex: string;
  fragment: string;
  bindings?: GPUBindGroupEntry[];
  cullMode?: GPUCullMode;
  topology?: GPUPrimitiveTopology;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
};

export type Material = {
  ctx: Context;
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  group1: GPUBindGroup | null;
  ownedBuffers: GPUBuffer[];
  cullMode: GPUCullMode;
  topology: GPUPrimitiveTopology;
  depthWrite: boolean;
  depthCompare: GPUCompareFunction;
};
