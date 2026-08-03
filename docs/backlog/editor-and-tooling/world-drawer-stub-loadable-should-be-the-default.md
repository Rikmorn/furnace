# `stubDaemon`'s `loadable` should be the default, not an opt-in

`tests/chrome/world-drawer.test.tsx` fakes the daemon with a local `stubDaemon(worlds, opts)`.
Until the F4.5 holistic gate its `field.load` answered `{}` — a body that does not decode, so
`loadWorldInto` throws on `res.chunks.map` and returns `failed`. Every Open case in the file
asserts `inputFor("field.load")`, the REQUEST, which is recorded before the throw, so all of
them pass over a load that never landed. That is fine for what they test (the gate, the
filter, the confirm) and it is not fine for anything AFTER the load.

Ruling 5's automatic frame is exactly such an assertion, so the gate round added a
`loadable?: boolean` option that swaps in the smallest v2 world that decodes, and used it on
the two new cases. It was added opt-in rather than flipped because flipping the default
changes what the file's other thirty cases exercise, in the same commit that added one — and
the docblock on the option says, in bold, that **it should not stay opt-in**.

## Context

The end state is `loadable: true` by default with an explicit `loadable: false` on the cases
that genuinely want the failing load. As it stands the next person to add an assertion that
runs after the load gets a pass or a fail for the wrong reason — the load silently did not
happen — and will not have read the docblock first, because nothing makes them.

Not done in the fix round that filed this: 32 `stubDaemon` call sites in one file, each of
which has to be re-read to decide whether it wants the decode or the failure, is a
test-semantics change of its own size and not a comment fix.

The flip is mechanical but not blind. Two things to check per site: whether the case asserts
anything downstream of `loadWorldInto`'s outcome (those are the ones that change meaning),
and whether `stub.calls.loadWorld` / `frameWorld` counts appear anywhere that a now-succeeding
load would move.

## Trigger to revisit

The next time someone adds an assertion to this file that runs AFTER the load — that is the
case the current default silently answers wrong. A second `loadable: true` call site is the
same signal.

## Reference

- `packages/editor/tests/chrome/world-drawer.test.tsx` — `stubDaemon`'s `loadable` docblock
  (the self-declared trap), the `field.load` branch that reads it, and the two cases that pass
  it today (the ruling-5 frame pair at the end of the file).
- `packages/editor/src/frontend/lib/world-actions.ts` — `loadWorldInto`, whose `chunks.map`
  is what throws on the `{}` body.
- `packages/editor/src/frontend/hooks/useWorld.tsx` — the Open handler, which returns early
  unless the outcome is `loaded`; this is the branch the default currently skips.
