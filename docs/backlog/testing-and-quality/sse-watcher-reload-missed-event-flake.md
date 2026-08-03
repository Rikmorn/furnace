# The daemon's SSE watcher-reload wait can hang on a MISSED file event

`packages/editor/tests/server.test.ts`, test *"session lifecycle over HTTP with a live SSE
feed + watcher reload"*, has failed intermittently at its last wait:

```
error: SSE timeout; buffer so far:
: connected
event: scene-opened  … event: document-changed (scene.addEntity) … event: document-changed (scene.undo)
: ping
```

Every same-process event arrives; the one that times out is the **file-watcher** `file-reload`
after a direct `writeFileSync` to `scenes/cube.scene.json`. `readSse`'s window is a hard-coded
`timeoutMs = 8000` (`tests/server.test.ts:161`).

## Measurements

- **2 failures in ~12 whole-suite runs** while F4 Task 12 was in progress (dirty, mid-edit tree).
- **0 failures in 10 runs** of `server.test.ts` in isolation.
- **0 failures in 36 full-suite runs** at the Task 12 commit — 30 sequential plus 3 rounds of
  two suites running *concurrently* as a deliberate load probe. P(0 in 30 | p = 0.167) ≈ 0.4%,
  so the earlier 2/12 rate is **statistically incompatible** with the tree as committed.

## Causation: the original "concurrent load" framing was WRONG

This entry first attributed the flake to extra concurrent load from Task 12's new real-Worker +
Rapier-wasm e2e test. That is **not supported**, and the disconfirming evidence is decisive:

- There is **no `bunfig.toml`**, so `bun test` runs files **sequentially**. Task 12's test cannot
  overlap `server.test.ts` at all.
- All of `analyzer-verify.test.ts` takes **786 ms**, including daemon start, engine fetch, two
  real Workers and Rapier wasm; both Workers are terminated and the daemon closed in `afterAll`.
- `server.test.ts` alone runs in **~500 ms against an 8000 ms window** — a 16× margin. That is
  not eroded by a neighbouring 786 ms; closing it needs an ~8 s stall.
- The recorded failure buffer shows **one `: ping`**, and `HEARTBEAT_MS = 15_000` — so that run
  had already burned ≥15 s inside a file that normally takes half a second. That is a ~30×
  machine-wide slowdown, not a marginal one.

Recorded rather than deleted: disclosing a possible self-inflicted cause was the right instinct,
but the follow-up measurement refutes the conclusion, and a backlog entry carrying a mechanism
its own evidence contradicts is worse than none.

## Likelier mechanism: a LOST event, not a slow one

`chokidarWatchFile` (`src/daemon/watch.ts:15`) is chokidar v4 — pure JS over `node:fs`, fsevents
dropped in v4 — and is armed **asynchronously** when `scene.open` lands, while the test's
`writeFileSync` follows two HTTP round trips later. If the watcher is not ready yet, the write is
missed **permanently**, and `readSse` then burns its whole window on keepalives — exactly the log
shape above (all same-process events present, then nothing but a ping).
`awaitWriteFinish: { stabilityThreshold: 100 }` adds a second polling dependency on the same
event loop.

That mechanism explains a long wait ending in silence. "The machine was busy" would have to
explain a 30× slowdown that nothing else in the run shows.

## Fix shape

**Preferred — remove the race.** Poll `scene.get` for the reloaded document instead of racing an
SSE frame, keeping the SSE assertion for the same-process events it is actually about. Or expose
a watcher-ready signal the test can await before writing.

**Rejected — widening `readSse`'s window.** It cannot fix a lost-`ready` race; it would only make
a wedged watcher take longer to fail. (An earlier revision of this entry listed it first as
"cheapest"; it is the weaker option and is demoted deliberately.) Note also that the short window
does real work on the *same-process* events, where 8 s would turn a wedged daemon into a slow
green — so do not widen every wait either.

**Trigger to revisit:** the next time `server.test.ts` fails in CI or a local full run, or when
the daemon's watcher arming or debounce changes.

**2026-08-04 — trigger fired, still unfixed.** One failure in the first of 9 whole-suite runs
during the `field-segment` extraction work, then `server.test.ts` failed once in isolation
(11 pass / 1 fail) in the same session. It did not reproduce in 4 further isolated runs with
that tree, nor in 6 with the tree's changes stashed, nor in 8 further whole-suite runs. The
failing run's detail was not captured, so the identification rests on the isolated repro rather
than on the run itself. Rate is consistent with the ~2/12 above; nothing new about the
mechanism, and the change in flight touched neither the daemon nor the watcher.

**Reference:** surfaced during F4 tranche B, Task 12 (verify e2e + segment clamp + `emits` swap);
causation corrected and the 36-run measurement added during that task's spec review.
