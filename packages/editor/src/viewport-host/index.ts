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
  dolly,
  flyLook,
  flyMove,
  fromEyeTarget,
  type OrbitState,
  orbit,
  pan,
  toEyeTarget,
} from "./camera-control.ts";
import {
  AXIS_DIR,
  type Axis,
  closestPointParamOnAxis,
  pickAxis,
  type Ray,
} from "./gizmo.ts";
import { classifyDrag, type DragAction } from "./input-map.ts";
import { transformEditNeedsRebuild } from "./preview-gate.ts";
import { buildGridLines, segmentsToBatch } from "./reference-grid.ts";

export type { OrbitState } from "./camera-control.ts";
export {
  createFieldHost,
  type FieldEntityInfo,
  type FieldGeneratorInfo,
  type FieldHost,
  type FieldHostShading,
  type FieldLayers,
  type FieldMaskChoice,
  type FieldStats,
  type FieldTool,
  type SelectionInfo,
  type SelectionMode,
} from "./field-host.ts";
export type {
  StampPhase,
  StampRegion,
  StampSession,
} from "./field-stamp.ts";
export type { NudgeSteps } from "./input-map.ts";
export {
  createPreviewHost,
  type PreviewContent,
  type PreviewHost,
} from "./preview-host.ts";

/**
 * Viewport reference-layer + rendering toggles. `grid`, `headlamp`, and `fog` gate what
 * this host renders; `axes` gates the chrome's corner triad overlay (carried here so all
 * four share one type and one persisted blob). Defaults: grid/axes/headlamp ON, fog OFF —
 * a near-black unlit scene reads as broken without the grid + lamp.
 */
export type ViewFlags = {
  grid: boolean;
  axes: boolean;
  headlamp: boolean;
  fog: boolean;
};

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
   *
   * `opts.resetCamera` (default `true`) re-initializes the editor orbit camera
   * from the scene camera's pose. Pass `false` for a same-scene reload (a
   * resource/settings commit or external file edit that bumps the revision) so
   * the user's current orbit/zoom is preserved — the editor camera is
   * independent of the scene and must not jump when scene content changes.
   */
  loadScene(
    doc: SceneDocument,
    opts?: { resetCamera?: boolean },
  ): Promise<void>;
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
   * Register chrome callbacks for selection and transform-commit events. May be
   * called before or after `init` — the callbacks are latched immediately and
   * take effect once `init` has wired the pointer/gizmo event handlers.
   * `onTransformCommit` receives an array so a multi-entity gizmo drag produces
   * a single undo entry (Tasks 13+14 depend on this shape).
   */
  setCallbacks(cb: ViewportCallbacks): void;
  /**
   * Toggle the viewport reference layer + rendering flags and re-render. `grid`/`headlamp`/
   * `fog` change what this host draws; `axes` is consumed by the chrome's corner triad, not
   * here. A no-opts host defaults to grid/axes/headlamp ON, fog OFF, so callers that never
   * call this (the GPU tests) still render a grounded, lit scene.
   */
  setViewFlags(flags: ViewFlags): void;
  /**
   * The current editor orbit pose (target/distance/yaw/pitch), or `null` before a scene
   * loads (the camera is created on load). Returns a copy — mutating it does not affect the
   * host. Consumed by the corner triad and per-doc camera-pose persistence.
   */
  getCameraPose(): OrbitState | null;
  /**
   * Restore an orbit pose (e.g. a persisted per-doc camera) onto the editor camera and
   * re-render. No-op before a scene loads. Does NOT notify camera subscribers — a
   * programmatic restore is not a user gesture and must not trigger a persistence write.
   */
  setCameraPose(pose: OrbitState): void;
  /**
   * Subscribe to editor-camera changes (orbit/pan/zoom/frame). `phase` is `"move"` during a
   * drag — fires per pointer-move frame, for a live overlay only — and `"end"` on release,
   * wheel zoom, or frame-selection: persist there, never on `"move"` (a per-frame
   * whole-blob write is the anti-pattern this split exists to prevent). Returns an
   * unsubscribe function.
   */
  subscribeCameraPose(
    cb: (pose: OrbitState, phase: "move" | "end") => void,
  ): () => void;
  /**
   * Frame the current selection: re-centre the orbit pivot on the selection's AABB
   * centroid — keeping the current viewing angle and distance — and re-render.
   * No-op when nothing is selected or no scene is loaded. Drives the chrome's `F`
   * key and Frame-Selection menu action; emits an `"end"` camera-pose notification
   * so the framed pose persists.
   */
  frameSelection(): void;
  introspect(): SceneSchemaReflection;
  destroy(): void;
};

// Vertical FOV the editor orbit camera is created with. Shared so the gizmo's
// screen-constant axis-length math uses the exact same projection the camera
// renders with (a divergence here would make handle hit-tests miss).
const EDITOR_FOV_Y = Math.PI / 3;

// Boundary: scene-document settings store clearColor as a hand-authored RGBA
// tuple, but frame.render wants a Vec4 (Float32Array). Convert at the call
// site; undefined passes through so render falls back to its own default.
function toVec4(
  rgba: readonly [number, number, number, number] | undefined,
): Vec4 | undefined {
  return rgba ? vec4.fromValues(rgba[0], rgba[1], rgba[2], rgba[3]) : undefined;
}

