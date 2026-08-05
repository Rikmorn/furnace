// The shader module's engine-private door. Sibling core modules reach the slot
// accessors, the raw compile entry point, and the engine-authored source
// fragments through this file rather than deep-importing shader.ts /
// preamble.ts / shadows.ts. None of it is consumer surface — that is index.ts.

import type { ResolvedLayout } from "../binding/types.ts";
import type { Context } from "../gpu/index.ts";
import { _lookupShader } from "../resources/internal.ts";
import type { Shader, ShaderSlot } from "./types.ts";

/**
 * The `@group(0)` camera-uniform declaration every engine-authored shader
 * composes. Read by `frame.render-lines` so the debug-line shader binds the
 * same camera UBO the built-ins do.
 */
export { _cameraBinding } from "./preamble.ts";

/**
 * Raw compile entry point behind `shader.create`, taking an already-resolved
 * layout instead of a schema. Used by the engine's own built-ins and the post
 * built-ins, which resolve their layouts once at module load.
 */
export { _createShader } from "./shader.ts";

/**
 * The depth-only shadow-caster source the shadow-map pass compiles. Engine-
 * authored; consumers get shadows declaratively via `Light.shadow`.
 */
export { _shadowCasterSrc } from "./shadows.ts";

/**
 * Read the resolved `@group(1)` {@link ResolvedLayout} stored on a shader slot,
 * or `null` if no layout was declared at compile time.
 *
 * Used by the binding subsystem to validate that a `Binding` matches its paired
 * shader's declared schema.
 */
export function _layoutOf(ctx: Context, shader: Shader): ResolvedLayout | null {
  return _lookupShader<ShaderSlot>(ctx, shader)?.layout ?? null;
}

/**
 * Read the `textureBinding` flag stored on a shader slot. `true` when the
 * shader was compiled with `textureBinding: true` (declares a texture+sampler
 * at `@group(1)`, bindings 0 and 1); `false` otherwise (the default for all
 * built-ins and shaders created without the flag).
 *
 * Used by `material.create` to enforce that a `texture` is supplied when the
 * shader samples one.
 */
export function _textureBindingOf(ctx: Context, shader: Shader): boolean {
  return _lookupShader<ShaderSlot>(ctx, shader)?.textureBinding ?? false;
}

/**
 * Read the `usesScene` flag stored on a shader slot. `true` when the shader
 * reads the Scene UBO at `@group(0) @binding(1)`. Read by `material.create` to
 * record it on the material slot for the render path.
 */
export function _usesSceneOf(ctx: Context, shader: Shader): boolean {
  return _lookupShader<ShaderSlot>(ctx, shader)?.usesScene ?? false;
}

/**
 * Read the `usesShadows` flag stored on a shader slot. `true` when the shader
 * samples the engine shadow maps at `@group(0) @binding(2)` (depth array) +
 * `@binding(3)` (comparison sampler). Read by `material.create` to record it on
 * the material slot for the render path.
 */
export function _usesShadowsOf(ctx: Context, shader: Shader): boolean {
  return _lookupShader<ShaderSlot>(ctx, shader)?.usesShadows ?? false;
}

/**
 * Read the `instanced` flag stored on a shader slot. `true` when the shader
 * sources its model matrix from per-instance vertex attributes (locations 3–6)
 * and bypasses the `@group(2)` Object UBO. Read by `material.create` to select
 * the instance vertex-buffer pipeline layout.
 */
export function _instancedOf(ctx: Context, shader: Shader): boolean {
  return _lookupShader<ShaderSlot>(ctx, shader)?.instanced ?? false;
}
