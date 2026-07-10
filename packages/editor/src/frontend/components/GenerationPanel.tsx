import { useState } from "react";
import type { PreviewHost } from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import {
  clampLoop,
  clampRooms,
  type EnvelopeRow,
  envelopeRowFor,
  type GenerationSession,
  type GenerationStatus,
  invalidateDonePreview,
  isValidWingName,
  layoutBounds,
  MAX_LOOP,
  mergeContents,
  nextRerollSeed,
  type RealizeResult,
  reliabilityText,
  toWireFiles,
} from "../lib/generation.ts";
import { useEditor } from "./editor-context.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

// The minimal structural shape of ONE placed layout the panel realizes. Declared locally
// (the frontend can't import the dungeon's LayoutResult by value); narrowed at the `ext`
// boundary cast below. Region `bounds` feed layoutBounds; `provenance.theme` filters the
// authored phantom (empty geometry) out of the realize set. The worker streams `layout`
// opaquely — only this seam reads inside it.
type Vec3 = [number, number, number];
type PreviewRegion = {
  provenance: { theme: string };
  instances: unknown[];
  bounds: { min: Vec3; max: Vec3 };
};
type PreviewAttempt = {
  layout?: {
    regions: PreviewRegion[];
    connectors: { bounds: { min: Vec3; max: Vec3 } }[];
  };
};

function statusText(s: GenerationStatus): string {
  switch (s.phase) {
    case "idle":
      return "idle — set a seed and generate";
    case "running":
      return `generating… attempt ${s.attempt}/${s.totalAttempts}`;
    case "done":
      return `previewing "${s.attemptSeed}" (attempt ${s.attempt}) — freeze to bake`;
    case "baking":
      return "baking…";
    case "baked":
      return `baked ${s.files} files — run the game to walk it`;
    case "failed":
      return `failed: ${s.error}`;
    case "cancelled":
      return "cancelled";
  }
}

