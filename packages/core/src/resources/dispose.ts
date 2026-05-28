import type { Context } from "../gpu/context-types.ts";
import { warn } from "../log/internal.ts";
import { _countLive, _iterateLive, type ResourceKind } from "./internal.ts";

/**
 * Cascade order (load-bearing). Meshes refcount Materials and Geometries,
 * so meshes tear down first. Effects are independent and slot in after
 * meshes. Materials and Geometries last (their refcount must already
 * be at zero when actual GPU teardown runs).
 */
const CASCADE_ORDER: readonly ResourceKind[] = [
  "mesh",
  "effect",
  "material",
  "geometry",
];

/**
 * Slot data for any consumer-facing resource carries a `_teardown`
 * function that releases the GPU resources owned by the slot. The
 * cascade calls this for each live slot in cascade order.
 *
 * Resource modules (mesh, material, geometry, post) populate this
 * field when allocating their slot data.
 */
export type CascadeTeardownSlot = {
  _teardown: () => void;
};

/**
 * Walk every pool in cascade order. For each live slot, call its
 * `_teardown` function. Emits a single informational log entry summarising
 * the cleanup ("auto-cleaned N handles…") if any handles were live.
 *
 * Called from gpu.dispose AFTER the existing engine-private cascade
 * (depth texture, per-camera buffers, post intermediates) and BEFORE
 * the leak-warn count read. A throwing teardown is caught and logged;
 * iteration continues so one failure doesn't abort the cascade.
 */
export function disposeAllResources(ctx: Context): void {
  const total = CASCADE_ORDER.reduce(
    (acc, kind) => acc + _countLive(ctx, kind),
    0,
  );
  if (total === 0) return;
  warn(
    "resources",
    `auto-cleaned ${total} live handles on dispose; explicit destroy is an optimization, not a requirement`,
  );
  for (const kind of CASCADE_ORDER) {
    // Snapshot live handles before iterating — teardown mutates the pool.
    const snapshot = [..._iterateLive<CascadeTeardownSlot>(ctx, kind)];
    for (const { data } of snapshot) {
      try {
        data._teardown();
      } catch (e) {
        warn("resources", `teardown threw during cascade for ${kind}`, e);
        // Continue iteration; one failure must not abort the cascade.
      }
    }
  }
}
