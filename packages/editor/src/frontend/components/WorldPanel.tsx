// The World panel (W3): the Generation panel generalized into world ASSEMBLY (charter
// §2.4). Region list (attach-on-add, per-region reroll/remove), start picker, name +
// Generate / Freeze&bake + make-default. All structure lives in the pure world-draft
// model; this file is the shell — the four flows (previewWorld / generateFrom /
// rerollRegion / freeze) plus layout. The rows and the add-form live in ./world-panel/.
import type { PreviewHost } from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import {
  bakeUploadCalls,
  invalidateWorldPreview,
  isValidWorldName,
  layoutBounds,
  mergeContents,
  type RealizeResult,
  toWireFiles,
  type Vec3,
  type WorldGenStatus,
} from "../lib/generation.ts";
import {
  addRegion,
  bumpRegionSeed,
  canRemove,
  draftToSpec,
  removeRegion,
  type WorldDraft,
  type WorldSpecLike,
} from "../lib/world-draft.ts";
import { useEditor } from "./editor-context.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { AddRegionForm } from "./world-panel/AddRegionForm.tsx";
import { errorMessage, Field, SELECT_CLASS } from "./world-panel/fields.tsx";
import { RegionRow } from "./world-panel/RegionRow.tsx";

// The minimal structural shape of ONE placed piece the panel realizes. The world payload
// crosses the worker boundary opaquely (only this seam reads inside it): each piece is a
// placed RegionData whose `bounds` feed layoutBounds and whose whole `data` passes to
// realizeRegion (typed `unknown` at the ext cast).
type PreviewPiece = { id: string; data: { bounds: { min: Vec3; max: Vec3 } } };
type WorldRunPayload = { regions: PreviewPiece[]; connectors: PreviewPiece[] };

function statusText(s: WorldGenStatus): string {
  switch (s.phase) {
    case "idle":
      return "idle — assemble regions and generate";
    case "generating":
      return "generating…";
    case "previewing":
      return "previewing — freeze to bake";
    case "baking":
      return "baking…";
    case "baked":
      return s.madeDefault
        ? `baked ${s.files} files — now the game's world`
        : `baked ${s.files} files — game world unchanged`;
    case "failed":
      return `failed: ${s.error}`;
  }
}

