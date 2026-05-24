import type { Context } from "../gpu/index.ts";
import { _registerResource } from "../stats/internal.ts";
import { create } from "./material.ts";
import type { Material } from "./types.ts";

const COLOR_BUFFER_SIZE_BYTES = 16;

// gwsl file lazy loaded?
const UNLIT_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Mat { color: vec4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var<uniform> mat: Mat;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}

@fragment fn fs_main() -> @location(0) vec4<f32> {
  return mat.color;
}
`;

export async function unlit(
  ctx: Context,
  opts: { color: [number, number, number, number] },
): Promise<Material> {
  const colorBuffer = ctx.device.createBuffer({
    size: COLOR_BUFFER_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(colorBuffer, 0, new Float32Array(opts.color));
  const colorBufferHandle = _registerResource(ctx, {
    kind: "buffer",
    bytes: COLOR_BUFFER_SIZE_BYTES,
  });
  const mat = await create(ctx, {
    vertex: UNLIT_WGSL,
    fragment: UNLIT_WGSL,
    bindings: [{ binding: 0, resource: { buffer: colorBuffer } }],
  });
  mat.ownedBuffers.push(colorBuffer);
  mat.ownedBufferHandles.push(colorBufferHandle);
  return mat;
}
