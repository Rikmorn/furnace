# Bulk `setInstanceTints` to mirror `setInstanceMatrices`

## Context

Slice 2.2.3a's `InstancedMesh` resource (`packages/core/src/mesh/instanced.ts`) exposes a
**bulk** transform upload — `mesh.setInstanceMatrices(ctx, handle, matrices)` (a single
column-major `Float32Array` of all instance mat4s, one buffer write) — alongside the
per-instance `setInstanceTransform`. But there is **no symmetric bulk tint path**: tints can
only be set one instance at a time via `setInstanceTint`.

The asymmetry shows up in the dungeon's `packages/dungeon/src/realize.ts`, which bakes an
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
- `packages/dungeon/src/realize.ts` — the per-instance `setInstanceTint` loop that a bulk path
  would collapse.
