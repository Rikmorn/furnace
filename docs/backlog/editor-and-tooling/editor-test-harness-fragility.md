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

**Reference:** `packages/editor/tests/server.test.ts:189` (the test),
`packages/editor/src/daemon/watch.ts` + `src/daemon/events.ts` + `src/daemon/session.ts` (the
file watcher, SSE feed, and session store it exercises),
`docs/reference/editor-architecture.md` (SSE change feed + file watching).

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
