// The cockpit preview world (Slice 3.1 spec §2): an HDR context + bloom→tonemap + fog
// + orbit camera the generation session realizes consumer RegionData into. GENERIC —
// consumer realize code arrives through the engine bundle's `extensions` namespace and
// is called BY THE PANEL with this host's ctx/world; the host owns no generator knowledge.
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import type { InstancedMesh, Mesh } from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import * as post from "@furnace/core/post";
import { vec4 } from "@furnace/core/transform";
import {
  type OrbitState,
  orbit,
  pan,
  toEyeTarget,
  zoom,
} from "./camera-control.ts";

// Mood constants — mirror the dungeon's game-side setup (main.ts) so the preview
// reads at game parity: a dark fog void, low hemisphere ambient, a bloom→tonemap
// HDR chain. These are viewing policy, not generator knowledge.
const FOG: frame.Fog = { color: [0.015, 0.02, 0.03], density: 0.12 };
const AMBIENT: frame.Ambient = {
  sky: [0.06, 0.07, 0.1],
  ground: [0.02, 0.02, 0.03],
  intensity: 0.4,
};
const CLEAR = vec4.fromValues(0.015, 0.02, 0.03, 1);

// Headlamp: generated content is dressed with lit (game-parity) materials, so with
// no scene lights the low ambient reads near-black. A point light carried at the
// camera eye (mirroring the dungeon's torch) keeps the preview visible. It is a
// generic viewing aid — a fixed carried light, not generator-specific lighting.
const HEADLAMP_COLOR: [number, number, number] = [1, 0.95, 0.9];
const HEADLAMP_INTENSITY = 6;
const HEADLAMP_RANGE = 40;

const EDITOR_FOV_Y = Math.PI / 3;
const ORBIT_SPEED = 0.01;
const PAN_SPEED = 0.002;
// frame(): seat the eye at FRAME_FILL × the AABB bounding-sphere radius so the box fills the view with margin.
const FRAME_FILL = 1.5;
const MIN_FRAME_DISTANCE = 0.5;
const PREVIEW_GRAVITY: [number, number, number] = [0, -9.81, 0];

// A pleasant default 3/4 orbit until the panel calls frame() on the generated AABB.
const DEFAULT_ORBIT: OrbitState = {
  target: [0, 0, 0],
  distance: 10,
  yaw: Math.PI / 4,
  pitch: 0.5,
};

/**
 * Realized preview content adopted by the host. The panel realizes consumer
 * `RegionData` against the host's `ctx()`/`world()` and hands the resulting
 * engine handles here; the host keeps them opaque (`unknown[]`) and only casts
 * to the concrete engine mesh types at the `frame.render` boundary.
 */
export type PreviewContent = {
  meshes: unknown[]; // mesh.Mesh[] — kept opaque; the panel passes realize results through
  instanced: unknown[]; // mesh.InstancedMesh[]
  update?: () => void;
  destroy: () => void;
};

/**
 * The cockpit preview world: an HDR + bloom→tonemap + fog + orbit-camera host
 * the generation session realizes consumer `RegionData` into. GENERIC — it owns
 * no generator knowledge; the panel drives it via `ctx()`/`world()`/`adopt()`.
 */
export type PreviewHost = {
  /**
   * Create the GPU context (HDR + MSAA by default), post chain, orbit camera,
   * and an unstepped preview physics world. `gpuOptions` overrides the default
   * `{ sampleCount: 4, hdr: true }` (headless tests pass `surfaceFormat: "linear"`).
   */
  init(
    canvas: HTMLCanvasElement,
    gpuOptions?: gpu.RequestContextOptions,
  ): Promise<void>;
  /** The live engine context consumer realize code needs. Throws before init. */
  ctx(): gpu.Context;
  /** The live (unstepped) preview physics world for realize's collider creation. Throws before init. */
  world(): physics.World;
  /** Adopt realized content (the panel realized it against ctx()/world()). Call clear() first for a fresh preview. */
  adopt(content: PreviewContent): void;
  /** Destroy all adopted content + physics bodies (recreates the physics world). */
  clear(): Promise<void>;
  /** Frame the orbit camera on an AABB (min/max world corners). */
  frame(min: [number, number, number], max: [number, number, number]): void;
  /**
   * Toggle the game-parity fog and re-render. Default OFF: at orbit framing
   * distance the game's exponential fog (density 0.12) attenuates >95% of the
   * signal — structure inspection needs a clear view; mood is judged in the walk.
   */
  setFog(enabled: boolean): void;
  render(): void;
  destroy(): void;
};

