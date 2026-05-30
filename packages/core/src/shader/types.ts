import type { ShaderHandle } from "../resources/handle.ts";

/**
 * Opaque shader handle. Returned by {@link create} / {@link load}. Holds a
 * compiled `GPUShaderModule` for one WGSL module (which may carry
 * `@vertex`/`@fragment`/`@compute` entry points). Consumers pass it to
 * `material.create` and otherwise treat it as opaque; dispose via
 * `shader.destroy`. Type-alias of {@link ShaderHandle}.
 */
export type Shader = ShaderHandle;

/**
 * Engine-private slot data backing a {@link Shader}. `module` is the compiled
 * `GPUShaderModule`; `source` is the WGSL, retained for hot-reload-readiness +
 * debugging; `engineOwned` marks the shared built-in shaders (public `destroy`
 * no-ops on them; freed only by the dispose cascade). `_teardown` is a no-op —
 * `GPUShaderModule` has no `.destroy()`; GC reclaims the module when the slot clears.
 */
export type ShaderSlot = {
  module: GPUShaderModule;
  source: string;
  engineOwned: boolean;
  _teardown: () => void;
};
