import type { Context } from "../gpu/context-types.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";

/**
 * Low-level escape hatch: create a `GPUCommandEncoder`, hand it to `callback`,
 * then finish and submit. Bypasses all scene-pass / camera / mesh bookkeeping
 * — for consumers authoring their own passes (compute, custom multi-pass,
 * read-back). Most callers should use `render` / `renderToTexture` instead.
 *
 * Setup-loud per the foreground failure policy
 * (`engine-conventions.md` §"Failure policy").
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed.
 */
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
