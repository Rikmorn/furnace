# Editor test harness — fragility and coverage reach

Tracker for what the editor's `bun test` harness cannot currently do deterministically or
at all: single-process global-state collisions between the DOM / GPU / daemon test
families, one flaky daemon test, and the coverage boundary the FieldHost worker seam moved
but did not erase. Merged so there is **one place to check whenever a test-ordering or
environment failure appears in `packages/editor/tests/`**. Sections keep their original
content.

## bun test single-process fragility: DOM (happy-dom) vs GPU tests interleave badly

**Context.** `bun test` runs all editor test files in ONE shared process and walks
top-level `tests/*.ts` files before `tests/<subdir>/*`. The happy-dom harness
(`tests/inspector/_register.ts` → `GlobalRegistrator.register()`) mutates
process-global state, which collides with two other test families:

1. **Global `fetch` pollution.** A happy-dom-registering test (or a full `<App/>`
   render / `mock.module` of the frontend `api.ts`) placed in BARE `tests/`
   breaks the daemon HTTP suites (`server.test.ts`, `project-assets.test.ts`)
   that run later in the same process. (Surfaced in Slice 3.2.2 Task 5.)
2. **`navigator.gpu` clobber.** happy-dom installs a `navigator` with no `.gpu`.
   If a happy-dom test runs BEFORE a `*.gpu.test.ts` (which top-level files do,
   by file-walk order), every later GPU test throws "WebGPU unavailable".
   (Surfaced in Slice 3.2.2 Task 7 — 13 GPU failures until the DOM test was
   moved from `tests/theme.test.ts` into `tests/inspector/`.)

**Current mitigation (convention, not enforced):** every DOM/happy-dom test lives
in a `tests/` SUBDIR (`tests/inspector/`, `tests/chrome/`), never bare `tests/`,
so it sorts AFTER the top-level `*.gpu.test.ts` and the daemon HTTP suites in the
file walk. This works today but is fragile — it relies on alphabetical file-walk
ordering and a placement comment, and a new bare-`tests/` DOM file silently
reintroduces either failure.

3. **Radix PORTAL content does not render unless a `tests/inspector/` file ran
   first.** Found in F3a Task 8 (2026-07-22). `bun test` from the repo root is
   green, but a narrower invocation is not: `bun test packages/editor/tests/chrome/`
   fails 10/45 — every assertion that queries menu or dialog CONTENT
   (`menubar.test.tsx` 6, `confirm-dialog.test.tsx` 3, `view-flags` 1). The
   trigger element itself flips correctly (`data-state="open"`,
   `aria-expanded="true"`); the portalled content is simply absent from the DOM.
   It is NOT a first-file-in-process effect: `menubar` + `confirm-dialog`
   together still fail both. It IS fixed by running certain inspector files
   first — `color-field`, `entities-panel`, `number-field`, `scrub-affordance`
   and `vec-field` each make `confirm-dialog` pass, while `boolean-field`,
   `inspect-panel`, `object-field` and `schema-form-mixed` do not. Root cause not
   identified (suspect a happy-dom global some component touches lazily). The
   practical cost today: any NEW chrome behaviour built on a Radix portal is
   untestable in a single-file run, which is how a task-scoped gate is usually
   run — F3a Task 8 chose three inline row buttons over the planned ⋯ dropdown
   for exactly this reason.

**A real fix worth designing when this bites again:** isolate the environments —
e.g. a separate `bun test` invocation (or bunfig test project) for DOM tests vs
GPU tests vs daemon tests, so global state can't leak across families; or a
per-file teardown that unregisters happy-dom. Either removes the ordering
dependency entirely.

**Trigger to revisit:** the next time a DOM+GPU or DOM+daemon test-ordering
failure appears, or when the suite grows enough DOM tests that the subdir
convention becomes unwieldy. Not urgent — the convention holds for now.

**Reference:** `packages/editor/tests/inspector/_register.ts`; placement comments
in `tests/inspector/theme.test.ts` and `tests/chrome/*`; surfaced in Slice 3.2.2
Tasks 5 and 7.

## Flaky daemon test: `session lifecycle over HTTP with a live SSE feed + watcher reload`

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

