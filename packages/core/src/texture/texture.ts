import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocTexture,
  _destroyTexture,
  _lookupTexture,
} from "../resources/internal.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import type { Texture, TextureDescriptor, TextureSlot } from "./types.ts";

/**
 * Create a GPU texture from the given descriptor and return an opaque
 * {@link Texture} handle.
 *
 * Only the `{data}` source branch is implemented in T1. The `{source}`
 * (ImageBitmap) branch is added in T3.
 *
 * Setup-loud: throws {@link FurnaceError} on bad context or GPU validation
 * error (surfaced from `pushErrorScope("validation")`).
 *
 * @throws FurnaceError - if the `{source}` branch is passed (not yet implemented).
 * @throws FurnaceError - if WebGPU texture creation reports a validation error.
 */
export async function create(
  ctx: Context,
  descriptor: TextureDescriptor,
): Promise<Texture> {
  if (!("data" in descriptor)) {
    throw new FurnaceError(
      "texture.create: only the {data} source is implemented (T1)",
    );
  }
  const { data, width, height } = descriptor;
  // T2 makes format colorSpace-driven; for T1 default to rgba8unorm-srgb.
  // bun-webgpu note: standalone createTexture({format:"rgba8unorm-srgb"}) +
  // createView() (no format arg) works under Dawn. If bun-webgpu rejects the
  // srgb format, callers can pass colorSpace:"linear" to use rgba8unorm instead.
  const format: GPUTextureFormat = "rgba8unorm-srgb";
  ctx.device.pushErrorScope("validation");
  const gpuTex = ctx.device.createTexture({
    size: { width, height },
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  ctx.device.queue.writeTexture(
    { texture: gpuTex },
    data,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height },
  );
  const err = await ctx.device.popErrorScope();
  if (err) {
    gpuTex.destroy();
    throw new FurnaceError(`texture.create failed: ${err.message}`);
  }
  const byteLength = data.byteLength;
  const slot: TextureSlot = {
    gpu: gpuTex,
    view: gpuTex.createView(),
    byteLength,
    _teardown: () => {
      gpuTex.destroy();
      // BYTES kind — frees memory.textureBytes.
      _recordDestroy(ctx, "texture", byteLength);
    },
  };
  // Record bytes BEFORE allocating the slot so that stats are consistent if
  // _allocTexture ever throws (currently infallible, but defensive ordering).
  _recordAlloc(ctx, "texture", byteLength); // BYTES kind → memory.textureBytes
  // _allocTexture records the COUNT kind (texture-resource → resources.textures).
  // Boundary cast: Texture is TextureHandle & phantom; _allocTexture returns TextureHandle.
  return _allocTexture(ctx, slot) as Texture;
}

/**
 * Destroy a {@link Texture}. Releases the underlying `GPUTexture` and
 * decrements both the texture handle count (`resources.textures`) and the
 * GPU memory bytes (`memory.textureBytes`).
 *
 * Silent on stale or already-destroyed handles (idempotent).
 */
export function destroy(ctx: Context, tex: Texture): void {
  const slot = _lookupTexture<TextureSlot>(ctx, tex);
  if (slot === null) return; // idempotent on stale/destroyed
  _destroyTexture<TextureSlot>(ctx, tex, (s) => s._teardown());
}
