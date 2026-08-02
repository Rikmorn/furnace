# `useCatalogs` carries a second, narrower severity vocabulary

`NotifySeverity` (`lib/notify-store.ts:21`) is the editor's severity type:
`"info" | "success" | "warn" | "error"`, and every toast and log entry is one of those four.

`hooks/useCatalogs.tsx:83` declares a second one:

```ts
type Report = { severity: "info" | "error"; text: string };
```

with its own constructors (`info`, `bad`) and its own dispatch (`post`, an
error-else-info branch onto `notify`). It is a real design choice rather than an accident —
the three catalog loaders run concurrently and the ORDER their outcomes are said in is the
caller's decision, so an outcome has to be CARRIED rather than posted, and carrying it needs
a type. The comment above it says exactly that.

What makes it worth tracking is that it is **a second producer writing the same log through
a narrower alphabet**, and its `post` is a hand-written two-way branch over a four-member
union. The day a catalog outcome wants `warn` — a partial catalog, a stale table, an entity
archetype that resolved but is unusable — the branch silently downgrades it to `info`,
because that is what `else` means here.

## Context

This is the likely home of the "second caller" that `notify-severity-has-no-warn-member.md`
anticipated before it was retired. F4.5c Task 1 added `warn` to `NotifySeverity` and rerouted
the advisor-idle message onto it; that entry was deleted as resolved, and this datum went
with it. It lives here now so the deletion did not lose it.

The fix when it is needed is small and reductive: carry `NotifySeverity` in `Report` and
make `post` a lookup rather than a branch (`notify[report.severity](report.text)` — the store
already exposes one method per member). Not done now because at two members the branch is
correct, and widening a type nothing widens is speculative surface.

## Trigger to revisit

Any `useCatalogs` report that wants `warn` (or `success`) — at that moment the two
vocabularies must merge rather than the narrow one grow a third member. A third private
`severity` union appearing anywhere in `src/frontend` is the same signal.

## Reference

- `packages/editor/src/frontend/hooks/useCatalogs.tsx:81-89` — the `Report` type, its two
  constructors, and `post`.
- `packages/editor/src/frontend/lib/notify-store.ts:21` — `NotifySeverity`, and the store's
  per-severity methods a lookup would use.
