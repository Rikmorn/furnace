import { createPool, type Pool } from "./pool.ts";

/**
 * Per-context resource manager. Owns one pool per consumer-facing
 * resource type. Slot data types are loose (`unknown`) at this layer
 * because the manager is generic — the type-safe wrapper lives in
 * `internal.ts` (engine-internal API) and `index.ts` (public API).
 *
 * The pool kinds are fixed at compile time and align with the four
 * consumer-facing resource types in @furnace/core. Future resource
 * types (textures, samplers, scene nodes) extend this struct.
 */
export type ResourceManager = {
  meshes: Pool<unknown>;
  materials: Pool<unknown>;
  geometries: Pool<unknown>;
  effects: Pool<unknown>;
};

/**
 * Construct a new resource manager with empty pools for every resource
 * type. Called once per Context in `createInternalState`.
 */
export function createResourceManager(): ResourceManager {
  return {
    meshes: createPool(),
    materials: createPool(),
    geometries: createPool(),
    effects: createPool(),
  };
}
