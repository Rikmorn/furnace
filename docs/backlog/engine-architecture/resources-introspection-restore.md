# Resources introspection restore — `list` / `snapshot`

*Filed by RM-4 on landing (2026-05-28). RM-4 deleted `resources.list` and `resources.snapshot` from the public surface because zero consumer-package call sites existed (verified during spec phase). The manager retains `_iterateLive` internally; restoration is mechanical when needed.*

## What was deleted

- `resources.summary(ctx) → ResourceSummary` — covered by `stats.snapshot(ctx).resources.*`; not restored even on trigger (use stats).
- `resources.list<H>(ctx, kind) → IterableIterator<H>` — deleted; restorable.
- `resources.snapshot(ctx) → ResourceSnapshot` — deleted; restorable.
- Types: `ResourceSummary`, `ResourceSnapshot`.

## When to revisit

When an external consumer needs live-handle iteration or per-kind handle-array snapshot for:
- A dev-tools panel that lists every live resource by kind
- Custom dispose logic that wants to walk a specific kind before scene transition
- A post-mortem dump tool that needs structured handle arrays

The trigger is "first external consumer files a concrete need," not speculative readiness.

## What to do when triggered

- Re-expose `list` and `snapshot` wrappers in `packages/core/src/resources/index.ts` over the existing `_iterateLive<unknown>(ctx, kind)` internal helper.
- Restore `ResourceSummary` / `ResourceSnapshot` type definitions.
- Add test coverage matching the consumer's use case.

Implementation is ~30 LOC; no design questions.

## Reference

- RM-4 spec: `docs/superpowers/specs/2026-05-28-resource-manager-rm4-single-writer-design.md`
- Deleted code: see git history at the RM-4 deletion commit
