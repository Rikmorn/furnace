// The World panel (W3): the Generation panel generalized into world ASSEMBLY (charter
// §2.4). Region list (attach-on-add, per-region reroll/remove), start picker, name +
// Generate / Freeze&bake + make-default. All structure lives in the pure world-draft
// model; this component is the thin React shell + the two engine seams (preview realize
// on the main thread, runWorld/bakeWorld on the worker).
import { useState } from "react";
import type { PreviewHost } from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import {
  bakeUploadCalls,
  invalidateWorldPreview,
  isValidWingName,
  layoutBounds,
  mergeContents,
  type RealizeResult,
  toWireFiles,
  type WorldGenStatus,
} from "../lib/generation.ts";
import {
  addRegion,
  bumpRegionSeed,
  canRemove,
  type ConnectorKindDraft,
  DEFAULT_KNOBS,
  type DraftAlgorithm,
  type DraftAttachment,
  type DraftRegion,
  draftToSpec,
  HALL_PRESET_KNOBS,
  legalKinds,
  nextRegionId,
  type PortalSpot,
  removeRegion,
  type WallName,
  type WorldDraft,
  type WorldSpecLike,
} from "../lib/world-draft.ts";
import { useEditor } from "./editor-context.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

// The minimal structural shape of ONE placed piece the panel realizes. The world payload
// crosses the worker boundary opaquely (only this seam reads inside it): each piece is a
// placed RegionData whose `bounds` feed layoutBounds and whose whole `data` passes to
// realizeRegion (typed `unknown` at the ext cast).
type Vec3 = [number, number, number];
type PreviewPiece = { id: string; data: { bounds: { min: Vec3; max: Vec3 } } };
type WorldRunPayload = { regions: PreviewPiece[]; connectors: PreviewPiece[] };

type HallPreset = keyof typeof HALL_PRESET_KNOBS;
type HallRegion = Extract<DraftRegion, { algorithm: "hall" }>;
type MazeRegion = Extract<DraftRegion, { algorithm: "maze" }>;
type CaveRegion = Extract<DraftRegion, { algorithm: "cave" }>;

const WALLS: WallName[] = ["north", "south", "east", "west"];
// Derived from the table (not a hand-written literal) so a new preset in world-draft.ts
// shows up here without an edit. Object.keys() is typed `string[]` because a runtime
// object may carry extra keys; this one is a closed Record literal, so the keys ARE its
// keyof — the assertion states what the table's type already proves.
const HALL_PRESETS = Object.keys(HALL_PRESET_KNOBS) as HallPreset[];
// The hall's three size axes, carried with LITERAL tuple indices so knob edits index the
// [number, number, number] without a widened `number` (noUncheckedIndexedAccess).
const HALL_AXES = [
  { label: "w (cells)", axis: 0 },
  { label: "h (cells)", axis: 1 },
  { label: "d (cells)", axis: 2 },
] as const;

const SELECT_CLASS = "h-8 rounded-md border border-input bg-transparent px-2";

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

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

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
    // Sequential (`for … await`): the MaterialCache is not concurrency-safe (its TSDoc).
    for (const r of pieces) {
      results.push(await ext.realizeRegion(host.ctx(), host.world(), cache, r));
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
  const nameValid = isValidWingName(draft.name);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">World Name</span>
        <Input
          type="text"
          value={draft.name}
          onChange={(e) => editDraft((d) => ({ ...d, name: e.target.value }))}
          disabled={busy}
          aria-invalid={!nameValid}
          className={cn(!nameValid && "border-destructive")}
        />
      </label>

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

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Player start</span>
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
      </label>

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

      {/* Always-rendered STABLE aria-live region so each phase change (generating →
          previewing → baked/failed) is announced to assistive tech. */}
      <p className="text-muted-foreground" aria-live="polite">
        {statusText(session.status)}
      </p>
    </div>
  );
}

// ── Region row: seed, per-algorithm knobs, reroll/remove ───────────────────────

/** A number field's value, falling back when the field is mid-edit (empty / "-" / NaN). */
const num = (v: string, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function RegionRow(props: {
  region: DraftRegion;
  removable: boolean;
  busy: boolean;
  onEdit: (next: DraftRegion) => void;
  onReroll: () => void;
  onRemove: () => void;
}) {
  const { region: r, removable, busy, onEdit, onReroll, onRemove } = props;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {r.id} <span className="text-muted-foreground">({r.algorithm})</span>
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onReroll}
          >
            Reroll
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || !removable}
            title={
              removable
                ? undefined
                : "has attached regions — remove its leaves first"
            }
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{r.id} seed</span>
        <Input
          type="text"
          value={r.seed}
          disabled={busy}
          onChange={(e) => onEdit({ ...r, seed: e.target.value })}
        />
      </label>
      {/* Knobs are REPLACED, never mutated: the preset tables are deep-frozen, and a
          region seeded from one would otherwise alias it (world-draft.ts). */}
      {r.algorithm === "hall" && (
        <HallKnobFields region={r} busy={busy} onEdit={onEdit} />
      )}
      {r.algorithm === "maze" && (
        <MazeKnobFields region={r} busy={busy} onEdit={onEdit} />
      )}
      {r.algorithm === "cave" && (
        <CaveKnobFields region={r} busy={busy} onEdit={onEdit} />
      )}
    </div>
  );
}

