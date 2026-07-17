// The Field panel (F1/F2b): the dig-loop chrome. It mounts a <canvas> the
// App-owned FieldHost renders into (LMB applies the tool or a selection
// gesture, RMB looks, WASD/QE flies, wheel/[ ] size the brush, ⌘Z undoes) and
// exposes name + the tool palette (brush effects, selection gestures, stamp
// generators) + the persistent material swatches + the brush inspector
// (radius/mask/smooth/hollow) + shading, plus Save / Load / Bake-as-default.
// On engine-ready it loads the project's materials catalog (F2) and installs
// the resolved table on the host; Load is gated until the catalog settles.
// The host is created ONCE at engine-ready (App) and reached ONLY through the
// /engine.js runtime channel (a context ref) — the chrome never value-imports
// engine code (the project-first invariant). This file type-imports the field
// host + artifact types (all erased) and value-imports the catalog parser
// from a frontend lib that itself only type-imports core.
import type {
  FieldManifest,
  GeneratorEntity,
  MaterialTable,
} from "@furnace/core/field"; // type-only: erased
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FieldGeneratorInfo,
  FieldHostShading,
  FieldLayers,
  FieldMaskChoice,
  FieldTool,
  SelectionInfo,
  SelectionMode,
  StampSession,
} from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
// catalog.ts type-imports core only (erased), so value-importing it here does NOT
// pull core into the chrome bundle — the project-first invariant holds.
import { CatalogError, parseMaterialsCatalog } from "../lib/catalog.ts";
import { cn } from "../lib/cn.ts";
import { bakeUploadCalls, toWireFiles } from "../lib/generation.ts";
import { initWhenSized } from "../lib/init-when-sized.ts";
import { useEditor } from "./editor-context.ts";
import { BrushInspector } from "./field/BrushInspector.tsx";
import { EntitiesList } from "./field/EntitiesList.tsx";
import { LayersRow } from "./field/LayersRow.tsx";
import { MaterialSwatches } from "./field/MaterialSwatches.tsx";
import { StampInspector } from "./field/StampInspector.tsx";
import { ToolPalette } from "./field/ToolPalette.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { ReasonTip } from "./world-panel/fields.tsx";

// Mirrors the daemon field.load name regex AND FieldHost's clamp range. Name is EMPTY by
// default and never prefilled (the W3/W4 gate-clobber lesson: a stale default silently
// overwrites the game's world on Save/Bake).
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;
// Mirror FieldHost's default digRadius (the range lives in BrushInspector).
const DEFAULT_RADIUS = 1.25;

// The panel's initial brush — mirrors the host's own defaultTool() (dig into
// rock, unmasked, core SMOOTH_DEFAULTS-equivalent smooth, solid fill). A
// local literal: the chrome cannot value-import core or the host
// (frontend-no-engine-leakage), and subscribeTool fires only on
// HOST-initiated changes, so there is nothing to seed from at mount.
const DEFAULT_TOOL: FieldTool = {
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
};

// Dropdown/swatch fallback before the catalog resolves and when there is none
// (404): rock only. A LOCAL literal — the chrome can't value-import core's
// BUILTIN_TABLE (frontend-no-engine-leakage). The host keeps its own
// BUILTIN_TABLE default; this only feeds the panel's material UI.
const ROCK_ONLY_TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
  ],
};

// Panel-side layer defaults — mirror the host's own all-true default (a local
// literal for the same reason as DEFAULT_TOOL: the chrome cannot value-import
// the host). Pushed to the host at engine-ready so both start in agreement.
const DEFAULT_LAYERS: FieldLayers = {
  field: true,
  kit: true,
  ghost: true,
  selection: true,
  grid: true,
};

// Slice defaults: OFF, plane parked at 8 m — mid-range of the slider (LayersRow
// owns the −8…+24 range), high enough to cut a typical kit hall when enabled.
const SLICE_DEFAULT_Y = 8;

type FieldStats = { chunks: number; lastRemeshMs: number };

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// base64 → bytes: the inverse of toWireFiles' encoder, decoding the density chunk files
// the daemon returns. Per-chunk atob is fine for v0 sizes (each chunk is a 4KiB file).
const base64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

