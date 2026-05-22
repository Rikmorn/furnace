export type Emitter<T> = Readonly<{
  on(listener: (data: T) => void): () => void;
  emit(data: T): void;
  clear(): void;
  readonly listenerCount: number;
}>;

export function createEmitter<T = void>(): Emitter<T> {
  const listeners = new Set<(data: T) => void>();
  return Object.freeze({
    on(listener: (data: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(data: T): void {
      // Snapshot before iterating so adds-during-emit don't fire this round.
      const snapshot = Array.from(listeners);
      // Track removals-during-emit so removed listeners don't fire either.
      for (const listener of snapshot) {
        if (listeners.has(listener)) {
          listener(data);
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
