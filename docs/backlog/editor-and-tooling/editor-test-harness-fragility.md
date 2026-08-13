---
summary: what the editor's `bun test` harness cannot do deterministically — happy-dom/GPU/daemon collisions in one shared process, a flaky daemon test, coverage the worker seam still hides
---

# Editor test harness — fragility and coverage reach

Tracker for what the editor's `bun test` harness cannot currently do deterministically or
at all: single-process global-state collisions between the DOM / GPU / daemon test
families, one flaky daemon test, the coverage boundary the FieldHost worker seam moved
but did not erase, and (T4b) a dependency whose mere construction de-optimizes the shared
process by ~3×. Merged so there is **one place to check whenever a test-ordering or
environment failure appears in `packages/editor/tests/`**. Sections keep their original
content.

**Absorbed at T5 (2026-08-11):** the last two sections — *`stubDaemon`'s `loadable` should be
the default* and *`RADIUS_MIN` / `RADIUS_MAX` / `HOLLOW_MIN_M` are pinned by nothing*. Both
are about what the harness assumes rather than what it can reach: one a stub default that
makes every test opt in to the normal case, one a set of constants no test pins.

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

**Current mitigation — ENFORCED since foundations T5 (2026-08-11) by
`packages/editor/tests/harness-conventions.test.ts`:** every DOM/happy-dom test lives
in a `tests/` SUBDIR (`tests/inspector/`, `tests/chrome/`), never bare `tests/`,
so it sorts AFTER the top-level `*.gpu.test.ts` and the daemon HTTP suites in the
file walk. **This works because of directory-files-before-subdirectory-files, not because
of alphabetical order** — a claim this entry carried until 2026-08-04. The distinction
matters for anyone reasoning about placement *within* a directory: that order is readdir
order, not the file's name.