export function WorldPanel() {
  const { state, dispatch, previewHostRef, extensions, generation } =
    useEditor();
  // App owns the session and the worker client (context slice) — NOT panel-local state.
  // Closing the panel unmounts this component, but an in-flight run's async setter calls
  // target App state through these stable setters, so the run keeps advancing and the
  // session is intact on reopen (Slice 3.2.3 lift). The bake destination is the draft's
  // own `name` (W3) — there is no separate worldName any more.
  const { session, setSession, client } = generation;

  // Boundary cast: `extensions` is the engine bundle's untyped `extensions` namespace —
  // the dungeon's editor-extensions re-exports crossing the project-first boundary as
  // Record<string, unknown>. This is the SINGLE panel seam that narrows it. runWorld/
  // bakeWorld run WORKER-side (via `client`); the panel only realizes/frames on the main
  // thread (GPU ctx). DEFAULT_WORLD is no longer read: the draft starts empty (D-W3-12).
  const ext = extensions as {
    realizeRegion: (
      ctx: unknown,
      world: unknown,
      cache: unknown,
      region: unknown,
    ) => Promise<RealizeResult>;
    MaterialCache: new (ctx: unknown) => { destroy: () => void };
    worldDir: (name: string) => string;
  };

  const setStatus = (status: WorldGenStatus): void =>
    setSession((s) => ({ ...s, status }));

  // EVERY draft write routes through one of these two, and both invalidate a `previewing`
  // snapshot so Freeze can never bake stale structure (the flow's core guarantee).
  //  - editDraft: pure, non-throwing edits (name, seed, knobs, start) — functional update.
  //  - applyDraft: a draft the caller ALREADY computed. The world-draft model's structural
  //    ops (addRegion/removeRegion/bumpRegionSeed) throw setup-loud, and a throw inside a
  //    setState updater would surface during React's render phase (uncatchable by the
  //    click handler), so those run OUTSIDE the updater and hand the result to applyDraft.
  const editDraft = (fn: (d: WorldDraft) => WorldDraft): void =>
    setSession((s) => invalidateWorldPreview({ ...s, draft: fn(s.draft) }));
  const applyDraft = (next: WorldDraft): void =>
    setSession((s) => invalidateWorldPreview({ ...s, draft: next }));

  // Realize the placed world (regions + connectors, already world-frame) into the preview
  // host and frame the camera. Main-thread: it needs the preview host's GPU ctx.
  const previewWorld = async (
    host: PreviewHost,
    payload: WorldRunPayload,
    spec: WorldSpecLike,
  ): Promise<void> => {
    await host.clear();
    const cache = new ext.MaterialCache(host.ctx());
    const pieces = [...payload.regions, ...payload.connectors].map(
      (p) => p.data,
    );
    const results: RealizeResult[] = [];
    try {
      // Sequential (`for … await`): the MaterialCache is not concurrency-safe (its TSDoc).
      for (const r of pieces) {
        results.push(
          await ext.realizeRegion(host.ctx(), host.world(), cache, r),
        );
      }
    } catch (err) {
      // The host only frees what it has ADOPTED, and adopt() is below — so a throw partway
      // through would strand every already-realized region's GPU buffers plus the cache,
      // unreachable, once per failed generate. Free them here, then let the failure surface.
      for (const r of results) r.destroy();
      cache.destroy();
      throw err;
    }
    host.adopt(mergeContents(results, cache));
    const [min, max] = layoutBounds(pieces);
    host.frame(min, max);
    host.render();
    // Snapshot the SPEC that produced this preview (D-W3-11) — freeze bakes from here, so
    // a later draft edit can't change what freeze produces.
    setSession((s) => ({ ...s, status: { phase: "previewing", spec } }));
  };

  // Generate from a given draft (the session's, or a just-bumped reroll draft — React
  // state updates are async, so the caller passes the draft explicitly).
  const generateFrom = (draft: WorldDraft): void => {
    const host = previewHostRef.current;
    if (!host) return;
    let spec: WorldSpecLike;
    try {
      spec = draftToSpec(draft);
    } catch (err) {
      setStatus({ phase: "failed", error: errorMessage(err) });
      return;
    }
    dispatch({ type: "generation-active", active: true });
    setStatus({ phase: "generating" });
    client.runWorld(spec, {
      onWorld: (payload) => {
        // Boundary cast: the payload crossed the worker boundary opaquely; this is the
        // engine-bundle shape previewWorld consumes.
        void previewWorld(host, payload as WorldRunPayload, spec).catch((err) =>
          setStatus({ phase: "failed", error: errorMessage(err) }),
        );
      },
      onError: (message) => setStatus({ phase: "failed", error: message }),
    });
  };

  const rerollRegion = (id: string): void => {
    const next = bumpRegionSeed(session.draft, id);
    applyDraft(next);
    generateFrom(next);
  };

  // Freeze & bake the SNAPSHOT spec (never the live draft): worker re-bake (same engine
  // that previewed it → reproduces it exactly) → upload the file set, cleanDir'd so a
  // re-bake leaves no orphans → optionally point worlds/index.json at it (D-W3-9).
  const freeze = (spec: WorldSpecLike): void => {
    setStatus({ phase: "baking" });
    const { name } = session.draft;
    const { makeDefault } = session;
    client.bakeWorld(spec, name, {
      onBaked: (files) => {
        void (async () => {
          try {
            const calls = bakeUploadCalls(
              toWireFiles(files),
              ext.worldDir(name),
              name,
              makeDefault,
            );
            const results: { files: number }[] = [];
            // Ordered (`for … await`): the world's files land before index.json points at
            // them, so the game never sees a default that isn't on disk yet.
            for (const call of calls) {
              results.push(await api.generationBake(call.files, call.cleanDir));
            }
            setStatus({
              phase: "baked",
              // Call 0 only: that is the WORLD's file set — what the user made. The
              // optional second call writes worlds/index.json, which is bookkeeping and
              // would otherwise inflate the count by one.
              files: results[0]?.files ?? 0,
              madeDefault: makeDefault,
            });
          } catch (err) {
            setStatus({ phase: "failed", error: errorMessage(err) });
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

  const draft = session.draft;
  const busy =
    session.status.phase === "generating" || session.status.phase === "baking";
  // The currently previewed world (its snapshot spec), or undefined when nothing is on
  // screen to freeze. Freeze reads this exclusively — never the live draft.
  const previewing =
    session.status.phase === "previewing" ? session.status : undefined;
  const failed = session.status.phase === "failed";
  const nameValid = isValidWorldName(draft.name);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <Field label="World Name">
        <Input
          type="text"
          value={draft.name}
          onChange={(e) => editDraft((d) => ({ ...d, name: e.target.value }))}
          disabled={busy}
          aria-invalid={!nameValid}
          className={cn(!nameValid && "border-destructive")}
        />
      </Field>

      {draft.regions.map((r) => (
        <RegionRow
          key={r.id}
          region={r}
          removable={canRemove(draft, r.id)}
          busy={busy}
          onEdit={(next) =>
            editDraft((d) => ({
              ...d,
              regions: d.regions.map((x) => (x.id === next.id ? next : x)),
            }))
          }
          onReroll={() => rerollRegion(r.id)}
          onRemove={() => applyDraft(removeRegion(draft, r.id))}
        />
      ))}

      <AddRegionForm
        draft={draft}
        busy={busy}
        onAdd={(region) => applyDraft(addRegion(draft, region))}
      />

      <Field label="Player start">
        <select
          className={SELECT_CLASS}
          value={draft.startRegionId}
          disabled={busy || draft.regions.length === 0}
          onChange={(e) =>
            editDraft((d) => ({ ...d, startRegionId: e.target.value }))
          }
        >
          {draft.regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || draft.regions.length === 0}
          onClick={() => generateFrom(draft)}
        >
          Generate
        </Button>
        {/* Freeze keeps the distinct success semantic (commit-to-disk); tailwind-merge
            lets the className override the default primary fill. */}
        <Button
          type="button"
          size="sm"
          disabled={previewing === undefined || !nameValid}
          onClick={() => {
            if (previewing !== undefined) freeze(previewing.spec);
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

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={session.makeDefault}
          disabled={busy}
          onChange={(e) =>
            setSession((s) => ({ ...s, makeDefault: e.target.checked }))
          }
        />
        <span className="text-muted-foreground">
          Make this the game&apos;s world
        </span>
      </label>

      {/* ONE always-rendered live region, so every phase change (generating → previewing →
          baked/failed) is announced. A failure is not a status hint — it reads destructive
          and escalates to assertive, because the two reachable failures (an unattached grid
          anchor; two children on one portal) leave the preview canvas BLANK, and a grey
          line beside an empty viewport says nothing. */}
      <p
        className={cn(failed ? "text-destructive" : "text-muted-foreground")}
        aria-live={failed ? "assertive" : "polite"}
      >
        {statusText(session.status)}
      </p>
    </div>
  );
}
