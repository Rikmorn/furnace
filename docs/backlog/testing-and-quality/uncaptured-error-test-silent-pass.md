# Uncaptured-error tests silently pass on sync-throw backends

The integration tests at `packages/core/src/stats/uncaptured-errors.gpu.test.ts` and `packages/core/src/gpu/uncaptured-error.gpu.test.ts` use the same pattern: trigger an invalid pipeline, wait ~30ms, then guard assertions on `if (snapshot(ctx).gpu.uncapturedErrors > 0)`.

The risk: on a backend where `createRenderPipeline` throws synchronously (not via the `uncapturederror` event), the `if` guard is false and the test exits green having asserted nothing. The test reports "passed" but ran no assertions on the emitter, log routing, or counter behaviour.

This is a pre-existing pattern from Tranche 5 (the original `uncaptured-errors.gpu.test.ts`). Tranche C T14 inherited it for the new `gpu/uncaptured-error.gpu.test.ts`. A passing-but-unasserted test is worse than a skip because it creates false confidence.

**Fix shape:** capture whether the count incremented; if it didn't, fail with a clear message or explicitly skip. Possible approaches:

```ts
if (snap.gpu.uncapturedErrors === 0) {
  // Either: bail out with explicit "skip" message, OR fail explicitly
  // so future readers see "this backend doesn't route uncapturederror"
  // rather than a silently-passing test.
}
```

**Trigger to revisit:** When the uncaptured-error tests are touched again, OR when a bun-webgpu update changes the sync/async error path, OR when a new backend is added that exhibits sync-only behaviour.

**Reference:** Tranche C T14+T15 code review (commit `8147678`). The reviewer's suggested fix is to bail-out-or-fail explicitly rather than no-op.
