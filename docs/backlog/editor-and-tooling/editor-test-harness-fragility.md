# Editor test harness — fragility and coverage reach

Tracker for what the editor's `bun test` harness cannot currently do deterministically or
at all: single-process global-state collisions between the DOM / GPU / daemon test
families, one flaky daemon test, the coverage boundary the FieldHost worker seam moved
but did not erase, and (T4b) a dependency whose mere construction de-optimizes the shared
process by ~3×. Merged so there is **one place to check whenever a test-ordering or
environment failure appears in `packages/editor/tests/`**. Sections keep their original
content.

## bun test single-process fragility: DOM (happy-dom) vs GPU tests interleave badly

**Context.** `bun test` runs every file the invocation covers in ONE shared process.
**Ordering is not alphabetical — an earlier revision of this entry said it was, and that was
wrong.** What is measured: a directory runs its own files before it recurses into
subdirectories (3-file probe: `mfile` → `zsub/inner` → `asub/inner`), and order *within* a
directory is deterministic but is **readdir order**, unrelated to file name (4-file probe
ran `p1, p3, p2, p4`, identical across two runs; a sibling probe had `zsub/` run before
`asub/`). **Passing files to `bun test` in a chosen order does not control this either** —
`bun test bfile cfile afile` ran `afile, cfile, bfile` on this machine, identically across
two runs (probed 2026-08-04, Task E1); two probes during this same task were initially
misread because of exactly this assumption, which is worth naming so the next person does
not repeat it. The happy-dom harness (`tests/inspector/_register.ts` →
`GlobalRegistrator.register()`) mutates process-global state, and there is **no per-file
isolation** — a marker set in one test file has been observed visible in a later one. That
absence of isolation is the actual mechanism behind everything below; the directory-walk
order only determines *which* files see the pollution.

1. **Global `fetch` pollution — RE-CONFIRMED 2026-08-04 (Task E1), after an intermediate
   revision of this entry wrongly claimed it "no longer reproduces."**
   `GlobalRegistrator.register()` copies every one of happy-dom's `window` properties onto
   `globalThis` whose value differs from what's already there — `fetch` included, so it does
   **not** stay native across registration; it is replaced by happy-dom's `fetch`, which
   enforces the Same-Origin Policy. A happy-dom-registering test placed in bare `tests/`
   still breaks the daemon HTTP suites that run after it in the same process: adding one such
   file to bare `tests/` this session produced 12 `server.test.ts` failures
   (`NetworkError: Cross-Origin Request Blocked`) and 1 `bundle-watch.test.ts` failure. This
   matches, almost to the count, what `tests/chrome/keybindings-dom.test.ts`'s own header
   already recorded independently ("29 of them fail, measured this session") — that comment
   was right the whole time. The "no longer reproduces" language an earlier revision of this
   entry added was not backed by a probe that made an actual cross-origin call; `typeof
   fetch === "function"` stays true of happy-dom's replacement too, which is consistent with
   "fetch works" only if nothing is actually invoked. (Original finding: Slice 3.2.2 Task 5.)

   **A second collision, found the same session, is not scoped to this package at all.**
   The no-isolation mechanism is process-wide: registering happy-dom from an editor test, in
   the same `bun test` invocation that also covers `packages/core`, flipped
   `packages/core/src/texture/load.gpu.test.ts`'s `typeof createImageBitmap === "function"`
   feature-detection gate from false (bun has no native `createImageBitmap`, so the case
   skips) to true — the case then ran and failed against happy-dom's own `ImageBitmap`
   implementation. Any `typeof <web API> === "function"` skip gate anywhere in the workspace
   is a candidate for this once happy-dom is global, not just the editor's own suites.

