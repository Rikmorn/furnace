import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Context, RequestContextOptions } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import type {
  LoadedScene,
  SceneDocument,
  SceneSchemaReflection,
} from "@furnace/core/scene";
import * as scene from "@furnace/core/scene";
import type { Vec4 } from "@furnace/core/transform";
import { vec4 } from "@furnace/core/transform";

/**
 * The chrome↔engine protocol. The editor chrome (which contains no engine
 * code) drives the viewport exclusively through this interface; the host owns
 * the GPU context and the loaded scene. Render-on-demand: a render is issued
 * on load, on canvas resize (the host subscribes its own re-render via
 * `gpu.onResize`, so the chrome must NOT drive resize-rendering itself), and
 * via `render()` for any other on-demand redraw. The loaded camera's
 * projection is bound to the canvas so aspect automatically tracks canvas size.
 */
export type ViewportHost = {
  init(
    canvas: HTMLCanvasElement,
    gpuOptions?: RequestContextOptions,
  ): Promise<void>;
  /**
   * Load a scene document into the viewport. If called before `init` resolves,
   * the document is queued and applied once `init` completes — callers need not
   * await `init` before issuing a `loadScene` (the SSE-driven editor can load
   * before the canvas's async GPU init). If multiple pre-init calls are made,
   * the last document wins (latest revision takes precedence).
   */
  loadScene(doc: SceneDocument): Promise<void>;
  /** Re-issue the render of the currently-loaded scene (on-demand redraw). The host re-renders itself on canvas resize, so callers need not invoke this for resize. No-op when nothing is loaded. */
  render(): void;
  introspect(): SceneSchemaReflection;
  destroy(): void;
};

// Boundary: scene-document settings store clearColor as a hand-authored RGBA
// tuple, but frame.render wants a Vec4 (Float32Array). Convert at the call
// site; undefined passes through so render falls back to its own default.
function toVec4(
  rgba: readonly [number, number, number, number] | undefined,
): Vec4 | undefined {
  return rgba ? vec4.fromValues(rgba[0], rgba[1], rgba[2], rgba[3]) : undefined;
}

/**
 * Create an uninitialized viewport host. `init` must be called before GPU
 * operations, but `loadScene` may be called before `init` — the document is
 * queued and applied once `init` completes. This lets the SSE-driven editor
 * load a scene before the canvas's async GPU init resolves (a common race on
 * browser boot / tab refresh when a session already exists).
 */
export function createViewportHost(): ViewportHost {
  let ctx: Context | undefined;
  let loaded: LoadedScene | undefined;
  let unbindCamera: (() => void) | undefined;
  let unbindResize: (() => void) | undefined;
  // SSE-driven loads can race the async GPU init; the latest doc is queued here
  // and flushed once init completes. If multiple loads arrive before init, the
  // last one wins (latest revision takes precedence).
  let pendingDoc: SceneDocument | undefined;

  const requireCtx = (): Context => {
    if (!ctx)
      throw new Error("viewport-host: init(canvas) must be called first");
    return ctx;
  };

  const renderLoaded = (c: Context, l: LoadedScene): void => {
    frame.render(c, {
      meshes: l.meshes,
      camera: l.camera,
      clearColor: toVec4(l.settings.clearColor),
    });
  };

  // Applies a scene document assuming ctx is already set. Encapsulates the
  // destroy-before-build and resize/bind ordering that is load-critical (the M3
  // resize-blank fix depends on the specific sequence below — do not reorder).
  const applyScene = async (doc: SceneDocument): Promise<void> => {
    const c = requireCtx();
    // Destroy-before-build; also unbind the previous camera's resize
    // subscription (scene-swap = swapping the bound camera without disposing
    // the context, the exact case bind.ts says needs manual unsubscribe).
    unbindCamera?.();
    unbindCamera = undefined;
    unbindResize?.();
    unbindResize = undefined;
    loaded?.destroy();
    loaded = undefined;
    loaded = await scene.loadScene(c, doc);
    // bindToCanvas applies the current canvas aspect immediately, then keeps it
    // in sync on resize; render after so the first frame uses that aspect.
    unbindCamera = camera.bindToCanvas(c, loaded.camera);
    // Re-render on canvas resize. Subscribe AFTER bindToCanvas so this runs
    // after the camera-aspect update, and because the engine's onResize sets
    // the canvas backing store BEFORE emitting, the render here happens at the
    // NEW size — the chrome must NOT drive this via its own ResizeObserver
    // (that fires before the backing-store resize and the resize then blanks
    // the surface).
    unbindResize = gpu.onResize(c, () => {
      if (ctx && loaded) renderLoaded(ctx, loaded);
    });
    renderLoaded(c, loaded);
  };

  return {
    async init(canvas, gpuOptions) {
      if (ctx) throw new Error("viewport-host: already initialized");
      ctx = await gpu.requestContext(canvas, gpuOptions);
      // Flush any scene queued before init resolved (SSE-driven load race).
      if (pendingDoc !== undefined) {
        const d = pendingDoc;
        pendingDoc = undefined;
        await applyScene(d);
      }
    },
    async loadScene(doc) {
      if (!ctx) {
        // queue: SSE-driven load can race the async GPU init; apply on init
        pendingDoc = doc;
        return;
      }
      await applyScene(doc);
    },
    render() {
      if (ctx && loaded) renderLoaded(ctx, loaded);
    },
    introspect: () => scene.introspect(),
    destroy() {
      unbindCamera?.();
      unbindCamera = undefined;
      unbindResize?.();
      unbindResize = undefined;
      loaded?.destroy();
      loaded = undefined;
      if (ctx) gpu.dispose(ctx);
      ctx = undefined;
    },
  };
}