/**
 * Create an uninitialized preview host. `init(canvas)` must run before any GPU
 * operation; `ctx()`/`world()` throw until then. Mirrors the viewport host's
 * lifecycle (own context, own orbit camera, own resize subscription) but adds
 * the HDR post chain + fog the game uses, and exposes the engine handles the
 * generation panel realizes consumer content against.
 */
export function createPreviewHost(): PreviewHost {
  let ctx: gpu.Context | undefined;
  let cam: camera.Camera | undefined;
  let world: physics.World | undefined;
  let bloom: post.Effect | undefined;
  let tonemap: post.Effect | undefined;
  let content: PreviewContent | undefined;
  let orbitState: OrbitState = { ...DEFAULT_ORBIT };
  let unbindCamera: (() => void) | undefined;
  let unbindResize: (() => void) | undefined;
  let canvasEl: HTMLCanvasElement | undefined;
  let fogEnabled = false; // see setFog TSDoc — orbit distances defeat game fog
  let drag: { mode: "orbit" | "pan"; lastX: number; lastY: number } | null =
    null;

  const requireCtx = (): gpu.Context => {
    if (!ctx)
      throw new Error("preview-host: init(canvas) must be called first");
    return ctx;
  };
  const requireWorld = (): physics.World => {
    if (!world)
      throw new Error("preview-host: init(canvas) must be called first");
    return world;
  };

  // Write the current orbitState into the camera's position/target/up fields.
  const applyOrbit = (): void => {
    if (!cam) return;
    const { eye, target, up } = toEyeTarget(orbitState);
    camera.setPosition(cam, new Float32Array(eye));
    camera.setTarget(cam, new Float32Array(target));
    camera.setUp(cam, new Float32Array(up));
  };

  const renderFrame = (): void => {
    if (!ctx || !cam || !bloom || !tonemap) return;
    content?.update?.();
    const { eye } = toEyeTarget(orbitState);
    const headlamp: frame.PointLight = {
      type: "point",
      position: eye,
      color: HEADLAMP_COLOR,
      intensity: HEADLAMP_INTENSITY,
      range: HEADLAMP_RANGE,
    };
    frame.render(ctx, {
      // Boundary cast: PreviewContent stores meshes/instanced as unknown[]. The
      // panel realized consumer RegionData against THIS host's ctx(), so they are
      // engine mesh.Mesh[] / mesh.InstancedMesh[] bound to this context — the
      // realize-against-our-ctx invariant is what makes the cast sound.
      meshes: (content?.meshes ?? []) as Mesh[],
      instanced: (content?.instanced ?? []) as InstancedMesh[],
      camera: cam,
      clearColor: CLEAR,
      lights: [headlamp],
      ambient: AMBIENT,
      // Spread keeps `fog` absent (not explicitly undefined) when disabled.
      ...(fogEnabled ? { fog: FOG } : {}),
      effects: [bloom, tonemap],
    });
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    // Left+shift or middle button = pan; plain left = orbit; wheel = zoom.
    const mode = e.button === 1 || e.shiftKey ? "pan" : "orbit";
    drag = { mode, lastX: e.clientX, lastY: e.clientY };
    canvasEl?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!drag || !cam) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (drag.mode === "orbit") {
      // Negate so dragging moves the world, not the camera (the intuitive feel).
      orbitState = orbit(orbitState, -dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    } else {
      // view matrix rows give the camera basis in world space (world→view).
      const m = camera.getMatrices(cam).view;
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
    renderFrame();
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!drag) return;
    canvasEl?.releasePointerCapture(e.pointerId);
    drag = null;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    orbitState = zoom(orbitState, Math.sign(e.deltaY));
    applyOrbit();
    renderFrame();
  };

  return {
    async init(canvas, gpuOptions) {
      if (ctx) throw new Error("preview-host: already initialized");
      // Default to the game-parity HDR + MSAA context; callers may override (e.g.
      // surfaceFormat for the bun-webgpu headless mock). Mirrors viewport-host init.
      ctx = await gpu.requestContext(canvas, {
        sampleCount: 4,
        hdr: true,
        ...gpuOptions,
      });
      // Bloom REQUIRES an hdr context; an hdr context REQUIRES a non-empty chain.
      bloom = await post.bloom(ctx, {
        intensity: 0.9,
        threshold: 1.0,
        softness: 0.2,
      });
      tonemap = await post.tonemap(ctx, {
        exposure: 1.0,
        operator: "neutral",
      });
      cam = camera.perspective({
        fovYRad: EDITOR_FOV_Y,
        aspect: 1,
        near: 0.1,
        far: 1000,
      });
      applyOrbit();
      // bindToCanvas applies the current canvas aspect immediately, then keeps it in sync on resize.
      unbindCamera = camera.bindToCanvas(ctx, cam);
      // A preview world for realize's collider creation — NOT stepped (no game loop here).
      world = await physics.createWorld(ctx, { gravity: PREVIEW_GRAVITY });
      // Guard: headless test mocks (OffscreenCanvas cast as HTMLCanvasElement)
      // don't expose addEventListener — only attach in real browser environments.
      if (typeof canvas.addEventListener === "function") {
        canvasEl = canvas;
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
      }
      // Re-render on canvas resize (the engine sets the backing store BEFORE emitting).
      unbindResize = gpu.onResize(ctx, () => renderFrame());
    },
    ctx: () => requireCtx(),
    world: () => requireWorld(),
    adopt(next) {
      // Destroy any prior content — makes re-adopt leak-safe regardless of caller
      // clear() discipline (the reroll loop hammers this). No-op in the happy path
      // (clear() already nulled content); no double-free (clear() sets it undefined).
      content?.destroy();
      content = next;
    },
    async clear() {
      const c = requireCtx();
      content?.destroy();
      content = undefined;
      // Fresh world per reroll — cheaper than tracking every realize-created body.
      if (world) physics.destroyWorld(c, world);
      world = await physics.createWorld(c, { gravity: PREVIEW_GRAVITY });
    },
    frame(min, max) {
      const center: [number, number, number] = [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      ];
      const radius =
        0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      orbitState = {
        ...orbitState,
        target: center,
        distance: Math.max(MIN_FRAME_DISTANCE, FRAME_FILL * radius),
      };
      applyOrbit();
      renderFrame();
    },
    setFog(enabled) {
      fogEnabled = enabled;
      renderFrame();
    },
    render: () => renderFrame(),
    destroy() {
      if (canvasEl) {
        canvasEl.removeEventListener("pointerdown", onPointerDown);
        canvasEl.removeEventListener("pointermove", onPointerMove);
        canvasEl.removeEventListener("pointerup", onPointerUp);
        canvasEl.removeEventListener("pointercancel", onPointerUp);
        canvasEl.removeEventListener("wheel", onWheel);
        canvasEl = undefined;
      }
      unbindResize?.();
      unbindResize = undefined;
      unbindCamera?.();
      unbindCamera = undefined;
      content?.destroy();
      content = undefined;
      const c = ctx;
      if (c) {
        if (world) physics.destroyWorld(c, world);
        if (bloom) post.destroy(c, bloom);
        if (tonemap) post.destroy(c, tonemap);
        gpu.dispose(c); // LAST — warns on leaked resource-manager slots; a clean shutdown is the leak check.
      }
      world = undefined;
      bloom = undefined;
      tonemap = undefined;
      cam = undefined;
      ctx = undefined;
      drag = null;
    },
  };
}