export function GenerationPanel() {
  const { state, dispatch, previewHostRef, extensions, generation } =
    useEditor();
  // The session, the bake destination (wingName), and the worker client are all owned by
  // App (context slice) — NOT local state. That is the lift: closing the panel unmounts this
  // component, but an in-flight run's async setter calls target App state through these
  // stable setters, so the run keeps advancing and the session is intact on reopen. The
  // client is App-owned too, so Cancel terminates the SAME worker the run drives across a
  // reopen (Slice 3.2.3: run/bake on a worker; cancel = terminate, instant mid-attempt).
  const { session, setSession, wingName, setWingName, client } = generation;

  // Boundary cast: `extensions` is the engine bundle's untyped `extensions` namespace —
  // the dungeon's editor-extensions re-exports, crossing the project-first bundle boundary
  // as Record<string, unknown>. This is the SINGLE panel seam that narrows the generator
  // surface to the shapes the cockpit calls; the engine owns their real types. worldAttempts
  // and bake now run WORKER-side (via `client`); the panel only realizes/frames on the main
  // thread (GPU ctx) and reads the measured envelope.
  const ext = extensions as {
    realizeRegion: (
      ctx: unknown,
      world: unknown,
      cache: unknown,
      region: unknown,
    ) => Promise<RealizeResult>;
    MaterialCache: new (ctx: unknown) => { destroy: () => void };
    COCKPIT_CONFIG: Record<string, unknown>;
    COCKPIT_BUDGET: Record<string, unknown>;
    COCKPIT_ENVELOPE: EnvelopeRow[];
    wingDir: (name: string) => string;
  };
  const envelope = ext.COCKPIT_ENVELOPE;

  // Draft state for the clamped knobs: hold the raw text while typing, clamp on commit
  // (blur/Enter) so a mid-edit keystroke isn't clamped out from under the caret. A committed
  // out-of-envelope value surfaces a one-line note (setup-loud, never fail-slow-searched).
  const [roomsDraft, setRoomsDraft] = useState<string | undefined>(undefined);
  const [loopDraft, setLoopDraft] = useState<string | undefined>(undefined);
  const [clampNote, setClampNote] = useState<string | undefined>(undefined);

  const setStatus = (status: GenerationStatus): void =>
    setSession((s) => ({ ...s, status }));

  // Editing a knob invalidates a `done` preview (see invalidateDonePreview): the on-screen
  // world no longer matches the controls, so Freeze must not bake against stale knobs.
  const patchConfig = (patch: Partial<GenerationSession["config"]>): void =>
    setSession((s) =>
      invalidateDonePreview({ ...s, config: { ...s.config, ...patch } }),
    );

  const commitRooms = (): void => {
    if (roomsDraft === undefined) return;
    const raw = roomsDraft.trim();
    setRoomsDraft(undefined);
    setClampNote(undefined); // every commit clears any prior note
    if (raw === "") return; // empty field → revert to the committed value, no note
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const clamped = clampRooms(envelope, v);
    const first = envelope[0]?.rooms ?? clamped;
    const last = envelope[envelope.length - 1]?.rooms ?? clamped;
    // Note ONLY when genuinely out of range — a non-integer in range is just rounded
    // to the nearest knob value, which needs no "outside the envelope" note.
    if (v < first || v > last) {
      setClampNote(
        `rooms ${v} is outside the measured envelope — clamped to ${clamped}`,
      );
    }
    patchConfig({ targetRooms: clamped });
  };

  const commitLoop = (): void => {
    if (loopDraft === undefined) return;
    const raw = loopDraft.trim();
    setLoopDraft(undefined);
    setClampNote(undefined);
    if (raw === "") return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const clamped = clampLoop(v);
    // Note only when out of [0, MAX_LOOP] — snapping to the 0.05 step is expected.
    if (v < 0 || v > MAX_LOOP) {
      setClampNote(`loop ${v} clamped to ${clamped}`);
    }
    patchConfig({ loopChance: clamped });
  };

  // Realize a placed layout into the preview host and frame the camera on it. Main-thread:
  // needs the preview host's GPU ctx, so this stays here even though the search runs worker-side.
  const previewLayout = async (
    host: PreviewHost,
    layout: NonNullable<PreviewAttempt["layout"]>,
    attemptSeed: string,
    attempt: number,
    config: { targetRooms: number; loopChance: number },
  ): Promise<void> => {
    await host.clear();
    const cache = new ext.MaterialCache(host.ctx());
    // The authored phantom carries empty geometry (main.ts realizes the level itself),
    // so it is dropped from the preview; connectors follow the regions.
    const regions = layout.regions.filter(
      (r) => r.provenance.theme !== "authored",
    );
    const pieces = [...regions, ...layout.connectors];
    const results: RealizeResult[] = [];
    // Sequential (`for … await`): the MaterialCache is not concurrency-safe (its TSDoc).
    for (const r of pieces) {
      results.push(await ext.realizeRegion(host.ctx(), host.world(), cache, r));
    }
    host.adopt(mergeContents(results, cache));
    const [min, max] = layoutBounds(pieces);
    host.frame(min, max);
    host.render();
    setSession((s) => ({
      ...s,
      // Each attempt seed is unique per session (rerolls derive distinct seeds), so an
      // already-present seed means this is a re-preview from a history click — don't
      // re-prepend it (that duplicated the row every click).
      history: s.history.some((h) => h.attemptSeed === attemptSeed)
        ? s.history
        : [{ attemptSeed, baseSeed: s.baseSeed }, ...s.history],
      // Snapshot the config that PRODUCED this preview — freeze bakes from here, so a
      // later knob edit can't change what freeze produces (the slice's core guarantee).
      status: { phase: "done", attemptSeed, attempt, config },
    }));
  };

  // Run generation on the worker (Slice 3.2.3): the client streams attempt results; the
  // panel's only main-thread work is realizing the ONE winning layout. Attempts come from
  // the measured envelope row (attemptsOverride = 1 re-previews one exact seed from history).
  const runGeneration = (baseSeed: string, attemptsOverride?: number): void => {
    const host = previewHostRef.current;
    if (!host) return;
    dispatch({ type: "generation-active", active: true });

    // Snapshot the knob values THIS run uses, so the winning preview's `done` status
    // records exactly what produced it (freeze reads this snapshot, never live knobs).
    // Belt-and-braces clamp: programmatic state can bypass the input commit handlers.
    const runConfig = {
      targetRooms: clampRooms(envelope, session.config.targetRooms),
      loopChance: clampLoop(session.config.loopChance),
    };
    const attempts =
      attemptsOverride ??
      envelopeRowFor(envelope, runConfig.targetRooms)?.attempts ??
      1;
    const config: Record<string, unknown> = {
      ...ext.COCKPIT_CONFIG,
      ...runConfig,
      attempts,
    };
    setStatus({ phase: "running", attempt: 1, totalAttempts: attempts });

    // The most recent attempt's failure text — surfaces WHY the run died in the
    // failed status (a deadline give-up reads differently from search exhaustion).
    let lastError: string | undefined;
    client.run(
      { baseSeed, config, budget: ext.COCKPIT_BUDGET },
      {
        onAttempt: (a) => {
          if (a.ok && a.layout !== undefined) {
            // Boundary cast: the layout crossed the worker boundary opaquely; this
            // is the same engine-bundle shape previewLayout always consumed.
            void previewLayout(
              host,
              a.layout as NonNullable<PreviewAttempt["layout"]>,
              a.attemptSeed,
              a.k + 1,
              runConfig,
            ).catch((err) => {
              // Main-thread realize (GPU) failure surfaces honestly, not a wedge at
              // "running" (mirrors freeze's onBaked error path; D5 setup-loud extends
              // to realize).
              setStatus({
                phase: "failed",
                error: err instanceof Error ? err.message : String(err),
              });
            });
          } else {
            lastError = a.error;
            setStatus({
              phase: "running",
              attempt: Math.min(a.k + 2, attempts), // 1-based next; never exceed total
              totalAttempts: attempts,
            });
          }
        },
        onDone: (outcome) => {
          if (outcome === "exhausted") {
            setStatus({
              phase: "failed",
              error:
                `no placement in ${attempts} attempt(s)` +
                (lastError !== undefined ? ` (last: ${lastError})` : "") +
                " — Reroll tries new seeds",
            });
          }
          // "placed": previewLayout's own setSession already recorded the done status.
        },
        onError: (message) => setStatus({ phase: "failed", error: message }),
      },
    );
  };

  // Freeze & bake: re-bake the frozen wing from its winning derived seed ON THE WORKER (same
  // engine that previewed it → reproduces it exactly), then upload the produced file set to
  // the daemon (main-thread api call), which validates + writes + emits generation-baked.
  // Reads ONLY the `done`-status snapshot (seed + the config that produced the preview) —
  // NEVER live `session.config` — so freeze bakes exactly what is on screen even if the user
  // has since edited the knobs.
  const freeze = (done: {
    attemptSeed: string;
    config: { targetRooms: number; loopChance: number };
  }): void => {
    setStatus({ phase: "baking" });
    const config = { ...ext.COCKPIT_CONFIG, ...done.config, attempts: 1 };
    client.bake(
      // COCKPIT_BUDGET carries deadlineMs, but bakeWing strips it dungeon-side
      // (D4): the bake replay is counted-only deterministic.
      {
        attemptSeed: done.attemptSeed,
        config,
        budget: ext.COCKPIT_BUDGET,
        wingName,
      },
      {
        onBaked: (files) => {
          void (async () => {
            try {
              const result = await api.generationBake(
                toWireFiles(files),
                ext.wingDir(wingName),
              );
              setStatus({ phase: "baked", files: result.files });
            } catch (err) {
              setStatus({
                phase: "failed",
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })();
        },
        onError: (message) => setStatus({ phase: "failed", error: message }),
      },
    );
  };

  if (state.status !== "ready") {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        generation waits for the engine bundle…
      </p>
    );
  }

  const isRunning = session.status.phase === "running";
  const isBaking = session.status.phase === "baking";
  // The current previewed world (seed + its config snapshot), or undefined when nothing
  // is on screen to freeze. Freeze reads this exclusively — never live session.config.
  const done = session.status.phase === "done" ? session.status : undefined;
  const wingNameValid = isValidWingName(wingName);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Seed</span>
        <Input
          type="text"
          value={session.baseSeed}
          onChange={(e) =>
            setSession((s) =>
              invalidateDonePreview({ ...s, baseSeed: e.target.value }),
            )
          }
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Wing Name</span>
        <Input
          type="text"
          value={wingName}
          onChange={(e) => setWingName(e.target.value)}
          disabled={isRunning || isBaking}
          aria-invalid={!wingNameValid}
          className={cn(!wingNameValid && "border-destructive")}
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-muted-foreground">Rooms</span>
          <Input
            type="number"
            value={roomsDraft ?? String(session.config.targetRooms)}
            onChange={(e) => setRoomsDraft(e.target.value)}
            onBlur={commitRooms}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRooms();
            }}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-muted-foreground">Loop</span>
          <Input
            type="number"
            step={0.05}
            value={loopDraft ?? String(session.config.loopChance)}
            onChange={(e) => setLoopDraft(e.target.value)}
            onBlur={commitLoop}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLoop();
            }}
          />
        </label>
      </div>

      {/* The measured reliability line under the knobs — honest about low-yield sizes. */}
      <p className="text-xs text-muted-foreground">
        {reliabilityText(envelopeRowFor(envelope, session.config.targetRooms))}
      </p>
      {clampNote !== undefined && (
        <p className="text-xs text-muted-foreground">{clampNote}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isRunning || isBaking}
          onClick={() => runGeneration(session.baseSeed)}
        >
          Generate
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isRunning || isBaking}
          onClick={() =>
            runGeneration(
              nextRerollSeed(session.baseSeed, session.history.length),
            )
          }
        >
          Reroll
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!isRunning}
          onClick={() => {
            client.cancel();
            setStatus({ phase: "cancelled" });
          }}
        >
          Cancel
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Freeze keeps the distinct success semantic (commit-to-disk); tailwind-merge
            lets the className override the default primary fill. */}
        <Button
          type="button"
          size="sm"
          disabled={done === undefined || !wingNameValid}
          onClick={() => {
            if (done !== undefined) freeze(done);
          }}
          className="bg-success text-success-foreground hover:bg-success/90"
        >
          Freeze &amp; bake
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!state.generationActive}
          onClick={() => dispatch({ type: "generation-active", active: false })}
        >
          Close preview
        </Button>
      </div>

      {/* Always-rendered STABLE aria-live region so each phase change (generating →
          previewing → baked/failed) is announced to assistive tech. */}
      <p className="text-muted-foreground" aria-live="polite">
        {statusText(session.status)}
      </p>

      {session.history.length > 0 && (
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-muted-foreground">History</span>
          <ul className="flex flex-col gap-1">
            {session.history.map((h, i) => (
              <li key={`${h.attemptSeed}-${i}`}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isRunning || isBaking}
                  onClick={() => runGeneration(h.attemptSeed, 1)}
                  className={cn(
                    "w-full justify-start px-2 text-left font-mono",
                    done?.attemptSeed === h.attemptSeed &&
                      "bg-primary/20 text-primary",
                  )}
                >
                  {h.attemptSeed}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
