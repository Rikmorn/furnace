export const FRAME_WINDOW_CAPACITY = 120;

export type FrameWindow = {
  ring: Float32Array;
  writeIndex: number;
  filled: number;
  sum: number;
  min: number;
  max: number;
};

export function createFrameWindow(): FrameWindow {
  return {
    ring: new Float32Array(FRAME_WINDOW_CAPACITY),
    writeIndex: 0,
    filled: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  };
}

export function pushFrameMs(w: FrameWindow, value: number): void {
  if (w.filled === FRAME_WINDOW_CAPACITY) {
    const outgoing = w.ring[w.writeIndex] ?? 0;
    w.sum += value - outgoing;
    w.ring[w.writeIndex] = value;
    w.writeIndex = (w.writeIndex + 1) % FRAME_WINDOW_CAPACITY;
    // Rescan in two paths: incoming may not be the new extreme, and the
    // outgoing value may have been the sole holder of the cached extreme.
    if (value < w.min) w.min = value;
    else if (outgoing === w.min) w.min = rescanMin(w);
    if (value > w.max) w.max = value;
    else if (outgoing === w.max) w.max = rescanMax(w);
    return;
  }
  w.ring[w.writeIndex] = value;
  w.writeIndex = (w.writeIndex + 1) % FRAME_WINDOW_CAPACITY;
  w.filled++;
  w.sum += value;
  if (value < w.min) w.min = value;
  if (value > w.max) w.max = value;
}

function rescanMin(w: FrameWindow): number {
  let m = Number.POSITIVE_INFINITY;
  for (let i = 0; i < w.filled; i++) {
    const v = w.ring[i] ?? Number.POSITIVE_INFINITY;
    if (v < m) m = v;
  }
  return m;
}

function rescanMax(w: FrameWindow): number {
  let m = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < w.filled; i++) {
    const v = w.ring[i] ?? Number.NEGATIVE_INFINITY;
    if (v > m) m = v;
  }
  return m;
}

export function computeP99(w: FrameWindow): number {
  if (w.filled === 0) return 0;
  const scratch = new Float32Array(w.filled);
  scratch.set(w.ring.subarray(0, w.filled));
  scratch.sort();
  const idx = Math.floor((w.filled - 1) * 0.99);
  return scratch[idx] ?? 0;
}

export function getMean(w: FrameWindow): number {
  if (w.filled === 0) return 0;
  return w.sum / w.filled;
}
