import type { InternalState } from "./internal.ts";

export type Context = Readonly<{
  device: GPUDevice;
  queue: GPUQueue;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  pixelRatio: number;
  _internal: InternalState;
}>;
