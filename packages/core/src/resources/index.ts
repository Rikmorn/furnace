import type { Context } from "../gpu/context-types.ts";
import { disposeAllResources } from "./dispose.ts";

/**
 * Branded handle types — re-exported so consumers can type their
 * variables without reaching into engine-internal modules.
 */
export type {
  AnyResourceHandle,
  BindingHandle,
  EffectHandle,
  GeometryHandle,
  MaterialHandle,
  MeshHandle,
  ShaderHandle,
} from "./handle.ts";

/** Discriminator string for resource kinds. */
export type { ResourceKind } from "./internal.ts";

/**
 * Manually trigger the resource-manager cascade — equivalent to what
 * `gpu.dispose(ctx)` does internally, but without disposing the
 * `GPUDevice` itself. Exposed so consumers can explicitly clean up
 * before disposing the context (e.g., free memory during a level
 * transition without dropping the device).
 *
 * Idempotent: a second call after everything is already disposed is
 * a no-op.
 *
 * For count and memory introspection of live resources, see
 * `stats.snapshot(ctx).resources.*` and `stats.snapshot(ctx).memory.*`.
 */
export function disposeAll(ctx: Context): void {
  disposeAllResources(ctx);
}