That scan lists the top level of `tests/` at runtime and flags any file reaching happy-dom —
by the package specifier in either import form, or by importing `_register.ts` — naming the
offending file. `tests/gpu-fixture-survives-dom.test.ts` is the one licensed registrant and
is asserted BY NAME, so a second is a deliberate edit rather than a silent arrival; what buys
it the licence is the targeted teardown in its `finally`, not its placement. **This closes the
"a new bare-`tests/` DOM file silently reintroduces finding 1" half and nothing more** — the
blast radius (which reaches across package boundaries, not just editor's own suites) is
unchanged, and so is the underlying ordering dependency. A guard on where the file sits is not
the environment isolation this section's last paragraph asks for.

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

   **What is NOT closed** is the ordering dependency this section opens with. The subdir
   convention (§1 and §2) is enforced since T5 — see the mitigation paragraph above — but
   enforcing WHERE a DOM file sits does not remove the dependency on where it RUNS; the
   inspector directory's green was
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
up after themselves, which is exactly why the subdir convention still has to exist. (It is
enforced since T5; being enforced is not the same as being unnecessary, and this paragraph is
the reason it is still needed.) Generalizing E1's teardown to every DOM-registering file is not a
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

**Reference:** `packages/editor/tests/harness-conventions.test.ts` (the scan that enforces the
subdir convention, since T5); `packages/editor/tests/inspector/_register.ts` (the happy-dom
registration); `packages/editor/tests/register-first.test.ts` (the sibling scan, which holds
the POSITION of the registration line inside the two subdirectories rather than the placement
of the file); `packages/editor/tests/chrome/keybindings-dom.test.ts` (an existing,
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
  the `15_000` budget on `bundle-watch.test.ts`'s "a source change under the extensions dir
  emits bundle-outdated to subscribers" being the only 15 s budget in the package. Bun prints ELAPSED
  time on every fail line whatever the budget — probe-confirmed: a test with a 20 s budget
  failing at 1.5 s prints `[1516.83ms]` — so the figure never implied a budget at all, and
  the exclusivity argument dissolves with it. That same `bundle-watch.test.ts` case remains a SECONDARY
  candidate on its own merits (its `read` → `fire()` → `read` shape would deadlock if the
  `": connected"` preamble ever failed to flush); it went 10/10 green here too. Provenance
  note for whoever picks this up: the "15005 ms" figure comes from a session message, not
  from a durable artifact — no log survives.

**2026-08-12 — a third sighting, name not captured.** Sculpting-worlds cycle 2's review ran
the editor package suite at each of the five E0 commits in a throwaway worktree. The run at
`75060723` reported **1,768 pass / 1 fail of 1,769**; two immediate re-runs at the identical
commit gave **1,769 / 0**. The failing test's name was lost to a `tail -6` capture, so this
cannot be attributed to the section title above — it is recorded as evidence that the package
suite is still not deterministically green, not as a reproduction. Provenance is the same
class as the "15005 ms" note: a session message, no durable log. **Whoever picks this up
should capture full output, not a tail** — that is twice now that a sighting has arrived
without the one field that would make it actionable.

**2026-08-13 — the never-tail rule is necessary but NOT sufficient under `--parallel`.**
Sharpened at the isolate-hardening slice, and it costs nothing to obey, so obey it. A full-suite
`bun test --parallel` run reported **`2 fail`** in its summary while its stdout carried **no
failure detail whatever** — no `(fail)` line, no test name, no assertion text, nothing to grep.
That was a complete capture, not a tail: 5,289 lines redirected to a file. Two sibling runs of
the same command, same commit, printed the detail normally, so this is not a property of the
failing tests. The names were recovered by re-running with
`--reporter=junit --reporter-outfile=<file>` and parsing the XML for `testcase` elements
carrying a `failure` child.

**So the rule for any `--parallel` run whose failures need attributing is: capture full stdout
AND take a junit run.** Stdout alone can tell you *that* a run was red and not *what* was red,
which is the same dead end a `tail` produces and reads identically to a captured log. Two
practical notes from the same session: parse the junit for the `.test.ts`-named testsuites only,
since the file-level and `describe`-level suites both carry the case and naive totals double-count;
and one full-suite junit-plus-`--parallel` run hung past 240 s before completing normally on
retry — one sighting, no class claimed, but budget for it rather than assuming the run wedged.

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

What hides this today is the daemon's SSE heartbeat (`HEARTBEAT_MS = 15_000` in
`daemon/events.ts`): every 15 s a `: ping` frame wakes the read, the predicate fails, and
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
  `installMockResizeObserver` + rAF/canvas shims), already used by sibling GPU tests in the
  same directory; it is now the pattern EVERY `*.gpu.test.ts` at the top level of
  `packages/editor/tests/` follows. *(This bullet named `preview-host.gpu.test.ts` as the
  sibling until T5, 2026-08-11 — that file was deleted in `b71d033e` along with the rest of
  the world-assembly surface, so the citation had been pointing at nothing.)* The first revision of this entry
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
(`createFieldHost`'s `deps` parameter); any sibling `packages/editor/tests/*.gpu.test.ts` for
the GPU-fixture pattern — `field-host-pointer.gpu.test.ts` is a plain one.

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

**ENFORCED since foundations T5 (2026-08-11)**, by the same
`packages/editor/tests/harness-conventions.test.ts`: no file under `packages/editor/tests/`
may name a `@modelcontextprotocol/sdk` specifier except `tests/_helpers/mcp-probe.ts`, which
is asserted by name. `packages/editor/src/daemon/` is out of scope by construction rather than
by exemption — `daemon/mcp.ts` mounts a real server and the scan does not walk `src/`. It was
a convention held by discipline until then, and it held: T4c's seven gate runs are the
evidence, in the section below. What it did NOT have was anything that would say so on the
day someone imported the SDK straight into a test file, which is a one-line change with a
3× bill attached.

**Why it is filed rather than fixed.** The fix is either upstream (an SDK whose shape we do
not control) or a change to how this repo gates: per-package `bun test` runs in separate
processes (verified green — core 20.2 s, dungeon 11.3 s, editor 48.6 s, each alone), or
`bun test --isolate` (**not** usable today: 32 fails, since the GPU fixtures depend on
shared process state), or making the core wall-clock budgets calibrate against a
per-process baseline instead of an absolute ceiling. All three are program-level decisions
about the gate — **and all three are ruled in the last section of this file**, which is where
that question now lives.

**Trigger to revisit:** an SDK upgrade — re-measure the table first, since a v2 SDK may not
have this at all; OR any move to change the repo's gate command, which should settle this at
the same time; OR MCP coverage the transcript shape cannot express (a streaming tool, an
interleaving the probe cannot script). *(The T4c clause of this trigger is spent — see the
next section.)*

**What changed at isolate-hardening (2026-08-13).** The paragraph above offers three gate
options and rules out one of them in passing; that parenthetical is now false, and the second
clause of the trigger directly above has FIRED — the repo's gate command did change. Recorded
here as a dated correction rather than by editing the prose, which stands as a record of what
was true when it was written.

- **"`bun test --isolate` (not usable today: 32 fails, since the GPU fixtures depend on shared
  process state)" is wrong twice over and is struck.** The stated mechanism was already refuted
  by the 2026-08-13 correction at the foot of the T5 section (a GPU file alone under `--isolate`
  skips too, so no cross-file state is involved). The *conclusion* is now wrong as well:
  `--isolate` is usable, and **`bun test --parallel=4` — which implies `--isolate` — is the
  repo's per-commit gate**, with the serial run kept as the close/review standard. Command,
  wording and the reason the worker count is 4 live in `AGENTS.md` §Commands and §Before
  committing.
