import { useRef, useState } from "react";
import type { PreviewHost } from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import {
  type GenerationSession,
  type GenerationStatus,
  initialSession,
  invalidateDonePreview,
  layoutBounds,
  mergeContents,
  nextRerollSeed,
  type RealizeResult,
  toWireFiles,
} from "../lib/generation.ts";
import { useEditor } from "./editor-context.ts";

// The generation config knobs' UI bounds. targetRooms brackets a single-sector wing;
// loopChance stays below the point where the placer struggles to satisfy cycles.
const MIN_ROOMS = 2;
const MAX_ROOMS = 12;
const MAX_LOOP = 0.6;
const LOOP_STEP = 0.05;

// The minimal structural shape of ONE worldAttempts yield the panel reads. Declared
// locally (the frontend can't import the dungeon's WorldAttempt by value); narrowed at
// the `ext` boundary cast below. Region `bounds` feed layoutBounds; `provenance.theme`
// filters the authored phantom (empty geometry) out of the realize set.
type Vec3 = [number, number, number];
type PreviewRegion = {
  provenance: { theme: string };
  instances: unknown[];
  bounds: { min: Vec3; max: Vec3 };
};
type PreviewAttempt = {
  ok: boolean;
  attempt: number;
  attemptSeed: string;
  error?: string;
  layout?: { regions: PreviewRegion[]; connectors: { bounds: { min: Vec3; max: Vec3 } }[] };
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
  const { state, dispatch, previewHostRef, extensions } = useEditor();
  const [session, setSession] = useState<GenerationSession>(initialSession);
  // Mirrors the host's fog flag (host default = off; see PreviewHost.setFog — game fog
  // at orbit distance hides the structure the cockpit exists to show).
  const [fogOn, setFogOn] = useState(false);
  // A ref (not state) so a mid-run flip is visible to the running loop synchronously.
  const cancelRef = useRef(false);

  // Boundary cast: `extensions` is the engine bundle's untyped `extensions` namespace —
  // the dungeon's editor-extensions re-exports, crossing the project-first bundle boundary
  // as Record<string, unknown>. This is the SINGLE panel seam that narrows the generator
  // surface to the shapes the cockpit calls; the engine owns their real types.
  const ext = extensions as {
    worldAttempts: (
      seed: string,
      config?: Record<string, unknown>,
      budget?: Record<string, unknown>,
    ) => Iterator<PreviewAttempt>;
    realizeRegion: (
      ctx: unknown,
      world: unknown,
      cache: unknown,
      region: unknown,
    ) => Promise<RealizeResult>;
    MaterialCache: new (ctx: unknown) => { destroy: () => void };
    COCKPIT_CONFIG: Record<string, unknown>;
    COCKPIT_BUDGET: Record<string, unknown>;
    bake: (
      seed: string,
      config: Record<string, unknown>,
      budget: Record<string, unknown>,
    ) => { files: { path: string; contents: string | Uint8Array }[] };
  };

  const setStatus = (status: GenerationStatus): void =>
    setSession((s) => ({ ...s, status }));

  // Editing a knob invalidates a `done` preview (see invalidateDonePreview): the on-screen
  // world no longer matches the controls, so Freeze must not bake against stale knobs.
  const patchConfig = (patch: Partial<GenerationSession["config"]>): void =>
    setSession((s) =>
      invalidateDonePreview({ ...s, config: { ...s.config, ...patch } }),
    );

  // Wait one paint before stepping the attempt iterator, so a placement search that
  // creaks doesn't freeze the whole cockpit (rAF → the browser paints; setTimeout(0)
  // → yields the macrotask so React can flush the "generating…" status first).
  const paintGap = (): Promise<void> =>
    new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  // Realize a placed layout into the preview host and frame the camera on it.
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
      history: [{ attemptSeed, baseSeed: s.baseSeed }, ...s.history],
      // Snapshot the config that PRODUCED this preview — freeze bakes from here, so a
      // later knob edit can't change what freeze produces (the slice's core guarantee).
      status: { phase: "done", attemptSeed, attempt, config },
    }));
  };

  // Step worldAttempts between paints until the first placed attempt (previewed) or the
  // budget is exhausted (failed). `attemptsOverride` = 1 re-previews one exact seed.
  const runGeneration = async (
    baseSeed: string,
    attemptsOverride?: number,
  ): Promise<void> => {
    const host = previewHostRef.current;
    if (!host) return;
    cancelRef.current = false;
    dispatch({ type: "generation-active", active: true });

    // Snapshot the knob values THIS run uses, so the winning preview's `done` status
    // records exactly what produced it (freeze reads this snapshot, never live knobs).
    const runConfig = {
      targetRooms: session.config.targetRooms,
      loopChance: session.config.loopChance,
    };
    const config: Record<string, unknown> = { ...ext.COCKPIT_CONFIG, ...runConfig };
    if (attemptsOverride !== undefined) config["attempts"] = attemptsOverride;
    const total = typeof config["attempts"] === "number" ? config["attempts"] : 1;

    const it = ext.worldAttempts(baseSeed, config, ext.COCKPIT_BUDGET);
    setStatus({ phase: "running", attempt: 0, totalAttempts: total });

    while (!cancelRef.current) {
      await paintGap();
      if (cancelRef.current) break; // cancelled during the paint gap — don't step
      const res = it.next();
      if (res.done) {
        setStatus({
          phase: "failed",
          error: `no placement in ${total} attempt(s)`,
        });
        return;
      }
      const attempt = res.value;
      setStatus({
        phase: "running",
        attempt: attempt.attempt + 1,
        totalAttempts: total,
      });
      if (attempt.ok && attempt.layout) {
        await previewLayout(
          host,
          attempt.layout,
          attempt.attemptSeed,
          attempt.attempt,
          runConfig,
        );
        return;
      }
    }
    setStatus({ phase: "cancelled" });
  };

  // Freeze & bake (the FALLBACK): re-bake the frozen wing from its winning derived seed
  // IN THIS BROWSER (same engine that previewed it → reproduces it exactly), then upload
  // the produced file set to the daemon, which validates + writes + emits generation-baked.
  // Reads ONLY the `done`-status snapshot (seed + the config that produced the preview) —
  // NEVER live `session.config` — so freeze bakes exactly what is on screen even if the
  // user has since edited the knobs.
  const freeze = async (done: {
    attemptSeed: string;
    config: { targetRooms: number; loopChance: number };
  }): Promise<void> => {
    setStatus({ phase: "baking" });
    try {
      const config = { ...ext.COCKPIT_CONFIG, ...done.config, attempts: 1 };
      const { files } = ext.bake(done.attemptSeed, config, ext.COCKPIT_BUDGET);
      const result = await api.generationBake(toWireFiles(files));
      setStatus({ phase: "baked", files: result.files });
    } catch (err) {
      setStatus({
        phase: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (state.status !== "ready") {
    return (
      <p className="p-3 text-sm text-neutral-500">
        generation waits for the engine bundle…
      </p>
    );
  }

  const isRunning = session.status.phase === "running";
  const isBaking = session.status.phase === "baking";
  // The current previewed world (seed + its config snapshot), or undefined when nothing
  // is on screen to freeze. Freeze reads this exclusively — never live session.config.
  const done =
    session.status.phase === "done" ? session.status : undefined;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-neutral-400">seed</span>
        <input
          type="text"
          value={session.baseSeed}
          onChange={(e) =>
            setSession((s) =>
              invalidateDonePreview({ ...s, baseSeed: e.target.value }),
            )
          }
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-neutral-400">rooms</span>
          <input
            type="number"
            min={MIN_ROOMS}
            max={MAX_ROOMS}
            value={session.config.targetRooms}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) patchConfig({ targetRooms: v });
            }}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-neutral-400">loop</span>
          <input
            type="number"
            min={0}
            max={MAX_LOOP}
            step={LOOP_STEP}
            value={session.config.loopChance}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) patchConfig({ loopChance: v });
            }}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isRunning || isBaking}
          onClick={() => void runGeneration(session.baseSeed)}
          className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-40"
        >
          Generate
        </button>
        <button
          type="button"
          disabled={isRunning || isBaking}
          onClick={() =>
            void runGeneration(
              nextRerollSeed(session.baseSeed, session.history.length),
            )
          }
          className="rounded bg-neutral-700 px-3 py-1 font-medium text-white disabled:opacity-40"
        >
          Reroll
        </button>
        <button
          type="button"
          disabled={!isRunning}
          onClick={() => {
            cancelRef.current = true;
          }}
          className="rounded bg-neutral-800 px-3 py-1 text-neutral-300 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={done === undefined}
          onClick={() => done !== undefined && void freeze(done)}
          className="rounded bg-amber-700 px-3 py-1 font-medium text-white disabled:opacity-40"
        >
          Freeze &amp; bake
        </button>
        <button
          type="button"
          disabled={!state.generationActive}
          onClick={() => dispatch({ type: "generation-active", active: false })}
          className="rounded bg-neutral-800 px-3 py-1 text-neutral-300 disabled:opacity-40"
        >
          Close preview
        </button>
      </div>

      <label
        className="flex items-center gap-2 text-neutral-400"
        title="Preview the game's fog mood. Off = clear structural view (fog at orbit distance obscures the wing)."
      >
        <input
          type="checkbox"
          checked={fogOn}
          onChange={(e) => {
            setFogOn(e.target.checked);
            previewHostRef.current?.setFog(e.target.checked);
          }}
        />
        game fog
      </label>

      <p className="text-neutral-400">{statusText(session.status)}</p>

      {session.history.length > 0 && (
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-neutral-500">history</span>
          <ul className="flex flex-col gap-1">
            {session.history.map((h, i) => (
              <li key={`${h.attemptSeed}-${i}`}>
                <button
                  type="button"
                  disabled={isRunning || isBaking}
                  onClick={() => void runGeneration(h.attemptSeed, 1)}
                  className={cn(
                    "w-full rounded px-2 py-1 text-left font-mono text-xs hover:bg-neutral-800 disabled:opacity-40",
                    done?.attemptSeed === h.attemptSeed &&
                      "bg-neutral-800 text-emerald-300",
                  )}
                >
                  {h.attemptSeed}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
