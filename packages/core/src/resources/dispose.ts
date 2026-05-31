import type { Context } from "../gpu/context-types.ts";
import { warn } from "../log/internal.ts";
import {
  _countLive,
  _destroyByKind,
  _iterateLive,
  _resetBuiltinShaders,
  type ResourceKind,
} from "./internal.ts";

/**
 * Cascade order (load-bearing). Meshes refcount Materials and Geometries,
 * so meshes tear down first. Effects are independent and slot in after
 * meshes. Materials and Geometries follow (their refcount must already
 * be at zero when actual GPU teardown runs). Shaders are order-insensitive
 * — nothing references a shader slot after pipeline creation (WebGPU captures
 * the module at pipeline-build time), so they slot last.
 */
const CASCADE_ORDER: readonly ResourceKind[] = [
  "mesh",
  "effect",
  "material",
  "geometry",
  "shader",
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
  /** Engine-owned slots (e.g. builtin shaders) are freed by the cascade but
   *  excluded from the consumer-facing auto-clean warning count — they are the
   *  engine's responsibility, not the consumer's. */
  engineOwned?: boolean;
};

/**
 * Walk every pool in cascade order. For each live slot, call its
 * `_teardown` function. Emits a single warning entry summarising the
 * cleanup ("auto-cleaned N handles…") if any consumer-owned handles
 * were live (engine-owned handles such as builtin shaders are freed
 * silently and excluded from the count).
 *
 * Called from gpu.dispose AFTER the existing engine-private cascade
 * (depth texture, per-camera buffers, post intermediates) and BEFORE
 * the leak-warn count read. A throwing teardown is caught and logged;
 * iteration continues so one failure doesn't abort the cascade.
 */
export function disposeAllResources(ctx: Context): void {
  const upfrontTotal = CASCADE_ORDER.reduce(
    (acc, kind) => acc + _countLive(ctx, kind),
    0,
  );
  if (upfrontTotal === 0) return;
  let consumerDestroyed = 0;
  for (const kind of CASCADE_ORDER) {
    // Snapshot live handles before iterating — teardown mutates the pool.
    // Some snapshot entries may already be destroyed by the time we reach
    // them because mesh teardown can refcount-cascade into the geometry
    // and material slots it referenced. _destroyByKind returns false on
    // those; we count only the slots WE actually freed so the post-cascade
    // warn matches reality.
    const snapshot = [..._iterateLive<CascadeTeardownSlot>(ctx, kind)];
    for (const { handle, data } of snapshot) {
      // _destroyByKind invokes the slot's _teardown then frees the pool
      // slot. Going through _destroyByKind (not raw teardown) keeps the
      // pool's live-count consistent so stats.snapshot(ctx).resources
      // reflects reality after the cascade — important when called
      // outside of gpu.dispose (e.g. resources.disposeAll mid-session).
      try {
        if (
          _destroyByKind<CascadeTeardownSlot>(ctx, kind, handle, (d) =>
            d._teardown(),
          )
        ) {
          // Engine-owned slots are freed silently — they are not consumer leaks.
          if (!data.engineOwned) consumerDestroyed += 1;
        }
      } catch (e) {
        warn("resources", `teardown threw during cascade for ${kind}`, e);
        // Continue iteration; one failure must not abort the cascade.
      }
    }
  }
  // The cascade just freed any live built-in shader slots; invalidate the
  // per-ctx cache that held their (now-dead) handles so a post-disposeAll
  // material.unlit / shader.unlit / shader.normalColor recompiles instead
  // of reusing a freed handle.
  _resetBuiltinShaders(ctx);
  if (consumerDestroyed > 0) {
    warn(
      "resources",
      `auto-cleaned ${consumerDestroyed} live handles on dispose; explicit destroy is an optimization, not a requirement`,
    );
  }
}
