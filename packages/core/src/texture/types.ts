import type { TextureHandle } from "../resources/handle.ts";

/** Color-space for a texture; drives the GPU format selection. */
export type TextureColorSpace = "srgb" | "linear";

/**
 * Input descriptor for {@link create}. Two variants:
 * - `{data}` — raw RGBA byte array with explicit `width`/`height`.
 * - `{source}` — pre-decoded `ImageBitmap` (T3+).
 */
export type TextureDescriptor =
  | {
      data: Uint8Array;
      width: number;
      height: number;
      colorSpace?: TextureColorSpace;
      mipmaps?: boolean;
    }
  | {
      source: ImageBitmap;
      colorSpace?: TextureColorSpace;
      mipmaps?: boolean;
    };

/**
 * Opaque texture handle. Returned by {@link create}; consumers pass it to
 * material descriptors and otherwise treat it as opaque. Dispose via
 * `texture.destroy`.
 *
 * The `__texture` phantom field is optional (matching the `Shader.__layout`
 * pattern) so the handle is constructable from a plain number at runtime.
 */
export type Texture = TextureHandle & { readonly __texture?: unique symbol };

/**
 * Engine-private slot data backing a {@link Texture} handle in the textures
 * pool. Not exported from the public surface; resource-manager internals only.
 */
export type TextureSlot = {
  gpu: GPUTexture;
  view: GPUTextureView;
  byteLength: number;
  _teardown: () => void;
};
