import type { Context } from "../gpu/context-types.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import { bytesPerTexel } from "./format-bytes.ts";

/**
 * A transient color render target handed out by the pool. Keyed by
 * `(width, height, format)`; reused across acquire/release cycles so a
 * multi-pass post chain doesn't reallocate every frame.
 */
type PoolTarget = {
  tex: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  format: GPUTextureFormat;
};

type PoolState = {
  free: PoolTarget[];
  live: Set<PoolTarget>;
};

const poolByCtx = new WeakMap<Context, PoolState>();

function poolKey(
  width: number,
  height: number,
  format: GPUTextureFormat,
): string {
  return `${width}x${height}x${format}`;
}

function targetBytes(t: PoolTarget): number {
  return t.width * t.height * bytesPerTexel(t.format);
}

function ensurePool(ctx: Context): PoolState {
  const existing = poolByCtx.get(ctx);
  if (existing !== undefined) return existing;
  const state: PoolState = { free: [], live: new Set() };
  poolByCtx.set(ctx, state);
  _onDispose(ctx, () => _disposePool(ctx));
  return state;
}

function allocateTarget(
  ctx: Context,
  width: number,
  height: number,
  format: GPUTextureFormat,
): PoolTarget {
  const tex = ctx.device.createTexture({
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  _recordAlloc(ctx, "texture", width * height * bytesPerTexel(format));
  return { tex, view: tex.createView(), width, height, format };
}

/**
 * Acquire a transient render target matching `(width, height, format)`. Reuses
 * a released target with the same key when one is free; otherwise allocates a
 * new texture and records its bytes against GPU stats. Engine-internal — the
 * post-chain evaluator and built-in effects are the only callers.
 */
export function _acquirePoolTarget(
  ctx: Context,
  width: number,
  height: number,
  format: GPUTextureFormat,
): PoolTarget {
  const state = ensurePool(ctx);
  const key = poolKey(width, height, format);
  const reused = state.free.find(
    (t) => poolKey(t.width, t.height, t.format) === key,
  );
  if (reused !== undefined) {
    state.free.splice(state.free.indexOf(reused), 1);
    state.live.add(reused);
    return reused;
  }
  const fresh = allocateTarget(ctx, width, height, format);
  state.live.add(fresh);
  return fresh;
}

/**
 * Return a target to the free list for reuse. Does NOT destroy the texture —
 * the next `_acquirePoolTarget` with a matching key reclaims it. No-op if the
 * target isn't currently live for this context.
 */
export function _releasePoolTarget(ctx: Context, t: PoolTarget): void {
  const state = poolByCtx.get(ctx);
  if (state === undefined) return;
  if (!state.live.delete(t)) return;
  state.free.push(t);
}

function _disposePool(ctx: Context): void {
  const state = poolByCtx.get(ctx);
  if (state === undefined) return;
  for (const t of state.free) {
    t.tex.destroy();
    _recordDestroy(ctx, "texture", targetBytes(t));
  }
  for (const t of state.live) {
    t.tex.destroy();
    _recordDestroy(ctx, "texture", targetBytes(t));
  }
  poolByCtx.delete(ctx);
}

/**
 * Test accessor: current free/live target counts for `ctx`. Returns zeros when
 * the pool has never been touched for this context.
 */
export function _poolStats(ctx: Context): { free: number; live: number } {
  const state = poolByCtx.get(ctx);
  if (state === undefined) return { free: 0, live: 0 };
  return { free: state.free.length, live: state.live.size };
}

export type { PoolTarget };
