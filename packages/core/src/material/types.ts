import type { Context } from "../gpu/index.ts";
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
 * Engine-owned material handle returned by `material.create` (and the built-in
 * factories `unlit` / `normalColor`).
 *
 * Treated as opaque by consumers — pass to `mesh.create` and `frame.render`,
 * mutate only via documented APIs, dispose via `material.destroy`. The
 * `pipeline`, `group1`, `ownedBuffers`, and `_materialHandle` fields are
 * engine-managed: `pipeline` is refcounted in the internal pipeline cache;
 * `ownedBuffers` holds any uniform buffers the factory allocated and
 * registered with stats so `destroy` can release them.
 */
export type Material = {
  ctx: Context;
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  group1: GPUBindGroup | null;
  ownedBuffers: GPUBuffer[];
  ownedBufferHandles: ResourceHandle[];
  _materialHandle: ResourceHandle;
  cullMode: GPUCullMode;
  topology: GPUPrimitiveTopology;
  depthWrite: boolean;
  depthCompare: GPUCompareFunction;
};
