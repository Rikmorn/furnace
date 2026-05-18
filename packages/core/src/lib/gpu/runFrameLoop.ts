export type FrameCallback = (timestampMs: number) => void;

export interface FrameLoopHandle {
  stop(): void;
}

export function runFrameLoop(onFrame: FrameCallback): FrameLoopHandle {
  let rafId = 0;
  let stopped = false;

  const tick = (timestampMs: number): void => {
    if (stopped) return;
    onFrame(timestampMs);
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    },
  };
}