// Value-equality for the subscribeTool echo guard (see the mirror effect).
const masksEqual = (a: FieldMaskChoice, b: FieldMaskChoice): boolean =>
  a.kind === "class" && b.kind === "class"
    ? a.classId === b.classId
    : a.kind === b.kind;

const toolsEqual = (a: FieldTool, b: FieldTool): boolean => {
  // Compiler backstop (F2b rider): destructure EVERY FieldTool field — a
  // future field lands in `rest` and fails the never-check, forcing this
  // comparator to learn it. A missed field would silently WEAKEN the
  // subscribeTool echo guard: differing tools would compare equal and the
  // mirror would drop host-initiated changes.
  const { effect, materialId, hollow, mask, smooth, ...rest } = a;
  void (rest satisfies Record<string, never>);
  return (
    effect === b.effect &&
    materialId === b.materialId &&
    hollow === b.hollow &&
    masksEqual(mask, b.mask) &&
    smooth.strength === b.smooth.strength &&
    smooth.iterations === b.smooth.iterations &&
    smooth.mode === b.smooth.mode
  );
};

// Entity-list identity for the refresh guard: id + opSpan. Params/seed are
// immutable post-commit (reconfigure is F3), so a matching signature means
// the same rows and the previous array reference can be kept (no re-render).
const sameEntities = (
  a: GeneratorEntity[],
  b: GeneratorEntity[],
): boolean =>
  a.length === b.length &&
  a.every((e, i) => {
    const o = b[i];
    return (
      o !== undefined &&
      e.entityId === o.entityId &&
      e.opSpan[0] === o.opSpan[0] &&
      e.opSpan[1] === o.opSpan[1]
    );
  });

