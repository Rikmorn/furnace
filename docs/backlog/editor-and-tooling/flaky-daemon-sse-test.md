---
summary: the daemon's `session lifecycle over HTTP with a live SSE feed + watcher reload` timed out once in five runs and has never reproduced in 31 further runs; the SSE half of the hypothesis is refuted, the un-awaited chokidar `ready` half stands and predicts the observed 15 s
---

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
`docs/reference/editor/change-feed.md` (SSE change feed + file watching);
`readsse-timeout-not-honoured.md` — the lying instrument this entry's own analysis runs on,
and the reason a diagnosis should start there rather than here.
