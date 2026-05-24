import type { Context } from "../gpu/context-types.ts";
import {
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
} from "../stats/internal.ts";

const BYTES_PER_PIXEL = 4;

type AllocatedTarget = Readonly<{
  tex: GPUTexture;
  view: GPUTextureView;
  handle: ResourceHandle;
}>;

type IntermediateEntry = {
  a: GPUTexture;
  aView: GPUTextureView;
  aHandle: ResourceHandle;
  b: GPUTexture;
  bView: GPUTextureView;
  bHandle: ResourceHandle;
  sampler: GPUSampler;
  width: number;
  height: number;
};

const intermediateByCtx = new WeakMap<Context, IntermediateEntry>();

function allocateColorTarget(
  ctx: Context,
  width: number,
  height: number,
): AllocatedTarget {
  const tex = ctx.device.createTexture({
    size: { width, height },
    format: ctx.format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = tex.createView();
  const handle = _registerResource(ctx, {
    kind: "texture",
    bytes: width * height * BYTES_PER_PIXEL,
  });
  return { tex, view, handle };
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
  entry.a.destroy();
  entry.b.destroy();
  _unregisterResource(ctx, entry.aHandle);
  _unregisterResource(ctx, entry.bHandle);
}

export function _ensureSceneIntermediates(ctx: Context): IntermediateEntry {
  const existing = intermediateByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
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
  const a = allocateColorTarget(ctx, width, height);
  const b = allocateColorTarget(ctx, width, height);
  const sampler =
    existing !== undefined ? existing.sampler : createSharedSampler(ctx);
  const entry: IntermediateEntry = {
    a: a.tex,
    aView: a.view,
    aHandle: a.handle,
    b: b.tex,
    bView: b.view,
    bHandle: b.handle,
    sampler,
    width,
    height,
  };
  intermediateByCtx.set(ctx, entry);
  return entry;
}

export type { IntermediateEntry };
