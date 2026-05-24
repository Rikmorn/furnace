# Formal log helper + configurable sink for engine diagnostics

Tranche 5 surfaces diagnostics through direct `console.warn` / `console.error` calls with the existing `[furnace/<module>]` prefix from `events/emitter.ts`. This is consistent within the engine but has three known problems:

1. **Master spec § 10 disagrees with reality.** The "No engine-level logging" rule in `docs/superpowers/specs/2026-05-21-core-architecture-design.md` forbids `console.log` / `console.warn`. `events/emitter.ts` already deviates; tranche 5 adds ~4 more sites (`stats` bad-input, `stats` subscriber-throw catch, `gpu` uncaptured-error listener, `gpu` resource-leak warning). Reconciling spec and code is overdue.
2. **No consumer integration path.** Engine writes to `console` unconditionally; consumers can't redirect to their telemetry or silence in production.
3. **No level filtering.** All warns and errors fire; no way to dial verbosity.

Recommended shape (settled in this session's brainstorm; deferred for size): a small `@furnace/core/log` sub-path module exposing `log.warn(module, message, ...rest)`, `log.error(module, message, ...rest)`, `log.setSink(sink | null)`, and `LogSink` / `LogLevel` types. Default sink writes to console with the existing prefix. Module-level mutable state for the sink — documented exception to master spec § 1.3, same way `stats` instrumentation is — because logging is a process-level diagnostic concern, not a context-level one, and needs to work before any ctx exists.

Migrate the existing console sites in `events/emitter.ts`, `stats/*`, and `gpu/context.ts` to use the helper. Update master spec § 10 to replace "No engine-level logging" with the formal sink pattern.

**Trigger to revisit:** When console-site count exceeds ~5 OR when a consumer (not hello-world) asks how to integrate furnace diagnostics with their logging system. Could also be triggered by a session where Safari-style silent failures recur and we need richer per-site context.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-5-stats-expansion-design.md` § Section 10 — Logging (interim). Memory: `~/.claude/projects/-Users-roberto-sousa-Documents-Projects-furnace/memory/feedback_setup_loud_runtime_quiet.md`.
