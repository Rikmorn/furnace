# Centralize Vec3Tuple input type in transform/types.ts

The `readonly [number, number, number]` array-literal input type is defined in
multiple places across the engine, with no single source of truth:

- `packages/core/src/physics/types.ts:15` — `export type Vec3Tuple = readonly [number, number, number]` (the only **exported** copy)
- `packages/core/src/geometry/factories/cube.ts:6` — local `type Vec3Tuple = readonly [number, number, number]`
- `packages/core/src/frame/lights.ts:15` — local `type Vec3Tuple = readonly [number, number, number]`
- `packages/core/src/texture/procedural.ts:9` — local `type Rgb = readonly [number, number, number]` (same shape, different name)
- `packages/core/src/camera/perspective.ts:11–13` — inline `readonly [number, number, number]` on three `const` defaults
- `packages/core/src/camera/orthographic.ts:15–17` — inline `readonly [number, number, number]` on three `const` defaults + one function parameter

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
existing name); `packages/core/src/physics/types.ts:15` (currently the only
exported copy).
