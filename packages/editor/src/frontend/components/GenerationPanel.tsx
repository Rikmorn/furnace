import { useEffect } from "react";
import type { PreviewHost } from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import {
  invalidateWorldPreview,
  isValidWingName,
  layoutBounds,
  mergeContents,
  type RealizeResult,
  rerollSeeds,
  toWireFiles,
  type WorldGenStatus,
  type WorldSpecLike,
  worldSpecWithSeeds,
} from "../lib/generation.ts";
import { useEditor } from "./editor-context.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

// The minimal structural shape of ONE placed piece the panel realizes. The world payload
// crosses the worker boundary opaquely (only this seam reads inside it): each piece is a
// placed RegionData whose `bounds` feed layoutBounds and whose whole `data` passes to
// realizeRegion (typed `unknown` at the ext cast). Regions are already world-frame — no
// authored phantom to filter (that was a wing concept), so every piece realizes.
type Vec3 = [number, number, number];
type PreviewPiece = { id: string; data: { bounds: { min: Vec3; max: Vec3 } } };
type WorldRunPayload = {
  regions: PreviewPiece[];
  connectors: PreviewPiece[];
};

function statusText(s: WorldGenStatus): string {
  switch (s.phase) {
    case "idle":
      return "idle — set seeds and generate";
    case "generating":
      return "generating…";
    case "previewing":
      return "previewing — freeze to bake";
    case "baking":
      return "baking…";
    case "baked":
      return `baked ${s.files} files — run the game to walk it`;
    case "failed":
      return `failed: ${s.error}`;
  }
}

