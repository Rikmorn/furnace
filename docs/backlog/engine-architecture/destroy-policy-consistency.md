# Inconsistent double-destroy policy across resource modules

*Tranche A-3 candidate (engine API hygiene).*

`@furnace/core` resource modules currently implement three different double-destroy behaviours:

| Module | Behaviour on second `destroy(handle)` call |
|---|---|
| `material.destroy` | **Silent.** Both `ownedBuffers.forEach(b => b.destroy())` and `_unregisterResource` are defensive (empty array no-ops; `_unregisterResource` returns silently on unknown handles), so a re-entry does nothing visible. No warning is emitted. |
| `mesh.destroy` | **Crashes.** Reads `_objectBufferHandle` / `_meshHandle` off the mesh object, then `_unregisterResource` returns silently on the second call, but the underlying `objectBuffer.destroy()` is called twice and the resource handles point to already-released entries. Behaviour is undefined; production WebGPU drivers will surface a use-after-free. |
| `post.destroy` | **Warns + no-ops.** Guards with `if (effect._internal.destroyed) { console.warn("[furnace/post] effect already destroyed"); return; }`. Cleanest of the three. |

Three patterns for one lifecycle concept (`create` / `destroy` of an engine-owned GPU resource) is engine-architecture drift. Consumers using all three modules see different behaviour from textually-similar calls.

This was surfaced repeatedly during Tranche A-1's bulk TSDoc pass — every `destroy` block had to document the actual behaviour of its module (not lie about idempotency) and the inconsistency became visible as the same paragraph kept needing rewording.

## Fix

Pick a single policy and apply it to all three modules. Strong preference: **runtime-quiet warn-and-noop** (post's existing pattern):

```ts
if (handle._internal.destroyed) {
  console.warn("[furnace/<module>] <Resource> already destroyed");
  return;
}
handle._internal.destroyed = true;
// ... existing teardown ...
```

Rationale: the warn surfaces double-destroy as a (likely) consumer bug without breaking the program flow. Silent (material's current behaviour) hides bugs; crash (mesh's current behaviour) is too punitive for an idempotent-feeling operation and inconsistent with the rest of the engine's runtime-quiet posture.

Apply uniformly to `material.destroy`, `mesh.destroy` (+ `mesh.destroyGeometry`), `post.destroy`, and any future resource modules. Update each module's TSDoc to match.

## What to verify when fixing

- All three `destroy` calls warn-and-noop on second invocation (no crash, no silent ignore).
- Existing tests pass — the only behavioural change for consumers calling `destroy` exactly once is unchanged.
- TSDoc on all three matches; engine-conventions.md grows a "Resource destruction" section codifying the policy.
- `mesh.destroy` no longer attempts the second `objectBuffer.destroy()` (currently undefined behaviour at WebGPU level).

**Trigger to revisit:** Next engine API hygiene tranche (A-3), OR when a consumer reports inconsistent destroy behaviour, OR when a fourth resource module ships (so the policy is decided before adding a fourth divergent pattern).

**Reference:** Surfaced during Tranche A-1 (TSDoc bulk pass), 2026-05-26. Sibling-pattern observations live in `material/material.ts`, `mesh/mesh.ts`, `post/effect.ts`.