2. **`navigator.gpu` clobber — the `navigator.gpu` half is CLOSED by Task E1 (2026-08-04).**
   happy-dom installs a `navigator` with no `.gpu`. If a happy-dom test ran BEFORE a
   `*.gpu.test.ts`, every later GPU test used to throw "WebGPU unavailable" (Surfaced in
   Slice 3.2.2 Task 7 — 13 GPU failures until the DOM test was moved from `tests/theme.test.ts`
   into `tests/inspector/`). **The fix an earlier revision of this entry proposed —
   "have `ensureBunWebGpu` re-check `navigator.gpu` … and re-run `setupGlobals()`" — cannot
   work:** `setupGlobals()` throws `Attempted to assign to readonly property` against
   happy-dom's `navigator` (measured). What works, and what Task E1 shipped
   (`packages/core/tests/_helpers/gpu-fixture.ts`), is `Object.defineProperty` re-attaching
   the `GPU` object saved from the first successful setup — `navigator.gpu` stays
   `configurable` under happy-dom even though plain assignment is blocked, and
   `Object.defineProperty` doesn't go through the assignment path `setupGlobals()` does.
   `ensureBunWebGpu()` now validates against the live `navigator.gpu` on every call instead
   of trusting its memoized promise, and
   `packages/editor/tests/gpu-fixture-survives-dom.test.ts` proves a device is still
   acquirable after a happy-dom registration lands mid-process.

   **A third finding, discovered getting that test to clean up after itself, belongs here
   too: `GlobalRegistrator.unregister()` is not a safe cleanup — it is its own, worse,
   process-wide hazard.** The obvious fix for finding 1's leakage is a `finally` block
   calling `unregister()`. Measured cost of doing exactly that, via a clean sequential A/B
   with no other process running (ruling out ambient load): the REST OF THE SUITE went from
   65s to ~205s wall-clock — a ~3x regression, reproduced 1:1 across repeats, and gone the
   instant `unregister()` was removed and register-only was tried instead (which reproduces
   finding 1's failures exactly, confirming the regression was `unregister()`'s specifically,
   not registration). The likely mechanism: `unregister()` restores ~100 happy-dom-only
   globals via `delete globalThis[key]`, and a delete storm on the global object is a
   well-documented JS-engine de-optimization trigger — `register()`'s own
   `Object.defineProperty` path, adding a comparable number of properties, does not trigger
   it. The shipped fix is narrower than a full unregister: capture and restore only the
   globals a repo-wide grep confirmed are actually load-bearing (`fetch` via
   `Object.defineProperty`, `createImageBitmap` / `ImageData` via `delete` — three keys, not
   ~100), which reproduces neither hazard. **Any future fix that reaches for
   `GlobalRegistrator.unregister()` as "the clean way" should re-read this paragraph
   first** — it was the first thing tried here and it was worse than the disease.

