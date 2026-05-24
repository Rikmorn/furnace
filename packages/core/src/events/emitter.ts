import type { Context } from "../gpu/context-types.ts";
import { _recordEmission } from "../stats/internal.ts";

export type Emitter<T> = Readonly<{
  on(listener: (data: T) => void): () => void;
  emit(data: T): void;
  clear(): void;
  readonly listenerCount: number;
}>;

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
            // failures": surface it via console.error, don't swallow.
            console.error("[furnace/events] subscriber threw:", err);
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
