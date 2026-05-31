import type { Binding, LayoutSchema } from "../binding/types.ts";
import type { MaterialHandle } from "../resources/handle.ts";
import type { Shader } from "../shader/types.ts";

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
 * `ownedBuffers` / `ownedBufferBytes` are paired arrays holding any
 * uniform buffers the factory allocated and their byte sizes (used by
 * the slot's `_teardown` to fire matching stats decrements).
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
  ownedBuffers: GPUBuffer[];
  ownedBufferBytes: number[];
  cullMode: GPUCullMode;
  topology: GPUPrimitiveTopology;
  depthWrite: boolean;
  depthCompare: GPUCompareFunction;
  depthEnabled: boolean;
  userCount: number;
  markedDestroyed: boolean;
  _teardown: () => void;
};
