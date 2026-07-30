// The bun-environment gap every FieldHost test has to fill, in one place.
//
// `requestAnimationFrame`/`cancelAnimationFrame` do not exist under bun, and the
// host reaches for both: it schedules its render loop through rAF at the end of
// `init` and at the end of every tick, and `cancelAnimationFrame` is the first
// line of `dispose`. A test that leaves them missing dies in the host's own
// plumbing, upstream of anything it meant to exercise.
//
// THREE shapes, because three different things are being bought. Do not collapse
// them — each caller depends on the one it picked:
//  - `stubAnimationFrameNoop` — the loop must EXIST and must NOT RUN. For tests
//    driven entirely through the host's methods or its input handlers, where a
//    tick would only render, and under bun-webgpu that render is invalid anyway.
//  - `stubAnimationFrameCaptured` — the loop is in the TEST's hand: the pending
//    callback is captured and `tick(now)` fires it once. The only way to reach
//    what lives inside a frame (`drainDirty`, the per-frame `FieldStats` push).
//  - `stubCancelAnimationFrame` — cAF alone, for headless suites that never
//    `init` a host (so nothing scheduled a frame) but do call `dispose`.
//
// All three restore exactly what was there: a global that was absent goes back
// to absent, so nothing leaks into the next file in the run.

/** Both rAF globals, stubbed so the host's loop exists but never runs on its own.
 *  Returns the restore. */
export function stubAnimationFrameNoop(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = ["requestAnimationFrame", "cancelAnimationFrame"].map(
    (name) => ({ name, had: name in g, prev: g[name] }),
  );
  g["requestAnimationFrame"] = () => 1;
  g["cancelAnimationFrame"] = () => undefined;
  return () => {
    for (const { name, had, prev } of saved) {
      if (had) g[name] = prev;
      else delete g[name];
    }
  };
}

/** Both rAF globals, stubbed so the loop never runs on its own but its callback
 *  is CAPTURED: `tick(now)` runs the one frame the host has pending, and throws
 *  if it scheduled none (a silent no-op there would read as a passing test that
 *  never entered the frame). */
export function stubAnimationFrameCaptured(): {
  restore: () => void;
  tick: (now: number) => void;
} {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = ["requestAnimationFrame", "cancelAnimationFrame"].map(
    (name) => ({ name, had: name in g, prev: g[name] }),
  );
  let pending: ((now: number) => void) | null = null;
  g["requestAnimationFrame"] = (fn: (now: number) => void) => {
    pending = fn;
    return 1;
  };
  g["cancelAnimationFrame"] = () => undefined;
  return {
    tick: (now) => {
      const fn = pending;
      if (fn === null) throw new Error("test: the host scheduled no frame");
      pending = null;
      fn(now);
    },
    restore: () => {
      for (const { name, had, prev } of saved) {
        if (had) g[name] = prev;
        else delete g[name];
      }
    },
  };
}

/** `cancelAnimationFrame` alone — enough for `dispose()` in a suite that never
 *  scheduled a frame. Returns the restore. */
export function stubCancelAnimationFrame(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = "cancelAnimationFrame" in g;
  const prev = g["cancelAnimationFrame"];
  g["cancelAnimationFrame"] = () => undefined;
  return () => {
    if (had) g["cancelAnimationFrame"] = prev;
    else delete g["cancelAnimationFrame"];
  };
}
