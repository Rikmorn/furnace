// The stamp session's pure state machine. No side effects and no engine
// imports beyond core types: plain transitions on plain data, so the
// supersession semantics (the run counter) unit-test without a host, a worker,
// or a GPU. The FieldHost owns the effects — selection→region snap, snapshot
// assembly, the worker round-trip, ghost meshes — and holds exactly one
// `StampSession | null`.
import type { MergePolicy } from "@furnace/core/field";

/** Where a stamp session stands: `configuring` = params live, no valid ghost
 *  (fresh, superseded, or errored); `previewing` = a ghost evaluate is in
 *  flight; `ready` = the ghost matches the current params — Enter commits. */
export type StampPhase = "configuring" | "previewing" | "ready";

/** The stamp's world-metre placement AABB (the generator anchors at `min`,
 *  snapped down to the 0.5 m lattice core-side). */
export type StampRegion = {
  min: [number, number, number];
  max: [number, number, number];
};

/** One staged-stamp session. `run` is the supersession counter: every
 *  params/seed/policy change bumps it and a preview response carrying an older
 *  run is DROPPED ({@link withPreviewResult}/{@link withPreviewError} return
 *  null). Intra-session only — run restarts at 0 each {@link startSession},
 *  so the HOST must guard responses across sessions itself. `opCount`/`error`
 *  are the last preview's outcome (both null while none applies).
 *  `truncatedSelection` records that the region came from a selection whose
 *  flood hit the UI budget — the region under-covers the true flood, and the
 *  stamp UI (Task 15) surfaces that instead of silently stamping short. */
export type StampSession = {
  generator: string;
  params: Record<string, unknown>;
  seed: number;
  policy: MergePolicy;
  region: StampRegion;
  phase: StampPhase;
  run: number;
  opCount: number | null;
  error: string | null;
  truncatedSelection: boolean;
};

/** Opens a session in `configuring` at run 0 with the generator's schema
 *  defaults and the default `replace` policy. The caller owns aliasing:
 *  `defaults`/`region` are stored as given (the host clones at its boundary). */
export function startSession(
  generator: string,
  defaults: Record<string, unknown>,
  region: StampRegion,
  seed: number,
  truncatedSelection: boolean,
): StampSession {
  return {
    generator,
    params: defaults,
    seed,
    policy: "replace",
    region,
    phase: "configuring",
    run: 0,
    opCount: null,
    error: null,
    truncatedSelection,
  };
}

/** A params/seed/policy change: back to `configuring`, run bumped (any
 *  in-flight preview is invalidated — its response will carry the old run),
 *  last preview outcome cleared. */
export function withParams(
  s: StampSession,
  params: Record<string, unknown>,
  seed: number,
  policy: MergePolicy,
): StampSession {
  return {
    ...s,
    params,
    seed,
    policy,
    phase: "configuring",
    run: s.run + 1,
    opCount: null,
    error: null,
  };
}

/** Marks a preview in flight for the session's CURRENT run. */
export function toPreviewing(s: StampSession): StampSession {
  return { ...s, phase: "previewing" };
}

/** A preview success for `run`: null when the run is stale (the caller drops
 *  the response — a newer preview owns the ghost); else `ready` carrying the
 *  evaluated op count. */
export function withPreviewResult(
  s: StampSession,
  run: number,
  opCount: number,
): StampSession | null {
  if (run !== s.run) return null;
  return { ...s, phase: "ready", opCount, error: null };
}

/** A preview failure for `run`: null when the run is stale; else back to
 *  `configuring` carrying the message (there is no valid ghost to commit). */
export function withPreviewError(
  s: StampSession,
  run: number,
  message: string,
): StampSession | null {
  if (run !== s.run) return null;
  return { ...s, phase: "configuring", opCount: null, error: message };
}

/** A latest-wins in-flight latch for preview jobs (the worker client is a
 *  plain request pipe — callers own coalescing). `request()` fires
 *  immediately when idle; while a job is in flight, any number of further
 *  requests collapse into ONE queued flag. `settle()` — which the job's
 *  owner must call on EVERY settlement (result or error, stale or not) —
 *  releases the latch and re-fires exactly once if anything queued. `fire`
 *  returns whether a job was actually posted; false (e.g. the session is
 *  gone by fire time) leaves the latch idle instead of wedging it. Pure so
 *  the collapse semantics unit-test without a worker; latest-wins comes from
 *  the fire callback reading the CURRENT session state at fire time. */
export function createPreviewCoalescer(fire: () => boolean): {
  request(): void;
  settle(): void;
} {
  let inFlight = false;
  let queued = false;
  return {
    request(): void {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = fire();
    },
    settle(): void {
      inFlight = false;
      if (!queued) return;
      queued = false;
      inFlight = fire();
    },
  };
}
