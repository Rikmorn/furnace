export { requestWebGpu } from "./lib/gpu/requestWebGpu.ts";
export type { WebGpuContext } from "./lib/gpu/requestWebGpu.ts";

export { runFrameLoop } from "./lib/gpu/runFrameLoop.ts";
export type { FrameCallback, FrameLoopHandle } from "./lib/gpu/runFrameLoop.ts";

export { computeFps, createFpsSystem } from "./lib/stats/fps.ts";
export type { FpsSystem, FpsSystemOptions } from "./lib/stats/fps.ts";
