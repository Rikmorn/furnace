import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocTexture,
  _destroyTexture,
  _lookupTexture,
} from "../resources/internal.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import type {
  Texture,
  TextureColorSpace,
  TextureDescriptor,
  TextureSlot,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** rgba8 (unorm or srgb) packs 4 bytes per texel: R, G, B, A. */
const RGBA8_BYTES_PER_TEXEL = 4;

function formatFor(colorSpace: TextureColorSpace): GPUTextureFormat {
  return colorSpace === "srgb" ? "rgba8unorm-srgb" : "rgba8unorm";
}

/** Drain the open validation error scope. On error: destroy gpuTex and throw. */
async function finalizeTexture(
  ctx: Context,
  gpuTex: GPUTexture,
  byteLength: number,
): Promise<Texture> {
  const err = await ctx.device.popErrorScope();
  if (err) {
    gpuTex.destroy();
    throw new FurnaceError(`texture.create failed: ${err.message}`);
  }
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

async function createFromData(
  ctx: Context,
  data: Uint8Array,
  width: number,
  height: number,
  colorSpace: TextureColorSpace,
): Promise<Texture> {
  const expected = width * height * RGBA8_BYTES_PER_TEXEL;
  if (data.byteLength !== expected) {
    throw new FurnaceError(
      `texture.create: data length ${data.byteLength} != expected ${expected} (${width}x${height} rgba8)`,
    );
  }
  ctx.device.pushErrorScope("validation");
  const gpuTex = ctx.device.createTexture({
    size: { width, height },
    format: formatFor(colorSpace),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  ctx.device.queue.writeTexture(
    { texture: gpuTex },
    data,
    { bytesPerRow: width * RGBA8_BYTES_PER_TEXEL, rowsPerImage: height },
    { width, height },
  );
  return await finalizeTexture(ctx, gpuTex, data.byteLength);
}

async function createFromSource(
  ctx: Context,
  source: ImageBitmap,
  colorSpace: TextureColorSpace,
): Promise<Texture> {
  const { width, height } = source;
  ctx.device.pushErrorScope("validation");
  const gpuTex = ctx.device.createTexture({
    size: { width, height },
    format: formatFor(colorSpace),
    // copyExternalImageToTexture requires RENDER_ATTACHMENT in addition to
    // TEXTURE_BINDING | COPY_DST (unlike writeTexture which only needs COPY_DST).
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  ctx.device.queue.copyExternalImageToTexture(
    { source },
    { texture: gpuTex },
    { width, height },
  );
  const byteLength = width * height * RGBA8_BYTES_PER_TEXEL;
  return await finalizeTexture(ctx, gpuTex, byteLength);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a GPU texture from the given descriptor and return an opaque
 * {@link Texture} handle.
 *
 * Two source variants are supported:
 * - `{data}` — raw RGBA byte array with explicit `width`/`height`.
 * - `{source}` — pre-decoded `ImageBitmap` (dimensions taken from the bitmap).
 *
 * Setup-loud: throws {@link FurnaceError} on bad input or GPU validation error
 * (surfaced from `pushErrorScope("validation")`).
 *
 * @throws FurnaceError - if `data.byteLength` does not equal `width * height * 4` (rgba8 expects 4 bytes per texel).
 * @throws FurnaceError - if WebGPU texture creation reports a validation error.
 */
export function create(
  ctx: Context,
  descriptor: TextureDescriptor,
): Promise<Texture> {
  if ("data" in descriptor) {
    const { data, width, height, colorSpace = "srgb" } = descriptor;
    return createFromData(ctx, data, width, height, colorSpace);
  }
  const { source, colorSpace = "srgb" } = descriptor;
  return createFromSource(ctx, source, colorSpace);
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

/**
 * Fetch an image from `url`, decode it into an `ImageBitmap`, and upload it as
 * a GPU texture. Mirrors the behaviour of {@link create} with a `{source}`
 * descriptor. Setup-loud.
 *
 * Does not cache by URL — the browser HTTP-caches the bytes; reuse the returned
 * handle to deduplicate GPU resources.
 *
 * @throws FurnaceError - on a non-OK HTTP response (checked before decoding).
 * @throws FurnaceError - if WebGPU texture creation reports a validation error.
 */
export async function load(
  ctx: Context,
  url: string,
  opts?: { colorSpace?: TextureColorSpace; mipmaps?: boolean },
): Promise<Texture> {
  const resp = await fetch(url);
  if (!resp.ok)
    throw new FurnaceError(`texture.load: HTTP ${resp.status} for ${url}`);
  const bitmap = await createImageBitmap(await resp.blob());
  return create(ctx, { source: bitmap, ...opts });
}

/** Test-only: read the backing GPUTexture format. Not part of the public surface. */
export function _formatOf(ctx: Context, tex: Texture): GPUTextureFormat | null {
  return _lookupTexture<TextureSlot>(ctx, tex)?.gpu.format ?? null;
}
