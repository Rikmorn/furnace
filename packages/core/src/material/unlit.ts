import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import { _registerResource } from "../stats/internal.ts";
import type { Vec4 } from "../transform/types.ts";
import { create } from "./material.ts";
import type { Material } from "./types.ts";

const COLOR_BUFFER_SIZE_BYTES = 16;

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

/**
 * Options accepted by {@link unlit}.
 *
 * `color` is required — linear-space RGBA `Vec4` written into the material's
 * uniform buffer (see `engine-conventions.md` §"Color space"; sRGB encoding
 * happens on swap-chain write via the view format).
 *
 * Pipeline-state fields are optional with defaults matching
 * {@link MaterialDescriptor} (`topology: "triangle-list"`, `cullMode: "back"`,
 * `depthWrite: true`, `depthCompare: "less"`, no blend).
 */
export type UnlitOptions = {
  color: Vec4;
  topology?: GPUPrimitiveTopology;
  cullMode?: GPUCullMode;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  blend?: GPUBlendState;
};

/**
 * Stock unlit material — outputs `opts.color` directly from the fragment
 * shader. Allocates a 16-byte uniform buffer (one `vec4<f32>`) for the
 * color, owned by the material and freed on `destroy`.
 *
 * Delegates to {@link create}, so its failure policy and pipeline-cache
 * behaviour apply.
 *
 * @throws FurnaceError - if `opts.color` is null or contains a
 *   non-finite component.
 */
export async function unlit(
  ctx: Context,
  opts: UnlitOptions,
): Promise<Material> {
  if (
    opts.color == null ||
    !Number.isFinite(opts.color[0]) ||
    !Number.isFinite(opts.color[1]) ||
    !Number.isFinite(opts.color[2]) ||
    !Number.isFinite(opts.color[3])
  ) {
    throw new FurnaceError("material.unlit: color must be a finite Vec4");
  }
  const colorBuffer = ctx.device.createBuffer({
    size: COLOR_BUFFER_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(colorBuffer, 0, opts.color);
  const colorBufferHandle = _registerResource(ctx, {
    kind: "buffer",
    bytes: COLOR_BUFFER_SIZE_BYTES,
  });
  const mat = await create(ctx, {
    vertex: UNLIT_WGSL,
    fragment: UNLIT_WGSL,
    bindings: [{ binding: 0, resource: { buffer: colorBuffer } }],
    topology: opts.topology,
    cullMode: opts.cullMode,
    depthWrite: opts.depthWrite,
    depthCompare: opts.depthCompare,
    blend: opts.blend,
  });
  mat.ownedBuffers.push(colorBuffer);
  mat.ownedBufferHandles.push(colorBufferHandle);
  return mat;
}
