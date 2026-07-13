# Flaky daemon test: `session lifecycle over HTTP with a live SSE feed + watcher reload`

**Context.** Surfaced during the W4 execution. `packages/editor`'s daemon test
**`session lifecycle over HTTP with a live SSE feed + watcher reload`** is FLAKY: it timed
out (15 s) once in five full-suite runs, and passed the other four.

It is **not caused by any W4 change** — W4 touched no daemon code path this test exercises
(the sweep was dungeon generators + the editor's wing session model; the daemon's SSE feed
and file watcher were untouched).

The consequence matters more than the test: the suite reports 0 fail, but it is **not
deterministically green**. Anyone treating a single green run as proof of a change's safety
is relying on a coin-flip they don't know they're flipping. Most likely a race between the
watcher's debounce and the SSE subscriber attaching, or a real-filesystem timing assumption —
but that is a hypothesis, not a diagnosis; nobody has instrumented it.

**Trigger to revisit:** the next time the daemon's SSE/watcher code is touched, or the first
time it fails in CI (whichever is first). Diagnose it then rather than raising the timeout —
a timeout bump hides the race instead of resolving it.

**Reference:** `packages/editor/tests/server.test.ts:189` (the test),
`packages/editor/src/daemon/watch.ts` + `src/daemon/events.ts` + `src/daemon/session.ts` (the
file watcher, SSE feed, and session store it exercises),
`docs/reference/editor-architecture.md` (SSE change feed + file watching).