- **Both blocking mechanisms were one Bun defect, not repo defects**, and the two sites that
  work around it are `trySetup` in the `gpu-fixture.ts` helpers under `packages/core/tests/` and
  `packages/dungeon/tests/` (which resolve bun-webgpu's native library synchronously and pass an
  explicit `libPath`), and `_harness.tsx` under `packages/editor/tests/inspector/` (which pulls
  testing-library through a synchronous `require`). Mechanism, minimal repro, and the trigger to
  delete both:
  [`bun-isolate-top-level-await-tdz.md`](../infrastructure/bun-isolate-top-level-await-tdz.md).
- **The third option in that paragraph — calibrating the core wall-clock budgets against a
  per-process baseline — was NOT taken**, and deliberately: see the RULED 2026-08-13 block at
  the foot of the T5 section below, which carries the evidence, the worker-count ruling that
  made calibration unnecessary, and the answer the declined-calibration objection was owed.
- **The first option — per-package runs — remains a diagnostic, not a gate**, for the coverage
  reason clause 3 gives; nothing in this slice touched that.

Derive the current state rather than reading a number here: `bun run test`, `bun run test:serial`,
`bun test --isolate`.

**Reference:** `packages/editor/tests/_helpers/mcp-probe.ts` (the measurement and the
eliminations, at source); `packages/editor/tests/action-registry/node-door.test.ts` (the
`Bun.spawn` precedent); `packages/editor/tests/harness-conventions.test.ts` (the scan that
holds the containment, since T5).

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
for the gate question, which the section below settles.

### The gate question, RULED at foundations T5 (2026-08-11) — the root whole-workspace run stays

**This is a RECOMMENDATION carried to the T5 review for the user to ratify, not a decision
already taken.** The three options under "Why it is filed rather than fixed" are program-level
calls about how this repo gates and no task gets to make one; what follows is the argument for
changing nothing, with the evidence under each part, so that ratifying it is cheap and
overturning it is possible.

**1. KEEP the root whole-workspace `bun test`.** The containment is structural rather than
fragile, and the section above is the load test that says so — every T4c gate that recorded a
wall clock landed inside the band, against a suite that grew by 144 cases, because a fresh
runtime cannot be polluted by its parent. That
evidence is not restated here; it is the entire reason this ruling can be "change nothing"
instead of "hope".

**2. The stance is MACHINERY now, and that is what turns "it held" into "it will hold".**
Through T4c the containment was held by discipline. Since T5 it is held by
`packages/editor/tests/harness-conventions.test.ts`, whose second case — *"no test file imports
the MCP SDK — every SDK object is built in a spawn child"* — walks `packages/editor/tests/` and
asserts that the set of files naming an `@modelcontextprotocol/sdk` specifier is EXACTLY
`_helpers/mcp-probe.ts`. A gate change argued on "the convention might slip one day" no longer
has that premise available to it.

**3. Per-package runs STAY as the documented DIAGNOSTIC fallback — and are not a candidate
gate.** Re-measured at T5 rather than carried from the 2026-08-09 figures above; each command
run alone from the repo root, at branch head `0fd37ad7`:

