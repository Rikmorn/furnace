import { useEffect, useRef } from "react";
import { useEditor } from "./editor-context.ts";

export function Viewport() {
  const { state, dispatch, hostRef } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialized = useRef(false);

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
    const observer = new ResizeObserver(() => host.render());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [state.status, dispatch, hostRef]);

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
  return <canvas ref={canvasRef} className="h-full w-full" />;
}
