import type { Context } from "../gpu/context-types.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";

export function encode(
  ctx: Context,
  callback: (encoder: GPUCommandEncoder) => void,
): void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  const encoder = ctx.device.createCommandEncoder();
  callback(encoder);
  const cmd = encoder.finish();
  ctx.queue.submit([cmd]);
}