**Current mitigation (convention, not enforced):** every DOM/happy-dom test lives
in a `tests/` SUBDIR (`tests/inspector/`, `tests/chrome/`), never bare `tests/`,
so it sorts AFTER the top-level `*.gpu.test.ts` and the daemon HTTP suites in the
file walk. **This works because of directory-files-before-subdirectory-files, not because
of alphabetical order** — a claim this entry carried until 2026-08-04. The distinction
matters for anyone reasoning about placement *within* a directory: that order is readdir
order, not the file's name. The convention holds today but is fragile — it's a placement
comment, not something enforced, and a new bare-`tests/` DOM file silently reintroduces
finding 1 (now known to reach across package boundaries, not just editor's own suites).

**The convention has a SECOND half nobody had written down, found 2026-07-31
(F4.5b Task 3).** It also constrains where GPU tests may live: a `*.gpu.test.ts`
placed in a subdirectory that sorts after `tests/chrome/` (here:
`tests/field-host/`) is poisoned by the same clobber, and it does NOT skip —
it FAILS. The reason is that `ensureBunWebGpu()` memoizes its setup promise
(`packages/core/tests/_helpers/gpu-fixture.ts`) and `bunWebGpuAvailable()` keeps
answering `true` from the cached flag, so `test.skipIf(!bunWebGpuAvailable())`
admits the test and `requestContext` then throws "WebGPU unavailable". Observed
as 4 failures that are green in isolation and red in the full suite — the worst
shape a harness failure can take, because the task-scoped gate passes. Worked
around by keeping the file in bare `tests/` beside the five other host GPU tests.
**CLOSED by Task E1** — see point 2 above; `ensureBunWebGpu` now validates rather than
caches, so a `*.gpu.test.ts` no longer needs to out-position a happy-dom registration to
stay correct.

3. **Radix PORTAL content does not render unless a `tests/inspector/` file ran
   first.** Found in F3a Task 8 (2026-07-22). `bun test` from the repo root is
   green, but a narrower invocation is not: the trigger element flips correctly
   (`data-state="open"`, `aria-expanded="true"`); the portalled content is simply
   absent from the DOM. It is NOT a first-file-in-process effect — two chrome files
   together still fail both. Root cause not identified (suspect a happy-dom global
   some component touches lazily). The practical cost: any chrome behaviour built on
   a Radix portal is untestable in a chrome-only run, which is how a task-scoped gate
   is usually run — F3a Task 8 chose three inline row buttons over the planned ⋯
   dropdown for exactly this reason.

   **Re-measured at F4.5a Task 13 (2026-07-30), and the effect has GROWN with the
   shell — but so has the confidence in the mechanism:**

   | Invocation | Result |
   | --- | --- |
   | `bun test tests/chrome/` | **97 pass / 48 fail** across 7 files |
   | `bun test tests/inspector/color-field.test.tsx tests/chrome/` | **150 pass / 0 fail** across 8 files |
   | `bun test` (whole repo) | green — 2353 pass / 1 skip / 0 fail |

   ONE inspector file in front of the directory clears **all 48**. That is the same
   mechanism as the original 10/45, at the scale F4.5a's portal-heavy chrome (dialogs,
   dropdowns, popovers) put on it. `confirm-dialog.test.tsx` also fails 3/3 run entirely
   alone and passes when preceded by `color-field` — the smallest reproduction of the
   whole thing.

   **The workaround, until the real fix below lands:** run a chrome subset as
   `bun test tests/inspector/color-field.test.tsx tests/chrome/<file>`. It is ugly and
   it is not a fix, but it makes a task-scoped gate possible, which the entry previously
   said was impossible. (The per-file figures the earlier revision named —
   `menubar.test.tsx`, `entities-panel`, `inspect-panel`, `view-flags` — are all files
   F4.5a deleted; the ordering finding survives them, the file list does not.)

   **CLOSED 2026-08-02 (F4.5c Tasks 12 + 15) — root cause FOUND, and it was not a
   happy-dom mystery.** `@radix-ui/react-use-layout-effect` resolves
   `globalThis?.document ? useLayoutEffect : noop` ONCE in its module body, and
   `@radix-ui/react-portal` mounts through `useLayoutEffect(() => setMounted(true), [])`.
   One file that reaches any Radix module before happy-dom's globals exist pins that hook
   to the no-op branch for the WHOLE PROCESS, and every portal in every other file then
   renders `null` under a trigger that opened correctly. That is the entire effect
   described above — "ONE inspector file in front of the directory clears all 48" was the
   registering file arriving first, nothing more.

   The fix is one line per file: a BARE `import "../inspector/_register.ts";` above the
   first other import (bare, because Biome's `organizeImports` sorts a named
   `./_harness.tsx` import below `../../src/…` and reverts any attempt to hoist it).
   Task 12 added it to the three chrome files that lacked it — `confirm-dialog`,
   `flags-palette`, `host-seams-and-catalogs` — taking `bun test packages/editor/tests/chrome`
   from ~130 failures in ~51 s to **0 in ~10 s**, and Task 15 added it to the nine
   inspector tests that RENDER and lacked it. The rule is now held by a scan,
   `tests/register-first.test.ts`, which names the offending file.

   **Two process facts this RETIRES.** "Never run the chrome directory, `confirm-dialog`
   poisons it" was a real mechanism misread as a quirk of one file — the directory is safe
   and fast now. So is the `segmented-field` + `shell.test.tsx` pairing, which failed for
   the same reason. The `color-field`-in-front workaround above is obsolete.

   **What is NOT closed** is the ordering dependency this section opens with: the subdir
   convention (§1 and §2) is still unenforced, and the inspector directory's green was
   itself order-dependent until Task 15 — measured, because it looked fine either way.
   Adding the nine imports moved no counts at all (85 pass / 0 fail / 180 asserts before
   and after), since bun happened to evaluate a DOM-safe file first; but the pair
   `boolean-field.test.tsx` + `enum-field.test.tsx` goes 9/0 with the line and **8/1
   without** it. A suite that is green by load order is the shape this whole entry is
   about.

