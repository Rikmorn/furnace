# Cookbook: extract a shared `tryWithCleanup` helper for the dispose / catch-arm pattern

*Cookbook hygiene tranche candidate. Surfaced during Resource Manager Stage 2 closeout (2026-05-28).*

Every cookbook demo's setup follows the same shape:

```ts
setup: async (ctx) => {
  let cube: Mesh | undefined;
  let cubeGeo: Geometry | undefined;
  let mat: Material | undefined;
  try {
    mat = await material.normalColor(ctx);
    cubeGeo = mesh.cubeGeometry(ctx);
    cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    // ... more allocations ...

    const sceneCube = cube;             // narrow undefined away for the closure
    const sceneCubeGeo = cubeGeo;
    const sceneMat = mat;

    return {
      scene: { cube: sceneCube, ... },
      frame: ({ ctx, scene }) => { ... },
      dispose: () => {                  // success-path teardown
        mesh.destroy(ctx, sceneCube);
        mesh.destroyGeometry(ctx, sceneCubeGeo);
        material.destroy(ctx, sceneMat);
      },
    };
  } catch (e) {                          // failure-path teardown
    if (cube) mesh.destroy(ctx, cube);
    if (cubeGeo) mesh.destroyGeometry(ctx, cubeGeo);
    if (mat) material.destroy(ctx, mat);
    throw e;
  }
}
```

The success-path `dispose` and the catch-arm cleanup are nearly identical — they tear down the same set of resources in (roughly) the same order. The catch arm needs `if` guards because the `let`-bindings are `T | undefined`; the dispose closure doesn't because it operates on the post-success narrowed aliases.

This pattern duplicates across **8 demos** (animation, blend, camera, geometry, input, post, render-target, shader) — well past clean-code.md's third-occurrence rule. The duplication wasn't introduced by Stage 2; it was visible across every per-demo migration reviewer pass.

## Why it surfaced now

Stage 2's per-demo migration touched every dispose AND catch-arm body — 30+ resource destroys × 2 paths in some demos. Each migration commit roughly doubled the diff size because the migration had to be applied symmetrically. The duplication became impossible to miss.

## Fix shape (sketch — confirm during the tranche)

A `tryWithCleanup` helper in `packages/cookbook/src/shared/` that takes:
- An async `build(ctx) → { resources, scene, frame, dispose }` function
- A `cleanup(ctx, partialResources) → void` function that handles the catch arm

The helper:
1. Calls `build(ctx)` inside try/catch
2. On success, returns the mountDemo shape (scene + frame + dispose), with the helper's own dispose wrapping the user's
3. On catch, calls `cleanup(ctx, partialResources)` with whatever was constructed before the throw, then re-throws

This removes the catch-arm boilerplate from every demo. The `let` + `if`-guard pattern moves into one well-tested helper.

Alternative shape — **dispose-bag pattern** (mentioned in §9.2 of the Stage 2 spec as out-of-scope for that tranche):
- `resources.disposeBag(ctx)` returns a bag object with `add(handle)` and `disposeAll()`
- The demo's setup adds each allocated handle to the bag immediately
- Both success-dispose and catch-arm just call `bag.disposeAll()` — one path, one ordering
- Stage 1's refcount machinery handles destroy-order automatically; the bag just needs the set of handles

The dispose-bag approach is cleaner — it eliminates the dispose/catch divergence entirely. But it needs a small engine-side helper (or could be cookbook-side using `resources.summary`-style introspection). Worth comparing both shapes during the tranche brainstorm.

## Trade-offs

- **Pro:** Removes 8 occurrences of a ~5-15 line duplication. Future cookbook demos get the shape for free.
- **Pro:** Centralizes the catch-arm teardown logic — easier to test, easier to audit when the engine's destroy semantics change.
- **Con:** Adds a cookbook-shared abstraction. The current pattern is verbose but local; the helper-based pattern is concise but reads through indirection.
- **Con:** Demos serve as cookbook examples — readers learn from copying them. A helper-based pattern means readers must also learn the helper, which is one more concept.

The con about pedagogy is real but probably outweighed: the dispose pattern is so boilerplate at this point that it's NOT what readers should be learning from. Demos should teach the engine feature they're showcasing, not the dispose plumbing.

## What to verify when fixing

- All 8 demos migrate to the helper (or the dispose-bag pattern).
- Per-demo line count drops measurably; cookbook total LoC drops.
- `bun run typecheck` + `bun test` + `bun run check` all pass.
- Playwright sweep on all 9 demos: zero new console errors.
- Custom-stats stress test: same 5200/5200 spawn/despawn symmetry under churn.

## Trigger to revisit

- After A-6 (Type/API surface hygiene) — the engine-side hygiene work may surface helper-shape constraints that affect this tranche.
- OR when a 9th cookbook demo is added and the temptation to copy the existing dispose/catch pattern is too obvious to ignore.
- OR if a cookbook-shared cleanup decision is needed for the dispose-bag question regardless of demo count.

**Reference:** Surfaced 2026-05-28 during Resource Manager Stage 2 migration (commit `c945c8a` and earlier). Stage 2 closeout doc enumerates the per-demo occurrence: `docs/superpowers/plans/handoffs/2026-05-28-resource-manager-stage-2-closeout.md` §"Discoveries / learnings" #4.
