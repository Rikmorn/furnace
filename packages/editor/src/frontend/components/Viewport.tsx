import { Layers } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrbitState } from "../../viewport-host/index.ts"; // type-only: erased
import { VIEW_FLAG_ITEMS } from "../lib/view-flags.ts";
import { AxisTriad } from "./AxisTriad.tsx";
import { useEditor } from "./editor-context.ts";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

// Trailing-debounce the per-doc camera-pose write: an "end" fires on every wheel event, and
// a trackpad zoom (Safari's default gesture) is a continuous wheel stream — each write is a
// synchronous whole-UiState stringify + localStorage.setItem. Coalesce to one write once the
// gesture settles. Mirrors App's LAYOUT_SAVE_DEBOUNCE_MS.
const POSE_SAVE_DEBOUNCE_MS = 200;

export function Viewport() {
  const { state, dispatch, hostRef, previewHostRef, viewFlags, setViewFlag, store } =
    useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const initialized = useRef(false);
  const previewInitialized = useRef(false);
  // Preview-host fog toggle (Slice 3.1) — a VIEW flag for the generation preview canvas,
  // distinct from the doc viewport's own `fog` view flag (which drives the host below).
  const [fogOn, setFogOn] = useState(false);
  // The doc viewport's live orbit pose, driving the corner axis triad. Null until a scene
  // loads; updated live during a drag and on load via the host's camera-pose API.
  const [pose, setPose] = useState<OrbitState | null>(null);
  // Trailing-debounce timer for the pose write (cleared on unmount).
  const poseSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host || initialized.current || state.status !== "ready")
      return;
    initialized.current = true;
    host.init(canvas).catch((err) => {
      dispatch({
        type: "engine-error",
        diagnostics: `viewport init failed: ${String(err)}`,
      });
    });
    // The host owns resize-rendering (it re-renders itself via gpu.onResize,
    // ordered after the backing-store resize). The chrome must NOT add a
    // competing ResizeObserver here — one that fires before the backing-store
    // resize blanks the viewport.
  }, [state.status, dispatch, hostRef]);

  // The cockpit preview host lives on its own canvas (Slice 3.1). It inits once at
  // ready so the generation panel can realize into it immediately. Sound ONLY because
  // the canvas keeps its layout box while invisible (visibility swap, see the JSX
  // comment) — init on a zero-size canvas throws in core's bindToCanvas.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const host = previewHostRef.current;
    if (
      !canvas ||
      !host ||
      previewInitialized.current ||
      state.status !== "ready"
    )
      return;
    previewInitialized.current = true;
    host.init(canvas).catch((err) => {
      dispatch({
        type: "engine-error",
        diagnostics: `preview init failed: ${String(err)}`,
      });
    });
  }, [state.status, dispatch, previewHostRef]);

  // Persist the doc's camera pose — called on an orbit "end" (see below), then trailing-
  // debounced so a continuous wheel/trackpad-zoom stream coalesces to ONE whole-UiState
  // write once the gesture settles. Keyed by the open scene path.
  const persistPose = useCallback(
    (p: OrbitState) => {
      const path = state.selectedScene;
      if (!store || !path) return;
      if (poseSaveTimerRef.current !== undefined) {
        clearTimeout(poseSaveTimerRef.current);
      }
      poseSaveTimerRef.current = setTimeout(() => {
        const prev = store.get("cameraByDoc") ?? {};
        store.set("cameraByDoc", { ...prev, [path]: p });
      }, POSE_SAVE_DEBOUNCE_MS);
    },
    [store, state.selectedScene],
  );

  // Clear any pending debounced pose write on unmount.
  useEffect(
    () => () => {
      if (poseSaveTimerRef.current !== undefined) {
        clearTimeout(poseSaveTimerRef.current);
      }
    },
    [],
  );

  // Live triad + persistence: subscribe to the host's camera changes. "move" updates the
  // overlay only; "end" also persists. Re-subscribes when the persist target changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || state.status !== "ready") return;
    return host.subscribeCameraPose((p, phase) => {
      setPose(p);
      if (phase === "end") persistPose(p);
    });
  }, [state.status, hostRef, persistPose]);

  // Seed/refresh the triad pose whenever the loaded document changes (open, switch, revision
  // bump, or App's persisted-pose restore). By this point the host holds the final pose.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || state.status !== "ready") return;
    setPose(host.getCameraPose());
  }, [state.status, state.doc, hostRef]);

  if (state.status === "no-webgpu") {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-muted-foreground">
        WebGPU unavailable — Safari 26+ or Chrome 113+ required. The rest of the
        editor still works.
      </div>
    );
  }
  if (state.status === "engine-error") {
    return (
      <div className="h-full overflow-auto p-4">
        <p className="mb-2 text-destructive">
          engine bundle failed to build — fix the extension and refresh:
        </p>
        <pre className="whitespace-pre-wrap font-mono text-xs text-destructive">
          {state.error}
        </pre>
      </div>
    );
  }
  // Both canvases stay mounted AND laid out at all times: the swap toggles
  // `visibility`, never `display` — a display:none canvas has zero client size, so
  // core's bindToCanvas throws "width and height must be positive" at host init
  // (found live at the 3.1 gate). visibility keeps the layout box, so both hosts
  // init at boot with real dimensions and the swap needs no resize event.
  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ visibility: state.generationActive ? "hidden" : "visible" }}
      />
      <canvas
        ref={previewCanvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ visibility: state.generationActive ? "visible" : "hidden" }}
      />
      {state.generationActive && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-warning/90 px-2 py-1 text-xs font-semibold text-warning-foreground">
          PREVIEW
        </div>
      )}
      {state.generationActive && (
        <label
          className="absolute right-2 top-2 flex items-center gap-1.5 rounded bg-popover/80 px-2 py-1 text-xs text-foreground"
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
          fog
        </label>
      )}
      {/* Doc-viewport view flags: a top-right popover cluster, mirrored with View▸View flags
          (both drive the same App state). Hidden while the generation preview owns the view. */}
      {!state.generationActive && (
        <div className="absolute right-2 top-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 bg-popover/70 hover:bg-popover"
                title="View flags"
                aria-label="View flags"
              >
                <Layers />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-2">
              <div className="flex flex-col gap-0.5">
                {VIEW_FLAG_ITEMS.map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={viewFlags[key]}
                      onCheckedChange={(v) => setViewFlag(key, v === true)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}
      {/* Corner orientation triad (the `axes` view flag), bottom-right, tracking the orbit. */}
      {!state.generationActive && viewFlags.axes && pose && (
        <div className="pointer-events-none absolute bottom-2 right-2">
          <AxisTriad yaw={pose.yaw} pitch={pose.pitch} />
        </div>
      )}
    </div>
  );
}
