# FieldHost hard-wires its worker client, so every worker-backed path is untestable headlessly

**Context.** `createFieldHost()` takes no arguments and constructs its own
`new FieldWorkerClient()` (`packages/editor/src/viewport-host/field-host.ts`). The client
itself HAS an injection seam — `constructor(private readonly spawn = defaultSpawn)` — but
the host never exposes it, so a test cannot see what the host asks the worker for.

That makes a whole class of host behaviour unobservable in `bun test`. It bit F3b Task 12
(the void cast): the enable path's context guard (`if (!ctx) return` before firing the cast
job) cannot be covered, because a real spawn of the browser's `/field-worker.js` inside bun
neither resolves nor rejects — it simply hangs, so removing the guard is INVISIBLE to a
test. The Task 12 test was narrowed to the claim it could actually make (the enable path is
synchronous-exception-free without a context) after the wider version survived sabotage.
The same blind spot covers: the request the host builds (chunk set, cellSize), the
generation guard that strands a superseded job, remesh coalescing, and every response
handler.

It bit the same task a second time, harder. Spec review found that
`markDirtyWithNeighbors` also runs with an EMPTY dirty set — a pure scatter writes no
cells — so the cast was torn down, with a "the field changed" message, on the commit of a
stamp that could not have staled it. The fix is a one-line `if (changed.size === 0)
return;`, and **deleting that line again fails nothing**: 502 pass / 0 fail across the
whole editor suite, because the only observable is a cast that headless tests can never
bring into existence. A real regression on the headline F3b workflow is presently held by
code review alone.

The plausible seam is a single optional argument — `createFieldHost(deps?: { spawnWorker?:
() => WorkerLike })` threaded into the client — but `WorkerLike` is private to
`field-client.ts`, three test files plus the production panel call the factory, and "should
the host expose a DI seam at all, or should these paths be gated visually" is a real
design call rather than a mechanical change. That is why Task 12 filed it instead of
adding it mid-tranche.

**Trigger to revisit:** the next task that needs to assert on what the host SENDS the
worker (rather than on what a handler does with a request) — or the next time a
worker-backed host bug ships because the only gate for it was visual.

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`createFieldHost`'s
`const worker = new FieldWorkerClient()`; `requestVoidCast`'s context guard);
`packages/editor/src/frontend/lib/field-client.ts` (the `spawn` seam that already exists);
`packages/editor/tests/field-host-headless.test.ts` (the narrowed void-cast test and its
comment).
