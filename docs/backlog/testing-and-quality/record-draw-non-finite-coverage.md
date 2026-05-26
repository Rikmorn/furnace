# `_recordDraw` guard: NaN/Infinity coverage gap

Surfaced during Tranche C T6+T7 code review. The guard in `packages/core/src/stats/internal.ts` (`_recordDraw`) is:

```ts
if (!Number.isFinite(info.triangles) || info.triangles < 0) {
  warn("stats", "_recordDraw: triangles must be finite and non-negative", { value: info.triangles });
  return;
}
```

The bad-input test in `packages/core/tests/stats/internal-gpu-hooks.test.ts` only exercises the negative arm (`triangles: -3`). The non-finite arm (`NaN`, `Infinity`, `-Infinity`) is the other half of the predicate and has no test.

**Trigger to revisit:** Next time `_recordDraw` or similar `Number.isFinite` guards are touched, OR during a broader pass to audit non-finite handling across stats guards.

**Reference:** Tranche C T6+T7 code review (commit `afe1d63`).