**What remains OPEN after Task E1.** Two things, not one — E1 closed the `navigator.gpu`
half of finding 2 (see above) and proved, in one file, that a per-file targeted-global
teardown removes finding 1's blast radius for that file WITHOUT paying finding 3's
`unregister()` cost. It did **not** apply that teardown to the package's existing DOM
suites — `tests/chrome/*` and `tests/inspector/*` still register happy-dom and never clean
up after themselves, which is exactly why the subdir convention still has to exist and
still isn't enforced. Generalizing E1's teardown to every DOM-registering file is not a
copy-paste of what E1 shipped, either: it hardcoded the three globals a repo-wide grep
found load-bearing TODAY, and a chrome/inspector-wide version would need to re-derive that
set (or capture/restore the full window property list, minus whatever in it turns out to
carry finding 3's cost — not yet known which subset that is). **A real fix worth designing
when this bites again:** isolate the environments — e.g. a separate `bun test` invocation
(or bunfig test project) for DOM tests vs GPU tests vs daemon tests, so global state can't
leak across families at all; or a generalized, audited version of E1's targeted teardown on
every DOM-registering file. Either removes the ordering dependency entirely; both are
bigger than a single task.

**Trigger to revisit:** the next time a DOM+GPU or DOM+daemon test-ordering
failure appears, or when the suite grows enough DOM tests that the subdir
convention becomes unwieldy. Not urgent — the convention holds for now.

**Reference:** `packages/editor/tests/inspector/_register.ts` (the happy-dom
registration); `packages/editor/tests/chrome/keybindings-dom.test.ts` (an existing,
independently-measured account of finding 1); `packages/editor/tests/gpu-fixture-survives-dom.test.ts`
+ `packages/core/tests/_helpers/gpu-fixture.ts` (Task E1's fix and proof for finding 2);
placement comments in `tests/chrome/*`; surfaced in Slice 3.2.2 Tasks 5 and 7, re-measured
at F4.5a Task 13 and Task E1 (2026-08-04).

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
  it produces is not the one the code reads as: `readSse` (`server.test.ts`)
  consults its deadline only at the TOP of the loop, and `await reader.read()` carries no
  timeout of its own — so on a silent stream the read simply blocks past the 8 s deadline.
  The next byte to arrive is the hub's own heartbeat (`HEARTBEAT_MS = 15_000`,
  `events.ts`, armed by `createEventHub()` in `startServer` — i.e. at server start,
  which in this test is milliseconds after the test begins). That wakes the read at
  ≈15.0 s, the predicate fails, the loop condition is now false, and the deadline throw
  lands. **A missed watcher event therefore fails the "structured error bodies carry code +
  message" test at ≈15,00x ms** — exactly the reported figure, on exactly the
  originally-named test.
  *(Line citations dropped for symbol ones at T4a, 2026-08-09 — all three had already
  drifted, and that commit's `server.ts` / `server.test.ts` additions moved them again. The
  `chokidarWatchFile` this bullet analyses was itself deleted in foundations T2; the entry is
  kept for the `readSse` deadline mechanism, which stands.)*
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

**Reference:** `packages/editor/tests/server.test.ts`, the "structured error bodies carry
code + message" test; `packages/editor/src/daemon/watch.ts` + `src/daemon/events.ts` (the file
watcher and SSE feed it exercises — `src/daemon/session.ts` was cited here too and does not
exist: this entry's own text records the session store as deleted in foundations T2),
`docs/reference/editor-architecture.md` (SSE change feed + file watching).

## `readSse`'s `timeoutMs` is not honoured on a silent stream

**Context.** Surfaced 2026-07-30 while diagnosing the flake above. `readSse`
(`readSse` in `packages/editor/tests/server.test.ts`) takes a `timeoutMs` (default 8 s) and
reads as though it bounds the wait. It does not: the deadline is consulted only at the top
of the `while`, and `await state.reader.read()` has no timeout of its own. On a stream that
goes quiet the helper blocks INSIDE the read, indefinitely as far as its own logic is
concerned — the parameter bounds only how many further reads it will attempt, never the
one it is sitting in.

What hides this today is the daemon's SSE heartbeat (`HEARTBEAT_MS = 15_000`,
`daemon/events.ts:5`): every 15 s a `: ping` frame wakes the read, the predicate fails, and
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

