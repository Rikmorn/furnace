// FieldHost: the F1 dig-loop surface. A sibling of PreviewHost — owns its
// canvas context, camera, render loop, and the field session (store + op log +
// dirty-set + remesh client). React chrome (Task 10) talks to it via methods;
// the host is FREE of React. Unlike PreviewHost it runs a continuous rAF (fly
// movement integrates per frame and the dirty-set drains across frames) and
// creates NO physics world (colliders are derived at dungeon-load time, T11).
import * as binding from "@furnace/core/binding";
import * as camera from "@furnace/core/camera";
import * as field from "@furnace/core/field";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import { vec4 } from "@furnace/core/transform";
import { FieldWorkerClient } from "../frontend/lib/field-client.ts";
import type { FieldWorkerResponse } from "../frontend/lib/field-protocol.ts";
import {
  flyLook,
  flyMove,
  type OrbitState,
  toEyeTarget,
} from "./camera-control.ts";
import { buildGridLines, segmentsToBatch } from "./reference-grid.ts";

/** Shading toggle: `flat` = unlit normal-colour (structure legibility); `headlamp` =
 *  the game-parity lit material under a camera-carried point light (mood preview). */
export type FieldHostShading = "flat" | "headlamp";

export type FieldHost = {
  init(canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;
  newWorld(): void;
  /** Loads a previously saved world (manifest + chunk bytes + ops). */
  loadWorld(data: {
    manifest: field.FieldManifest;
    chunks: { key: string; bytes: Uint8Array }[];
    ops: field.DigOp[];
  }): void;
  setDigRadius(r: number): void;
  setShading(mode: FieldHostShading): void;
  /** Bakes the current field to the artifact file set (pure, for upload). */
  exportArtifact(name: string): field.BakedFile[];
  subscribeStats(
    cb: (s: { chunks: number; lastRemeshMs: number }) => void,
  ): () => void;
};

type MeshedResponse = Extract<FieldWorkerResponse, { kind: "meshed" }>;
type Vec3T = [number, number, number];

const REMESH_PER_FRAME = 2; // dirty-set drain budget per rAF
const STROKE_MIN_MS = 40; // stroke throttle (pointermove-while-digging)
const DIG_RANGE_M = 30;
const FIRST_DIG_DISTANCE_M = 4; // virgin world: dig this far ahead of the eye
const EDITOR_FOV_Y = Math.PI / 3;
const FLY_SPEED = 6; // m/s
const FLY_BOOST = 3; // shift-held multiplier
const MAX_FRAME_DT = 0.1; // clamp dt so a stall can't lurch the camera
// MIGRATION (until Task 12): provisional look/dig feel — tune at the Safari gate.
const LOOK_SPEED = 0.005; // rad per pixel of RMB drag
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 3;
const RADIUS_WHEEL_STEP = 0.1;

const CLEAR = vec4.fromValues(0.03, 0.03, 0.045, 1);
const HEADLAMP_COLOR: Vec3T = [1, 0.95, 0.85];
const HEADLAMP_INTENSITY = 6;
const HEADLAMP_RANGE = 18;
// Low hemisphere ambient so the carried lamp dominates (mood parity with the
// dungeon torch). Flat mode uses normalColor, which ignores ambient/lights.
const HEADLAMP_AMBIENT: frame.Ambient = {
  sky: [0.4, 0.42, 0.48],
  ground: [0.16, 0.16, 0.2],
  intensity: 0.28,
};
const FLAT_AMBIENT: frame.Ambient = {
  sky: [1, 1, 1],
  ground: [1, 1, 1],
  intensity: 1,
};

const DEFAULT_GRID: Vec3T = [0.42, 0.42, 0.46];
const GRID_MINOR_DIM = 0.5; // minors dimmed vs majors (two-tone depth cue)

const clampRadius = (r: number): number =>
  Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r));