export function GenerationPanel() {
  const { state, dispatch, previewHostRef, extensions, generation } =
    useEditor();
  // App owns the session, the bake destination (worldName), and the worker client (context
  // slice) — NOT panel-local state. Closing the panel unmounts this component, but an
  // in-flight run's async setter calls target App state through these stable setters, so the
  // run keeps advancing and the session is intact on reopen (Slice 3.2.3 lift).
  const { session, setSession, worldName, setWorldName, client } = generation;

  // Boundary cast: `extensions` is the engine bundle's untyped `extensions` namespace — the
  // dungeon's editor-extensions re-exports crossing the project-first boundary as
  // Record<string, unknown>. This is the SINGLE panel seam that narrows the world generator
  // surface. runWorld/bakeWorld run WORKER-side (via `client`); the panel only realizes/frames
  // on the main thread (GPU ctx) and builds the spec from DEFAULT_WORLD.
  const ext = extensions as {
    realizeRegion: (
      ctx: unknown,
      world: unknown,
      cache: unknown,
      region: unknown,
    ) => Promise<RealizeResult>;
    MaterialCache: new (ctx: unknown) => { destroy: () => void };
    DEFAULT_WORLD: WorldSpecLike;
    worldDir: (name: string) => string;
  };
  const template = ext.DEFAULT_WORLD;

  // Fill the two cave-seed fields from the engine's DEFAULT_WORLD once the bundle is ready
  // (the editor can't import the spec by value — it reads it off the ext seam). Runs only
  // while both seeds are still the initial empty strings, so a user edit is never clobbered.
  useEffect(() => {
    if (!template) return;
    setSession((s) =>
      s.seeds[0] === "" && s.seeds[1] === ""
        ? {
            ...s,
            seeds: [
              template.regions[0]?.seed ?? "",
              template.regions[1]?.seed ?? "",
            ],
          }
        : s,
    );
  }, [template, setSession]);

  const setStatus = (status: WorldGenStatus): void =>
    setSession((s) => ({ ...s, status }));

  // Editing a seed invalidates a `previewing` world (see invalidateWorldPreview): the
  // on-screen world no longer matches the controls, so Freeze must not bake stale seeds.
  const setSeed = (index: 0 | 1, value: string): void =>
    setSession((s) => {
      const seeds: [string, string] =
        index === 0 ? [value, s.seeds[1]] : [s.seeds[0], value];
      return invalidateWorldPreview({ ...s, seeds });
    });

  // Realize the placed world (regions + connectors, already world-frame) into the preview
  // host and frame the camera. Main-thread: needs the preview host's GPU ctx, so this stays
  // here even though the realize search runs worker-side (it doesn't — realize is one call).
  const previewWorld = async (
    host: PreviewHost,
    payload: WorldRunPayload,
    seeds: [string, string],
  ): Promise<void> => {
    await host.clear();
    const cache = new ext.MaterialCache(host.ctx());
    const pieces = [...payload.regions, ...payload.connectors].map(
      (p) => p.data,
    );
    const results: RealizeResult[] = [];
    // Sequential (`for … await`): the MaterialCache is not concurrency-safe (its TSDoc).
    for (const r of pieces) {
      results.push(await ext.realizeRegion(host.ctx(), host.world(), cache, r));
    }
    host.adopt(mergeContents(results, cache));
    const [min, max] = layoutBounds(pieces);
    host.frame(min, max);
    host.render();
    // Snapshot the seeds that PRODUCED this preview — freeze bakes from here, so a later
    // seed edit can't change what freeze produces (the flow's core guarantee).
    setSession((s) => ({ ...s, status: { phase: "previewing", seeds } }));
  };

  // Generate on the worker (deterministic — one payload, no attempt stream): the client
  // returns the realized world; the panel's only main-thread work is realizing it.
  const generate = (seeds: [string, string]): void => {
    const host = previewHostRef.current;
    if (!host) return;
    dispatch({ type: "generation-active", active: true });
    const spec = worldSpecWithSeeds(template, seeds);
    setStatus({ phase: "generating" });
    client.runWorld(spec, {
      onWorld: (payload) => {
        // Boundary cast: the payload crossed the worker boundary opaquely; this is the
        // engine-bundle shape previewWorld consumes.
        void previewWorld(host, payload as WorldRunPayload, seeds).catch((err) =>
          setStatus({
            phase: "failed",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      },
      onError: (message) => setStatus({ phase: "failed", error: message }),
    });
  };

  // The seeds Generate/Reroll act on: the session values, falling back to the template
  // default for any still-empty seed (an action before the seed-fill effect still runs real
  // seeds). Belt-and-braces — worldSpecWithSeeds applies the same fallback.
  const resolvedSeeds = (): [string, string] => {
    const spec = worldSpecWithSeeds(template, session.seeds);
    return [spec.regions[0]?.seed ?? "", spec.regions[1]?.seed ?? ""];
  };

  const reroll = (): void => {
    const next = rerollSeeds(resolvedSeeds());
    setSession((s) => ({ ...s, seeds: next, status: { phase: "idle" } }));
    generate(next);
  };

  // Freeze & bake: re-bake the frozen world from its snapshot seeds ON THE WORKER (same engine
  // that previewed it → reproduces it exactly), then upload the produced file set to the daemon
  // (main-thread api call), which validates + writes + emits generation-baked. cleanDir clears
  // the prior bake so a re-bake never leaves orphans. Reads ONLY the `previewing` snapshot
  // seeds — never live session.seeds — so freeze bakes exactly what is on screen.
  const freeze = (seeds: [string, string]): void => {
    setStatus({ phase: "baking" });
    const spec = worldSpecWithSeeds(template, seeds);
    client.bakeWorld(spec, worldName, {
      onBaked: (files) => {
        void (async () => {
          try {
            const result = await api.generationBake(
              toWireFiles(files),
              ext.worldDir(worldName),
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
    });
  };

  if (state.status !== "ready") {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        generation waits for the engine bundle…
      </p>
    );
  }

  const isGenerating = session.status.phase === "generating";
  const isBaking = session.status.phase === "baking";
  const busy = isGenerating || isBaking;
  // The currently previewed world (its snapshot seeds), or undefined when nothing is on
  // screen to freeze. Freeze reads this exclusively — never live session.seeds.
  const previewing =
    session.status.phase === "previewing" ? session.status : undefined;
  const worldNameValid = isValidWingName(worldName);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">World Name</span>
        <Input
          type="text"
          value={worldName}
          onChange={(e) => setWorldName(e.target.value)}
          disabled={busy}
          aria-invalid={!worldNameValid}
          className={cn(!worldNameValid && "border-destructive")}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Cave A seed</span>
        <Input
          type="text"
          value={session.seeds[0]}
          onChange={(e) => setSeed(0, e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Cave B seed</span>
        <Input
          type="text"
          value={session.seeds[1]}
          onChange={(e) => setSeed(1, e.target.value)}
          disabled={busy}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => generate(resolvedSeeds())}
        >
          Generate
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={reroll}
        >
          Reroll
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Freeze keeps the distinct success semantic (commit-to-disk); tailwind-merge
            lets the className override the default primary fill. */}
        <Button
          type="button"
          size="sm"
          disabled={previewing === undefined || !worldNameValid}
          onClick={() => {
            if (previewing !== undefined) freeze(previewing.seeds);
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
    </div>
  );
}
