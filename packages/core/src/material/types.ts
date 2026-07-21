import type { Binding, LayoutSchema } from "../binding/types.ts";
import type { MaterialHandle } from "../resources/handle.ts";
import type { Shader } from "../shader/types.ts";
import type { SamplerParams, Texture } from "../texture/types.ts";

/**
 * Descriptor accepted by `material.create`.
 * - `shader`: the {@link Shader} resource (from `shader.create`/`load`). Must
 *   respect the binding contract (`@group(0)` camera+object; `@group(1)` consumer).
 * - `binding`: typed `@group(1)` data path — a {@link Binding} whose buffer is
 *   used to build the `@group(1)` `GPUBindGroup`. Required when the shader
 *   declares a `@group(1)` layout (unless `bindings` is supplied instead).
 *   The binding OWNS its buffer; `material.destroy` does not free it.
 * - `entryPoints`: per-stage entry-point names. Default `vs_main`/`fs_main`.
 *   Override to use any name, or pinpoint one entry in a multi-entry module.
 * - `bindings`: raw `@group(1)` entries (consumer-owned). Retained for
 *   textures, samplers, and advanced use-cases; `binding` is preferred for
 *   typed uniform data.
 * - `texture`: bind a {@link Texture} + optional {@link SamplerParams} to
 *   `@group(1)` (sampler@0, texture-view@1) for a `textureBinding` shader.
 *   Mutually exclusive with `binding`/`bindings`.
 * - `primitive`: `topology` (default `"triangle-list"`), `cullMode` (default `"back"`).
 * - `depth`: omit → depth test+write enabled (`compare:"less"`); `false` → no
 *   depth-stencil; `{ write?, compare? }` → enabled with overrides.
 * - `blend`: undefined → opaque; or a preset / custom `GPUBlendState`.
 */
export type MaterialDescriptor<L extends LayoutSchema = LayoutSchema> = {
  shader: Shader<L>;
  binding?: Binding<L>;
  entryPoints?: { vertex?: string; fragment?: string };
  bindings?: GPUBindGroupEntry[];
  texture?: { texture: Texture; sampler?: SamplerParams };
  primitive?: { topology?: GPUPrimitiveTopology; cullMode?: GPUCullMode };
  depth?: false | { write?: boolean; compare?: GPUCompareFunction };
  blend?: GPUBlendState;
};

/**
 * Opaque material handle. Returned by {@link create} and the built-in
 * factory `unlit`. Consumers pass it to `mesh.create` and `frame.render`
 * and otherwise treat it as opaque; mutate only via documented APIs,
 * dispose via `material.destroy`.
 *
 * The phantom `L` carries the binding layout schema when the material was
 * created with a typed {@link Binding}. Defaults to `LayoutSchema` (wide) for
 * materials without a typed binding. Type-alias of {@link MaterialHandle}.
 */
export type Material<L extends LayoutSchema = LayoutSchema> = MaterialHandle & {
  readonly __layout?: L;
};

/**
 * Engine-private slot data backing a {@link Material} handle in the
 * materials pool. Not exported from the `@furnace/core/material` public
 * surface; resource-manager internals only.
 *
 * `pipeline` is refcounted in the per-ctx material pipeline cache;
 * `ownedBuffers` / `ownedBufferBytes` are paired arrays for slot-owned
 * uniform buffers freed by `_teardown` — currently unused (see the field
 * comment below).
 *
 * `userCount` / `markedDestroyed` carry the Mesh→Material refcount
 * (symmetric to Mesh→Geometry): `destroy` while `userCount > 0` sets
 * `markedDestroyed` and skips actual GPU teardown; the last
 * `mesh.destroy` that drops `userCount` to zero then triggers teardown.
 */
export type MaterialSlot = {
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  group1: GPUBindGroup | null;
  // CURRENTLY DEAD (no writer): these hold factory-allocated uniform buffers the
  // slot frees on destroy. The only writer was `material.unlit`, retired in
  // Tranche E-B — the bridge now owns `@group(1)` buffers in the `Binding`
  // (material.destroy must NOT free those) and raw `bindings` are consumer-owned,
  // so nothing pushes here and `_teardown`'s loop iterates an empty array.
  // Retained pending a design call (is binding-ownership permanent?); removal
  // backlogged: docs/backlog/engine-architecture/material-ownedbuffers-dead-after-unlit-retirement.md
  ownedBuffers: GPUBuffer[];
  ownedBufferBytes: number[];
  cullMode: GPUCullMode;
  topology: GPUPrimitiveTopology;
  depthWrite: boolean;
  depthCompare: GPUCompareFunction;
  depthEnabled: boolean;
  /** `true` when the material was created with a `MaterialDescriptor.blend`
   *  state. A built `GPURenderPipeline` exposes nothing about its blend state,
   *  so this mirror is the only render-time-readable signal that a draw is
   *  translucent — `frame.render` uses it to record blended draws after every
   *  opaque one (see `frame.render`'s draw-order note). */
  blended: boolean;
  /** Mirror of the shader's `usesScene` — the render path binds the Scene UBO
   *  at `@group(0) @binding(1)` for this material's pipeline when true. */
  usesScene: boolean;
  /** Mirror of the shader's `usesShadows` — the render path binds the shadow
   *  map array + comparison sampler at `@group(0) @binding(2/3)` for this
   *  material's pipeline when true. */
  usesShadows: boolean;
  userCount: number;
  markedDestroyed: boolean;
  _teardown: () => void;
};
