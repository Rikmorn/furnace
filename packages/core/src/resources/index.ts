import type { Context } from "../gpu/context-types.ts";
import { disposeAllResources } from "./dispose.ts";
import type {
  EffectHandle,
  GeometryHandle,
  MaterialHandle,
  MeshHandle,
} from "./handle.ts";
import { _countLive, _iterateLive, type ResourceKind } from "./internal.ts";

/**
 * Branded handle types — re-exported so consumers can type their
 * variables without reaching into engine-internal modules.
 */
export type {
  AnyResourceHandle,
  EffectHandle,
  GeometryHandle,
  MaterialHandle,
  MeshHandle,
} from "./handle.ts";

/** Discriminator string used by {@link list} (and other cross-kind APIs). */
export type { ResourceKind } from "./internal.ts";

/**
 * Counts of live resources per kind. Used by debug overlays and leak
 * detection in long-running sessions. O(N) over each pool's capacity;
 * not suitable for per-frame gameplay code.
 */
export type ResourceSummary = {
  meshes: number;
  materials: number;
  geometries: number;
  effects: number;
};

/**
 * Return a snapshot of live-resource counts per kind. O(N) over each
 * pool's slot table; suitable for debug-overlay use, not per-frame
 * gameplay code.
 */
export function summary(ctx: Context): ResourceSummary {
  return {
    meshes: _countLive(ctx, "mesh"),
    materials: _countLive(ctx, "material"),
    geometries: _countLive(ctx, "geometry"),
    effects: _countLive(ctx, "effect"),
  };
}

/**
 * Iterate the live handles of the given kind. Yields handles only;
 * for the slot data, consumers go through the per-kind accessors
 * (`mesh.*`, `material.*`, etc.).
 *
 * The optional type parameter `H` lets the caller narrow the yield
 * type to one of the branded handle types — e.g.,
 * `list<MeshHandle>(ctx, "mesh")` yields `MeshHandle` values.
 */
export function list<H = number>(
  ctx: Context,
  kind: ResourceKind,
): IterableIterator<H> {
  // Boundary cast: _iterateLive yields { handle: number, data }; the
  // caller's H parameter narrows the yield type. The (kind, H) pairing
  // is the caller's responsibility — analogous to the _allocMesh /
  // _lookupMesh wrapper pattern in internal.ts.
  return mapHandles<H>(_iterateLive<unknown>(ctx, kind));
}

function* mapHandles<H>(
  inner: IterableIterator<{ handle: number; data: unknown }>,
): IterableIterator<H> {
  for (const { handle } of inner) {
    // Boundary cast: branded-handle re-narrowing at the public surface.
    // _iterateLive yields raw uint48 numbers; the caller's H parameter
    // (one of MeshHandle/MaterialHandle/etc.) names the brand the kind
    // discriminator implies. The (kind, H) pairing is the caller's
    // responsibility — analogous to the _allocMesh / _lookupMesh wrapper
    // pattern in internal.ts.
    yield handle as H;
  }
}

/** Per-kind structured dump of every live handle. */
export type ResourceSnapshot = {
  meshes: MeshHandle[];
  materials: MaterialHandle[];
  geometries: GeometryHandle[];
  effects: EffectHandle[];
};

/**
 * Full debug snapshot — collect every live handle into per-kind arrays.
 * Heavy; intended for dev tools, inspectors, and post-mortem dumps.
 * Not suitable for per-frame use.
 */
export function snapshot(ctx: Context): ResourceSnapshot {
  return {
    meshes: [...list<MeshHandle>(ctx, "mesh")],
    materials: [...list<MaterialHandle>(ctx, "material")],
    geometries: [...list<GeometryHandle>(ctx, "geometry")],
    effects: [...list<EffectHandle>(ctx, "effect")],
  };
}

/**
 * Manually trigger the resource-manager cascade — equivalent to what
 * `gpu.dispose(ctx)` does internally, but without disposing the
 * `GPUDevice` itself. Exposed so consumers can explicitly clean up
 * before disposing the context (e.g., free memory during a level
 * transition without dropping the device).
 *
 * Idempotent: a second call after everything is already disposed is
 * a no-op.
 */
export function disposeAll(ctx: Context): void {
  disposeAllResources(ctx);
}