/** Options for {@link createViewportHost}. All colours are `[r, g, b]` in `[0, 1]`. */
export type ViewportHostOptions = {
  /**
   * Selection highlight (AABB edge lines) accent — the ONE attention colour,
   * resolved by the chrome from the `--primary` design token. Defaults to a
   * steel-blue when omitted so a no-opts host renders a sensible highlight.
   */
  accentColor?: [number, number, number];
  /**
   * Default viewport clear colour, giving the 3D content area a tonal step of
   * separation from the panel chrome. Used ONLY when the loaded scene authors
   * no `clearColor` — an authored scene clear always wins. When omitted, the
   * engine's own default clear is used (a no-opts host is unchanged).
   */
  viewportBackground?: [number, number, number];
  /**
   * Reference-grid neutral colour, applied to the major lines; minor lines are drawn
   * dimmer. Resolved by the chrome from a neutral design token. Defaults to a mid grey so
   * a no-opts host still shows a sensible grid.
   */
  gridColor?: [number, number, number];
};

/**
 * Create an uninitialized viewport host. `init` must be called before GPU
 * operations, but `loadScene` may be called before `init` — the document is
 * queued and applied once `init` completes. This lets the SSE-driven editor
 * load a scene before the canvas's async GPU init resolves (a common race on
 * browser boot / tab refresh when a session already exists).
 */
