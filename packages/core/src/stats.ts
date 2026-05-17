export type StatsCallback = (fps: number) => void;

export interface FpsStats {
  frame(): void;
  dispose(): void;
}

export interface StatsOptions {
  onTick: StatsCallback;
  intervalMs?: number;
  now?: () => number;
}

export function computeFps(frames: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  return Math.round(frames / elapsedSeconds);
}

export function initStats({
  onTick,
  intervalMs = 1000,
  now = () => performance.now(),
}: StatsOptions): FpsStats {
  let frames = 0;
  let lastTickAt = now();

  const tick = (): void => {
    const nowMs = now();
    const elapsedSeconds = (nowMs - lastTickAt) / 1000;
    onTick(computeFps(frames, elapsedSeconds));
    frames = 0;
    lastTickAt = nowMs;
  };

  const intervalId = setInterval(tick, intervalMs);

  return {
    frame: () => {
      frames++;
    },
    dispose: () => {
      clearInterval(intervalId);
    },
  };
}
