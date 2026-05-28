import type { Context } from "../gpu/index.ts";
import { create } from "./material.ts";
import type { Material } from "./types.ts";

/**
 * Pipeline-state overrides accepted by {@link normalColor}.
 *
 * All fields optional; defaults match {@link MaterialDescriptor}
 * (`topology: "triangle-list"`, `cullMode: "back"`, `depthWrite: true`,
 * `depthCompare: "less"`, no blend).
 */
export type NormalColorOptions = {
  topology?: GPUPrimitiveTopology;
  cullMode?: GPUCullMode;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  blend?: GPUBlendState;
};

const NORMAL_COLOR_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  // Uniform-scale-correct normal transform. Non-uniform scale needs inverse-transpose
  // (deferred — tranche 4 demos use uniform scale).
  out.normal = (object.model * vec4<f32>(v.normal, 0.0)).xyz;
  return out;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  return vec4<f32>(n * 0.5 + 0.5, 1.0);
}
`;

/**
 * Stock debug material that renders the world-space normal as RGB
 * (`n * 0.5 + 0.5`). No bindings; the shader uses only the engine-provided
 * `@group(0)` camera + object uniforms.
 *
 * Normal transform is uniform-scale-correct (multiplies normals by the model
 * matrix's rotation/scale, then re-normalises in the fragment). Non-uniform
 * scale needs an inverse-transpose — deferred; today's demos use uniform scale.
 *
 * Pipeline state defaults match {@link MaterialDescriptor}; override via
 * `opts`. Delegates to {@link create}, so its failure policy and pipeline-
 * cache behaviour apply.
 */
export function normalColor(
  ctx: Context,
  opts?: NormalColorOptions,
): Promise<Material> {
  return create(ctx, {
    vertex: NORMAL_COLOR_WGSL,
    fragment: NORMAL_COLOR_WGSL,
    topology: opts?.topology,
    cullMode: opts?.cullMode,
    depthWrite: opts?.depthWrite,
    depthCompare: opts?.depthCompare,
    blend: opts?.blend,
  });
}
