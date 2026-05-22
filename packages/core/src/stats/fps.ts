export function computeFps(frames: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  return Math.round(frames / elapsedSeconds);
}

export interface FpsSystemOptions {
  intervalMs?: number;
  now?: () => number;
}

export interface FpsSystem {
  frame(): void;
  subscribe(listener: (fps: number) => void): () => void;
  readonly current: number;
  dispose(): void;
}

export function createFpsSystem(options: FpsSystemOptions = {}): FpsSystem {
  const intervalMs = options.intervalMs ?? 1000;
  const now = options.now ?? (() => performance.now());

  let frames = 0;
  let lastTickAt = now();
  let current = 0;
  let disposed = false;
  const listeners = new Set<(fps: number) => void>();

  const tick = (): void => {
    const nowMs = now();
    const elapsedSeconds = (nowMs - lastTickAt) / 1000;
    current = computeFps(frames, elapsedSeconds);
    frames = 0;
    lastTickAt = nowMs;
    for (const listener of listeners) listener(current);
  };

  const intervalId = setInterval(tick, intervalMs);

  return {
    frame: () => {
      frames++;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get current() {
      return current;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(intervalId);
      listeners.clear();
    },
  };
}
