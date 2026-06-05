import type { Context } from "../gpu/index.ts";
import { _getSampler } from "./sampler-cache.ts";

const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var out: VsOut;
  out.pos = vec4<f32>(p[vi], 0.0, 1.0);
  out.uv = vec2<f32>((p[vi].x + 1.0) * 0.5, (1.0 - p[vi].y) * 0.5);
  return out;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(src, samp, in.uv);
}
`;

/** Mip levels for a texture of the given base dimensions: floor(log2(max(w,h))) + 1. */
export function _mipLevelCount(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/**
 * Generate the full mip chain by rendering each level from the previous (linear
 * downsample). The texture MUST be created with `RENDER_ATTACHMENT` usage and the
 * matching `mipLevelCount`. Call inside the caller's active validation error scope.
 *
 * Pipeline is built per call (create-time, not hot-path; cache is a deferred optimization).
 * Internal.
 */
export function _generateMipmaps(
  ctx: Context,
  gpuTex: GPUTexture,
  format: GPUTextureFormat,
  width: number,
  height: number,
): void {
  const levels = _mipLevelCount(width, height);
  if (levels <= 1) return;

  const module = ctx.device.createShaderModule({ code: BLIT_WGSL });
  const pipeline = ctx.device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs_main" },
    fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = _getSampler(ctx);
  const encoder = ctx.device.createCommandEncoder();

  for (let level = 1; level < levels; level++) {
    const srcView = gpuTex.createView({
      baseMipLevel: level - 1,
      mipLevelCount: 1,
    });
    const dstView = gpuTex.createView({
      baseMipLevel: level,
      mipLevelCount: 1,
    });
    const bindGroup = ctx.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcView },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: dstView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  ctx.device.queue.submit([encoder.finish()]);
}
