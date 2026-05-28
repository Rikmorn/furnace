# `validateEffects` should return resolved slots (consistency with `validateDraw`)

Task 4.1 (2026-05-28) tightened `frame.render`'s draw path: `validateDraw` now returns a `ResolvedDraw[]` triple (mesh + material + geometry slots resolved once), and the per-draw render loop consumes those slots without re-looking-up.

`validateEffects` was NOT migrated in the same way. After Task 4.1, the post pass still has the pattern:

```ts
// packages/core/src/frame/render.ts
validateEffects(ctx, effects);            // calls _lookupEffect per effect, throws on null

for (const effect of effects) {
  renderEffectPass(ctx, effect, ...);     // calls _resolveEffect(ctx, effect) AGAIN
}
```

The second `_resolveEffect` call is redundant — `validateEffects` already proved the handle resolves. Same wasted-lookup pattern that `validateDraw` had pre-Task-4.1.

## Fix shape

Mirror `ResolvedDraw`:

```ts
type ResolvedEffect = { effect: EffectSlot };

function validateEffects(ctx: Context, effects: readonly Effect[]): ResolvedEffect[] {
  // ...lookup + throw...; push resolved slot
}
```

Then `renderEffectPass` takes `EffectSlot` directly. Removes the `_resolveEffect` call inside the loop.

For symmetry consider whether `ResolvedEffect` is just `EffectSlot` (no wrapper struct needed unless additional fields are surfaced) — single-field wrappers are unnecessary.

## What to verify when fixing

- `bun test packages/core/tests/frame/` — green, especially `frame-render-with-effects.gpu.test.ts`.
- `bun run check`, `bunx tsc --noEmit -p packages/core/tsconfig.json` — clean.
- No `_resolveEffect` calls remain inside the post-pass loop body.
- Error messages in `validateEffects` still carry the `effects[${i}]:` prefix.

## Trigger to revisit

- Next frame-module hygiene tranche, OR
- When a fourth lookup-and-throw branch is added (third-occurrence threshold reached).

**Reference:** Surfaced during Task 4.1 (`docs/superpowers/plans/2026-05-28-resource-manager-plan.md` Session 4) on 2026-05-28. Implementation site: `packages/core/src/frame/render.ts` `validateEffects` (~line 289) and `renderEffectPass` (~line 369).
