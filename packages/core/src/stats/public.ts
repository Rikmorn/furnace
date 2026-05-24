import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/context-types.ts";
import type { Path, PathValue } from "./path.ts";
import { buildSnapshot, type Snapshot } from "./snapshot.ts";
import { ZERO_SNAPSHOT } from "./zero-snapshot.ts";

export type { Path, PathValue } from "./path.ts";
export type { Snapshot } from "./snapshot.ts";

export function snapshot(ctx: Context): Snapshot {
  if (ctx._internal.disposed) return ZERO_SNAPSHOT;
  return buildSnapshot(ctx._internal.stats);
}

export function onFrame(ctx: Context, fn: (s: Snapshot) => void): () => void {
  if (ctx._internal.disposed) {
    throw new FurnaceError("stats.onFrame: context is disposed");
  }
  ctx._internal.stats.onFrameSubscribers.add(fn);
  return () => {
    ctx._internal.stats.onFrameSubscribers.delete(fn);
  };
}

export function get<P extends Path<Snapshot>>(
  ctx: Context,
  path: P,
): PathValue<Snapshot, P> | null {
  if (ctx._internal.disposed) return null;
  const snap = buildSnapshot(ctx._internal.stats);
  // Walk the dotted path. Untyped at runtime; the type signature constrains call sites.
  const parts = path.split(".");
  let cur: unknown = snap;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    // Boundary cast: runtime string traversal of the Snapshot object graph; Path<Snapshot> ensures structural validity at the call site.
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur === undefined) return null;
  // Boundary cast: returning runtime-traversed value as the statically-resolved PathValue<Snapshot, P>; the Path<Snapshot> constraint is the invariant.
  return cur as PathValue<Snapshot, P>;
}

export type Measurement = Readonly<{ end: () => void }>;

function badInput(op: string, name: string, reason: string): void {
  console.warn(
    `[furnace/stats] ${op}(${JSON.stringify(name)}): ${reason}; ignored`,
  );
}

function validName(op: string, name: string): boolean {
  if (typeof name !== "string" || name.length === 0) {
    badInput(op, name, "name must be a non-empty string");
    return false;
  }
  return true;
}

function noCrossKindCollision(
  ctx: Context,
  op: string,
  name: string,
  target: "gauges" | "counters" | "measures",
): boolean {
  const s = ctx._internal.stats;
  const others = (["gauges", "counters", "measures"] as const).filter(
    (k) => k !== target,
  );
  for (const k of others) {
    if (s[k].has(name)) {
      badInput(
        op,
        name,
        `name already in use as ${k.slice(0, -1)} (custom names must be unique across kinds)`,
      );
      return false;
    }
  }
  return true;
}

export function gauge(ctx: Context, name: string, value: number): void {
  if (ctx._internal.disposed) return;
  if (!validName("gauge", name)) return;
  if (!Number.isFinite(value)) {
    badInput("gauge", name, "value not finite");
    return;
  }
  if (!noCrossKindCollision(ctx, "gauge", name, "gauges")) return;
  ctx._internal.stats.gauges.set(name, value);
}

export function increment(ctx: Context, name: string, by = 1): void {
  if (ctx._internal.disposed) return;
  if (!validName("increment", name)) return;
  if (!Number.isFinite(by)) {
    badInput("increment", name, "delta not finite");
    return;
  }
  if (by < 0) {
    badInput(
      "increment",
      name,
      "negative delta not allowed (counters are monotonic — use gauge for absolute values)",
    );
    return;
  }
  if (!noCrossKindCollision(ctx, "increment", name, "counters")) return;
  const cur = ctx._internal.stats.counters.get(name) ?? 0;
  ctx._internal.stats.counters.set(name, cur + by);
}

export function measure(ctx: Context, name: string, fn: () => void): void {
  if (ctx._internal.disposed) {
    // Disposed: fn is intentionally not invoked. Per spec § 5 — passive on disposed.
    void fn;
    return;
  }
  if (!validName("measure", name)) return;
  if (!noCrossKindCollision(ctx, "measure", name, "measures")) return;
  const t0 = performance.now();
  try {
    fn();
  } finally {
    ctx._internal.stats.measures.set(name, performance.now() - t0);
  }
}

export function startMeasurement(ctx: Context, name: string): Measurement {
  if (ctx._internal.disposed) return Object.freeze({ end: () => undefined });
  if (!validName("startMeasurement", name))
    return Object.freeze({ end: () => undefined });
  if (!noCrossKindCollision(ctx, "startMeasurement", name, "measures")) {
    return Object.freeze({ end: () => undefined });
  }
  const t0 = performance.now();
  let ended = false;
  return Object.freeze({
    end: () => {
      if (ended) {
        badInput("startMeasurement.end", name, "already ended");
        return;
      }
      ended = true;
      ctx._internal.stats.measures.set(name, performance.now() - t0);
    },
  });
}