**2026-07-30 — trigger fired (F4.5a Task 12), NO reproduction, and the hypothesis is half
refuted.** 31 runs, every one green: 10× `server.test.ts` alone (~550 ms each), 6× the same
file 3-way parallel, 10× `bundle-watch.test.ts` alone (~96 ms each), 5× the whole editor
suite (686 tests, ~11 s each). No fix applied — a speculative fix to a test nobody can make
fail is worse than the flake. What the reading DID settle:

- **The SSE half of the filed hypothesis cannot happen.** `createEventHub.subscribe()` does
  `writeHead` → `write(": connected")` → `subscribers.add(res)` in ONE synchronous block, so
  a client whose `fetch` has resolved (headers received) is necessarily already in the
  subscriber set. No event emitted after that point can be missed by an attaching subscriber.
- **The watcher half STANDS — and it predicts the observed 15 s timing on the named test.**
  `chokidarWatchFile` (`daemon/watch.ts`) starts its watch with `ignoreInitial: true` and
  nothing awaits chokidar's `ready`, so a `writeFileSync` landing before the watch is armed
  is silently missed. What happens next is the part worth writing down, because the number
  it produces is not the one the code reads as: `readSse` (`server.test.ts:159-172`)
  consults its deadline only at the TOP of the loop, and `await reader.read()` carries no
  timeout of its own — so on a silent stream the read simply blocks past the 8 s deadline.
  The next byte to arrive is the hub's own heartbeat (`HEARTBEAT_MS = 15_000`,
  `events.ts:4`, armed by `createEventHub()` at `server.ts:166` — i.e. at server start,
  which in this test is milliseconds after the test begins). That wakes the read at
  ≈15.0 s, the predicate fails, the loop condition is now false, and the deadline throw
  lands. **A missed watcher event therefore fails `server.test.ts:189` at ≈15,00x ms** —
  exactly the reported figure, on exactly the originally-named test.
- **An earlier revision of this entry argued the 15 s figure could not come from this test.
  That was wrong, and worth keeping as the correction it is.** The argument rested on
  "15005 ms" implying a 15 s test BUDGET (this test declares 20 s), and on
  `bundle-watch.test.ts:50` being the only 15 s budget in the package. Bun prints ELAPSED
  time on every fail line whatever the budget — probe-confirmed: a test with a 20 s budget
  failing at 1.5 s prints `[1516.83ms]` — so the figure never implied a budget at all, and
  the exclusivity argument dissolves with it. `bundle-watch.test.ts:50` remains a SECONDARY
  candidate on its own merits (its `read` → `fire()` → `read` shape would deadlock if the
  `": connected"` preamble ever failed to flush); it went 10/10 green here too. Provenance
  note for whoever picks this up: the "15005 ms" figure comes from a session message, not
  from a durable artifact — no log survives.

**Reference:** `packages/editor/tests/server.test.ts:189` (the test),
`packages/editor/src/daemon/watch.ts` + `src/daemon/events.ts` + `src/daemon/session.ts` (the
file watcher, SSE feed, and session store it exercises),
`docs/reference/editor-architecture.md` (SSE change feed + file watching).

## `readSse`'s `timeoutMs` is not honoured on a silent stream

**Context.** Surfaced 2026-07-30 while diagnosing the flake above. `readSse`
(`packages/editor/tests/server.test.ts:160-173`) takes a `timeoutMs` (default 8 s) and
reads as though it bounds the wait. It does not: the deadline is consulted only at the top
of the `while`, and `await state.reader.read()` has no timeout of its own. On a stream that
goes quiet the helper blocks INSIDE the read, indefinitely as far as its own logic is
concerned — the parameter bounds only how many further reads it will attempt, never the
one it is sitting in.

What hides this today is the daemon's SSE heartbeat (`HEARTBEAT_MS = 15_000`,
`daemon/events.ts:4`): every 15 s a `: ping` frame wakes the read, the predicate fails, and
the now-expired deadline throws. So the failure mode is not a hang but a ~15 s failure
whose message ("SSE timeout; buffer so far:") names an 8 s timeout — which is precisely how
the flake above got mis-attributed once already. Two consequences worth naming: any test
using this helper has a real floor of one heartbeat interval, not `timeoutMs`; and if the
heartbeat is ever removed, shortened, or made per-subscriber, these tests stop failing in
15 s and start hanging to the test budget instead.

