// The Field panel (F1/F2): the dig-loop chrome. It mounts a <canvas> the App-owned FieldHost
// renders into (LMB applies the tool, RMB looks, WASD/QE flies, wheel sizes the brush, ⌘Z
// undoes) and exposes name + tool (dig/fill/paint) + material + dig-radius + shading controls
// plus Save / Load / Bake-as-default. On engine-ready it loads the project's materials
// catalog (F2) and installs the resolved table on the host. The host is created ONCE at
// engine-ready (App) and reached ONLY through the /engine.js runtime channel (a context ref)
// — the chrome never value-imports engine code (the project-first invariant). This file
// type-imports FieldHost + the field artifact types (all erased) and value-imports the
// catalog parser from a frontend lib that itself only type-imports core.
import type {
  FieldManifest,
  FieldOp,
  MaterialTable,
} from "@furnace/core/field"; // type-only: erased
import { useEffect, useRef, useState } from "react";
import type {
  FieldHost,
  FieldHostShading,
} from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
// catalog.ts type-imports core only (erased), so value-importing it here does NOT
// pull core into the chrome bundle — the project-first invariant holds.
import { CatalogError, parseMaterialsCatalog } from "../lib/catalog.ts";
import { cn } from "../lib/cn.ts";
import { bakeUploadCalls, toWireFiles } from "../lib/generation.ts";
import { initWhenSized } from "../lib/init-when-sized.ts";
import { useEditor } from "./editor-context.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

// Mirrors the daemon field.load name regex AND FieldHost's clamp range. Name is EMPTY by
// default and never prefilled (the W3/W4 gate-clobber lesson: a stale default silently
// overwrites the game's world on Save/Bake).
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;
// Mirror FieldHost's clamp range + default (RADIUS_MIN/MAX, digRadius).
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 4;
const RADIUS_STEP = 0.05;
const DEFAULT_RADIUS = 1.25;

/** Which brush the pointer applies. Mirrors FieldTool["effect"] (not exported from
 *  the viewport-host barrel, so declared locally — the setTool call below is
 *  structurally checked against the host's FieldTool param, catching any drift). */
type ToolEffect = "dig" | "fill" | "paint";

const TOOL_LABELS: Record<ToolEffect, string> = {
  dig: "Dig",
  fill: "Fill",
  paint: "Paint",
};

// Dropdown fallback before the catalog resolves and when there is none (404): rock
// only. A LOCAL literal — the chrome can't value-import core's BUILTIN_TABLE
// (frontend-no-engine-leakage). The host keeps its own BUILTIN_TABLE default; this
// only feeds the material <select>. Colour is unused by the dropdown, but the type
// requires it.
const ROCK_ONLY_TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
  ],
};

type FieldStats = { chunks: number; lastRemeshMs: number };

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// base64 → bytes: the inverse of toWireFiles' encoder, decoding the density chunk files
// the daemon returns. Per-chunk atob is fine for v0 sizes (each chunk is a 4KiB file).
const base64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

export function FieldPanel() {
  const { state, fieldHostRef } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialized = useRef(false);
  const catalogLoaded = useRef(false);
  const [name, setName] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [headlamp, setHeadlamp] = useState(false);
  const [tool, setTool] = useState<ToolEffect>("dig");
  const [materialId, setMaterialId] = useState(0);
  const [table, setTable] = useState<MaterialTable>(ROCK_ONLY_TABLE);
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
  // Panel-reopen re-init throws "already initialized" (host bound to the prior canvas)
  // — a v0 limitation surfaced here, tracked for Task 12.
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
  // it is present whenever state.status === "ready".
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
      }
    })();
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

  const onRadius = (r: number): void => {
    setRadius(r);
    fieldHostRef.current?.setDigRadius(r);
  };

  const onShading = (on: boolean): void => {
    setHeadlamp(on);
    const mode: FieldHostShading = on ? "headlamp" : "flat";
    fieldHostRef.current?.setShading(mode);
  };

  const onTool = (effect: ToolEffect): void => {
    setTool(effect);
    // Paint retints solids and is organic-only (kit-paint isn't a thing). If the
    // active material is a kit class — only reachable via Fill — clamp to the first
    // organic class so the paint <select> value stays inside its option set. Rock
    // (class 0, always organic) is the guaranteed fallback.
    let nextMaterial = materialId;
    const paintValid = table.classes.some(
      (c) => c.id === materialId && c.kind === "organic",
    );
    if (effect === "paint" && !paintValid) {
      nextMaterial = table.classes.find((c) => c.kind === "organic")?.id ?? 0;
      setMaterialId(nextMaterial);
    }
    fieldHostRef.current?.setTool({ effect, materialId: nextMaterial });
  };

  const onMaterial = (id: number): void => {
    setMaterialId(id);
    fieldHostRef.current?.setTool({ effect: tool, materialId: id });
  };

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
        ops: res.oplog ? (JSON.parse(res.oplog) as FieldOp[]) : [],
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
  // Fill offers every class; paint offers organic classes only (kit-paint isn't a
  // thing); dig hides the dropdown entirely (the conditional-axis refinement).
  const materialClasses =
    tool === "paint"
      ? table.classes.filter((c) => c.kind === "organic")
      : table.classes;

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
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !nameValid}
          onClick={() => void onLoad()}
        >
          Load
        </Button>
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
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="brush tool"
        >
          {(["dig", "fill", "paint"] as const).map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={tool === t ? "default" : "secondary"}
              aria-pressed={tool === t}
              onClick={() => onTool(t)}
            >
              {TOOL_LABELS[t]}
            </Button>
          ))}
        </div>
        {/* Material dropdown: shown for Fill (all classes) + Paint (organic only);
            hidden for Dig (materialId is irrelevant to digging). */}
        {tool !== "dig" && (
          <label className="flex items-center gap-1.5 text-muted-foreground">
            material
            <select
              value={materialId}
              onChange={(e) => onMaterial(Number(e.target.value))}
              aria-label="brush material"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {materialClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5 text-muted-foreground">
          brush
          <input
            type="range"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={RADIUS_STEP}
            value={radius}
            onChange={(e) => onRadius(Number(e.target.value))}
            aria-label="dig radius"
          />
          <span className="w-8 tabular-nums">{radius.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={headlamp}
            onChange={(e) => onShading(e.target.checked)}
          />
          headlamp
        </label>
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
        <span aria-live="polite">{status}</span>
      </div>
    </div>
  );
}
