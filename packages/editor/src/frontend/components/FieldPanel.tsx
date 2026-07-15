// The Field panel (F1): the dig-loop chrome. It mounts a <canvas> the App-owned FieldHost
// renders into (LMB digs, RMB looks, WASD/QE flies, wheel sizes the brush, ⌘Z undoes) and
// exposes name + dig-radius + shading controls plus Save / Load / Bake-as-default. The host
// is created ONCE at engine-ready (App) and reached ONLY through the /engine.js runtime
// channel (a context ref) — the chrome never value-imports engine code (the project-first
// invariant). This file type-imports FieldHost + the field artifact types (all erased).
import type { DigOp, FieldManifest } from "@furnace/core/field"; // type-only: erased
import { useEffect, useRef, useState } from "react";
import type {
  FieldHost,
  FieldHostShading,
} from "../../viewport-host/index.ts"; // type-only: erased
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { bakeUploadCalls, toWireFiles } from "../lib/generation.ts";
import { useEditor } from "./editor-context.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

// Mirrors the daemon field.load name regex AND FieldHost's clamp range. Name is EMPTY by
// default and never prefilled (the W3/W4 gate-clobber lesson: a stale default silently
// overwrites the game's world on Save/Bake).
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 3;
const RADIUS_STEP = 0.05;
const DEFAULT_RADIUS = 0.75;

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
  const [name, setName] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [headlamp, setHeadlamp] = useState(false);
  const [stats, setStats] = useState<FieldStats>({ chunks: 0, lastRemeshMs: 0 });
  const [status, setStatus] = useState("dig into the rock, then Save");
  const [busy, setBusy] = useState(false);

  const nameValid = NAME_RE.test(name);

  // Run-once init (the Viewport idiom): grab the canvas once the engine is ready and the
  // App-owned host exists. NO dispose in cleanup — the host outlives this panel (App owns
  // it), exactly like the viewport host. Init failure is reported LOCALLY (not a global
  // engine-error dispatch) so a Field-panel failure can't blank the whole editor: this is
  // optional chrome. Panel-reopen re-init throws "already initialized" (host bound to the
  // prior canvas) — a v0 limitation surfaced here, tracked for Task 12.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = fieldHostRef.current;
    if (!canvas || !host || initialized.current || state.status !== "ready")
      return;
    initialized.current = true;
    host.init(canvas).catch((err) => {
      setStatus(`field host init failed: ${errorMessage(err)}`);
    });
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
        ops: res.oplog ? (JSON.parse(res.oplog) as DigOp[]) : [],
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
