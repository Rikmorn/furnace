import type { LayoutSchema, ResolvedLayout } from "../binding/types.ts";
import type { ShaderHandle } from "../resources/handle.ts";

/**
 * Opaque shader handle carrying a compile-time phantom `L` that records the
 * declared `@group(1)` layout schema. Returned by {@link create} / {@link load}
 * / {@link unlit} / {@link normalColor}. Consumers pass it to `material.create`
 * and otherwise treat it as opaque; dispose via `shader.destroy`.
 *
 * The default `L = LayoutSchema` is intentionally wide so that existing
 * 2-arg `shader.create(ctx, wgsl)` calls compile without change — the phantom
 * narrows only when an explicit `layout` option is passed.
 */
export type Shader<L extends LayoutSchema = LayoutSchema> = ShaderHandle & {
  readonly __layout?: L;
};

/**
 * Engine-private slot data backing a {@link Shader}. `module` is the compiled
 * `GPUShaderModule`; `source` is the WGSL, retained for hot-reload-readiness +
 * debugging; `engineOwned` marks the shared built-in shaders (public `destroy`
 * no-ops on them; freed only by the dispose cascade); `layout` is the resolved
 * `@group(1)` layout (or `null` if no layout was declared); `textureBinding`
 * is `true` when the shader declares a texture+sampler at `@group(1)` (bindings
 * 0 and 1 respectively) — read by `material.create` to enforce a completeness
 * check. `usesScene` is `true` when the shader reads the engine Scene UBO at
 * `@group(0) @binding(1)` — mirrored onto the material slot so the render path
 * binds the Scene buffer for this pipeline. `_teardown` is a no-op —
 * `GPUShaderModule` has no `.destroy()`; GC reclaims the module when the slot
 * clears.
 */
export type ShaderSlot = {
  module: GPUShaderModule;
  source: string;
  engineOwned: boolean;
  layout: ResolvedLayout | null;
  textureBinding: boolean;
  /** `true` when the shader statically uses the Scene UBO at `@group(0)
   *  @binding(1)` — the per-frame group-0 bind group then includes it. Read by
   *  `material.create` → stored on the material slot → consumed by the render
   *  path's `ensurePerFrameGroup0`. */
  usesScene: boolean;
  /** `true` when the shader samples the engine shadow maps at `@group(0)`
   *  bindings 2 and 3 — the per-frame group-0 bind group then includes the
   *  shadow atlas and its sampler. Read by `material.create` → stored on the
   *  material slot → consumed by the render path. */
  usesShadows: boolean;
  /** `true` when the shader sources its model matrix from per-instance vertex
   *  attributes (locations 3–6) and bypasses the `@group(2)` Object UBO. Read
   *  by `material.create` to select the instance vertex-buffer pipeline layout
   *  (per-instance step-mode buffers for the model rows + tint). */
  instanced: boolean;
  _teardown: () => void;
};
