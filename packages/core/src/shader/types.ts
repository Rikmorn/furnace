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
 * `@group(1)` layout (or `null` if no layout was declared). `_teardown` is a
 * no-op — `GPUShaderModule` has no `.destroy()`; GC reclaims the module when
 * the slot clears.
 */
export type ShaderSlot = {
  module: GPUShaderModule;
  source: string;
  engineOwned: boolean;
  layout: ResolvedLayout | null;
  _teardown: () => void;
};