| Command | Result | Wall clock |
| --- | --- | --- |
| `bun test packages/core` | 1401 pass / 1 skip / 0 fail, 210 files | **20.06 s** |
| `bun test packages/dungeon` | 62 pass / 0 fail, 15 files | **11.52 s** |
| `bun test packages/editor` | 1752 pass / 0 fail, 144 files | **37.99 s** |
| *(sum of the three)* | *3215 pass, 369 files* | *69.57 s* |
| `bun test` (root, same session) | 3218 pass / 1 skip / 0 fail, 371 files | **71.66 s** |

All green. Two facts fall out, and the second is why the fallback is not a gate:

- **Splitting buys no wall clock.** 69.57 s of per-package runs against 71.66 s for the one
  root run is a wash — three process startups pay back whatever the split saves, which is
  exactly what you would expect once the pollution a split would avoid is already contained.
  *(Measured on a machine also running concurrent agent sessions, so read these five figures as
  comparable to EACH OTHER, not as absolute numbers against the ~64 s quiet-machine baseline
  above. The root run's 71.66 s sits just over T4c's 54.2–68.2 s band on a suite 17 cases
  larger, and nowhere near the ~90 s tripwire.)*
- **The three commands do not cover the workspace, and the entry has been spelling them as if
  they did.** 369 files against the root run's 371, 3215 tests against 3218: the missing two are
  `packages/cookbook/tests/demos.test.ts` and `packages/hello-world/tests/triangle-shader.test.ts`
  (`bun test packages/hello-world packages/cookbook` → 3 pass across 2 files, 50 ms; the sixth
  package, `packages/tools`, has no test files at all). Adopting the three-command form as the
  gate would silently drop two packages. As a diagnostic — "is this failure a cross-package
  interaction or not?" — the three are the right three; as a gate they owe a fourth command.

**4. `bun test --isolate` stays recorded NOT USABLE** on the measurement above — 32 fails,
because the GPU fixtures depend on shared process state. **Deliberately NOT re-probed at T5**:
nothing since has touched the fixtures' relationship to process state, so a re-run costs
minutes and can only reproduce the same number.

**5. Baseline-relative wall-clock budgets are DECLINED.** They exist to stop one contamination
class dragging `@furnace/core`'s absolute ceilings, and that class is contained; this file
records no second instance of it, which is the premise the decline rests on and the thing to
re-check before overturning it. Meanwhile the class that DID bite at T4c is untouched by all
three options — an unsettled `ask()` promise outliving its file and rejecting 30 s later inside
a stranger crosses a boundary that per-package runs, `--isolate` and calibrated budgets all
leave open, for the reason the paragraph directly above gives: a timer can outlive an isolate.
That stays per-site discipline. Calibrating would also cost something real that is easy to miss
— an absolute ceiling is a claim about the ENGINE, which a reader can argue with; a
baseline-relative one is a claim about the machine, which drifts with it and can never fail.

**What would reopen this.** The trigger above is unchanged and is still the right one (SDK
upgrade / a move to change the gate command / MCP coverage the transcript shape cannot express).
Add one clause: **a SECOND contamination class of the synchronous kind**, which is the premise
(5) rests on and the only one of the five that a single new finding could knock out.

**Correction 2026-08-13 (measured at the build-speed close; supersedes two claims above).**
(a) Clause 4's mechanism is refuted: a GPU file run entirely ALONE under `--isolate` skips too
(`bun test --isolate packages/core/tests/frame/render.gpu.test.ts` → 12 skip, vs 12 pass
serial), so no cross-file shared process state is involved — the fixture simply cannot
initialise inside an isolate: `ensureBunWebGpu()` returns false there, and the underlying
error is swallowed by the bare `catch` in `trySetup()`
(`gpu-fixture.ts` in `packages/core/tests/_helpers/`). "Not usable" stands; the recorded
reason does not. The 32-fail count also understates the damage: under `--isolate`/`--parallel`
487 cases skip and 532 more never execute (31 editor DOM files die at module evaluation on a
top-level-await TDZ in `_harness.tsx` in `packages/editor/tests/inspector/`) — roughly 31% of
the suite stops gating. Whether the fixture failure is fixable in the fixture or blocked
upstream in `bun-webgpu`'s FFI is the isolate-hardening slice's first probe.
(b) Clause 3's coverage gap has grown: the per-package fallback now misses **6** files, not 2 —
the four root `scripts/*.test.ts` files landed with the docs-system slice and live in no
package (derive: compare `bun test` root file count against the per-package runs).

