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
