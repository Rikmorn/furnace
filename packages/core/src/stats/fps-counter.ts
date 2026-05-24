const WINDOW_MS = 1000;

export type FpsCounter = {
  windowStart: number;
  windowFrames: number;
  current: number;
};

export function createFpsCounter(now: number): FpsCounter {
  return { windowStart: now, windowFrames: 0, current: 0 };
}

export function tickFps(c: FpsCounter, now: number): void {
  c.windowFrames++;
  const elapsed = now - c.windowStart;
  if (elapsed >= WINDOW_MS) {
    c.current = (c.windowFrames * WINDOW_MS) / elapsed;
    c.windowFrames = 0;
    c.windowStart = now;
  }
}