**RULED 2026-08-13 at the isolate-hardening slice (owner ruling; supersedes clause 4 outright
and answers clause 5's reopening trigger).**

*Clause 4 — "`bun test --isolate` stays recorded NOT USABLE" — is now WRONG and struck.* Both
mechanisms it rested on were fixed in that slice: the GPU fixture resolves bun-webgpu's native
library synchronously and passes it as an explicit `libPath`, and the inspector harness pulls
testing-library through a synchronous `require` instead of a top-level await. Both were
workarounds for one Bun defect, not for anything this repo did wrong — the mechanism, a
three-file repro, and the trigger to revert both live in
[`bun-isolate-top-level-await-tdz.md`](../infrastructure/bun-isolate-top-level-await-tdz.md).
Measured after: `bun test --isolate` and `bun test` return the SAME population and the same
result — 0 fail, 0 module errors, and one remaining skip, which is `test.skipIf` on a genuinely
absent capability (`createImageBitmap`/`ImageData`, in `load.gpu.test.ts` under
`packages/core/src/texture/`) and skips identically in both modes.

*Clause 5's reopening trigger DID fire, and the ruling stands unchanged — because the second
class turned out to be a machine-load artefact with a machine-load fix.* Under `bun test
--parallel` at bun's default worker count (one per core), two cases fail: the `cave-budget` and
`generators-budget` files in `packages/core/src/field/`. Both fail on bun's **5 s default
per-test timeout**, not on their own ceilings, which they print as comfortably inside budget.
The ruled gate is **`--parallel=4`**, and at 4 workers those same two cases return to
essentially their serial timing — under 50% of the default timeout, against a serial figure a
hair under that. So no budget file is edited, no per-file timeout is raised, and no
baseline-relative budget is adopted.

**The answer clause 5's objection is owed** ("an absolute ceiling is a claim about the ENGINE,
which a reader can argue with; a baseline-relative one is a claim about the machine, which
drifts with it and can never fail"): the objection is correct and is the reason this ruling
does NOT calibrate. Contention was never evidence that the ceilings are wrong — it is evidence
that a saturated machine is the wrong place to measure them. Fixing the measurement condition
keeps every ceiling an argue-able claim about the engine. Choosing the worker count is the
cheaper lever and the honest one; the same lever also buys back the headroom that group E of
the build-speed inputs found this laptop needs when a second agent session is running.

**Derive all of the above** (dated snapshots, machine idle, `--parallel=4` unless stated):
`bun test`, `bun test --isolate`, `bun test --parallel`, `bun test --parallel=4`, and for the
per-case timings `bun test --parallel=4 --reporter=junit --reporter-outfile=<file>` parsed for
the two `*-budget.test.ts` testcases' `time` attributes.

**What would reopen THIS ruling.** A budget-file failure under `--parallel=4` — which is the
signal that 4 is no longer an uncontended-enough measurement condition on the machine of the
day, and the next lever is the worker count again, not the budgets.


## `stubDaemon`'s `loadable` should be the default, not an opt-in

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

### Context

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

### Trigger to revisit

The next time someone adds an assertion to this file that runs AFTER the load — that is the
case the current default silently answers wrong. A second `loadable: true` call site is the
same signal.

### Reference

- `packages/editor/tests/chrome/world-drawer.test.tsx` — `stubDaemon`'s `loadable` docblock
  (the self-declared trap), the `field.load` branch that reads it, and the two cases that pass
  it today (the ruling-5 frame pair at the end of the file).
- `packages/editor/src/frontend/lib/world-actions.ts` — `loadWorldInto`, whose `chunks.map`
  is what throws on the `{}` body.
- `packages/editor/src/frontend/hooks/useWorld.tsx` — the Open handler, which returns early
  unless the outcome is `loaded`; this is the branch the default currently skips.

## `RADIUS_MIN` / `RADIUS_MAX` / `HOLLOW_MIN_M` are pinned by nothing

The three brush clamps moved to `packages/editor/src/shared/field-limits.ts` in foundations
T3b2 Task 5, so the host's clamp and the strip's control bound are now ONE number. No test
notices when that number changes.

### Context

**Measured, not assumed** (`bun test packages/editor/tests`, 1439 pass / 0 fail at the
committed state of T3b2 Task 5):

| sabotage | result |
| --- | --- |
| `RADIUS_MIN` `0.25` → `0.75` | 1439 pass / 0 fail |
| `RADIUS_MAX` `4` → `9` | 1439 pass / 0 fail |
| `HOLLOW_MIN_M` `0.5` → `1.5` | 1439 pass / 0 fail |

Nothing reddens. `tests/chrome/tool-strip.test.tsx` reaches the radius slider by its
accessible name (`getByLabelText("brush radius")`) and drives it, but never asserts its `min`
or `max`; the hollow field's `min` is likewise unasserted.

**THE MOVE DID NOT MAKE THIS WORSE — it made it strictly better, and an earlier draft of this
entry had that backwards.** Before Task 5 there were TWO unpinned copies of each number, one
in `field-host.ts` (the clamp's home then; `field-tool.ts` since T3d) and one in
`tool-params.tsx`, with nothing comparing them: a drift in
either was both unpinned AND able to put the control out of step with the clamp. There is now
ONE copy. Consolidating **removed** a possible failure (the two disagreeing) and left the
pre-existing one (nobody notices the single number moved) exactly as it was. Do not read this
entry as a regression the task introduced.

What remains is worth guarding anyway: `RADIUS_MAX` is the largest brush the editor offers and
`HOLLOW_MIN_M` is the floor a typed thickness is clamped up to on blur, and both reach a user
as a native control's own bound.

**Why Task 5 did not add the pin.** Not because its brief put the chrome suites off limits —
that brief forbade *reshaping* existing assertions, and adding a new case is not a reshape.
The honest reason is scope: the gap is pre-existing, it is not an instance of the drift class
that task's thesis was about (there is no second copy to drift from), and the task was already
carrying six table conversions plus eight carry-forwards.

The pin belongs beside the existing pair in `tests/chrome/tool-strip.test.tsx`, and should
follow the shape `tests/shared/action-table.test.ts`' three-limits case already documents: a
VALUE assertion in the shared test cannot catch a re-hardcoded literal, so the coupling is
held by a RENDERED assertion — read `min`/`max` off the control and compare against the
literal `0.25` / `4` / `0.5`, deliberately not against the imported constant, since a pin that
reads the constant makes the number agree with itself.

### Trigger to revisit

Any of:

- **The next task that opens `tests/chrome/tool-strip.test.tsx`** for its own reasons — the
  pin is three assertions and belongs in that commit rather than its own.

  > **This clause FIRED at foundations T3c and was consciously not taken (2026-08-07).** T3c
  > Task 1 (commit `d34374d3`) opened that file for a real reason — the material-swatch case became a `toEqual`
  > over a `toMatchObject` when `setTool` widened to a patch, because the ABSENCE of an
  > `effect` field is the claim. The pin was not added with it. The reason is a gate rule
  > rather than a judgement about the pin: the tranche's docs-and-gate task carried a suite
  > count pinned at 2905/1/0 as its own success criterion, and three new assertions move it,
  > so adding them there would have been a silent change to the number the tranche was
  > verified against. The clause stands, and the next opener that is not gate-frozen should
  > take it.
- **Either bound changes**, for any product reason. The change itself is the moment to add
  the guard that would have shown it.
- **A fourth clamp meets `field-limits.ts`' bar** and moves down. The file's header states
  the bar; it does not yet state that a moved limit wants a rendered pin, and the third one
  arriving is when that becomes worth writing.

### Reference

- `packages/editor/src/shared/field-limits.ts` — the three constants and the bar for adding
  one.
- `packages/editor/src/field-host/field-tool.ts` — `clampRadius`, and the `hollow` floor in
  `clampTool` (both now there).
- `packages/editor/src/frontend/components/shell/tool-params.tsx` — the radius range input's
  `min`/`max` and the hollow field's `min`, which are where a user meets them.
- `packages/editor/tests/shared/action-table.test.ts` — *"the three host limits reach the
  chrome as VALUES, not as prose"*, for the value-pin / rendered-pin pairing this should
  follow.
