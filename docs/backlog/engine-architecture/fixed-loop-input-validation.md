# `fixedLoop` does not validate `fixedDtMs > 0` (setup-loud gap)

*Tranche A-3 candidate (engine API hygiene).*

`packages/core/src/frame/fixed-loop.ts` accepts `opts.fixedDtMs: number` and feeds it directly into the catchup-tick accumulator without validation. Three pathological inputs are not guarded:

| Input | Symptom |
|---|---|
| `fixedDtMs = 0` | Inner `while (accumulator >= fixedDtMs)` loop never decrements; **infinite loop** on first frame. Browser tab hangs. |
| `fixedDtMs < 0` | `accumulator >= fixedDtMs` is always true; same infinite-loop symptom unless `maxCatchupTicks` cuts it off (still wastes a frame). |
| `fixedDtMs = NaN` | `alpha = accumulator / fixedDtMs` → `NaN`. Poisons every subsequent `onFrame({ alpha })` call. Consumer interpolation breaks silently. |

The engine elsewhere follows the "setup-loud / runtime-quiet" failure policy (`docs/reference/engine-conventions.md` §"Failure policy"): synchronous validation throws on bad input at setup; runtime-quiet handlers skip silently. `fixedLoop` only does the runtime half (`maxCatchupTicks` spiral-of-death guard), not the setup half.

This is a real footgun — a consumer typo (`fixedDtMs: 0` instead of `fixedDtMs: 16.67`) hangs the browser tab with no diagnostic.

## Fix

Add setup-loud validation at the top of `fixedLoop`:

```ts
export function fixedLoop(ctx: Context, opts: FixedLoopOptions): FrameLoopHandle {
  if (!Number.isFinite(opts.fixedDtMs) || opts.fixedDtMs <= 0) {
    throw new FurnaceError(
      `fixedLoop: fixedDtMs must be a positive finite number, got ${opts.fixedDtMs}`
    );
  }
  if (opts.maxCatchupTicks !== undefined && (!Number.isInteger(opts.maxCatchupTicks) || opts.maxCatchupTicks < 1)) {
    throw new FurnaceError(
      `fixedLoop: maxCatchupTicks must be a positive integer if provided, got ${opts.maxCatchupTicks}`
    );
  }
  // ... existing implementation
}
```

Update `fixedLoop`'s TSDoc (`frame/fixed-loop.ts`) to add a `@throws FurnaceError` clause for the new validations. Match the cite-format convention (`engine-conventions.md §"Failure policy"`).

Add a unit test covering each pathological input.

## What to verify when fixing

- `fixedLoop(ctx, { fixedDtMs: 0, onTick: () => {} })` throws `FurnaceError` synchronously (not on first RAF tick).
- `fixedLoop(ctx, { fixedDtMs: -1, onTick: () => {} })` throws.
- `fixedLoop(ctx, { fixedDtMs: NaN, onTick: () => {} })` throws.
- `fixedLoop(ctx, { fixedDtMs: Infinity, onTick: () => {} })` throws.
- Valid call sites (existing tests, cookbook demos) still work unchanged.
- TSDoc `@throws` clause matches the new validation conditions.

**Trigger to revisit:** Next engine API hygiene tranche (A-3), OR when a consumer reports a browser hang traced to `fixedLoop`.

**Reference:** Surfaced during Tranche A-1 (T8 frame module TSDoc work), 2026-05-26. The TSDoc landed without documenting `fixedDtMs` validation because none exists in code — but the absence is the bug.
