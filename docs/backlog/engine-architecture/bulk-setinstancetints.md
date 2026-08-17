---
summary: `InstancedMesh` exposes a bulk transform upload but no bulk tint path, so the dungeon's world loader loops `setInstanceTint` per instance where transforms take one call
---

# Bulk `setInstanceTints` to mirror `setInstanceMatrices`

## Context

Slice 2.2.3a's `InstancedMesh` resource (`packages/core/src/mesh/instanced.ts`) exposes a
**bulk** transform upload — `mesh.setInstanceMatrices(ctx, handle, matrices)` (a single
column-major `Float32Array` of all instance mat4s, one buffer write) — alongside the
per-instance `setInstanceTransform`. But there is **no symmetric bulk tint path**: tints can
only be set one instance at a time via `setInstanceTint`.

The asymmetry shows up in the dungeon's `packages/dungeon/src/world/world-loader.ts`, which bakes an
`InstanceGroup` into an `InstancedMesh`: it can upload all transforms in one
`setInstanceMatrices` call, but must **loop `setInstanceTint` per instance** for the tints. A
bulk `setInstanceTints(ctx, handle, tints)` (a single `Float32Array` of all instance `vec4`s,
one buffer write — mirroring the matrices path exactly) would collapse that loop and restore
API symmetry.

This is **deferred, not blocking** — the per-instance tint loop is correct and runs once at
build for a few hundred static decorations (not a measured hot path).

## Trigger to revisit

When per-instance-tint upload becomes a **measured** hot path (large or frequently-rebaked
instance counts), or as a small API-symmetry cleanup taken alongside other instancing work.

## Reference

- `packages/core/src/mesh/instanced.ts` — `setInstanceMatrices` (the bulk pattern to mirror) +
  `setInstanceTint` (the per-instance path).
- `packages/dungeon/src/world/world-loader.ts` — the per-instance `setInstanceTint` loop that a
  bulk path would collapse. *(Re-pointed at the T5 branch review, 2026-08-11: this entry named
  `packages/dungeon/src/world/realize.ts`, which does not exist. The dungeon's `src/` was split into
  `world/` and `agent/` during the 2026-08-04 structural housekeeping; `world/realize.ts` does
  exist but contains **zero** `setInstanceTint` calls —
  `grep -rn "setInstanceTint" packages/dungeon/src --include="*.ts"` returns exactly one line,
  in `world-loader.ts`.)*