export function createViewportHost(opts?: ViewportHostOptions): ViewportHost {
  let ctx: Context | undefined;
  let loaded: LoadedScene | undefined;
  let committedDoc: SceneDocument | undefined;
  let unbindCamera: (() => void) | undefined;
  let unbindResize: (() => void) | undefined;
  // SSE-driven loads can race the async GPU init; the latest doc is queued here
  // and flushed once init completes. If multiple loads arrive before init, the
  // last one wins (latest revision takes precedence).
  let pendingDoc: { doc: SceneDocument; resetCamera: boolean } | undefined;
  // Editor-owned orbit camera: initialized from the scene camera's pose on a NEW
  // scene load, preserved across same-scene reloads, then driven by pointer
  // events. Never serialized; independent of the scene camera entity (editing the
  // scene camera entity does NOT move the editor view, and vice versa).
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
  // Active translate-gizmo drag; null when no handle is being dragged. `startPos`
  // is the gizmo origin (selection centroid) captured at grab time so the axis
  // line stays fixed during the drag; `startParam` is the axis param under the
  // cursor at grab. `lastPos` records the exact position last poked into each
  // entity's mesh during the move, so the commit on release is byte-identical to
  // the final preview (no recompute, no visual jump).
  let gizmoDrag: {
    axis: Axis;
    startParam: number;
    startPos: [number, number, number];
    lastPos: Map<string, [number, number, number]>;
    pointerId: number;
  } | null = null;

  const ORBIT_SPEED = 0.01;
  const PAN_SPEED = 0.002;
  const TRACKPAD_PAN_SPEED = 0.002; // two-finger trackpad scroll → pan

  // Fly-through (RMB-hold): a requestAnimationFrame loop runs ONLY while `flying`,
  // reading held WASD/QE keys + accumulated pointer look-deltas each frame. It is
  // the host's ONLY continuous-render path; stopFly (RMB-up / dispose) cancels it
  // so the host returns to render-on-demand.
  // MIGRATION (until Task 12): the fly/look sensitivities below are provisional —
  // tune them at the live gate.
  const LOOK_SPEED = 0.005; // radians per pixel of RMB-drag
  const FLY_SPEED_DEFAULT = 6; // world units / second at base speed
  const FLY_SPEED_MIN = 0.25;
  const FLY_SPEED_MAX = 200;
  const FLY_SPEED_STEP = 0.2; // per-scroll-notch speed multiplier (exp)
  const FLY_BOOST = 3; // Shift → ×3 speed
  const MAX_FLY_DT = 0.05; // clamp the frame gap so a stall can't lurch the camera
  const FLY_KEYS = new Set(["w", "a", "s", "d", "q", "e"]);
  const heldKeys = new Set<string>();
  let flying = false;
  let flyRaf: number | null = null;
  let flyLastT = 0;
  let flySpeed = FLY_SPEED_DEFAULT;
  let flyYawAccum = 0; // pointer look-delta accumulated between fly frames
  let flyPitchAccum = 0;
  // The pointer that started the current fly gesture; fly-stop keys off THIS id,
  // not the shared `drag` slot (which a chorded second button could overwrite).
  let flyPointerId: number | null = null;

  const requireCtx = (): Context => {
    if (!ctx)
      throw new Error("viewport-host: init(canvas) must be called first");
    return ctx;
  };

  // Selection highlight edge-lines derive from the ONE attention token: the chrome
  // resolves `--primary` and passes it as accentColor. The default matches theme.ts's
  // steel-blue fallback so a no-opts host (GPU tests) still highlights sensibly.
  // Alpha 1 = fully opaque edge lines.
  const DEFAULT_ACCENT: [number, number, number] = [
    92 / 255,
    148 / 255,
    204 / 255,
  ];
  const accent = opts?.accentColor ?? DEFAULT_ACCENT;
  const HILITE: [number, number, number, number] = [
    accent[0],
    accent[1],
    accent[2],
    1,
  ];
  // Fallback clear (content-vs-chrome tonal separation), used only when the loaded
  // scene authors no clearColor — an authored scene clear always wins over this.
  // Undefined when the caller passed no viewportBackground, so frame.render's own
  // default clear applies (keeps no-opts hosts byte-identical).
  const viewportClear: Vec4 | undefined = opts?.viewportBackground
    ? vec4.fromValues(
        opts.viewportBackground[0],
        opts.viewportBackground[1],
        opts.viewportBackground[2],
        1,
      )
    : undefined;

  // Reference grid: neutral major lines from the token, minor lines dimmed for a cheap
  // two-tone depth cue. The grid is world-static, so both batches are built ONCE here and
  // re-used every render (202 lines default) rather than rebuilt per frame.
  const DEFAULT_GRID: [number, number, number] = [0.42, 0.42, 0.46];
  const gridBase = opts?.gridColor ?? DEFAULT_GRID;
  const GRID_MINOR_DIM = 0.5;
  const gridSegments = buildGridLines();
  const gridMinor = segmentsToBatch(gridSegments.minorSegments, [
    gridBase[0] * GRID_MINOR_DIM,
    gridBase[1] * GRID_MINOR_DIM,
    gridBase[2] * GRID_MINOR_DIM,
    1,
  ]);
  const gridMajor = segmentsToBatch(gridSegments.majorSegments, [
    gridBase[0],
    gridBase[1],
    gridBase[2],
    1,
  ]);

  // View flags default grid/axes/headlamp ON, fog OFF: a no-opts host (the GPU tests, which
  // never call setViewFlags) then renders a grounded, lit scene and never blanks.
  let viewFlags: ViewFlags = {
    grid: true,
    axes: true,
    headlamp: true,
    fog: false,
  };

  // Neutral camera-carried point light (the preview host's pattern) for near-black unlit
  // scenes. Intensity scales with orbit distance² and range with distance so the framed
  // content stays lit at ANY scale — a fixed lamp vanishes for a large scene framed far
  // away. Calibrated to ~parity with the preview host at its default 10u framing
  // (0.06 · 10² ≈ 6, range 40) using the shader's windowed inverse-square falloff.
  const HEADLAMP_COLOR: [number, number, number] = [1, 1, 1];
  const HEADLAMP_ILLUM = 0.06;
  const HEADLAMP_RANGE_FACTOR = 4;

  // Fog (view flag, default off): a gentle exponential depth cue fading to the viewport
  // clear — far weaker than the game's density (0.12), which at orbit distance would
  // swallow the whole scene (the 3.1 preview-host lesson).
  const VIEWPORT_FOG_DENSITY = 0.02;
  const fogColor: [number, number, number] = opts?.viewportBackground ?? [
    0.1, 0.1, 0.11,
  ];

  // Camera-pose subscribers (chrome corner triad + per-doc persistence). Notified on every
  // user camera gesture; see subscribeCameraPose for the "move"/"end" phase contract.
  const cameraSubscribers = new Set<
    (pose: OrbitState, phase: "move" | "end") => void
  >();

  // A defensive copy of an orbit pose so a returned/notified pose can't alias (and let a
  // subscriber mutate) the host's live state. Annotated return type contextually types the
  // target literal as the V3 tuple.
  const clonePose = (s: OrbitState): OrbitState => ({
    target: [s.target[0], s.target[1], s.target[2]],
    distance: s.distance,
    yaw: s.yaw,
    pitch: s.pitch,
  });

  const notifyCamera = (phase: "move" | "end"): void => {
    if (!orbitState || cameraSubscribers.size === 0) return;
    const pose = clonePose(orbitState);
    for (const cb of cameraSubscribers) cb(pose, phase);
  };

  // The neutral headlamp for the current orbit pose, or null when the flag is off / no
  // camera yet. Position = eye; intensity/range track orbit distance (see constants above).
  const makeHeadlamp = (): frame.PointLight | null => {
    if (!orbitState) return null;
    const { eye } = toEyeTarget(orbitState);
    const d = orbitState.distance;
    return {
      type: "point",
      position: eye,
      color: HEADLAMP_COLOR,
      intensity: HEADLAMP_ILLUM * d * d,
      range: d * HEADLAMP_RANGE_FACTOR,
    };
  };

  // Centroid of the current selection's AABB corners — the gizmo origin and the
  // frame-selected target. null when nothing is loaded, the selection is empty,
  // or no selected entity has a renderable box.
  // Centroid of the AABB corners of the given entity ids (mesh-less entities are
  // skipped). Returns null when no id has a renderable mesh.
  const centroidOf = (
    ids: readonly string[],
  ): [number, number, number] | null => {
    if (!loaded) return null;
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
    return n === 0 ? null : [cx / n, cy / n, cz / n];
  };

  const selectionCentroid = (): [number, number, number] | null =>
    selection.length === 0 ? null : centroidOf(selection);

  // Centroid of all renderable entities in the loaded scene — the orbit pivot the
  // editor camera frames on load (the scene camera's authored look-target is only
  // ~1 unit ahead of the eye, a poor pivot that makes content swing wildly).
  const sceneContentCentroid = (): [number, number, number] | null =>
    centroidOf(committedDoc?.entities.map((e) => e.id) ?? []);

  // Radius of the loaded content around `center`: the max distance from `center`
  // to any loaded entity's AABB corner. Used to frame the orbit camera on a
  // camera-LESS (fragment) doc — a baked region has no scene camera pose to seed
  // the eye from, so we derive one from the content extent. Returns 0 when nothing
  // renderable is loaded (the caller floors it with MIN_FRAME_RADIUS).
  const contentRadius = (center: readonly [number, number, number]): number => {
    if (!loaded) return 0;
    let maxSq = 0;
    for (const e of committedDoc?.entities ?? []) {
      const c = loaded.entityBoxCorners(e.id);
      if (!c) continue;
      for (let k = 0; k < 8; k++) {
        const dx = (c[k * 3] as number) - center[0];
        const dy = (c[k * 3 + 1] as number) - center[1];
        const dz = (c[k * 3 + 2] as number) - center[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxSq) maxSq = d2;
      }
    }
    return Math.sqrt(maxSq);
  };

  // World length of the gizmo's screen-constant pixel size, so the handles stay
  // ~GIZMO_PX long regardless of camera distance. Uses the editor cam's FOV
  // (EDITOR_FOV_Y) and the canvas backing-store height.
  const GIZMO_PX = 90;
  const axisLenWorld = (origin: [number, number, number]): number => {
    if (!editorCam || !ctx) return 1;
    const eye = vec3.create();
    camera.getPosition(eye, editorCam);
    const dist = Math.hypot(
      (eye[0] as number) - origin[0],
      (eye[1] as number) - origin[1],
      (eye[2] as number) - origin[2],
    );
    const worldPerPx =
      (2 * dist * Math.tan(EDITOR_FOV_Y / 2)) / ctx.canvas.height;
    return worldPerPx * GIZMO_PX;
  };

  // Per-axis handle colours (X red, Y green, Z blue). Render constants.
  const GIZMO_COLORS: Record<Axis, [number, number, number, number]> = {
    x: [1, 0.2, 0.2, 1],
    y: [0.2, 1, 0.2, 1],
    z: [0.3, 0.4, 1, 1],
  };

  // Draw the three always-on-top axis handles at the selection centroid. Called
  // after the highlight loop so it sits on top; occlude:false = ignores depth.
  const renderGizmo = (c: Context): void => {
    if (!editorCam) return;
    const origin = selectionCentroid();
    if (!origin) return;
    const axisLen = axisLenWorld(origin);
    for (const ax of ["x", "y", "z"] as Axis[]) {
      const d = AXIS_DIR[ax];
      const vertices = new Float32Array([
        origin[0],
        origin[1],
        origin[2],
        origin[0] + d[0] * axisLen,
        origin[1] + d[1] * axisLen,
        origin[2] + d[2] * axisLen,
      ]);
      const col = GIZMO_COLORS[ax];
      const colors = new Float32Array([...col, ...col]);
      frame.drawLines(c, {
        vertices,
        colors,
        camera: editorCam,
        occlude: false,
      });
    }
  };

  const renderLoaded = (c: Context, l: LoadedScene): void => {
    const cam = editorCam ?? l.camera;
    const headlamp = viewFlags.headlamp ? makeHeadlamp() : null;
    frame.render(c, {
      meshes: l.meshes,
      camera: cam,
      // Authored scene clear wins; the viewport tonal-separation clear is only the
      // fallback (undefined → frame.render's own default when neither is set).
      clearColor: toVec4(l.settings.clearColor) ?? viewportClear,
      // lights/ambient are always safe to pass — they don't depend on the
      // context's HDR state — so the editor viewport shows the real lit scene.
      // The neutral headlamp (when on) is appended so an unlit scene still reads.
      lights: headlamp ? [...l.lights, headlamp] : l.lights,
      ambient: l.ambient,
      // Fog is a VIEW FLAG here (default off): spread keeps `fog` absent — not
      // explicitly undefined — when disabled, matching the preview host's pattern.
      ...(viewFlags.fog
        ? { fog: { color: fogColor, density: VIEWPORT_FOG_DENSITY } }
        : {}),
      // effects (post chain) are DEFERRED. This host's GPU context is non-HDR
      // (init() requests the default `hdr: false`). A scene's post chain
      // (bloom→tonemap) is authored for the consumer's HDR pipeline, where
      // tonemap maps rgba16float→LDR. frame.render won't throw on a non-HDR
      // context with effects (the throw is the inverse: HDR + zero effects),
      // but running an HDR-authored chain against an LDR scene target produces
      // wrong output, not the real preview. Post-preview is deferred until the
      // editor viewport supports an HDR context (then pass l.effects here).
      effects: [],
    });
    // Reference grid: depth-tested (occlude:true) so solid geometry hides it, drawn every
    // render like the AABB highlight. Minor batch first, then the brighter majors on top.
    if (viewFlags.grid) {
      frame.drawLines(c, {
        vertices: gridMinor.vertices,
        colors: gridMinor.colors,
        camera: cam,
        occlude: true,
      });
      frame.drawLines(c, {
        vertices: gridMajor.vertices,
        colors: gridMajor.colors,
        camera: cam,
        occlude: true,
      });
    }
    for (const id of selection) {
      const corners = l.entityBoxCorners(id);
      if (!corners) continue;
      const { vertices, colors } = boxEdges(corners, HILITE);
      frame.drawLines(c, { vertices, colors, camera: cam, occlude: true });
    }
    renderGizmo(c);
  };

  // Write the current orbitState into editorCam's position/target/up fields.
  const applyOrbit = (): void => {
    if (!editorCam || !orbitState) return;
    const { eye, target, up } = toEyeTarget(orbitState);
    camera.setPosition(editorCam, new Float32Array(eye));
    camera.setTarget(editorCam, new Float32Array(target));
    camera.setUp(editorCam, new Float32Array(up));
  };

  // Framing factors for a camera-LESS (fragment) doc: seat the orbit eye back
  // from the content centroid by these multiples of the content radius — diagonally
  // back on X/Z and slightly up on Y — so the whole piece is in view. A floor on
  // the radius keeps the framing sane for tiny/degenerate content.
  const FRAGMENT_FRAME_BACK = 1.5;
  const FRAGMENT_FRAME_UP = 1.05;
  const MIN_FRAME_RADIUS = 1;

  // Applies a scene document assuming ctx is already set. Encapsulates the
  // destroy-before-build and resize/bind ordering that is load-critical (the M3
  // resize-blank fix depends on the specific sequence below — do not reorder).
  const applyScene = async (
    doc: SceneDocument,
    resetCamera: boolean,
  ): Promise<void> => {
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
    // A camera-LESS doc (a baked region fragment) has no scene camera; load it in
    // FRAGMENT mode so the loader's no-camera throw is suppressed, then frame the
    // orbit on content bounds below. Detection mirrors the loader's own throw
    // condition exactly: it throws when NO entity contributes a `camera` component.
    // (The editor viewport owns no game world, so no `world` is injected.)
    const hasSceneCamera = doc.entities.some((e) => "camera" in e.components);
    loaded = await scene.loadScene(
      c,
      doc,
      hasSceneCamera ? undefined : { fragment: true },
    );
    committedDoc = doc;
    // The editor camera is recreated each reload (then rebound to the canvas
    // below), but the orbit STATE — what the user is actually looking at — is only
    // reset for a NEW scene. A resource/settings commit or external file edit
    // reloads the document (rebuilding meshes) but must NOT move the editor view:
    // the editor camera is independent of the scene. Applying a preserved
    // orbitState to the fresh camera reproduces the exact view. (`!orbitState`
    // guards the first-ever load even if the caller passed resetCamera=false.)
    editorCam = camera.perspective({
      fovYRad: EDITOR_FOV_Y,
      aspect: 1,
      near: 0.1,
      far: 1000,
    });
    if (resetCamera || !orbitState) {
      if (hasSceneCamera) {
        // Init at the scene camera's eye position, but pivot the orbit on the scene
        // CONTENT centroid (not the scene camera's authored look-target, which the
        // camera builtin places only ~1 unit ahead of the eye — a near point that
        // makes the whole scene swing wildly when you orbit). Falling back to the
        // authored target keeps a sane pivot for an empty scene. The scene camera
        // entity stays independently editable in the inspector.
        const sc = loaded.camera;
        const eye = vec3.create();
        camera.getPosition(eye, sc);
        const tgt = vec3.create();
        camera.getTarget(tgt, sc);
        // vec3.create() returns Float32Array; index reads are number | undefined
        // under noUncheckedIndexedAccess but indices 0-2 are always present on a
        // vec3 — hot-path typed-array cast (documented in typescript.md).
        const target = sceneContentCentroid() ?? [
          tgt[0] as number,
          tgt[1] as number,
          tgt[2] as number,
        ];
        orbitState = fromEyeTarget(
          [eye[0] as number, eye[1] as number, eye[2] as number],
          target,
        );
      } else {
        // Camera-LESS (fragment) doc: no scene camera pose to seed from, so frame
        // the orbit on the content bounds — pivot on the content centroid, eye
        // seated back by the content radius (floored) along the framing factors.
        const centroid: [number, number, number] = sceneContentCentroid() ?? [
          0, 0, 0,
        ];
        const r = Math.max(MIN_FRAME_RADIUS, contentRadius(centroid));
        orbitState = fromEyeTarget(
          [
            centroid[0] + r * FRAGMENT_FRAME_BACK,
            centroid[1] + r * FRAGMENT_FRAME_UP,
            centroid[2] + r * FRAGMENT_FRAME_BACK,
          ],
          centroid,
        );
      }
    }
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

  // Re-centre the orbit pivot on the centroid of `ids` (keeping the current view
  // angle + distance) and render. Shared by F/frameSelection (the current
  // selection) and double-click (a single picked entity).
  const frameIds = (ids: readonly string[]): void => {
    if (!loaded || !orbitState) return;
    const centroid = centroidOf(ids);
    if (!centroid) return;
    orbitState = { ...orbitState, target: centroid };
    applyOrbit();
    if (ctx) renderLoaded(ctx, loaded);
    notifyCamera("end"); // a completed gesture — persist the new pose
  };

  const frameSelected = (): void => frameIds(selection);

  // Marshal an engine `screenToRay` result into the gizmo's plain-tuple Ray.
  // Returns null when there is no editor camera, or when the view-projection is
  // singular (screenToRay returns dir=[0,0,0]) — callers treat null as "no hit".
  const rayFromCursor = (clientX: number, clientY: number): Ray | null => {
    if (!editorCam) return null;
    const [nx, ny] = toNdc(clientX, clientY);
    const r = camera.screenToRay(editorCam, nx, ny);
    const dx = r.dir[0] as number;
    const dy = r.dir[1] as number;
    const dz = r.dir[2] as number;
    // Singular VP → dir=[0,0,0]: guard explicitly rather than relying on NaN
    // propagation through pickAxis/rayAxisDistance (dot(dir,dir)=0 → 0/0=NaN).
    if (Math.hypot(dx, dy, dz) < 1e-8) return null;
    return {
      origin: [
        r.origin[0] as number,
        r.origin[1] as number,
        r.origin[2] as number,
      ],
      dir: [dx, dy, dz],
    };
  };

  // The entity's committed (pre-drag) transform with schema defaults filled for
  // omitted position/rotation/scale. This is the baseline the anchor-relative
  // drag delta is applied to — never integrated per-event, so it can't drift.
  const committedTransform = (
    entityId: string,
  ): {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  } => {
    const entity = committedDoc?.entities.find((e) => e.id === entityId);
    // Runtime shape of the transform component (see scene/builtins transformShape);
    // the document type stores components as `unknown`.
    const tf = entity?.components["transform"] as
      | {
          position?: readonly [number, number, number];
          rotation?: readonly [number, number, number, number];
          scale?: readonly [number, number, number];
        }
      | undefined;
    return {
      position: tf?.position ? [...tf.position] : [0, 0, 0],
      rotation: tf?.rotation ? [...tf.rotation] : [0, 0, 0, 1],
      scale: tf?.scale ? [...tf.scale] : [1, 1, 1],
    };
  };

  // The transform to COMMIT for `entityId`: committed rotation/scale plus the
  // exact position last poked into the mesh during the drag (from gizmoDrag.lastPos).
  // Reading the stored pos — rather than recomputing — guarantees commit == final
  // preview, so the visual never jumps on release.
  const currentTransform = (entityId: string): Record<string, unknown> => {
    const base = committedTransform(entityId);
    const pos = gizmoDrag?.lastPos.get(entityId) ?? base.position;
    return { position: pos, rotation: base.rotation, scale: base.scale };
  };

  // Hit-test the gizmo handles under the cursor; on a hit, begin a drag and
  // capture the pointer. Returns true if a handle was grabbed (caller returns
  // early — the gizmo wins over scene-pick and orbit). The pick tolerance is a
  // fraction of the handle length so it scales with the screen-constant size.
  const GIZMO_PICK_TOL_FRAC = 0.08;
  const tryStartGizmoDrag = (e: PointerEvent): boolean => {
    if (e.button !== 0 || e.altKey) return false;
    const origin = selectionCentroid();
    if (!origin) return false;
    const ray = rayFromCursor(e.clientX, e.clientY);
    if (!ray) return false;
    const axisLen = axisLenWorld(origin);
    const axis = pickAxis(ray, origin, axisLen, axisLen * GIZMO_PICK_TOL_FRAC);
    if (!axis) return false;
    gizmoDrag = {
      axis,
      startParam: closestPointParamOnAxis(origin, AXIS_DIR[axis], ray),
      startPos: origin,
      lastPos: new Map(),
      pointerId: e.pointerId,
    };
    canvasEl?.setPointerCapture(e.pointerId);
    return true;
  };

  // Apply the anchor-relative ABSOLUTE drag delta to every selected entity. The
  // delta is `currentParam − startParam` against the fixed grab-time axis line —
  // never integrated per-event, so it can't drift. The SAME world delta applies
  // to each entity (added to its own committed base), preserving relative offsets.
  const updateGizmoDrag = (e: PointerEvent): void => {
    if (!gizmoDrag || !ctx || !loaded) return;
    const ray = rayFromCursor(e.clientX, e.clientY);
    if (!ray) return;
    const axisDir = AXIS_DIR[gizmoDrag.axis];
    const t = closestPointParamOnAxis(gizmoDrag.startPos, axisDir, ray);
    const delta = t - gizmoDrag.startParam;
    for (const id of selection) {
      const base = committedTransform(id).position;
      const pos: [number, number, number] = [
        base[0] + axisDir[0] * delta,
        base[1] + axisDir[1] * delta,
        base[2] + axisDir[2] * delta,
      ];
      gizmoDrag.lastPos.set(id, pos);
      loaded.setEntityTransform(id, { position: pos });
    }
    renderLoaded(ctx, loaded);
  };

  // Commit the drag as ONE array of edits (one undo entry for a multi-entity
  // drag). currentTransform reads the stored lastPos so commit == final preview.
  // Guard: if no pointermove ever fired (lastPos empty) the entities never moved —
  // skip the commit entirely (no revision bump, no empty undo entry). Spec §4.
  const commitGizmoDrag = (): void => {
    if (!gizmoDrag) return;
    if (gizmoDrag.lastPos.size > 0) {
      const edits = selection.map((id) => ({
        entityId: id,
        transform: currentTransform(id),
      }));
      // Fold the just-committed positions into committedDoc synchronously so a
      // second drag's committedTransform baseline is already at P1 — not the
      // stale P0 that would persist until the async SSE syncCommitted arrives.
      if (committedDoc) {
        const next = structuredClone(committedDoc);
        for (const e of edits) {
          const ent = next.entities.find((x) => x.id === e.entityId);
          if (ent) ent.components["transform"] = e.transform;
        }
        committedDoc = next;
      }
      if (edits.length > 0) callbacks?.onTransformCommit(edits);
    }
    canvasEl?.releasePointerCapture(gizmoDrag.pointerId);
    gizmoDrag = null;
  };

  // Abort the drag and restore each selected entity's committed transform via
  // rebuild (the same mechanism the public revertEntity uses). Releases capture
  // by the stored pointerId so it works when triggered by an Escape keypress.
  const cancelGizmoDrag = (): void => {
    if (!gizmoDrag) return;
    for (const id of selection) revertEntityToCommitted(id);
    canvasEl?.releasePointerCapture(gizmoDrag.pointerId);
    gizmoDrag = null;
  };

  // Discard any preview on `entityId` by rebuilding it from the committed doc.
  // Shared by the public `revertEntity` and the gizmo's Escape-cancel so both
  // restore identically.
  const revertEntityToCommitted = (entityId: string): void => {
    if (!ctx || !loaded || !committedDoc) return;
    try {
      loaded.rebuildEntity(entityId, committedDoc);
    } catch {
      // Committed doc loaded cleanly before; a throw here is an unexpected
      // invariant violation — keep the last good render rather than corrupt it.
      return;
    }
    renderLoaded(ctx, loaded);
  };

  // Held keys → move axes: W/S forward, A/D right, Q/E up. Read fresh each frame.
  const readFlyMove = (): { f: number; r: number; u: number } => ({
    f: (heldKeys.has("w") ? 1 : 0) - (heldKeys.has("s") ? 1 : 0),
    r: (heldKeys.has("d") ? 1 : 0) - (heldKeys.has("a") ? 1 : 0),
    u: (heldKeys.has("e") ? 1 : 0) - (heldKeys.has("q") ? 1 : 0),
  });

  // One fly frame: consume accumulated look-deltas, apply held-key movement, and
  // render — but ONLY when something actually changed (an idle fly frame skips the
  // GPU and just re-schedules). `dt` is clamped so a stall can't lurch the camera.
  const flyFrame = (now: number): void => {
    if (!flying) return;
    const dt = Math.min((now - flyLastT) / 1000, MAX_FLY_DT);
    flyLastT = now;
    if (orbitState && editorCam && ctx && loaded) {
      let changed = false;
      if (flyYawAccum !== 0 || flyPitchAccum !== 0) {
        orbitState = flyLook(orbitState, flyYawAccum, flyPitchAccum);
        flyYawAccum = 0;
        flyPitchAccum = 0;
        changed = true;
      }
      const move = readFlyMove();
      if (move.f !== 0 || move.r !== 0 || move.u !== 0) {
        const boost = heldKeys.has("shift") ? FLY_BOOST : 1;
        orbitState = flyMove(orbitState, move, flySpeed * boost * dt);
        changed = true;
      }
      if (changed) {
        applyOrbit();
        renderLoaded(ctx, loaded);
        notifyCamera("move"); // live overlay; persistence waits for stopFly's "end"
      }
    }
    flyRaf = requestAnimationFrame(flyFrame);
  };

  const startFly = (pointerId: number): void => {
    if (flying) return;
    flying = true;
    flyPointerId = pointerId;
    flyYawAccum = 0;
    flyPitchAccum = 0;
    flyLastT = performance.now();
    flyRaf = requestAnimationFrame(flyFrame);
  };

  const stopFly = (): void => {
    if (!flying) return;
    flying = false;
    flyPointerId = null;
    if (flyRaf !== null) {
      cancelAnimationFrame(flyRaf);
      flyRaf = null;
    }
    heldKeys.clear();
    notifyCamera("end"); // fly gesture settled — persist the resting pose
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!ctx || !loaded || !editorCam) return;
    // Give the canvas keyboard focus so F/Escape keydowns reach it. Safari does
    // NOT focus a tabindex element on click (and blurs the prior focus), so
    // without this the canvas's keydown handler only fires until the first click.
    // preventScroll: the canvas fills its dock pane — never scroll an ancestor to
    // reveal it on click.
    canvasEl?.focus({ preventScroll: true });
    // Gizmo pick-priority: a handle hit starts a drag and returns early, beating
    // both scene-pick (select) and orbit/pan.
    if (tryStartGizmoDrag(e)) return;
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
    if (action === "fly") {
      startFly(e.pointerId);
    } else if (action === "orbit") {
      // Orbit-around-selection: reseat the pivot on the selection centroid while
      // holding the EYE fixed (fromEyeTarget re-aims the view; a bare target swap
      // would teleport the eye by target−pivot). No-op when nothing is selected,
      // so orbit then falls back to the last-framed pivot.
      const pivot = selectionCentroid();
      if (pivot && orbitState) {
        const { eye } = toEyeTarget(orbitState);
        orbitState = fromEyeTarget(eye, pivot);
        applyOrbit();
        renderLoaded(ctx, loaded);
      }
    }
    drag = { action, lastX: e.clientX, lastY: e.clientY };
    canvasEl?.setPointerCapture(e.pointerId);
  };

  // World-space camera right/up axes: the view matrix is world→view, so its rows
  // are the camera basis in world space. Shared by pointer-pan + trackpad-pan.
  const cameraRightUp = (
    cam: Camera,
  ): { right: [number, number, number]; up: [number, number, number] } => {
    const m = camera.getMatrices(cam).view;
    return {
      right: [m[0] as number, m[4] as number, m[8] as number],
      up: [m[1] as number, m[5] as number, m[9] as number],
    };
  };

  const onPointerMove = (e: PointerEvent): void => {
    // Gizmo drag takes priority over orbit/pan while a handle is held.
    if (gizmoDrag) {
      updateGizmoDrag(e);
      return;
    }
    if (!drag || !orbitState || !editorCam || !ctx || !loaded) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (drag.action === "fly") {
      // Accumulate look; the rAF fly loop consumes it (don't render here). Signs
      // give non-inverted FPS look — drag right → look right, drag down → look down.
      // MIGRATION (until Task 12): look sensitivity/inversion tuned live at the gate.
      flyYawAccum += -dx * LOOK_SPEED;
      flyPitchAccum += dy * LOOK_SPEED;
      return;
    }
    if (drag.action === "orbit") {
      // Negate so a rightward/downward drag orbits the camera the intuitive way (drag the world, not the camera).
      orbitState = orbit(orbitState, -dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    } else if (drag.action === "pan") {
      const { right, up } = cameraRightUp(editorCam);
      orbitState = pan(orbitState, dx, dy, right, up, PAN_SPEED);
    }
    applyOrbit();
    renderLoaded(ctx, loaded);
    notifyCamera("move"); // live overlay update; persistence waits for "end"
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (gizmoDrag) {
      // pointercancel routes here too: an interrupted gizmo drag commits its last preview (undoable), not reverts.
      commitGizmoDrag();
      return;
    }
    // Fly-stop is decoupled from the shared `drag` slot: the fly pointer's release
    // (or pointercancel — both route here) ALWAYS stops the loop, even if `drag`
    // was overwritten or nulled by another button interaction mid-fly. Keying off
    // `drag.action` instead would leak the rAF loop forever if that happened.
    if (flying && e.pointerId === flyPointerId) {
      canvasEl?.releasePointerCapture(e.pointerId);
      drag = null;
      stopFly(); // stops the rAF loop, clears held keys, and notifies "end"
      return;
    }
    if (!drag) return;
    canvasEl?.releasePointerCapture(e.pointerId);
    drag = null;
    notifyCamera("end"); // orbit/pan released — persist the resting pose
  };

  const onWheel = (e: WheelEvent): void => {
    if (!orbitState || !ctx || !loaded || !editorCam) return;
    e.preventDefault();
    // While flying, the wheel trims fly speed (exponential notches) — no camera move.
    if (flying) {
      const factor = Math.exp(-Math.sign(e.deltaY) * FLY_SPEED_STEP);
      flySpeed = Math.max(
        FLY_SPEED_MIN,
        Math.min(FLY_SPEED_MAX, flySpeed * factor),
      );
      return;
    }
    // Trackpad two-finger pan heuristic: a no-button wheel with BOTH axes present
    // and no pinch (ctrlKey).
    // MIGRATION (until Task 12): trackpad pan/zoom feel verified in Safari at the gate.
    const isTrackpadPan =
      !e.ctrlKey && e.buttons === 0 && e.deltaX !== 0 && e.deltaY !== 0;
    if (isTrackpadPan) {
      const { right, up } = cameraRightUp(editorCam);
      orbitState = pan(
        orbitState,
        e.deltaX,
        -e.deltaY,
        right,
        up,
        TRACKPAD_PAN_SPEED,
      );
      applyOrbit();
      renderLoaded(ctx, loaded);
      notifyCamera("end");
      return;
    }
    // Scroll dollies the whole rig along the view direction — travel through the
    // scene, not orbit-zoom toward the pivot (which asymptotes to a dead stop and
    // whose speed swings with the hidden pivot distance). Wheel-up (deltaY<0) = forward.
    orbitState = dolly(orbitState, -Math.sign(e.deltaY));
    applyOrbit();
    renderLoaded(ctx, loaded);
    notifyCamera("end"); // discrete zoom step — no separate release event
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && gizmoDrag) {
      cancelGizmoDrag();
      return;
    }
    // While flying, WASD/QE (+ Shift boost) are held-key movement: track and
    // swallow them so they don't leak to browser/chrome shortcuts. The rAF loop
    // reads `heldKeys` each frame; these handlers only maintain the set.
    if (flying) {
      const k = e.key.toLowerCase();
      if (FLY_KEYS.has(k)) {
        heldKeys.add(k);
        e.preventDefault();
        return;
      }
      if (e.key === "Shift") {
        heldKeys.add("shift");
        return;
      }
    }
    if (e.key === "f" || e.key === "F") frameSelected();
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    heldKeys.delete(k);
    if (e.key === "Shift") heldKeys.delete("shift");
  };

  // RMB-drag fly must not pop the browser context menu over the canvas.
  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  // Double-click an entity to focus it: pick, select (replace), and frame.
  const onDblClick = (e: MouseEvent): void => {
    if (!ctx || !loaded || !editorCam) return;
    const [nx, ny] = toNdc(e.clientX, e.clientY);
    void loaded.pick(ctx, editorCam, nx, ny).then((id) => {
      if (!id) return;
      callbacks?.onSelect(id, {
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
      });
      frameIds([id]);
    });
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
        canvas.addEventListener("contextmenu", onContextMenu);
        canvas.addEventListener("dblclick", onDblClick);
        canvas.tabIndex = 0; // so the canvas can receive key events
        canvas.addEventListener("keydown", onKeyDown);
        canvas.addEventListener("keyup", onKeyUp);
      }
      // Flush any scene queued before init resolved (SSE-driven load race).
      if (pendingDoc !== undefined) {
        const d = pendingDoc;
        pendingDoc = undefined;
        await applyScene(d.doc, d.resetCamera);
      }
    },
    async loadScene(doc, opts) {
      const resetCamera = opts?.resetCamera ?? true;
      if (!ctx) {
        // queue: SSE-driven load can race the async GPU init; apply on init
        pendingDoc = { doc, resetCamera };
        return;
      }
      await applyScene(doc, resetCamera);
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
      if (
        component === "transform" &&
        !transformEditNeedsRebuild(committedDoc, entityId)
      ) {
        // Fast path: poke the mesh transform directly — no clone, no rebuild.
        // UNSAFE for light/camera entities: their direction is transform-DERIVED
        // (−Z rotated by the transform quaternion at build time) and refreshed
        // ONLY by rebuildEntity — setEntityTransform pokes meshes alone. Those
        // entities fall through to the clone+rebuild path below, which rebuilds
        // the light/camera with the new rotation → correct direction preview.
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
      revertEntityToCommitted(entityId);
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
    setViewFlags(flags) {
      viewFlags = flags;
      if (ctx && loaded) renderLoaded(ctx, loaded);
    },
    getCameraPose() {
      return orbitState ? clonePose(orbitState) : null;
    },
    setCameraPose(pose) {
      if (!editorCam || !orbitState) return;
      orbitState = clonePose(pose);
      applyOrbit();
      if (ctx && loaded) renderLoaded(ctx, loaded);
    },
    subscribeCameraPose(cb) {
      cameraSubscribers.add(cb);
      return () => {
        cameraSubscribers.delete(cb);
      };
    },
    frameSelection() {
      frameSelected();
    },
    introspect: () => scene.introspect(),
    destroy() {
      // Cancel any live fly rAF loop first so no frame runs against a torn-down
      // context (stopFly no-ops when not flying).
      stopFly();
      if (canvasEl) {
        canvasEl.removeEventListener("pointerdown", onPointerDown);
        canvasEl.removeEventListener("pointermove", onPointerMove);
        canvasEl.removeEventListener("pointerup", onPointerUp);
        canvasEl.removeEventListener("pointercancel", onPointerUp);
        canvasEl.removeEventListener("wheel", onWheel);
        canvasEl.removeEventListener("contextmenu", onContextMenu);
        canvasEl.removeEventListener("dblclick", onDblClick);
        canvasEl.removeEventListener("keydown", onKeyDown);
        canvasEl.removeEventListener("keyup", onKeyUp);
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
      cameraSubscribers.clear();
      drag = null;
      gizmoDrag = null;
      if (ctx) gpu.dispose(ctx);
      ctx = undefined;
    },
  };
}
