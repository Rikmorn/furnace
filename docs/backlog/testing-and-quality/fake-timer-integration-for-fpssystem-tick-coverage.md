# Fake-timer integration for FpsSystem tick coverage

`createFpsSystem` in `packages/core/src/lib/stats/fps.ts` (after Task 2 moves it there) exposes `subscribe`, `current`, and `dispose` — the API surface and initial state are unit-tested, but the actual `setInterval`-driven tick behaviour (frames-per-second math rolling over each second, listeners receiving values) is only covered by the end-to-end on-screen FPS counter. Bun's test runner doesn't ship fake timers; adding a third-party fake-timer dep just for this is overkill today.

**Trigger to revisit:** Second consumer of `createFpsSystem` lands (e.g., a telemetry sink, a test fixture), OR a regression in the tick math escapes to dev because there was no unit test catching it, OR Bun's test runner gains a built-in fake-timer API.

**Reference:** `packages/core/tests/lib/stats/fps.test.ts` (will live there after Task 2). The end-to-end on-screen FPS counter in `packages/hello-world` is the integration verification today.
