# The daemon's SSE watcher-reload wait flakes under whole-suite load

`packages/editor/tests/server.test.ts`, test *"session lifecycle over HTTP with a live SSE
feed + watcher reload"*, intermittently fails at its last wait:

```
error: SSE timeout; buffer so far:
: connected
event: scene-opened  … event: document-changed (scene.addEntity) … event: document-changed (scene.undo)
: ping
```

The events up to `scene.undo` all arrive; the one that times out is the **file-watcher**
`file-reload` after a direct `writeFileSync` to `scenes/cube.scene.json`. `readSse`'s window is
a hard-coded `timeoutMs = 8000` (`tests/server.test.ts:161`), and the watcher's own debounce
plus the daemon's reload has to fit inside it.

Observed **2 failures in ~12 whole-suite runs** on the F4 tranche-B branch, and **0 in 10 runs
of `server.test.ts` in isolation** — so it is load-sensitive, not a logic bug. **6** base-tree
whole-suite runs (working tree stashed) did not reproduce it, which at that sample size neither
confirms nor rules out a rate change; what it does establish is that nothing in F4 tranche B
touches `src/daemon/`, so the code under the failing assertion is unchanged.

**Honest caveat on causation.** F4 Task 12 added a second real-Worker + Rapier-wasm verify to
`tests/analyzer-verify.test.ts`, which already started a daemon in `beforeAll`. That is real
extra concurrent work inside the same suite run, so this task plausibly *raised the rate* of an
already-flaky wait without introducing it. Treat the 2/12 figure as an upper bound on a branch
that is heavier than base, not as a measurement of the flake's baseline rate.

**Fix shape (pick one, cheapest first):**
- Raise `readSse`'s default window, or take a longer one for the watcher wait specifically —
  the other waits in that test are same-process round trips and settle in milliseconds; only
  the watcher one crosses the filesystem.
- Or make the watcher wait poll `scene.get` for the reloaded document instead of racing an SSE
  frame, keeping the SSE assertion for the same-process events it is actually about.

Do NOT "fix" it by widening every wait — the short window is doing real work on the
same-process events, where an 8 s wait would turn a wedged daemon into a slow green.

**Trigger to revisit:** the next time `server.test.ts` fails in CI or a local full run, or when
the daemon's watcher debounce changes.

**Reference:** surfaced during F4 tranche B, Task 12 (verify e2e + segment clamp + `emits`
swap). The failing run's full log shape is reproduced above.
