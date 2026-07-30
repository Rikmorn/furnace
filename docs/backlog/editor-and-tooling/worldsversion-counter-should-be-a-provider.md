# `worldsVersion` rides `EditorContextValue` as a counter the drawer must mirror

`hooks/useDaemonFeed.ts` reduces the daemon's SSE feed to a number: a counter bumped on
every `worlds-changed` / `generation-baked` event. App puts that number on
`EditorContextValue.worldsVersion`, and `shell/WorldDrawer.tsx` reads it out of the editor
context and refetches `world.list` whenever it changes.

That works, and the counter-not-payload choice is right (the events are notification-only
dirty bits). The awkward part is the **route**: a value produced by a hook and consumed by
exactly one component travels through the editor context, which is otherwise the
App-owned-things channel — the host ref, the confirm seam, the persistence store. Two
costs follow:

1. **The wiring is mirror-pinned.** Nothing about `worldsVersion` is observable from the
   drawer's own module, so the "counter reaches the context reaches the drawer" chain is
   held together by a test that asserts the shape of the mirror rather than the behaviour.
   A refactor that renames or re-routes it passes typecheck and fails the pin for reasons
   that read as test churn.
2. **It widens the context for one consumer.** `EditorContextValue` is read by every part
   of the chrome; a field only the drawer wants is surface everyone carries.

The shape that removes both: make the daemon feed a **provider** (`WorldsFeedProvider` or
fold it into the existing `WorldProvider`, which already owns everything else about
worlds), have the drawer read it directly, and **delete `worldsVersion` from
`EditorContextValue`**. The provider stack the shell already builds is the natural home —
this is the same move Task 8 made for the world verbs and Task 9 for the view state.

Not done at F4.5a because the counter works and the slice's provider budget went to the
seams that were actively wrong. Filed rather than fixed so the next context edit does not
re-derive the argument.

**Trigger to revisit:** F4.5b's registry work touches `EditorContextValue` (it will — the
command registry needs a home), or the mirror pin bites during an unrelated refactor.

**Reference:** `packages/editor/src/frontend/hooks/useDaemonFeed.ts`,
`packages/editor/src/frontend/components/editor-context.ts` (`worldsVersion`'s docblock),
`packages/editor/src/frontend/components/shell/WorldDrawer.tsx`;
`docs/reference/editor-architecture.md` §20.8.