export function FieldPanel() {
  const { state, fieldHostRef } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialized = useRef(false);
  const catalogLoaded = useRef(false);
  const [name, setName] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [headlamp, setHeadlamp] = useState(false);
  const [tool, setToolState] = useState<FieldTool>(DEFAULT_TOOL);
  const [selectionMode, setSelectionModeState] = useState<SelectionMode | null>(
    null,
  );
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  // Full registry info — paramSchema/defaults feed the stamp inspector's form.
  const [generators, setGenerators] = useState<FieldGeneratorInfo[]>([]);
  const [stamp, setStamp] = useState<StampSession | null>(null);
  const [entities, setEntities] = useState<GeneratorEntity[]>([]);
  const [layers, setLayers] = useState<FieldLayers>(DEFAULT_LAYERS);
  const [slice, setSlice] = useState({ enabled: false, y: SLICE_DEFAULT_Y });
  // Range floors until the host-constants effect reads the real core ceilings.
  const [smoothLimits, setSmoothLimits] = useState({
    maxStrength: 1,
    maxIterations: 1,
  });
  const [table, setTable] = useState<MaterialTable>(ROCK_ONLY_TABLE);
  // True once the catalog fetch reached ANY outcome (success / 404 / error) —
  // Load waits for it so a world never remeshes against the wrong table
  // (carry-over #2: the settle can land before OR after engine init; both
  // orders converge, but a Load racing the fetch would not).
  const [catalogSettled, setCatalogSettled] = useState(false);
  const [stats, setStats] = useState<FieldStats>({ chunks: 0, lastRemeshMs: 0 });
  const [status, setStatus] = useState("dig into the rock, then Save");
  const [busy, setBusy] = useState(false);

  const nameValid = NAME_RE.test(name);

  // Run-once init (the Viewport idiom): grab the canvas once the engine is ready and the
  // App-owned host exists. Deferred to the first nonzero canvas measure (initWhenSized)
  // so mounting hidden behind another tab can't latch a zero-size init failure. NO
  // dispose in cleanup — the host outlives this panel (App owns it), exactly like the
  // viewport host. Init failure is reported LOCALLY (not a global engine-error dispatch)
  // so a Field-panel failure can't blank the whole editor: this is optional chrome.
  // Panel-reopen re-init throws "already initialized" (host bound to the prior
  // canvas) — a standing v0 limitation surfaced here.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = fieldHostRef.current;
    if (!canvas || !host || initialized.current || state.status !== "ready")
      return;
    initialized.current = true;
    return initWhenSized(canvas, () => {
      host.init(canvas).catch((err) => {
        setStatus(`field host init failed: ${errorMessage(err)}`);
      });
    });
  }, [state.status, fieldHostRef]);

  // Catalog load, run-once on engine-ready. Fetches the project's materials catalog
  // (the daemon maps this chrome-miss GET onto the project root) and installs the
  // resolved table on the host — BEFORE any world Load, so a v2 world baked against
  // this same catalog remeshes with the right classes. A 404 leaves the host on its
  // rock-only BUILTIN_TABLE default; a CatalogError is setup-loud (its JSON path
  // shows in the status line so a mistyped catalog is diagnosable here). The host
  // may not be GPU-init'd yet — setMaterialTable then just stores the table (no
  // rebuild) and init() picks it up; if init ran first, the swap re-meshes. Either
  // order converges. fieldHostRef.current is assigned before engine-ready (App), so
  // it is present whenever state.status === "ready". EVERY outcome settles the
  // catalog (finally) — the Load gate must never wedge shut on a failed fetch.
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready" || catalogLoaded.current) return;
    catalogLoaded.current = true;
    void (async () => {
      try {
        const res = await fetch("/catalog/materials.json");
        if (res.status === 404) {
          setStatus("no catalog — rock only");
          return;
        }
        if (!res.ok) {
          setStatus(`catalog fetch failed (${res.status})`);
          return;
        }
        const parsed = parseMaterialsCatalog(await res.text());
        host.setMaterialTable(parsed);
        setTable(parsed);
        setStatus(`materials: ${parsed.classes.length} classes`);
      } catch (err) {
        if (err instanceof CatalogError) {
          setStatus(`catalog error at "${err.path || "(root)"}": ${err.message}`);
          return;
        }
        setStatus(`catalog load failed: ${errorMessage(err)}`);
      } finally {
        setCatalogSettled(true);
      }
    })();
  }, [state.status, fieldHostRef]);

  // Host-surfaced constants, read once at engine-ready: the smooth ceilings
  // and the generator registry (both reach the chrome through the host
  // because it cannot value-import core).
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready") return;
    setSmoothLimits(host.getSmoothLimits());
    setGenerators(host.listGenerators());
  }, [state.status, fieldHostRef]);

  // Mirror HOST-initiated tool changes (Alt-click eyedropper, momentary
  // Shift/Ctrl overrides) into panel state. ECHO GUARD (binding rider): a
  // panel setTool that lands while a momentary modifier is held makes the
  // host re-derive and fire THIS callback with the DERIVED tool — so the
  // mirror ADOPTS only (a state write, never a host.setTool re-push: pushing
  // the derived tool back would re-derive → re-fire → loop), and
  // value-compares first so an echo of the panel's own state returns the same
  // reference (no render churn).
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready") return;
    return host.subscribeTool((t) =>
      setToolState((prev) => (toolsEqual(prev, t) ? prev : t)),
    );
  }, [state.status, fieldHostRef]);

  // Selection mirror (count / truncated / Clear-Reselect in the footer). The
  // host pushes the CURRENT state on subscribe, covering a panel remount
  // while a selection exists.
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready") return;
    return host.subscribeSelection(setSelection);
  }, [state.status, fieldHostRef]);

  // Stamp-session mirror. subscribeStamp pushes CLONES plus the current state
  // on subscribe, so a panel remount mid-session recovers the live form.
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready") return;
    return host.subscribeStamp(setStamp);
  }, [state.status, fieldHostRef]);

  // Push the panel's layer/slice view defaults to the host at engine-ready,
  // and drop any entity-highlight box when the panel unmounts. The host
  // outlives the panel (App owns it) and has no layers/slice/highlight
  // subscription seam, so a REMOUNT resets all three to the panel defaults —
  // honest (the controls always show what the host uses) at the cost of
  // forgetting the toggles across tab switches; the same v0 trade as the
  // one-way radius seam below. The highlight clear keeps a remounted list
  // (expansion state reset) from standing next to a box no row claims.
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready") return;
    host.setLayers(DEFAULT_LAYERS);
    host.setSlice(null);
    return () => host.highlightEntity(null);
  }, [state.status, fieldHostRef]);

  // Entities refresh strategy (Task 15): re-read listEntities when
  // (a) the STAMP session changes — a commit ends the session with a null
  //     push, which lands the new entity here;
  // (b) the STATS readout changes — any field mutation (including a ⌘Z
  //     undo/redo of an entity commit) dirties chunks, whose remesh bumps
  //     lastRemeshMs, so an undone entity disappears within a frame or two;
  // (c) the Entities section OPENS (EntitiesList onOpen) — manual catch-up.
  // The id+opSpan signature guard keeps the no-change reads (every plain dig
  // stroke hits (b)) from re-rendering the panel.
  const refreshEntities = useCallback((): void => {
    const host = fieldHostRef.current;
    if (!host) return;
    setEntities((prev) => {
      const next = host.listEntities();
      return sameEntities(prev, next) ? prev : next;
    });
  }, [fieldHostRef]);

  useEffect(() => {
    if (state.status !== "ready") return;
    // `stamp` + `stats` are deliberate TRIGGER deps — triggers (a) and (b) of
    // the refresh strategy above; their values are read via listEntities.
    void stamp;
    void stats;
    refreshEntities();
  }, [state.status, refreshEntities, stamp, stats]);

  // User-facing tool problems (selection-mask misuse, swallowed stroke
  // failures, "select a region first") surface on the status line.
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready") return;
    return host.subscribeToolError(setStatus);
  }, [state.status, fieldHostRef]);

  // Live chunk / remesh-time readout. The host fires this every rAF; the functional guard
  // returns the SAME reference when nothing changed, so an idle field (no dig in flight)
  // does not re-render the panel 60×/second.
  useEffect(() => {
    const host = fieldHostRef.current;
    if (!host || state.status !== "ready") return;
    return host.subscribeStats((s) =>
      setStats((prev) =>
        prev.chunks === s.chunks && prev.lastRemeshMs === s.lastRemeshMs
          ? prev
          : s,
      ),
    );
  }, [state.status, fieldHostRef]);

  // Panel radius → host, DELIBERATELY one-way: the host's wheel and [ / ]
  // keys also step its radius and there is NO host→panel radius seam
  // (FieldTool does not carry radius; no subscription does), so the readout
  // can lag the host after wheel/key sizing. Pre-existing wheel asymmetry,
  // kept — the ghost ring in the viewport is the live radius display.
  const onRadius = (r: number): void => {
    setRadius(r);
    fieldHostRef.current?.setDigRadius(r);
  };

  const onShading = (on: boolean): void => {
    setHeadlamp(on);
    const mode: FieldHostShading = on ? "headlamp" : "flat";
    fieldHostRef.current?.setShading(mode);
  };

  const onLayers = (next: FieldLayers): void => {
    setLayers(next);
    fieldHostRef.current?.setLayers(next);
  };

  const onSlice = (next: { enabled: boolean; y: number }): void => {
    setSlice(next);
    fieldHostRef.current?.setSlice(next.enabled ? next.y : null);
  };

  // The one funnel for every tool change: adopt locally + push to the host.
  // The host clamps (smooth ceilings, hollow floor) as a backstop; the
  // controls stay inside the same ranges so panel and host state agree.
  const pushTool = (next: FieldTool): void => {
    setToolState(next);
    fieldHostRef.current?.setTool(next);
  };

  const onBrush = (effect: FieldTool["effect"]): void => {
    // Paint retints solids and is organic-only: paint on a kit class would
    // emit a sphere-shaped kit write, which core rejects (kit stays
    // box+lattice) — clamp to the first organic class (rock, class 0, is
    // guaranteed organic). The swatches disable kit classes while paint is
    // active for the same reason.
    let materialId = tool.materialId;
    const paintable = table.classes.some(
      (c) => c.id === materialId && c.kind === "organic",
    );
    if (effect === "paint" && !paintable)
      materialId = table.classes.find((c) => c.kind === "organic")?.id ?? 0;
    pushTool({ ...tool, effect, materialId });
    // A brush pick disarms any selection gesture — LMB returns to the brush.
    setSelectionModeState(null);
    fieldHostRef.current?.setSelectionMode(null);
  };

  const onSelectionModePick = (mode: SelectionMode): void => {
    setSelectionModeState(mode);
    fieldHostRef.current?.setSelectionMode(mode);
  };

  const onMaterial = (id: number): void => pushTool({ ...tool, materialId: id });

  const onNew = (): void => {
    fieldHostRef.current?.newWorld();
    setStatus("new world — all solid rock");
  };

  const onSave = async (): Promise<void> => {
    const host = fieldHostRef.current;
    if (!host || !nameValid) return;
    setBusy(true);
    setStatus(`saving ${name}…`);
    try {
      const files = toWireFiles(host.exportArtifact(name));
      const res = await api.generationBake(files, `worlds/${name}`);
      setStatus(`saved ${res.files} files → worlds/${name}`);
    } catch (err) {
      setStatus(`save failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onBakeDefault = async (): Promise<void> => {
    const host = fieldHostRef.current;
    if (!host || !nameValid) return;
    setBusy(true);
    setStatus(`baking ${name} as the game's world…`);
    try {
      // Reuse the world flow's upload sequence: the world's file set (cleanDir'd to its own
      // dir so a re-bake leaves no orphans), then worlds/index.json pointed at it
      // (byte-identical to the committed format). Ordered — index.json never names a world
      // not yet on disk.
      const calls = bakeUploadCalls(
        toWireFiles(host.exportArtifact(name)),
        `worlds/${name}`,
        name,
        true,
      );
      const results: { files: number }[] = [];
      for (const call of calls) {
        results.push(await api.generationBake(call.files, call.cleanDir));
      }
      setStatus(`baked ${results[0]?.files ?? 0} files — now the game's world`);
    } catch (err) {
      setStatus(`bake failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onLoad = async (): Promise<void> => {
    const host = fieldHostRef.current;
    if (!host || !nameValid) return;
    setBusy(true);
    setStatus(`loading ${name}…`);
    try {
      const res = await api.fieldLoad(name);
      host.loadWorld({
        // Boundary cast: field.load returns the manifest as opaque JSON; it is the
        // v2 FieldManifest the host wrote (bakeFieldWorld) — loadWorld re-validates cellSize.
        manifest: res.manifest as FieldManifest,
        chunks: res.chunks.map((c) => ({
          key: c.key,
          bytes: base64ToBytes(c.data),
        })),
        // Material siblings decode the same way (base64 → bytes); empty for a
        // rock-only world. Threading them reaches store.materials so a painted/
        // filled world renders with its classes in the editor.
        materials: res.materials.map((m) => ({
          key: m.key,
          bytes: base64ToBytes(m.data),
        })),
        // Raw oplog text — the HOST parses it (field.parseOps maps legacy F1
        // `kind:"dig"` ops forward; the chrome can't value-import parseOps).
        oplog: res.oplog,
      });
      setStatus(`loaded ${name} (${res.chunks.length} chunks)`);
    } catch (err) {
      setStatus(`load failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  if (state.status !== "ready") {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        the field waits for the engine bundle…
      </p>
    );
  }

  const nameInvalid = name !== "" && !nameValid;
  // The live session's registry info (its paramSchema feeds the form). The
  // find can only miss if the registry changed under a live session —
  // impossible today (FIELD_GENERATORS is static); the guard simply hides
  // the inspector rather than crash on a schema-less form.
  const stampDef =
    stamp === null
      ? undefined
      : generators.find((g) => g.id === stamp.generator);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2 text-sm">
        <Input
          type="text"
          value={name}
          placeholder="world name"
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-invalid={nameInvalid}
          aria-label="world name"
          className={cn("h-8 w-36", nameInvalid && "border-destructive")}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={onNew}
        >
          New
        </Button>
        {/* ReasonTip, not a bare title: the Button's disabled:pointer-events-none
            would swallow the tooltip that explains the catalog gate. */}
        <ReasonTip
          reason={
            catalogSettled
              ? undefined
              : "waiting for the materials catalog — Load resolves world classes against it"
          }
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || !nameValid || !catalogSettled}
            onClick={() => void onLoad()}
          >
            Load
          </Button>
        </ReasonTip>
        <Button
          type="button"
          size="sm"
          disabled={busy || !nameValid}
          onClick={() => void onSave()}
        >
          Save
        </Button>
        {/* Bake keeps the World panel's commit-to-disk success colour (tailwind-merge lets
            the className override the default primary fill). */}
        <Button
          type="button"
          size="sm"
          disabled={busy || !nameValid}
          onClick={() => void onBakeDefault()}
          className="bg-success text-success-foreground hover:bg-success/90"
        >
          Bake &amp; make default
        </Button>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={headlamp}
            onChange={(e) => onShading(e.target.checked)}
          />
          headlamp
        </label>
      </div>
      <div className="flex flex-col gap-2 border-b border-border p-2 text-sm">
        <ToolPalette
          effect={tool.effect}
          selectionMode={selectionMode}
          generators={generators}
          onBrush={onBrush}
          onSelectionMode={onSelectionModePick}
          onGenerator={(id) => fieldHostRef.current?.startStamp(id)}
        />
        {/* The persistent swatch strip: rendered whenever the catalog has more
            than one class, independent of the active tool (the eyedropper can
            change the material under ANY tool — the ring must track it). */}
        {table.classes.length > 1 && (
          <MaterialSwatches
            classes={table.classes}
            activeId={tool.materialId}
            disableKit={tool.effect === "paint"}
            onSelect={onMaterial}
          />
        )}
        {/* Brush inspector only while LMB actually brushes — an armed selection
            gesture makes radius/mask/smooth/hollow promises LMB won't keep. */}
        {selectionMode === null && (
          <BrushInspector
            tool={tool}
            radius={radius}
            smoothLimits={smoothLimits}
            classes={table.classes}
            onRadius={onRadius}
            onChange={pushTool}
          />
        )}
        {/* The stamp inspector rides the session's existence, independent of
            the brush/selection state — the brush stays live during a session
            (its strokes are the documented divergence window). */}
        {stamp !== null && stampDef !== undefined && (
          <StampInspector
            session={stamp}
            def={stampDef}
            onUpdate={(params, seed, policy) =>
              fieldHostRef.current?.updateStamp(params, seed, policy)
            }
            onReroll={() => fieldHostRef.current?.rerollStamp()}
            onCommit={() => fieldHostRef.current?.commitStamp()}
            onCancel={() => fieldHostRef.current?.cancelStamp()}
          />
        )}
      </div>
      <div className="border-b border-border p-2 text-sm">
        <LayersRow
          layers={layers}
          slice={slice}
          onLayers={onLayers}
          onSlice={onSlice}
        />
      </div>
      <div className="border-b border-border px-2 py-1 text-sm">
        <EntitiesList
          entities={entities}
          onHighlight={(id) => fieldHostRef.current?.highlightEntity(id)}
          onOpen={refreshEntities}
        />
      </div>
      {/* The FieldHost renders into this canvas. tabIndex makes it focusable so the WASD/QE
          fly + ⌘Z undo keydowns the host attaches actually reach it (Task 9 review flagged
          this as a Task 10 responsibility). Absolute-fill inside a positioned flex cell so
          the canvas always has a non-zero client box at GPU init (bindToCanvas rejects zero). */}
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="field dig surface"
          className="absolute inset-0 h-full w-full focus:outline-none"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {stats.chunks} chunks · remesh {stats.lastRemeshMs.toFixed(1)}ms
        </span>
        <span className="flex items-center gap-1.5">
          {selection && (
            <span className="tabular-nums">
              {selection.count} selected
              {selection.truncated && ` — flood truncated at ${selection.count}`}
            </span>
          )}
          {selection && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-xs"
              onClick={() => fieldHostRef.current?.clearSelection()}
            >
              Clear
            </Button>
          )}
          {/* Always shown: Reselect restores what the last Clear/replace
              displaced, so it matters exactly when there is NO selection; the
              host no-ops on an empty slot. */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-xs"
            title="restore the previous selection"
            onClick={() => fieldHostRef.current?.reselect()}
          >
            Reselect
          </Button>
        </span>
        <span aria-live="polite">{status}</span>
      </div>
    </div>
  );
}
