---
summary: the `readonly [number, number, number]` input type is defined in six places across core with no canonical home, and the centralization pass also has to land the storage-vs-input rule that picks `Vec3` or `Vec3Tuple` by layer
---

# Centralize Vec3Tuple input type in transform/types.ts

The `readonly [number, number, number]` array-literal input type is defined in
multiple places across the engine, with no single source of truth:

- `packages/core/src/physics/types.ts` — `export type Vec3Tuple = readonly [number, number, number]` (the only **exported** copy)
- `packages/core/src/geometry/factories/cube.ts` — local `type Vec3Tuple = readonly [number, number, number]`
- `packages/core/src/frame/lights.ts` — local `type Vec3Tuple = readonly [number, number, number]`
- `packages/core/src/texture/procedural.ts` — local `type Rgb = readonly [number, number, number]` (same shape, different name)
- `packages/core/src/camera/perspective.ts` — inline `readonly [number, number, number]` on three `const` defaults (`DEFAULT_POSITION` / `DEFAULT_TARGET` / `DEFAULT_UP`) + one function parameter (`cloneVec3OrDefault`'s `fallback`)
- `packages/core/src/camera/orthographic.ts` — inline `readonly [number, number, number]` on three `const` defaults (`DEFAULT_POSITION` / `DEFAULT_TARGET` / `DEFAULT_UP`) + one function parameter (`cloneVec3OrDefault`'s `fallback`)

**Proposal:** home a canonical `Vec3Tuple` in `packages/core/src/transform/types.ts`
alongside the existing `Vec3` / `Vec4` storage types. The distinction matters:

- `Vec3` = `Float32Array` — the **storage** type for engine internals and math ops.
- `Vec3Tuple` = `readonly [number, number, number]` — the **input** type for consumer
  call sites that pass array literals like `[0, -1, 0]`. `Float32Array` does not
  accept array literals at the type level, so fields typed `Vec3` reject `[x, y, z]`
  inputs. `Vec3Tuple` is a distinct concept and deserves its own canonical definition,
  not a per-module local copy.

Once centralized, each local definition and inline annotation above becomes an
`import type { Vec3Tuple } from "@furnace/core/transform"` (or an internal path
import). `texture/procedural.ts`'s `Rgb` is a same-shape alias used for
checkerboard/grid pixel colors — it could either adopt `Vec3Tuple` directly or
remain a local alias referencing the canonical type.

**Governing rule (decided 2026-06-07 — codify alongside the centralization).**
The choice between the two types is settled by *layer*, not case-by-case, and
this rule should be the deliverable of the centralization pass (not just a moved
type):

- **`Vec3` (`Float32Array`) — storage / compute.** Long-lived state mutated in
  place, cache-hot or hot-loop data, anything uploaded to the GPU, and math-op
  in/out. E.g. `mesh`/`camera` transforms, matrices, geometry buffers, the
  per-frame Scene UBO scratch buffer.
- **`Vec3Tuple` (`readonly [number, number, number]`) — descriptor / input.**
  Immutable, hand-authored, **bounded-count** data passed by value into a
  setup-time or per-frame API and immediately consumed (copied into a
  `Float32Array`). E.g. `Light` / `Ambient`, physics descriptors, geometry
  factory inputs.

Rationale: performance is governed by the **storage** layer (always
`Float32Array`), not the input shape. At bounded input counts (e.g.
`MAX_LIGHTS = 16`) the tuple's costs — an `f64` backing store, and a per-frame
allocation to "move" a `readonly` tuple instead of an in-place `Float32Array`
write — are negligible and never become a hot path, so the input-type choice is
decided by **posture** (immutable value-data vs. mutable buffer) and ergonomics,
not cache layout. Lights/ambient keep `Vec3Tuple` (immutable value-data,
mirroring `Camera` and physics; literal authoring); the cache-friendly
`Float32Array` decision is preserved where it counts — the Scene UBO is a reused
`Float32Array` and the tuple never reaches the GPU. The centralization pass
should land this rule in `docs/reference/` (engine-conventions or api-posture)
so contributors pick the right type by layer without re-deriving the tradeoff
per module.

**Why deferred:** multi-module change with no new consumer surface — all
occurrences are internal types. Touches 6+ files across 5 sub-modules. No
design decision is open (the canonical location and distinction are settled here);
the work is straightforward but wide.

**Trigger to revisit:** next api-posture / naming-hygiene tranche, OR when a
further module needs to define the tuple-input type (making the count 7+), OR
before first npm publish of `@furnace/core` (since `Vec3Tuple` may warrant a
public export from `@furnace/core/transform`).

**Reference:** `packages/core/src/frame/lights.ts` (local `Vec3Tuple` added in
Stage 3 Phase 2 Task 3, originally coined `Vec3Input` — renamed to `Vec3Tuple`
in the same commit after spec review found it synonymous with the engine's
existing name); `Vec3Tuple` in `packages/core/src/physics/types.ts` (currently
the only exported copy).
