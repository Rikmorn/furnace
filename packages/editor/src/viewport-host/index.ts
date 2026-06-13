import type { Camera } from "@furnace/core/camera";
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
import { vec3, vec4 } from "@furnace/core/transform";
import { boxEdges } from "./box-edges.ts";
import {
  fromEyeTarget,
  type OrbitState,
  orbit,
  pan,
  toEyeTarget,
  zoom,
} from "./camera-control.ts";
import { classifyDrag, type DragAction } from "./input-map.ts";

/** Callbacks registered by the chrome via `ViewportHost.setCallbacks`. */
export type ViewportCallbacks = {
  onSelect: (
    entityId: string | null,
    mods: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  onTransformCommit: (
    edits: { entityId: string; transform: Record<string, unknown> }[],
  ) => void;
};

/**
 * The chrome↔engine protocol. The editor chrome (which contains no engine
 * code) drives the viewport exclusively through this interface; the host owns
 * the GPU context and the loaded scene. Render-on-demand: a render is issued
 * on load, on canvas resize (the host subscribes its own re-render via
 * `gpu.onResize`, so the chrome must NOT drive resize-rendering itself), and
 * via `render()` for any other on-demand redraw. The editor camera (orbit
 * perspective) is bound to the canvas so aspect automatically tracks canvas
 * size; it is never serialized and is independent of the scene camera entity.
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
  /**
   * Live-preview a single component edit on `entityId` (no daemon op): apply the
   * whole-component override onto the committed doc, rebuild just that entity,
   * and render. Invalid params are swallowed (last good render kept) — the daemon
   * commit path reports the real validation error.
   */
  previewEntity(
    entityId: string,
    component: string,
    params: Record<string, unknown>,
  ): void;
  /** Live-preview a settings edit (e.g. clearColor) — no daemon op, no rebuild, re-render only. No-op before init. */
  previewSettings(settings: SceneDocument["settings"]): void;
  /** Discard any preview on `entityId`: rebuild it from the committed doc + render. */
  revertEntity(entityId: string): void;
  /** Discard any settings preview: restore from the committed doc + render. */
  revertSettings(): void;
  /** Adopt `doc` as the committed baseline with NO rebuild (own-commit echo already shown). */
  syncCommitted(doc: SceneDocument): void;
  /** Re-issue the render of the currently-loaded scene (on-demand redraw). The host re-renders itself on canvas resize, so callers need not invoke this for resize. No-op when nothing is loaded. */
  render(): void;
  /**
   * Push a selection of entity ids into the host. The host immediately re-renders
   * with depth-tested AABB highlight boxes drawn over the scene for each selected
   * entity. Pass an empty array to clear the selection highlight.
   */
  setSelection(entityIds: string[]): void;
  /**
   * Register chrome callbacks for selection and transform-commit events. Must be
   * called after `init`. `onTransformCommit` receives an array so a multi-entity
   * gizmo drag produces a single undo entry (Tasks 13+14 depend on this shape).
   */
  setCallbacks(cb: ViewportCallbacks): void;
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
  let committedDoc: SceneDocument | undefined;
  let unbindCamera: (() => void) | undefined;
  let unbindResize: (() => void) | undefined;
  // SSE-driven loads can race the async GPU init; the latest doc is queued here
  // and flushed once init completes. If multiple loads arrive before init, the
  // last one wins (latest revision takes precedence).
  let pendingDoc: SceneDocument | undefined;
  // Editor-owned orbit camera: initialized from the scene camera's pose on each
  // scene load, then driven by pointer events. Never serialized; independent of
  // the scene camera entity (editing the scene camera entity does NOT move the
  // editor view, and vice versa).
  let editorCam: Camera | undefined;
  let orbitState: OrbitState | undefined;
  // Reassigned wholesale on every setSelection call (replace-not-mutate).
  let selection: string[] = [];

  // Chrome callbacks registered via setCallbacks; undefined until called.
  let callbacks: ViewportCallbacks | undefined;
  // Canvas element stored at init time for event attachment and capture.
  let canvasEl: HTMLCanvasElement | undefined;
  // Active pointer drag state; null when no drag is in progress.
  let drag: { action: DragAction; lastX: number; lastY: number } | null = null;

  const ORBIT_SPEED = 0.01;
  const PAN_SPEED = 0.002;

  const requireCtx = (): Context => {
    if (!ctx)
      throw new Error("viewport-host: init(canvas) must be called first");
    return ctx;
  };

  const HILITE: [number, number, number, number] = [1, 0.6, 0, 1];

  const renderLoaded = (c: Context, l: LoadedScene): void => {
    const cam = editorCam ?? l.camera;
    frame.render(c, {
      meshes: l.meshes,
      camera: cam,
      clearColor: toVec4(l.settings.clearColor),
    });
    for (const id of selection) {
      const corners = l.entityBoxCorners(id);
      if (!corners) continue;
      const { vertices, colors } = boxEdges(corners, HILITE);
      frame.drawLines(c, { vertices, colors, camera: cam, occlude: true });
    }
  };

  // Write the current orbitState into editorCam's position/target/up fields.
  const applyOrbit = (): void => {
    if (!editorCam || !orbitState) return;
    const { eye, target, up } = toEyeTarget(orbitState);
    camera.setPosition(editorCam, new Float32Array(eye));
    camera.setTarget(editorCam, new Float32Array(target));
    camera.setUp(editorCam, new Float32Array(up));
  };

  // Applies a scene document assuming ctx is already set. Encapsulates the
  // destroy-before-build and resize/bind ordering that is load-critical (the M3
  // resize-blank fix depends on the specific sequence below — do not reorder).
  const applyScene = async (doc: SceneDocument): Promise<void> => {
    const c = requireCtx();
    // Destroy-before-build; also unbind the previous editor camera's resize
    // subscription (scene-swap = swapping the bound camera without disposing
    // the context, the exact case bind.ts says needs manual unsubscribe).
    unbindCamera?.();
    unbindCamera = undefined;
    unbindResize?.();
    unbindResize = undefined;
    loaded?.destroy();
    loaded = undefined;
    loaded = await scene.loadScene(c, doc);
    committedDoc = doc;
    // Initialize the editor orbit camera from the scene camera's pose, then
    // bind the editor camera (not the scene camera) to the canvas so aspect
    // tracks canvas size. The scene camera entity remains independently
    // editable in the inspector without moving the editor view.
    const sc = loaded.camera;
    editorCam = camera.perspective({
      fovYRad: Math.PI / 3,
      aspect: 1,
      near: 0.1,
      far: 1000,
    });
    const eye = vec3.create();
    camera.getPosition(eye, sc);
    const tgt = vec3.create();
    camera.getTarget(tgt, sc);
    // vec3.create() returns Float32Array; index reads are number | undefined
    // under noUncheckedIndexedAccess but indices 0-2 are always present on a
    // vec3 — hot-path typed-array cast (documented in typescript.md).
    orbitState = fromEyeTarget(
      [eye[0] as number, eye[1] as number, eye[2] as number],
      [tgt[0] as number, tgt[1] as number, tgt[2] as number],
    );
    applyOrbit();
    // bindToCanvas applies the current canvas aspect immediately, then keeps it
    // in sync on resize; render after so the first frame uses that aspect.
    unbindCamera = camera.bindToCanvas(c, editorCam);
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

  const toNdc = (clientX: number, clientY: number): [number, number] => {
    if (!canvasEl) return [0, 0];
    const r = canvasEl.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    const y = -(((clientY - r.top) / r.height) * 2 - 1);
    return [x, y];
  };

  const frameSelected = (): void => {
    if (!loaded || !orbitState) return;
    const ids = selection;
    if (ids.length === 0) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const id of ids) {
      const c = loaded.entityBoxCorners(id);
      if (!c) continue;
      for (let k = 0; k < 8; k++) {
        cx += c[k * 3] as number;
        cy += c[k * 3 + 1] as number;
        cz += c[k * 3 + 2] as number;
      }
      n += 8;
    }
    if (n === 0) return;
    orbitState = { ...orbitState, target: [cx / n, cy / n, cz / n] };
    applyOrbit();
    if (ctx) renderLoaded(ctx, loaded);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!ctx || !loaded || !editorCam) return;
    // Task 13 inserts a gizmo hit-test here FIRST (gizmo pick-priority), returning early on a handle hit.
    const action = classifyDrag({
      button: e.button,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
    });
    if (action === "select") {
      const [nx, ny] = toNdc(e.clientX, e.clientY);
      void loaded.pick(ctx, editorCam, nx, ny).then((id) => {
        callbacks?.onSelect(id, {
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
        });
      });
      return;
    }
    drag = { action, lastX: e.clientX, lastY: e.clientY };
    canvasEl?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!drag || !orbitState || !editorCam || !ctx || !loaded) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (drag.action === "orbit") {
      // Negate so a rightward/downward drag orbits the camera the intuitive way (drag the world, not the camera).
      orbitState = orbit(orbitState, -dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    } else if (drag.action === "pan") {
      // view matrix is world→view; its rows give the camera basis in world space.
      const m = camera.getMatrices(editorCam).view;
      const right: [number, number, number] = [
        m[0] as number,
        m[4] as number,
        m[8] as number,
      ];
      const up: [number, number, number] = [
        m[1] as number,
        m[5] as number,
        m[9] as number,
      ];
      orbitState = pan(orbitState, dx, dy, right, up, PAN_SPEED);
    }
    applyOrbit();
    renderLoaded(ctx, loaded);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!drag) return;
    canvasEl?.releasePointerCapture(e.pointerId);
    drag = null;
  };

  const onWheel = (e: WheelEvent): void => {
    if (!orbitState || !ctx || !loaded) return;
    e.preventDefault();
    orbitState = zoom(orbitState, Math.sign(e.deltaY));
    applyOrbit();
    renderLoaded(ctx, loaded);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "f" || e.key === "F") frameSelected();
  };

  return {
    async init(canvas, gpuOptions) {
      if (ctx) throw new Error("viewport-host: already initialized");
      ctx = await gpu.requestContext(canvas, gpuOptions);
      // Guard: test mocks (OffscreenCanvas cast as HTMLCanvasElement) don't
      // expose addEventListener — only attach in real browser environments.
      if (typeof canvas.addEventListener === "function") {
        canvasEl = canvas;
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.tabIndex = 0; // so the canvas can receive key events
        canvas.addEventListener("keydown", onKeyDown);
      }
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
    setSelection(ids) {
      selection = ids;
      if (ctx && loaded) renderLoaded(ctx, loaded);
    },
    previewEntity(entityId, component, params) {
      if (!ctx || !loaded || !committedDoc) return;
      if (component === "transform") {
        // Fast path: poke the mesh transform directly — no clone, no rebuild.
        loaded.setEntityTransform(
          entityId,
          params as {
            position?: readonly [number, number, number];
            rotation?: readonly [number, number, number, number];
            scale?: readonly [number, number, number];
          },
        ); // Boundary cast: params comes from the inspector's typed form fields;
        // setEntityTransform's shape matches the transform component schema.
        renderLoaded(ctx, loaded);
        return;
      }
      const next = structuredClone(committedDoc);
      const entity = next.entities.find((e) => e.id === entityId);
      if (!entity) return;
      entity.components[component] = params;
      try {
        loaded.rebuildEntity(entityId, next);
      } catch {
        // Transiently-invalid preview (bad ref / params): keep last good render.
        return;
      }
      renderLoaded(ctx, loaded);
    },
    previewSettings(settings) {
      if (!ctx || !loaded) return;
      // Boundary cast: preview value comes from the typed settings inspector;
      // the daemon commit path validates it for real.
      loaded.setSettings((settings ?? {}) as LoadedScene["settings"]);
      renderLoaded(ctx, loaded);
    },
    revertEntity(entityId) {
      if (!ctx || !loaded || !committedDoc) return;
      try {
        loaded.rebuildEntity(entityId, committedDoc);
      } catch {
        // Committed doc loaded cleanly before; a throw here is an unexpected
        // invariant violation — keep the last good render rather than corrupt it.
        return;
      }
      renderLoaded(ctx, loaded);
    },
    revertSettings() {
      if (!ctx || !loaded || !committedDoc) return;
      // Boundary cast: mirrors previewSettings — restores from committed baseline.
      loaded.setSettings(
        (committedDoc.settings ?? {}) as LoadedScene["settings"],
      );
      renderLoaded(ctx, loaded);
    },
    syncCommitted(doc) {
      committedDoc = doc;
    },
    setCallbacks(cb) {
      callbacks = cb;
    },
    introspect: () => scene.introspect(),
    destroy() {
      if (canvasEl) {
        canvasEl.removeEventListener("pointerdown", onPointerDown);
        canvasEl.removeEventListener("pointermove", onPointerMove);
        canvasEl.removeEventListener("pointerup", onPointerUp);
        canvasEl.removeEventListener("pointercancel", onPointerUp);
        canvasEl.removeEventListener("wheel", onWheel);
        canvasEl.removeEventListener("keydown", onKeyDown);
        canvasEl = undefined;
      }
      unbindCamera?.();
      unbindCamera = undefined;
      unbindResize?.();
      unbindResize = undefined;
      loaded?.destroy();
      loaded = undefined;
      committedDoc = undefined;
      editorCam = undefined;
      orbitState = undefined;
      callbacks = undefined;
      drag = null;
      if (ctx) gpu.dispose(ctx);
      ctx = undefined;
    },
  };
}