/**
 * Create an uninitialized field host. `init(canvas)` must run before any GPU
 * operation. Mirrors {@link createPreviewHost}'s lifecycle (own context, own
 * camera, own listeners) but drives a fly camera + dig loop instead of orbit,
 * and remeshes carved chunks off the main thread via the field worker.
 */
export function createFieldHost(): FieldHost {
  let ctx: Context | null = null;
  let cam: camera.Camera | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let unbindCamera: (() => void) | null = null;

  const store = field.createFieldStore();
  const log = field.createOpLog();
  const dirty = new Set<string>();
  const worker = new FieldWorkerClient();
  const chunkMeshes = new Map<string, { m: mesh.Mesh; g: geometry.Geometry }>();

  let flatMat: material.Material | null = null;
  let litMat: material.Material | null = null;
  let litBind: binding.Binding | null = null;
  let shading: FieldHostShading = "flat";

  let digRadius = 0.75;
  let digging = false;
  let lastStroke = 0;
  let lastRemeshMs = 0;
  let statsCb: ((s: { chunks: number; lastRemeshMs: number }) => void) | null =
    null;
  let raf = 0;
  let lastFrameT = 0;
  let disposed = false;

  // Fly camera: start a few metres up looking down at the grid origin, so the
  // blank-canvas bootstrap digs the first hole at the ground-grid centre.
  let orbitState: OrbitState = {
    target: [0, 1, 0],
    distance: 6,
    yaw: 0.6,
    pitch: -0.3,
  };
  const keys = new Set<string>();
  // RMB-drag look state (null when not looking).
  let look: { lastX: number; lastY: number } | null = null;

  // Reference grid — world-static, so both batches are built once and reused.
  const gridSegments = buildGridLines();
  const gridMinor = segmentsToBatch(gridSegments.minorSegments, [
    DEFAULT_GRID[0] * GRID_MINOR_DIM,
    DEFAULT_GRID[1] * GRID_MINOR_DIM,
    DEFAULT_GRID[2] * GRID_MINOR_DIM,
    1,
  ]);
  const gridMajor = segmentsToBatch(gridSegments.majorSegments, [
    DEFAULT_GRID[0],
    DEFAULT_GRID[1],
    DEFAULT_GRID[2],
    1,
  ]);

  // --- camera + materials -------------------------------------------------

  const cameraEye = (): Vec3T => toEyeTarget(orbitState).eye;

  // Write the current orbitState into the camera's position/target/up.
  const applyOrbit = (): void => {
    if (!cam) return;
    const { eye, target, up } = toEyeTarget(orbitState);
    camera.setPosition(cam, new Float32Array(eye));
    camera.setTarget(cam, new Float32Array(target));
    camera.setUp(cam, new Float32Array(up));
  };

  const initMaterials = async (c: Context): Promise<void> => {
    const flatShd = await shader.normalColor(c); // unlit, normal-distinct faces
    flatMat = await material.create(c, { shader: flatShd });
    const litShd = await shader.lit(c);
    litBind = binding.create(c, litShd);
    // lit layout is { color: vec4f, specular: vec4f } — color is RGBA (4),
    // specular.rgb + specular.w = shininess.
    binding.set(c, litBind, {
      color: [0.62, 0.6, 0.58, 1],
      specular: [0.06, 0.06, 0.06, 16],
    });
    litMat = await material.create(c, { shader: litShd, binding: litBind });
  };

  const currentMat = (): material.Material => {
    const m = shading === "flat" ? flatMat : litMat;
    if (!m) throw new Error("field-host: materials not initialized");
    return m;
  };

  // --- dirty set + remesh -------------------------------------------------

  // Watertight seams need the FULL dirty set: a border write dirties the
  // neighbour whose apron reads the changed sample (the lower-endpoint-owns
  // rule). Add the 26 allocated neighbours of every changed chunk.
  const markDirtyWithNeighbors = (changed: Set<string>): void => {
    for (const k of changed) {
      dirty.add(k);
      const [cx, cy, cz] = field.parseChunkKey(k);
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nk = field.chunkKey(cx + dx, cy + dy, cz + dz);
            if (store.chunks.has(nk)) dirty.add(nk);
          }
    }
  };

  const chunkOrigin = (cx: number, cy: number, cz: number): Float32Array =>
    new Float32Array([
      cx * field.CHUNK_DIM * store.cellSize,
      cy * field.CHUNK_DIM * store.cellSize,
      cz * field.CHUNK_DIM * store.cellSize,
    ]);

  // Replace a chunk's GPU mesh with a fresh remesh result. A zero-index result
  // destroys any stale mesh and creates none (a fully re-buried chunk) — never
  // skipped, since a neighbour's owned crossing may have vanished here.
  const applyMesh = (c: Context, key: string, res: MeshedResponse): void => {
    const old = chunkMeshes.get(key);
    if (old) {
      mesh.destroy(c, old.m);
      geometry.destroy(c, old.g);
      chunkMeshes.delete(key);
    }
    const indices = new Uint32Array(res.indices);
    if (indices.length === 0) return;
    const g = geometry.create(c, {
      positions: new Float32Array(res.positions),
      normals: new Float32Array(res.normals),
      uvs: new Float32Array(res.uvs),
      indices,
    });
    const m = mesh.create(c, { geometry: g, material: currentMat() });
    const [cx, cy, cz] = field.parseChunkKey(key);
    mesh.setPosition(c, m, chunkOrigin(cx, cy, cz));
    chunkMeshes.set(key, { m, g });
  };

  // Mesh one chunk through the worker. The client rejects on dispose and on a
  // worker-side mesh error; callers must catch (the client does not) or a
  // post-dispose rejection becomes an unhandled rejection.
  const remeshOne = async (key: string): Promise<void> => {
    const c = ctx;
    if (!c) return;
    const apron = field.extractApron(store, key);
    const t0 = performance.now();
    try {
      const res = await worker.mesh(key, apron, store.cellSize);
      lastRemeshMs = performance.now() - t0;
      if (disposed) return;
      applyMesh(c, key, res);
    } catch (err) {
      if (disposed) return; // dispose rejects pending jobs — expected, swallow
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`field-host: remesh failed for ${key}: ${message}`);
    }
  };

  const drainDirty = (): void => {
    let n = 0;
    for (const key of dirty) {
      if (n >= REMESH_PER_FRAME) break;
      dirty.delete(key);
      void remeshOne(key);
      n++;
    }
  };

  // --- dig ----------------------------------------------------------------

  // Cursor client coords → NDC (Y-up, [-1,1]). Copied from viewport-host/index.ts.
  const toNdc = (clientX: number, clientY: number): [number, number] => {
    if (!canvasEl) return [0, 0];
    const r = canvasEl.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    const y = -(((clientY - r.top) / r.height) * 2 - 1);
    return [x, y];
  };

  // Dig a sphere where the cursor ray meets rock. In virgin (all-solid) space
  // the raycast may miss within range — bootstrap by digging a fixed distance
  // ahead of the eye so the first stroke always opens the world.
  const dig = (clientX: number, clientY: number): void => {
    if (!cam) return;
    const [nx, ny] = toNdc(clientX, clientY);
    const r = camera.screenToRay(cam, nx, ny);
    // Boundary cast: screenToRay returns Vec3 (Float32Array); fixed indices
    // 0/1/2 are always present. `noUncheckedIndexedAccess` widens them to
    // `number | undefined`. Marshal to plain tuples for `raycastField` exactly
    // as viewport-host's rayFromCursor does (the recognized fixed-index read).
    const ox = r.origin[0] as number;
    const oy = r.origin[1] as number;
    const oz = r.origin[2] as number;
    const dx = r.dir[0] as number;
    const dy = r.dir[1] as number;
    const dz = r.dir[2] as number;
    if (Math.hypot(dx, dy, dz) < 1e-8) return; // singular VP → no valid ray
    const origin: Vec3T = [ox, oy, oz];
    const direction: Vec3T = [dx, dy, dz];
    const hit = field.raycastField(store, origin, direction, DIG_RANGE_M);
    const at: Vec3T = hit
      ? hit.point
      : [
          ox + dx * FIRST_DIG_DISTANCE_M,
          oy + dy * FIRST_DIG_DISTANCE_M,
          oz + dz * FIRST_DIG_DISTANCE_M,
        ];
    const dirtied = field.logApply(store, log, {
      id: 0,
      kind: "dig",
      shape: { kind: "sphere", center: at, radius: digRadius },
    });
    markDirtyWithNeighbors(dirtied);
  };

  // --- render loop --------------------------------------------------------

  const readFlyMove = (): { f: number; r: number; u: number } => ({
    f: (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0),
    r: (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0),
    u: (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0),
  });

  const applyFlyMove = (dt: number): void => {
    const move = readFlyMove();
    if (move.f === 0 && move.r === 0 && move.u === 0) return;
    const boost = keys.has("shift") ? FLY_BOOST : 1;
    orbitState = flyMove(orbitState, move, FLY_SPEED * boost * dt);
    applyOrbit();
  };

  const sceneLights = (): frame.Light[] =>
    shading === "headlamp"
      ? [
          {
            type: "point",
            position: cameraEye(),
            color: HEADLAMP_COLOR,
            intensity: HEADLAMP_INTENSITY,
            range: HEADLAMP_RANGE,
          },
        ]
      : [];

  const renderScene = (c: Context, view: camera.Camera): void => {
    const meshes = [...chunkMeshes.values()].map((e) => e.m);
    frame.render(c, {
      meshes,
      camera: view,
      clearColor: CLEAR,
      lights: sceneLights(),
      ambient: shading === "headlamp" ? HEADLAMP_AMBIENT : FLAT_AMBIENT,
      effects: [],
    });
    // Depth-tested grid (occlude:true): solid geometry hides it. Minors, then majors.
    frame.drawLines(c, {
      vertices: gridMinor.vertices,
      colors: gridMinor.colors,
      camera: view,
      occlude: true,
    });
    frame.drawLines(c, {
      vertices: gridMajor.vertices,
      colors: gridMajor.colors,
      camera: view,
      occlude: true,
    });
  };

  const tick = (now: number): void => {
    if (disposed) return;
    const c = ctx;
    if (c && cam) {
      const dt =
        lastFrameT === 0
          ? 0
          : Math.min((now - lastFrameT) / 1000, MAX_FRAME_DT);
      lastFrameT = now;
      applyFlyMove(dt);
      drainDirty();
      statsCb?.({ chunks: store.chunks.size, lastRemeshMs });
      renderScene(c, cam);
    }
    raf = requestAnimationFrame(tick);
  };

  // --- input handlers -----------------------------------------------------

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) {
      digging = true;
      dig(e.clientX, e.clientY);
      canvasEl?.setPointerCapture(e.pointerId);
    } else if (e.button === 2) {
      look = { lastX: e.clientX, lastY: e.clientY };
      canvasEl?.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (look) {
      const dx = e.clientX - look.lastX;
      const dy = e.clientY - look.lastY;
      look.lastX = e.clientX;
      look.lastY = e.clientY;
      orbitState = flyLook(orbitState, -dx * LOOK_SPEED, -dy * LOOK_SPEED);
      applyOrbit();
      return;
    }
    if (!digging) return;
    const now = performance.now();
    if (now - lastStroke < STROKE_MIN_MS) return;
    lastStroke = now;
    dig(e.clientX, e.clientY);
  };

  const onPointerUp = (e: PointerEvent): void => {
    digging = false;
    look = null;
    canvasEl?.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    digRadius = clampRadius(
      digRadius - Math.sign(e.deltaY) * RADIUS_WHEEL_STEP,
    );
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault(); // RMB drives look — suppress the browser menu
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === "z") {
      e.preventDefault();
      const dirtied = e.shiftKey
        ? field.redo(store, log)
        : field.undo(store, log);
      markDirtyWithNeighbors(dirtied);
      return;
    }
    keys.add(k);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.key.toLowerCase());
  };

  const attachListeners = (canvas: HTMLCanvasElement): void => {
    // Guard: headless mocks (OffscreenCanvas cast as HTMLCanvasElement) don't
    // expose addEventListener — only attach in real browser environments.
    if (typeof canvas.addEventListener !== "function") return;
    canvasEl = canvas;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
  };

  const detachListeners = (): void => {
    if (!canvasEl) return;
    canvasEl.removeEventListener("pointerdown", onPointerDown);
    canvasEl.removeEventListener("pointermove", onPointerMove);
    canvasEl.removeEventListener("pointerup", onPointerUp);
    canvasEl.removeEventListener("pointercancel", onPointerUp);
    canvasEl.removeEventListener("wheel", onWheel);
    canvasEl.removeEventListener("contextmenu", onContextMenu);
    canvasEl.removeEventListener("keydown", onKeyDown);
    canvasEl.removeEventListener("keyup", onKeyUp);
    canvasEl = null;
  };

  // Reset the field session + free every GPU chunk mesh. Shared by newWorld/loadWorld.
  const resetWorld = (): void => {
    store.chunks.clear();
    log.ops.length = 0;
    log.undoStack.length = 0;
    log.redoStack.length = 0;
    log.nextId = 1;
    dirty.clear();
    const c = ctx;
    if (c)
      for (const [, e] of chunkMeshes) {
        mesh.destroy(c, e.m);
        geometry.destroy(c, e.g);
      }
    chunkMeshes.clear();
  };

  return {
    async init(canvas) {
      if (ctx) throw new Error("field-host: already initialized");
      ctx = await gpu.requestContext(canvas, { sampleCount: 4 });
      cam = camera.perspective({
        fovYRad: EDITOR_FOV_Y,
        aspect: 1,
        near: 0.1,
        far: 1000,
      });
      applyOrbit();
      unbindCamera = camera.bindToCanvas(ctx, cam);
      await initMaterials(ctx);
      attachListeners(canvas);
      lastFrameT = 0;
      raf = requestAnimationFrame(tick);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      detachListeners();
      worker.dispose();
      const c = ctx;
      if (c) {
        for (const [, e] of chunkMeshes) {
          mesh.destroy(c, e.m);
          geometry.destroy(c, e.g);
        }
        chunkMeshes.clear();
        if (flatMat) material.destroy(c, flatMat);
        if (litMat) material.destroy(c, litMat);
        if (litBind) binding.destroy(c, litBind);
        unbindCamera?.();
        gpu.dispose(c); // LAST — a clean shutdown is the leak check.
      }
      flatMat = null;
      litMat = null;
      litBind = null;
      unbindCamera = null;
      cam = null;
      ctx = null;
    },
    newWorld() {
      resetWorld();
    },
    loadWorld(data) {
      resetWorld();
      for (const { key, bytes } of data.chunks)
        store.chunks.set(key, field.decodeChunkFile(bytes));
      for (const op of data.ops) log.ops.push(op);
      log.nextId = data.ops.reduce((max, o) => Math.max(max, o.id), 0) + 1;
      for (const key of store.chunks.keys()) dirty.add(key);
    },
    setDigRadius(r) {
      digRadius = clampRadius(r);
    },
    setShading(mode) {
      shading = mode;
      const c = ctx;
      if (!c) return;
      const m = currentMat();
      for (const [, e] of chunkMeshes) mesh.setMaterial(c, e.m, m);
    },
    exportArtifact(name) {
      return field.bakeFieldWorld(store, log, {
        name,
        playerStart: cameraEye(), // v0 spawn = current camera position
        playerYaw: orbitState.yaw,
      });
    },
    subscribeStats(cb) {
      statsCb = cb;
      return () => {
        statsCb = null;
      };
    },
  };
}
