import type { Context } from "../gpu/context-types.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";

type AllocatedTarget = Readonly<{
  tex: GPUTexture;
  view: GPUTextureView;
}>;

type IntermediateEntry = {
  a: GPUTexture;
  aView: GPUTextureView;
  b: GPUTexture;
  bView: GPUTextureView;
  sampler: GPUSampler;
  width: number;
  height: number;
  format: GPUTextureFormat;
};

const intermediateByCtx = new WeakMap<Context, IntermediateEntry>();

/** Bytes per texel for common render target formats. Mirrors the helper in `frame/render.ts`. */
function bytesPerTexel(format: GPUTextureFormat): number {
  switch (format) {
    case "rgba16float":
      return 8;
    default:
      return 4; // bgra8unorm, rgba8unorm, bgra8unorm-srgb, rgba8unorm-srgb
  }
}

function allocateColorTarget(
  ctx: Context,
  width: number,
  height: number,
  format: GPUTextureFormat,
): AllocatedTarget {
  const tex = ctx.device.createTexture({
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = tex.createView();
  _recordAlloc(ctx, "texture", width * height * bytesPerTexel(format));
  return { tex, view };
}

function createSharedSampler(ctx: Context): GPUSampler {
  return ctx.device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
}

function destroyEntry(ctx: Context, entry: IntermediateEntry): void {
  // Both `a` and `b` are allocated at the same width×height and format, so a
  // single derivation covers both records.
  const bytes = entry.width * entry.height * bytesPerTexel(entry.format);
  entry.a.destroy();
  entry.b.destroy();
  _recordDestroy(ctx, "texture", bytes);
  _recordDestroy(ctx, "texture", bytes);
}

export function _ensureSceneIntermediates(ctx: Context): IntermediateEntry {
  const existing = intermediateByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  // No format check needed: workingColorFormat is frozen at requestContext and
  // cannot change mid-context, so only the backing-store size can invalidate.
  const sizeUnchanged =
    existing !== undefined &&
    existing.width === width &&
    existing.height === height;
  if (existing !== undefined && sizeUnchanged) {
    return existing;
  }
  if (existing !== undefined) {
    destroyEntry(ctx, existing);
  }
  const format = ctx._internal.workingColorFormat;
  const a = allocateColorTarget(ctx, width, height, format);
  const b = allocateColorTarget(ctx, width, height, format);
  const sampler =
    existing !== undefined ? existing.sampler : createSharedSampler(ctx);
  const entry: IntermediateEntry = {
    a: a.tex,
    aView: a.view,
    b: b.tex,
    bView: b.view,
    sampler,
    width,
    height,
    format,
  };
  intermediateByCtx.set(ctx, entry);
  if (existing === undefined) {
    _onDispose(ctx, () => _disposeIntermediates(ctx));
  }
  return entry;
}

function _disposeIntermediates(ctx: Context): void {
  const entry = intermediateByCtx.get(ctx);
  if (!entry) return;
  destroyEntry(ctx, entry);
  intermediateByCtx.delete(ctx);
}

export type { IntermediateEntry };
