// Mock requestAnimationFrame + performance.now for deterministic frame-loop tests.
// Patches globals on setup(); restore() reverts. Use within a single test or beforeEach/afterEach.

type RafCallback = (timestampMs: number) => void;

export type MockRaf = {
  /** Advance the virtual clock by deltaMs and fire any scheduled RAF callbacks once. */
  advance(deltaMs: number): void;
  /** Set the virtual clock to an absolute time. */
  setTime(ms: number): void;
  /** Current virtual time. */
  now(): number;
  /** Fire visibilitychange events with the given hidden state. */
  setHidden(hidden: boolean): void;
  /** Restore the original globals. */
  restore(): void;
};

export function setupMockRaf(): MockRaf {
  let currentTime = 0;
  const pendingCallbacks: RafCallback[] = [];

  const visibilityListeners = new Set<() => void>();
  let documentHidden = false;

  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  const originalNow = globalThis.performance?.now;
  const originalDoc = globalThis.document;

  globalThis.requestAnimationFrame = ((cb: RafCallback): number => {
    pendingCallbacks.push(cb);
    return pendingCallbacks.length;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((_id: number): void => {
    // Simple mock: don't track per-id; the actual loop checks its own stopped flag.
    // Tests can advance() between cancel and the next callback to verify nothing fired.
  }) as typeof cancelAnimationFrame;

  if (globalThis.performance) {
    globalThis.performance.now = () => currentTime;
  }

  // Minimal document mock for visibilitychange.
  // Only patches if document exists (e.g., not in pure-Node test envs).
  const fakeDoc = {
    get hidden() {
      return documentHidden;
    },
    addEventListener(event: string, listener: () => void) {
      if (event === "visibilitychange") visibilityListeners.add(listener);
    },
    removeEventListener(event: string, listener: () => void) {
      if (event === "visibilitychange") visibilityListeners.delete(listener);
    },
  } as unknown as Document;
  (globalThis as { document?: Document }).document = fakeDoc;

  return {
    advance(deltaMs: number): void {
      currentTime += deltaMs;
      const callbacks = pendingCallbacks.splice(0);
      for (const cb of callbacks) cb(currentTime);
    },
    setTime(ms: number): void {
      currentTime = ms;
    },
    now(): number {
      return currentTime;
    },
    setHidden(hidden: boolean): void {
      documentHidden = hidden;
      for (const listener of visibilityListeners) listener();
    },
    restore(): void {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
      if (originalNow && globalThis.performance) {
        globalThis.performance.now = originalNow;
      }
      (globalThis as { document?: Document }).document = originalDoc;
    },
  };
}