**The fix when it is worth doing:** race the read against a timer
(`Promise.race([state.reader.read(), timeout])`) and cancel the reader on expiry, so the
helper fails at the deadline it advertises and with a message that is true.

**Trigger to revisit:** the flake above being diagnosed for real (this helper is the
instrument that would measure it, and a lying instrument is the wrong place to start), or
any change to the heartbeat. Not urgent on its own — no test is currently WRONG because of
it, they are only slower and vaguer than they claim.

**Reference:** `packages/editor/tests/server.test.ts:160-173` (the helper),
`packages/editor/src/daemon/events.ts:4` (the heartbeat that masks it).

## FieldHost's worker seam exists now — what host coverage still cannot reach is a stamp session

**Status: mostly CLOSED by F3b Task 12.** `createFieldHost({ spawnWorker })` now takes the
seam (`packages/editor/src/viewport-host/field-host.ts`), threaded into
`FieldWorkerClient`'s existing `spawn` argument, and
`packages/editor/tests/field-host-void-cast.gpu.test.ts` uses it to drive the whole loop —
request → the real protocol handler in-process → response → `applyVoidCast` against a
bun-webgpu device. Now pinned: the request the host BUILDS (chunk set, cellSize), the
density COPY contract (the fake worker detaches transferred buffers exactly as a real one
does, so sending the store's live buffers fails the next cast), the response path, the
in-flight refusal, and the empty-dirty-set guard that spec review found missing.

Two corrections to what this entry first claimed, both worth remembering:

- **DI was never the whole answer.** `requestVoidCast` returns at its `!ctx` guard BEFORE
  it sends anything, so the binding constraint on host-side coverage is the **GPU
  context** — and that harness already existed (`core/tests/_helpers/gpu-fixture.ts` +
  `installMockResizeObserver` + rAF/canvas shims), already used by the sibling
  `preview-host.gpu.test.ts` in the same directory. The first revision of this entry
  blamed the seam for an uncovered `markDirtyWithNeighbors` guard; wrong diagnosis, and
  that guard is now covered.
- **What forced the seam anyway** is that a job posted to a `Worker` spawned from the
  browser's `/field-worker.js` never settles under `bun test` — measured repeatedly, still
  pending after 1 s — so with a real worker nothing downstream of the request ever runs,
  and the response path could not be covered at all.

  A retracted claim, kept because it cost a review round: an earlier revision of this entry
  (and of `createFieldHost`'s TSDoc) stated that terminating such a Worker **panics the Bun
  runtime**. A genuine `panic: unhandled exception` with a bun.report URL was observed once,
  on Bun 1.3.14 / macOS, from a GPU test that spawned a real worker and then disposed the
  host — and it does not reproduce: 10/10 clean on the identical file afterwards, and code
  review could not reproduce it in five configurations. Treat it as an unexplained one-off,
  not a mechanism. (The first attempt to re-verify it "reproduced" 5/5 — by grepping for
  `panic` and matching the probe file's own NAME. Grep the panic banner, not the word.)

**What is still out of reach.** Anything behind a stamp SESSION: `startStamp` needs a
selection, which needs pointer gestures on a canvas whose listeners the GPU fixture stubs
out. So `commitStamp`, `applyReconfigure`, and the preview coalescer's latch remain gated
on review plus the Safari gate — and with them the one void-cast case a test still cannot
reach: a cast surviving a REAL scatter commit, rather than the empty-dirty-set entry point
(`undo` with nothing to undo) that stands in for it today.

**Trigger to revisit:** the first task that needs to assert on a stamp session end to end.
That needs synthetic pointer events or a host-level gesture seam — a bigger design call
than this one turned out to be.

**Reference:** `packages/editor/tests/field-host-void-cast.gpu.test.ts` (the harness, and
its comments on why the worker is injected); `packages/editor/src/viewport-host/field-host.ts`
(`createFieldHost`'s `deps` parameter); `packages/editor/tests/preview-host.gpu.test.ts`
(prior art for the GPU fixture).
