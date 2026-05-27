# Tranche B-1 — `mesh.cube` / `mesh.plane` factory geometry ownership

The convenience factories `mesh.cube(ctx, { material })` and `mesh.plane(ctx, { material })` allocate an internal geometry via `cubeGeometry(ctx, opts)` / `planeGeometry(ctx, opts)`, register that geometry's GPU resources with stats, and return only the `Mesh` handle. But `mesh.destroy(mesh)` explicitly does NOT cascade to `mesh.geometry`. The two TSDocs contradict each other from the consumer's perspective:

- `packages/core/src/mesh/factories/cube.ts:105` — *"The geometry is owned by this mesh; share via cubeGeometry + mesh.create when one cube must back multiple meshes."*
- `packages/core/src/mesh/mesh.ts:67-69` — *"Does **not** destroy `mesh.geometry` or `mesh.material` — both may be shared with other meshes. Call `mesh.destroyGeometry` and `material.destroy` separately when those resources have no other owners."*

A consumer reading the factory doc reasonably concludes `mesh.destroy(cube)` cleans up everything. A consumer reading the mesh-destroy doc knows they have to call `destroyGeometry` separately. The factory doc creates a false expectation that the destroy contract then violates.

**Observed today — consumer-visible leak in every demo using the factory.** The Tranche B cascade fix restored the leak-warn signal to consumer-only leaks. Manual testing of the cookbook camera demo on 2026-05-27 surfaced `[furnace/gpu] context disposed with resources still registered — leak suspected { remaining: 6 }` because the demo destroys the mesh + material but never the factory-allocated geometry. The user's leak signal is correctly identifying a real leak that the engine API made too easy to introduce.

**Affected cookbook demos (every one using the factory):**

| Demo | Factory calls | Leaked geometries |
|---|---|---|
| `camera/entry.ts:95-96` | `mesh.cube` + `mesh.plane` | 2 |
| `post/entry.ts:125` | `mesh.cube` | 1 |
| `input/entry.ts:70` | `mesh.cube` | 1 |
| `animation/entry.ts:90-92` | `mesh.cube` × 3 | 3 |
| `render-target/entry.ts:208,217,227` | `mesh.cube` × 2 + `mesh.plane` | 3 |
| `blend/entry.ts:142,171,211,239,240` | `mesh.plane` × 4 + `mesh.cube` | 5+ |
| `shader/entry.ts:102-103` | `mesh.cube` + `mesh.plane` | 2 |

Only `geometry/` and `custom-stats/` demos use the explicit `mesh.createGeometry(...)` flow and clean up correctly.

## Design options for the engine fix

Three shapes worth brainstorming. None of these are this entry's recommendation — they need a dedicated session.

### Option A — Factory returns `{ mesh, geometry }`

```ts
const { mesh: cube, geometry: cubeGeo } = mesh.cube(ctx, { material });
// later:
mesh.destroy(cube);
mesh.destroyGeometry(cubeGeo);
```

**Pro:** The factory's "owned by this mesh" claim becomes literally true. Destroy pair is explicit; nothing hidden.
**Con:** Breaking change to every call site. All demos must migrate. The convenience-factory ergonomic win shrinks (now you destructure + destroy two things).

### Option B — `mesh.destroy(handle, { destroyOwnedGeometry?: boolean })`

```ts
const cube = mesh.cube(ctx, { material });
// later:
mesh.destroy(cube, { destroyOwnedGeometry: true });
```

**Pro:** Additive, opt-in. Existing consumers who explicitly destroy their geometry don't have to change.
**Con:** Consumers still have to know — the API surface still hides the trap, just with an opt-out lever. Doesn't solve the discovery problem.

### Option C — Factory-created meshes track ownership; `mesh.destroy` cascades automatically

```ts
const cube = mesh.cube(ctx, { material });
// later:
mesh.destroy(cube);  // engine knows the geometry was factory-allocated and destroys it.
```

**Pro:** Principle of least surprise. The factory's "owned by this mesh" claim becomes literally true via runtime behavior.
**Con:** Engine carries hidden ownership state on the Mesh (an `_ownsGeometry` flag or similar). Sharing patterns get tricky: if a consumer does `cubeGeometry(ctx) + mesh.create({ geometry, material })`, no auto-destroy; if they use `mesh.cube`, auto-destroy. Two flow shapes with different lifetime semantics for the same `Mesh` type.

### Hybrid — keep convenience factory but deprecate as "examples-only"

Document the factories explicitly as "convenience for examples and tests; real consumers should use the explicit `cubeGeometry + create` flow which makes ownership obvious." Update factory TSDoc to say "the caller still owns the geometry and must call `destroyGeometry` on teardown" (removing the misleading "owned by this mesh" line). No code change to the engine; just documentation truth-telling.

## Recommendation pre-brainstorm

Option A — explicit return + explicit destroy. The brittleness of options B and C (consumer still has to know, or engine carries hidden state) outweighs the convenience-factory ergonomic loss. The `{ mesh, geometry }` shape is honest about what the factory does. Migration cost is mechanical across the 7 affected demos.

But this is a brainstorm decision — confirm in the B-1 session.

## Scope of Tranche B-1

1. Brainstorm + decide which option (A/B/C/hybrid).
2. Update factory implementation + TSDoc + `mesh.destroy` TSDoc to remove the contradiction.
3. Migrate all 7 affected cookbook demos to the new shape (both setup and dispose paths, including catch arms).
4. Add a regression test: run a demo's dispose, assert no leak warn (mirrors the Tranche B `resource-leak-warning.gpu.test.ts` integration tests but for a real cookbook-style consumer flow).
5. Update `engine-conventions.md` §Drawables to document the resolved ownership semantic.

## Trigger to revisit

**Active now.** Surfaced 2026-05-27 by user testing the camera demo after Tranche B shipped. Consumer-visible leak warn fires on every demo unload. Want to land this before the cookbook gets more uses of the factory.

## Reference

- Companion to `docs/backlog/_AUDIT-2026-05-26.md` §9.2 (consumer disposal bag) — both findings live in the same "consumer-side teardown ergonomics" territory. The disposal-bag approach would also surface this leak loudly via developer ergonomics; Tranche B-1 addresses the root API contradiction directly.
- The Tranche B fix (`docs/superpowers/specs/2026-05-27-tranche-b-cascade-teardown-design.md`) restored the leak-warn signal that exposed this latent bug. Tranche B-1 is the consumer-side complement.
