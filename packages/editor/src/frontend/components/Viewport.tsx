import { useEffect, useRef, useState } from "react";
import { useEditor } from "./editor-context.ts";

export function Viewport() {
  const { state, dispatch, hostRef, previewHostRef } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const initialized = useRef(false);
  const previewInitialized = useRef(false);
  // View flag, not a generation knob — fog on/off is a property of how you VIEW the
  // world (the UE/Unity viewport show-flags pattern), so it lives on the viewport.
  // Mirrors the preview host's flag (both default off).
  const [fogOn, setFogOn] = useState(false);

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
    </div>
  );
}