function HallKnobFields(props: {
  region: HallRegion;
  busy: boolean;
  onEdit: (next: HallRegion) => void;
}) {
  const { region: r, busy, onEdit } = props;
  const withAxis = (axis: 0 | 1 | 2, value: number): HallRegion["knobs"] => {
    const size: [number, number, number] = [...r.knobs.size];
    size[axis] = value;
    return { ...r.knobs, size };
  };
  return (
    <div className="flex gap-2">
      {HALL_AXES.map(({ label, axis }) => (
        <label key={label} className="flex flex-col gap-1">
          <span className="text-muted-foreground">{label}</span>
          <Input
            type="number"
            value={r.knobs.size[axis]}
            disabled={busy}
            onChange={(e) =>
              onEdit({
                ...r,
                knobs: withAxis(
                  axis,
                  num(e.target.value, r.knobs.size[axis]),
                ),
              })
            }
          />
        </label>
      ))}
    </div>
  );
}

function MazeKnobFields(props: {
  region: MazeRegion;
  busy: boolean;
  onEdit: (next: MazeRegion) => void;
}) {
  const { region: r, busy, onEdit } = props;
  const [cellsX, cellsZ] = r.knobs.cells;
  return (
    <div className="flex gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">cells x</span>
        <Input
          type="number"
          value={cellsX}
          disabled={busy}
          onChange={(e) =>
            onEdit({
              ...r,
              knobs: {
                ...r.knobs,
                cells: [num(e.target.value, cellsX), cellsZ],
              },
            })
          }
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">cells z</span>
        <Input
          type="number"
          value={cellsZ}
          disabled={busy}
          onChange={(e) =>
            onEdit({
              ...r,
              knobs: {
                ...r.knobs,
                cells: [cellsX, num(e.target.value, cellsZ)],
              },
            })
          }
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">braid</span>
        <Input
          type="number"
          step="0.05"
          value={r.knobs.braid}
          disabled={busy}
          onChange={(e) =>
            onEdit({
              ...r,
              knobs: { ...r.knobs, braid: num(e.target.value, r.knobs.braid) },
            })
          }
        />
      </label>
    </div>
  );
}

function CaveKnobFields(props: {
  region: CaveRegion;
  busy: boolean;
  onEdit: (next: CaveRegion) => void;
}) {
  const { region: r, busy, onEdit } = props;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">mouths</span>
      <Input
        type="number"
        value={r.knobs.mouths}
        disabled={busy}
        onChange={(e) =>
          onEdit({
            ...r,
            knobs: { mouths: num(e.target.value, r.knobs.mouths) },
          })
        }
      />
    </label>
  );
}

// ── Add-region form: algorithm + knob defaults + the ATTACHMENT (D-W3-7) ───────

/** Both ends of a candidate attachment are edited as ONE row of fields; which of them the
 *  region's class actually reads (wall+offset, or mouth) is decided at submit. */
type SpotState = { wall: WallName; offset: number; mouth: number };

const spotFor = (algorithm: DraftAlgorithm, s: SpotState): PortalSpot =>
  algorithm === "cave"
    ? { mouth: s.mouth }
    : { wall: s.wall, offset: s.offset };

function SpotFields(props: {
  label: string;
  algorithm: DraftAlgorithm | undefined;
  spot: SpotState;
  setSpot: (s: SpotState) => void;
  busy: boolean;
}) {
  const { label, algorithm, spot, setSpot, busy } = props;
  if (algorithm === "cave") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{label} mouth</span>
        <Input
          type="number"
          value={spot.mouth}
          disabled={busy}
          onChange={(e) =>
            setSpot({ ...spot, mouth: num(e.target.value, spot.mouth) })
          }
        />
      </label>
    );
  }
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{label} wall</span>
        <select
          className={SELECT_CLASS}
          value={spot.wall}
          disabled={busy}
          onChange={(e) =>
            // Boundary cast: a <select>'s value is a plain string; its options are exactly
            // the WallName union, so the DOM's wider type narrows back to it here.
            setSpot({ ...spot, wall: e.target.value as WallName })
          }
        >
          {WALLS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{label} offset</span>
        <Input
          type="number"
          value={spot.offset}
          disabled={busy}
          onChange={(e) =>
            setSpot({ ...spot, offset: num(e.target.value, spot.offset) })
          }
        />
      </label>
    </>
  );
}