**Reference:** `readSse` in `packages/editor/tests/server.test.ts` (the helper),
`HEARTBEAT_MS` in `packages/editor/src/daemon/events.ts` (the heartbeat that masks it).
*(All line citations in this entry dropped for symbol ones at T4a, 2026-08-09: every one had
already drifted, and that tranche's additions to both files moved them again.)*

## FieldHost's worker seam exists now — what host coverage still cannot reach is a stamp session

**Status: mostly CLOSED by F3b Task 12.** `createFieldHost({ spawnWorker })` now takes the
seam (`packages/editor/src/field-host/field-host.ts`), threaded into
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
its comments on why the worker is injected); `packages/editor/src/field-host/field-host.ts`
(`createFieldHost`'s `deps` parameter); `packages/editor/tests/preview-host.gpu.test.ts`
(prior art for the GPU fixture).

## Constructing an MCP SDK object triples the rest of the `bun test` process

**Context.** Measured at foundations T4b Task 5 (2026-08-09), on `bun` 1.3.14 with
`@modelcontextprotocol/sdk@1.30.0`. Constructing **any** SDK `Protocol` object — `new
Client(...)` or `new Server(...)`, with no transport, no HTTP and no request — costs the
REST of the shared test process about **3× wall clock**. It belongs in this file because it
is the same absence of per-file isolation the section at the top is about, arriving from a
new direction: a dependency, not a global.

| run | wall clock | fails |
| --- | --- | --- |
| `bun test` (workspace), no MCP object anywhere | 64 s | 0 |
| `bun test` (workspace), one MCP object in one test file | 194 s | 6–7 |
| `bun test packages/editor`, no MCP object | 31.4 s | 0 |
| `bun test packages/editor`, one `new Client()` and nothing else | 48.5 s | 0 |
| `bun test packages/editor`, the MCP work in a `Bun.spawn` child | 32.0 s | 0 |

The failures are all `@furnace/core` **wall-clock budget** tests, dragged over ceilings they
otherwise clear by up to 10× (`cave carve — budget` 148 ms → 1581 ms against a 500 ms
ceiling; `flood-material` 79.8 ms → over its 100 ms ceiling). The production daemon is not
implicated: with `daemon/mcp.ts` imported and mounted but no MCP object constructed in any
test, the workspace suite is 64 s / 0 fail.

**What it is NOT** — each eliminated by measurement rather than by argument: not the
transport (`new Server(...)` alone, no transport, reproduces it in full); not Ajv (`new
Ajv()` alone reproduces none of it, and supplying the SDK's `jsonSchemaValidator` option —
which skips the default Ajv construction entirely — changes nothing); not SSE
(`enableJsonResponse: true` changes nothing); not `globalThis` pollution (nothing added,
removed or re-attributed around the call); not GC pressure (a forced collection afterwards
changes nothing); not module load (importing the SDK without constructing anything costs
nothing, and `daemon/server.ts` imports it on every run regardless). The mechanism is
unidentified. The symptom is diffuse — CPU- and allocation-heavy tests slow the most, a
tight `Math.sqrt` loop not at all — and the magnitude matches what
`tests/gpu-fixture-survives-dom.test.ts` records for `GlobalRegistrator.unregister()`.

**How T4b lives with it.** `tests/mcp.test.ts` spawns `tests/_helpers/mcp-probe.ts` in a
fresh runtime, which performs every protocol exchange and prints one JSON transcript the
test file asserts on — the same remedy, and the same argument, that
`tests/action-registry/node-door.test.ts` already uses for a different kind of process
pollution. Nothing in `src/` changed to accommodate it.

**Why it is filed rather than fixed.** The fix is either upstream (an SDK whose shape we do
not control) or a change to how this repo gates: per-package `bun test` runs in separate
processes (verified green — core 20.2 s, dungeon 11.3 s, editor 48.6 s, each alone), or
`bun test --isolate` (**not** usable today: 32 fails, since the GPU fixtures depend on
shared process state), or making the core wall-clock budgets calibrate against a
per-process baseline instead of an absolute ceiling. All three are program-level decisions
about the gate.

**Trigger to revisit:** an SDK upgrade — re-measure the table first, since a v2 SDK may not
have this at all; OR any move to change the repo's gate command, which should settle this at
the same time; OR MCP coverage the transcript shape cannot express (a streaming tool, an
interleaving the probe cannot script). *(The T4c clause of this trigger is spent — see the
next section.)*

**Reference:** `packages/editor/tests/_helpers/mcp-probe.ts` (the measurement and the
eliminations, at source); `packages/editor/tests/action-registry/node-door.test.ts` (the
`Bun.spawn` precedent).

### What foundations T4c actually hit — the prediction was right, the class was wrong

**The prediction: "T4c will hit this wall again." It did NOT.** Whole-workspace `bun test` from
the repo root, read off each commit's own gate line (2026-08-09 → 2026-08-10) — **Task 0
64.9 s, Task 1 54.4 s, Task 2 64 s, Task 4 54.2 s, Task 5 67 s, Task 6 66.1 s, Task 7 68.2 s**.
*(Task 3 recorded its pass/fail counts but not a wall clock, so there are seven gates and six
figures plus this file's own; the gap is stated rather than interpolated.)* Baseline ~64 s, and
the ~90 s tripwire that a 3× multiple would have blown through on its first appearance was never
approached. The suite grew 3,057 → 3,201 cases and the wall clock did not move. **The containment held for exactly the
reason it was designed to**: the tranche added six MCP tools, five argument schemas and 17
door cases, and **every SDK object construction stayed inside `tests/_helpers/mcp-probe.ts`'s
spawn child**. Nothing in `src/` was shaped around it and nothing needed to be. That is the
first real load test of the remedy above, and it is worth recording as a positive: the fix is
not fragile, it is structural — a fresh runtime cannot be polluted by the parent's SDK.

**A DIFFERENT contamination class bit instead, and it belongs in this file because it is the
same absence of per-file isolation arriving from a third direction: an unsettled PROMISE.**

At T4c Task 3, three brokered-command cases opened a backchannel ask and never answered it.
`EventHub.close()` deliberately does not fire its close handlers, so `abandonAsksOn` never runs
at teardown and a pending ask **survives its own test file** on an `unref`'d timer. It then
rejects up to its budget later — 30 s for `generate` — inside **whatever file bun happens to be
running by then**, as an unhandled rejection attributed to a stranger. Measured while writing
those cases: three unsettled asks reddened `tests/chrome/tool-rail.test.tsx` with
`session-timeout: "generate"`, a file that names none of this, **and the failure MOVED between
runs** as scheduling shifted.

**Why it is worse than the SDK cost even though it is smaller.** The SDK multiple is loud,
reproducible and points at itself. This one is silent until it isn't, blames an innocent file,
and is non-deterministic — the three properties that make a suite untrustworthy rather than
slow. A reader who bisects on the reddened file learns nothing.

**How it was fixed, and what is left.** Per-site: every case that opens an ask now settles it,
with the discipline stated at the top of `tests/session-mutation.test.ts` and the accepting
half of `tests/session-query.test.ts`'s validation case deliberately NOT asserted for exactly
this reason (a request the schema admits is relayed, so asserting it would open an ask nothing
answers). **The underlying gap is filed, not fixed**, at
`docs/backlog/editor-and-tooling/backchannel-refusals-blur-two-causes.md` item 2 — `hub.close()`
firing no close handlers, which that entry had recorded as "unreachable today". **T4c is its
first live evidence**, and it arrived from the test harness rather than from the daemon
shutdown path the entry anticipated.

**The general rule this suggests, stated rather than adopted:** a `bun test` process with no
per-file isolation cannot contain an async leak any better than it contains a synchronous one,
and the three remedies listed above (per-package runs, `--isolate`, calibrated budgets) address
only the synchronous half. An unsettled promise crosses a file boundary that even `--isolate`
would not close if the timer outlived the isolate. Nothing here proposes a fix; it is context
for whoever settles the gate question.
