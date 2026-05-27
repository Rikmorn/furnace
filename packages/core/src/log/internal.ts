/**
 * Discrete severity level on a {@link LogEntry}. The engine emits at
 * `warn` (recoverable misuse, resource-leak warnings, bad-input no-ops)
 * and `error` (subscriber throws, GPU uncaptured errors, device lost).
 * `info` and `debug` are reserved for future engine verbosity — they
 * exist as entry points but have no engine call sites today.
 */
export type LogLevel = "warn" | "error" | "info" | "debug";

/**
 * Structured log event delivered to the active {@link LogSink}.
 *
 * Fields are guaranteed present on every entry; the sink never receives
 * a partial entry. `rest` is a (possibly empty) read-only array of any
 * additional arguments the call site passed beyond `module` and `message`.
 */
export type LogEntry = Readonly<{
  level: LogLevel;
  module: string;
  message: string;
  rest: readonly unknown[];
  timestampMs: number;
}>;

/**
 * Receives every {@link LogEntry} the engine emits while installed.
 *
 * Sinks run synchronously. A throwing sink propagates to the caller —
 * the engine does not swallow consumer-supplied callback failures
 * (matches the standard event-subscriber contract).
 */
export type LogSink = (entry: LogEntry) => void;

/**
 * The default sink. Formats each entry with the `[furnace/<module>]`
 * prefix and routes to the matching `console.*` method:
 *
 * - `error` → `console.error`
 * - `warn`  → `console.warn`
 * - `info`  → `console.info`
 * - `debug` → `console.debug`
 *
 * Exported so consumers can compose (`setSink(e => { consoleSink(e);
 * telemetry(e); })`) or restore the default explicitly after a
 * `setSink(null)` silence.
 */
export const consoleSink: LogSink = (entry) => {
  const prefix = `[furnace/${entry.module}]`;
  switch (entry.level) {
    case "error":
      console.error(prefix, entry.message, ...entry.rest);
      return;
    case "warn":
      console.warn(prefix, entry.message, ...entry.rest);
      return;
    case "info":
      console.info(prefix, entry.message, ...entry.rest);
      return;
    case "debug":
      console.debug(prefix, entry.message, ...entry.rest);
      return;
    default: {
      // Exhaustiveness guard: if a new LogLevel is added, this assertion
      // fails at compile time, forcing the switch to be updated.
      const _exhaustive: never = entry.level;
      return _exhaustive;
    }
  }
};

// Module-level mutable singleton — documented exception to master spec
// §1.3. Logging is process-level (must work before any ctx exists);
// per-context sinks would force every call site to plumb Context, and
// many engine warn/error paths have no context available.
let currentSink: LogSink | null = consoleSink;

/**
 * Replace the active log sink. Pass `null` to silence the engine (no
 * entry is built and no sink invoked). Pass {@link consoleSink} to
 * restore the default explicitly.
 *
 * @remarks
 *
 * Replacement semantics — exactly one sink at any moment. To run
 * multiple destinations, wrap them in a single sink function.
 */
export function setSink(sink: LogSink | null): void {
  currentSink = sink;
}

function emit(
  level: LogLevel,
  module: string,
  message: string,
  rest: unknown[],
): void {
  if (currentSink === null) return;
  currentSink({
    level,
    module,
    message,
    rest,
    timestampMs: performance.now(),
  });
}

export function warn(
  module: string,
  message: string,
  ...rest: unknown[]
): void {
  emit("warn", module, message, rest);
}

export function error(
  module: string,
  message: string,
  ...rest: unknown[]
): void {
  emit("error", module, message, rest);
}

export function info(
  module: string,
  message: string,
  ...rest: unknown[]
): void {
  emit("info", module, message, rest);
}

export function debug(
  module: string,
  message: string,
  ...rest: unknown[]
): void {
  emit("debug", module, message, rest);
}
