# Session concurrent-open race hardening (deferred from M4, 2026-06-11)

**Context.** `packages/editor/src/daemon/session.ts` (M4, Task 6) has two await-point races
that a code-quality review surfaced:

- **`onFileChanged`** captures `const s = state` then awaits `readFile` / `registry.current()`.
  If `open()` swaps `state` during one of those awaits, the stale callback continues against the
  orphaned `s` and still calls `deps.emit()` — emitting a `file-conflict` / `document-changed`
  for the no-longer-open path/revision.
- **`apply`** awaits `registry.current()`; an `open()` during that await leaves `apply` mutating
  the orphaned old `OpenState` and emitting a `document-changed` for the old revision.

**Why deferred, not fixed inline.** The M4 spec (§2) explicitly descopes concurrency control:
"the daemon's single-threaded event loop serializes commands … not needed for single-user
local." The consequences are benign under that model: SSE events are notification-only
dirty-bits (spec §5) — a stale event just triggers a redundant `scene.get` refetch that returns
the live truth; stale mutations land on an orphaned state object, never the live session. The
practical interleaving window is a microtask for `apply` (registry is cached after first open)
and a `readFile` macrotask for `onFileChanged`, and both require an HTTP `scene.open` to land
mid-flight in a single-user editor. The `apply`-superseded case also carries a small design
decision (return silently vs. throw `no-session`) that wants its own call, not an inline guess.

**The fix when triggered.** Add a staleness guard after each `await` in `onFileChanged` and
`apply`: `if (s !== state) return;` (for `apply`, decide return-silently vs.
`throw EditorError("no-session", …)`). Cover all post-await paths. Add a test that interleaves
`open()` into a pending `apply()` / `onFileChanged()` (resolve the registry/readFile promise
manually) and asserts no stale event is emitted.

**Trigger to revisit.** Before/when M5 introduces continuous interactions (gizmo drags →
coalesced ~10Hz commits) or any second concurrent writer (multi-client, embedded agent), the
serialization assumption weakens and these guards become load-bearing. Also revisit if the live
gate ever shows a spurious conflict/ghost event.

**Reference.** `packages/editor/src/daemon/session.ts` (`onFileChanged`, `apply`); the command layer + change-feed contract is documented in `docs/reference/editor-architecture.md` (concurrency was descoped to single-user; events are notification-only). Surfaced by the Task 6 code-quality review.
