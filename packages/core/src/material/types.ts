import type { Context } from "../gpu/index.ts";
import type { MaterialHandle } from "../resources/handle.ts";
import type { ResourceHandle } from "../stats/internal.ts";

/**
 * Descriptor accepted by `material.create`.
 *
 * - `vertex` / `fragment`: required WGSL source strings. Must respect the
 *   engine's binding contract (see `engine-conventions.md` §"Binding
 *   contract"): `@group(0) @binding(0)` is the camera uniform,
 *   `@group(0) @binding(1)` is the object uniform; consumer bindings live
 *   under `@group(1)`. The vertex stage entry is `vs_main`, fragment is
 *   `fs_main`.
 * - `bindings`: entries bound at `@group(1)`. The resources (buffers,
 *   textures) are consumer-owned — destroy them yourself after
 *   `material.destroy`.
 * - `cullMode`: default `"back"`. Override to `"none"` for two-sided or
 *   full-screen geometry.
 * - `topology`: default `"triangle-list"`.
 * - `depthWrite`: default `true`.
 * - `depthCompare`: default `"less"`.
 * - `blend`: undefined disables blending (opaque). Use the
 *   {@link PREMULTIPLIED_ALPHA_BLEND} / {@link ADDITIVE_BLEND} /
 *   {@link STRAIGHT_ALPHA_BLEND} constants, or supply a custom `GPUBlendState`.
 */
export type MaterialDescriptor = {
  vertex: string;
  fragment: string;
  bindings?: GPUBindGroupEntry[];
  cullMode?: GPUCullMode;
  topology?: GPUPrimitiveTopology;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  blend?: GPUBlendState;
};

/**
 * Opaque material handle. Returned by {@link create} and the built-in
 * factories (`unlit`, `normalColor`). Consumers pass it to `mesh.create`
 * and `frame.render` and otherwise treat it as opaque; mutate only via
 * documented APIs, dispose via `material.destroy`.
 *
 * Type-alias of {@link MaterialHandle}; consumers can use either name.
 */
export type Material = MaterialHandle;

/**
 * Engine-private slot data backing a {@link Material} handle in the
 * materials pool. Not exported from the `@furnace/core/material` public
 * surface; resource-manager internals only.
 *
 * `pipeline` is refcounted in the per-ctx material pipeline cache;
 * `ownedBuffers` / `ownedBufferHandles` hold any uniform buffers the
 * factory allocated and registered with stats so the slot's `_teardown`
 * can release them.
 *
 * `userCount` / `markedDestroyed` carry the Mesh→Material refcount
 * (symmetric to Mesh→Geometry): `destroy` while `userCount > 0` sets
 * `markedDestroyed` and skips actual GPU teardown; the last
 * `mesh.destroy` that drops `userCount` to zero then triggers teardown.
 */
export type MaterialSlot = {
  ctx: Context;
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  group1: GPUBindGroup | null;
  ownedBuffers: GPUBuffer[];
  ownedBufferHandles: ResourceHandle[];
  cullMode: GPUCullMode;
  topology: GPUPrimitiveTopology;
  depthWrite: boolean;
  depthCompare: GPUCompareFunction;
  userCount: number;
  markedDestroyed: boolean;
  _teardown: () => void;
};
