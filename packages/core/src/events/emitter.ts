import type { Context } from "../gpu/context-types.ts";
import { error } from "../log/internal.ts";
import { _recordEmission } from "../stats/internal.ts";

/**
 * A minimal pub-sub emitter primitive.
 *
 * Generic over the event data type `T` (use `void` for events that carry no payload).
 *
 * - `on(listener)` subscribes a listener and returns an unsubscribe function.
 * - `emit(data)` fires all current listeners synchronously. Listener throws are caught
 *   and logged; the throw does not interrupt other listeners or propagate to the caller.
 * - `clear()` removes all listeners.
 * - `listenerCount` (read-only) returns the current listener count.
 *
 * @remarks
 *
 * **Snapshot-iteration semantics:** When `emit()` is called, listeners are snapshotted
 * before the callback loop begins. Listeners added during the emit fire on the *next*
 * emit. Listeners removed during the emit (via their unsubscribe function) are skipped
 * in the *current* emit.
 *
 * **Subscriber error handling:** If a listener throws, the error is caught and
 * routed to the engine log helper (see `@furnace/core/log`) at `error` level;
 * iteration continues over remaining listeners. This follows the engine's
 * runtime-quiet policy — subscriber failures do not break the emitter.
 */
export type Emitter<T> = Readonly<{
  on(listener: (data: T) => void): () => void;
  emit(data: T): void;
  clear(): void;
  readonly listenerCount: number;
}>;

/**
 * Create a new emitter instance.
 *
 * @param ctx - Optional. When provided together with a non-empty `name`, each
 * `emit` increments the `events.perEmitter[name]` counter in the stats snapshot.
 * See {@link stats.Snapshot}.
 * @param name - Optional. Non-empty string name for stats recording. Ignored if `ctx`
 * is absent or `name` is empty. Stats recording requires both parameters.
 *
 * @returns A new `Emitter<T>` instance.
 *
 * @remarks
 *
 * The returned emitter is independent of other emitters — subscribing to one does not
 * affect others. When neither `ctx` nor `name` are provided, stats recording is skipped
 * entirely (zero overhead for simple event sources).
 */
export function createEmitter<T = void>(
  ctx?: Context,
  name?: string,
): Emitter<T> {
  const listeners = new Set<(data: T) => void>();
  return Object.freeze({
    on(listener: (data: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(data: T): void {
      // Inline narrowing: TS narrows ctx → Context and name → string inside the
      // if-block; a hoisted boolean would not carry the narrowing into this closure.
      if (ctx !== undefined && name !== undefined && name.length > 0) {
        _recordEmission(ctx, name);
      }
      // Snapshot before iterating so adds-during-emit don't fire this round.
      const snapshot = Array.from(listeners);
      // Track removals-during-emit so removed listeners don't fire either.
      for (const listener of snapshot) {
        if (listeners.has(listener)) {
          try {
            listener(data);
          } catch (err) {
            // One bad subscriber must not break the iteration over the rest,
            // nor leak into whoever called emit() — for DOM-dispatched listeners
            // (gpu.onResize, input.onKeyDown, etc.) the unhandled throw would fire
            // the window's "error" event. Per the master arch spec § "No silent
            // failures": surface it via the log helper, don't swallow.
            error("events", "subscriber threw", err);
          }
        }
      }
    },
    clear(): void {
      listeners.clear();
    },
    get listenerCount(): number {
      return listeners.size;
    },
  });
}
