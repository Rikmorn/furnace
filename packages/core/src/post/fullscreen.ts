import type { Context } from "../gpu/context-types.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";

const FULLSCREEN_VS_WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var out: VsOut;
  out.clip_pos = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, 1.0 - y);
  return out;
}
`;

const cache = new WeakMap<Context, GPUShaderModule>();

export function _ensureFullscreenVS(ctx: Context): GPUShaderModule {
  const cached = cache.get(ctx);
  if (cached) return cached;
  const module = ctx.device.createShaderModule({ code: FULLSCREEN_VS_WGSL });
  cache.set(ctx, module);
  _onDispose(ctx, () => cache.delete(ctx));
  return module;
}
