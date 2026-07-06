import { useEffect, useRef } from "react";
import { useEditor } from "./editor-context.ts";

export function Viewport() {
  const { state, dispatch, hostRef, previewHostRef } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const initialized = useRef(false);
  const previewInitialized = useRef(false);

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
  // ready — even while hidden — so the generation panel can realize into it immediately;
  // the host re-renders itself on resize when the canvas becomes visible (display swap).
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
      <div className="grid h-full place-items-center p-6 text-center text-neutral-400">
        WebGPU unavailable — Safari 26+ or Chrome 113+ required. The rest of the
        editor still works.
      </div>
    );
  }
  if (state.status === "engine-error") {
    return (
      <div className="h-full overflow-auto p-4">
        <p className="mb-2 text-red-400">
          engine bundle failed to build — fix the extension and refresh:
        </p>
        <pre className="whitespace-pre-wrap font-mono text-xs text-red-300">
          {state.error}
        </pre>
      </div>
    );
  }
  // Both canvases stay mounted; the display swap (not unmount) preserves each host's
  // GPU context across toggles. The generation panel owns the preview canvas.
  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ display: state.generationActive ? "none" : "block" }}
      />
      <canvas
        ref={previewCanvasRef}
        className="h-full w-full"
        style={{ display: state.generationActive ? "block" : "none" }}
      />
      {state.generationActive && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-amber-600/90 px-2 py-1 text-xs font-semibold text-white">
          PREVIEW
        </div>
      )}
    </div>
  );
}