function AddRegionForm(props: {
  draft: WorldDraft;
  busy: boolean;
  onAdd: (region: DraftRegion) => void;
}) {
  const { draft, busy, onAdd } = props;
  const [algorithm, setAlgorithm] = useState<DraftAlgorithm>("hall");
  const [preset, setPreset] = useState<HallPreset>("pillarHall");
  const [parentId, setParentId] = useState("");
  const [kind, setKind] = useState<ConnectorKindDraft | "">("");
  const [parentSpot, setParentSpot] = useState<SpotState>({
    wall: "north",
    offset: 2,
    mouth: 0,
  });
  const [childSpot, setChildSpot] = useState<SpotState>({
    wall: "south",
    offset: 2,
    mouth: 0,
  });
  const [corridor, setCorridor] = useState({ length: 6, deltaY: 0 });
  // addRegion is setup-loud (e.g. "corridor cannot join hall -> cave"). The form disables
  // the illegal choices it knows about, but a stale/edge selection must SAY so — never a
  // silently dropped click.
  const [error, setError] = useState("");

  const first = draft.regions.length === 0;
  const parent = draft.regions.find(
    (r) => r.id === (parentId || draft.regions[0]?.id),
  );
  const kinds = parent ? legalKinds(parent.algorithm, algorithm) : [];
  const effectiveKind = kind !== "" && kinds.includes(kind) ? kind : kinds[0];

  // Each region OWNS its knobs: a fresh deep copy of the preset, never the (deep-frozen)
  // table reference — an aliased knob edit would resize every hall in the world.
  const freshRegion = (id: string, attachment?: DraftAttachment): DraftRegion => {
    if (algorithm === "hall") {
      return {
        id,
        algorithm: "hall",
        knobs: structuredClone(HALL_PRESET_KNOBS[preset]),
        seed: id,
        attachment,
      };
    }
    if (algorithm === "maze") {
      return {
        id,
        algorithm: "maze",
        knobs: structuredClone(DEFAULT_KNOBS.maze),
        seed: id,
        attachment,
      };
    }
    return {
      id,
      algorithm: "cave",
      knobs: structuredClone(DEFAULT_KNOBS.cave),
      seed: id,
      attachment,
    };
  };

  const submit = (): void => {
    const id = nextRegionId(draft, algorithm);
    let attachment: DraftAttachment | undefined;
    if (!first) {
      if (!parent || !effectiveKind) return;
      attachment = {
        kind: effectiveKind,
        parentId: parent.id,
        parentPortal: spotFor(parent.algorithm, parentSpot),
        childPortal: spotFor(algorithm, childSpot),
        ...(effectiveKind === "corridor" ? { params: corridor } : {}),
      };
    }
    try {
      onAdd(freshRegion(id, attachment));
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-2">
      <span className="font-medium">Add region</span>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">algorithm</span>
          <select
            className={SELECT_CLASS}
            value={algorithm}
            disabled={busy}
            // Boundary cast: the options are exactly the DraftAlgorithm union.
            onChange={(e) => setAlgorithm(e.target.value as DraftAlgorithm)}
          >
            <option value="hall">hall</option>
            <option value="maze">maze</option>
            <option value="cave">cave</option>
          </select>
        </label>
        {algorithm === "hall" && (
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">preset</span>
            <select
              className={SELECT_CLASS}
              value={preset}
              disabled={busy}
              // Boundary cast: the options are exactly HALL_PRESET_KNOBS' keys.
              onChange={(e) => setPreset(e.target.value as HallPreset)}
            >
              {HALL_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!first && (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">attach to</span>
            <select
              className={SELECT_CLASS}
              value={parent?.id ?? ""}
              disabled={busy}
              onChange={(e) => setParentId(e.target.value)}
            >
              {draft.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">connector</span>
            <select
              className={SELECT_CLASS}
              value={effectiveKind ?? ""}
              disabled={busy || kinds.length === 0}
              // Boundary cast: the options are exactly the legal kinds for this pair.
              onChange={(e) => setKind(e.target.value as ConnectorKindDraft)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <SpotFields
            label="parent"
            algorithm={parent?.algorithm}
            spot={parentSpot}
            setSpot={setParentSpot}
            busy={busy}
          />
          <SpotFields
            label="child"
            algorithm={algorithm}
            spot={childSpot}
            setSpot={setChildSpot}
            busy={busy}
          />
          {effectiveKind === "corridor" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">length (m)</span>
                <Input
                  type="number"
                  value={corridor.length}
                  disabled={busy}
                  onChange={(e) =>
                    setCorridor({
                      ...corridor,
                      length: num(e.target.value, corridor.length),
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">rise (m)</span>
                <Input
                  type="number"
                  step="0.25"
                  value={corridor.deltaY}
                  disabled={busy}
                  onChange={(e) =>
                    setCorridor({
                      ...corridor,
                      deltaY: num(e.target.value, corridor.deltaY),
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      )}

      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || (!first && (!parent || kinds.length === 0))}
          onClick={submit}
        >
          Add region
        </Button>
      </div>
      {error !== "" && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
