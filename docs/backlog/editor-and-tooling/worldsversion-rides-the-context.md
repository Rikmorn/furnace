---
summary: `useDaemonFeed`'s SSE counter travels through `EditorContextValue` to reach exactly one component, so the chain is held together by a mirror-shape test and every chrome consumer carries a field only the world drawer reads
---

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

**Adjudicated at the F4.5 seal (2026-08-03) — the entry STANDS, and the trigger is sharpened.**
The stated conditional resolved NEGATIVE in the way that matters: F4.5b's action registry did
NOT land on `EditorContextValue`. It got a provider of its own
(`hooks/useActionContext.tsx`), for a render-cost reason — assembling the action context reads
values that move on every drag frame, so it has to sit above the components that build palette
bodies. That is the same argument this entry makes, made independently and acted on, which
strengthens rather than weakens the case here.

`EditorContextValue` WAS widened this stage, once, by F4.5c Task 10's `ViewportFocus` — and
that one belongs there on the entry's own test: it is App/CanvasHost-owned, installed and
cleared by the component that owns the canvas element, and read by four unrelated surfaces.
`worldsVersion` still fails that test on both counts (produced by a hook, consumed by exactly
one component).

**A second reason to touch the same hook, added 2026-08-09 (foundations T4b).** The signature
is now **four positional parameters** — `useDaemonFeed(ready, bakeBusyRef, session, onRequest)`
— having taken `session: SessionFeed` for the claim and `onRequest` for the backchannel's
answerer in the same tranche. That is `clean-code.md`'s stated smell line (*"more than ~4
positional parameters is a smell"*) reached exactly, and the four are not cohesive: a boolean
gate, a ref, a handler record and a callback. It was left as-is deliberately — both tranche
commits were carrying behavioural change, and a signature churn under a behavioural diff is
what makes a review round unreadable (this entry's own standing argument).

**The agreed disposition is not a separate entry**: convert to a single options object
**whenever that signature is next touched, for any reason**. It is a mechanical change with one
call site (`App.tsx`), so it costs nothing then and is not worth a commit of its own now. A
FIFTH parameter is the hard trigger — take it in that commit rather than adding to the list.

**Trigger to revisit:** the next edit to `EditorContextValue` for any reason, the next edit to
`useDaemonFeed`'s signature, or the mirror pin biting during an unrelated refactor. Cheap to
take then — the provider stack already exists and `WorldProvider` is the natural home.

**Reference:** `packages/editor/src/frontend/hooks/useDaemonFeed.ts`,
`packages/editor/src/frontend/components/editor-context.ts` (`worldsVersion`'s docblock, and
`ViewportFocus` beside it as the contrast case),
`packages/editor/src/frontend/components/shell/WorldDrawer.tsx`,
`packages/editor/src/frontend/hooks/useActionContext.tsx` (the provider the registry took);
`docs/reference/editor-architecture.md` §16.8.
