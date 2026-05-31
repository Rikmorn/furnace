import type { Context } from "../gpu/index.ts";
import { normalColor as normalColorShader } from "../shader/index.ts";
import { _flatRenderState, create } from "./material.ts";
import type { Material } from "./types.ts";

/**
 * Pipeline-state overrides accepted by {@link normalColor}.
 *
 * All fields optional; defaults match {@link MaterialDescriptor}
 * (`topology: "triangle-list"`, `cullMode: "back"`, `depthEnabled: true`,
 * `depthWrite: true`, `depthCompare: "less"`, no blend). When `depthEnabled`
 * is `false` the pipeline is built without a depth-stencil attachment;
 * `depthWrite` and `depthCompare` are ignored in that case.
 */
export type NormalColorOptions = {
  topology?: GPUPrimitiveTopology;
  cullMode?: GPUCullMode;
  depthEnabled?: boolean;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  blend?: GPUBlendState;
};

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
export async function normalColor(
  ctx: Context,
  opts?: NormalColorOptions,
): Promise<Material> {
  return await create(ctx, {
    shader: await normalColorShader(ctx),
    ..._flatRenderState(opts ?? {}),
    blend: opts?.blend,
  });
}
