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
import { mat4, vec4 } from "@furnace/core/transform";
import { FieldWorkerClient } from "../frontend/lib/field-client.ts";
import type { WireBucket } from "../frontend/lib/field-protocol.ts";
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

/** Which brush the pointer applies: `dig` opens air, `fill` solidifies + writes
 *  a material, `paint` retints solid cells. `materialId` is the class fill/paint
 *  write (ignored by dig). */
export type FieldTool = {
  effect: "dig" | "fill" | "paint";
  materialId: number;
};

export type FieldHost = {
  init(canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;
  newWorld(): void;
  /** Loads a previously saved world (manifest + chunk bytes + material siblings + ops). */
  loadWorld(data: {
    manifest: field.FieldManifest;
    chunks: { key: string; bytes: Uint8Array }[];
    /** Material sibling files — optional so an F1 (rock-only) world still loads. */
    materials?: { key: string; bytes: Uint8Array }[];
    ops: field.BrushOp[];
  }): void;
  setDigRadius(r: number): void;
  setShading(mode: FieldHostShading): void;
  /** Selects the active brush (effect + material class). Default dig/rock. */
  setTool(tool: FieldTool): void;
  /** Swaps the project's resolved material table (the panel calls this once
   *  after catalog load, Task 12). Re-buckets and re-meshes every chunk. */
  setMaterialTable(table: field.MaterialTable): void;
  /** Bakes the current field to the artifact file set (pure, for upload). */
  exportArtifact(name: string): field.BakedFile[];
  subscribeStats(
    cb: (s: { chunks: number; lastRemeshMs: number }) => void,
  ): () => void;
};

type Vec3T = [number, number, number];

/** One chunk's GPU render state: per-class surface/backing bucket meshes plus an
 *  optional instanced kit mesh (one draw call for all its kit pieces). */
type ChunkRender = {
  entries: {
    m: mesh.Mesh;
    g: geometry.Geometry;
    classId: number;
    backing: boolean;
  }[];
  kit: mesh.InstancedMesh | null;
  kitGeo: geometry.Geometry | null;
};

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

// Shared specular for every lit bucket / kit material (color-only variation).
const LIT_SPECULAR: [number, number, number, number] = [0.06, 0.06, 0.06, 16];

// Built-kit fills snap to this lattice so assertOpValid accepts them.
const KIT_LATTICE = 0.5;
// Per-piece tint jitter (deterministic from the instance variant): scale RGB by
// KIT_TINT_JITTER_BASE + KIT_TINT_JITTER_SPAN·variant.
const KIT_TINT_JITTER_BASE = 0.92;
const KIT_TINT_JITTER_SPAN = 0.16;

// Exact quarter-turn yaw quaternions (rotation about +Y): (0, sin(θ/2), 0,
// cos(θ/2)). No trig — the donor skin.ts pattern (yaws are always {0, ±π/2, π}).
const S = Math.SQRT1_2;
const YAW_ZERO = new Float32Array([0, 0, 0, 1]); // 0°
const YAW_PLUS_90 = new Float32Array([0, S, 0, S]); // +90°
const YAW_180 = new Float32Array([0, 1, 0, 0]); // 180°
const YAW_MINUS_90 = new Float32Array([0, -S, 0, S]); // -90° / 270°

// Kit piece kind → its KitStyle.pieceColors bucket.
const PIECE_COLOR_KEY: Record<
  field.KitPieceId,
  keyof field.KitStyle["pieceColors"]
> = {
  panel: "panel",
  floorTile: "floor",
  ceilTile: "floor",
  post: "trim",
  rimPostV: "collar",
  rimEdgeH: "collar",
};

const clampRadius = (r: number): number =>
  Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r));

/** Exact yaw quaternion for a quarter-turn rotation about +Y (yaw ∈ {0, ±π/2, π}). */
const yawQuat = (yaw: number): Float32Array => {
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  switch (q) {
    case 1:
      return YAW_PLUS_90;
    case 2:
      return YAW_180;
    case 3:
      return YAW_MINUS_90;
    default:
      return YAW_ZERO;
  }
};

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
  const chunkMeshes = new Map<string, ChunkRender>();

  // ONE flat material (normalColor): classes are indistinct in flat mode — the
  // v0 coarseness is deliberate (structure legibility over class colour).
  let flatMat: material.Material | null = null;
  // Per-class lit materials keyed `c<classId>` (surface) / `b<classId>` (kit
  // backing), rebuilt from `table` at init and on setMaterialTable.
  const litByClass = new Map<
    string,
    { mat: material.Material; bind: binding.Binding }
  >();
  // ONE instanced-lit material for all kit pieces (white base; per-instance tint
  // carries the piece colour).
  let kitMat: material.Material | null = null;
  let kitBind: binding.Binding | null = null;
  let shading: FieldHostShading = "flat";

  // The project's resolved material table — drives the mesher's bucket split,
  // logApply validation, and the bake. Defaults rock-only until setMaterialTable.
  let table: field.MaterialTable = field.BUILTIN_TABLE;
  let tool: FieldTool = { effect: "dig", materialId: 0 };

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
  // POSITIVE pitch puts the eye ABOVE the target (toEyeTarget: eye.y = target.y +
  // distance·sin(pitch)); at distance 6 this seats the eye at y ≈ 3.9 (matches
  // preview-host's positive-pitch DEFAULT_ORBIT). A negative pitch would sink it
  // below the y=0 grid looking up.
  let orbitState: OrbitState = {
    target: [0, 1, 0],
    distance: 6,
    yaw: 0.6,
    pitch: 0.5,
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

  // Build the per-class lit material cache from `table`: a surface material per
  // class (its colour) plus a backing material per kit class (its backingColor).
  const buildLitMaterials = async (c: Context): Promise<void> => {
    const litShd = await shader.lit(c);
    for (const cls of table.classes) {
      const surfBind = binding.create(c, litShd);
      binding.set(c, surfBind, { color: cls.color, specular: LIT_SPECULAR });
      const surfMat = await material.create(c, {
        shader: litShd,
        binding: surfBind,
      });
      litByClass.set(`c${cls.id}`, { mat: surfMat, bind: surfBind });
      if (cls.kind === "kit") {
        const backBind = binding.create(c, litShd);
        binding.set(c, backBind, {
          color: cls.kit.backingColor,
          specular: LIT_SPECULAR,
        });
        const backMat = await material.create(c, {
          shader: litShd,
          binding: backBind,
        });
        litByClass.set(`b${cls.id}`, { mat: backMat, bind: backBind });
      }
    }
  };

  const destroyLitMaterials = (c: Context): void => {
    for (const [, e] of litByClass) {
      material.destroy(c, e.mat);
      binding.destroy(c, e.bind);
    }
    litByClass.clear();
  };

  const initMaterials = async (c: Context): Promise<void> => {
    const flatShd = await shader.normalColor(c); // unlit, normal-distinct faces
    flatMat = await material.create(c, { shader: flatShd });
    const kitShd = await shader.litInstanced(c);
    kitBind = binding.create(c, kitShd);
    // White base color — per-instance tint carries the piece colour.
    binding.set(c, kitBind, { color: [1, 1, 1, 1], specular: LIT_SPECULAR });
    kitMat = await material.create(c, { shader: kitShd, binding: kitBind });
    await buildLitMaterials(c);
  };

  // Material for one surface/backing bucket under the current shading mode. Flat
  // mode collapses every class to flatMat; headlamp mode looks up the per-class
  // lit material (falling back to class-0 surface if the key is missing).
  const bucketMaterial = (
    classId: number,
    backing: boolean,
  ): material.Material => {
    if (shading === "flat") {
      if (!flatMat) throw new Error("field-host: materials not initialized");
      return flatMat;
    }
    const key = (backing ? "b" : "c") + classId;
    const hit = litByClass.get(key) ?? litByClass.get("c0");
    if (!hit) throw new Error("field-host: lit materials not initialized");
    return hit.mat;
  };

  const kitInstancedMat = (): material.Material => {
    if (!kitMat) throw new Error("field-host: kit material not initialized");
    return kitMat;
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

  // Per-instance tint for a kit piece: the class's KitStyle piece colour, jittered
  // by the instance variant (RGB only; alpha carried through).
  const pieceColor = (
    k: field.KitInstance,
  ): [number, number, number, number] => {
    const cls = field.classOf(table, k.classId);
    if (cls.kind !== "kit") return [1, 1, 1, 1];
    const base = cls.kit.pieceColors[PIECE_COLOR_KEY[k.piece]];
    const j = KIT_TINT_JITTER_BASE + KIT_TINT_JITTER_SPAN * k.variant;
    return [base[0] * j, base[1] * j, base[2] * j, base[3]];
  };

  // Build one chunk's instanced kit mesh: a unit cube drawn once per piece, each
  // transformed by its (yaw · box) matrix at its world position, tinted per piece.
  // Accumulates ONE packed matrix array and uploads it in a single bulk call.
  const buildKit = (
    c: Context,
    key: string,
    kit: field.KitInstance[],
  ): { im: mesh.InstancedMesh; g: geometry.Geometry } | null => {
    if (kit.length === 0) return null;
    // Safe under litInstanced's no-normal-matrix shortcut (it reconstructs the
    // world normal from the upper 3×3 with no inverse-transpose) ONLY because
    // this is an axis-aligned unit cube + quarter-turn yaw: a per-axis-scaled
    // face normal still normalize()s back to its correct outward direction. Do
    // NOT swap to non-axis-aligned kit geometry (beveled/rounded/cylindrical) —
    // non-uniform per-instance scale would skew its normals with no compiler
    // error and no test to catch it (GPU-visual only).
    const g = geometry.cube(c, { size: 1 });
    const im = mesh.createInstanced(c, {
      geometry: g,
      material: kitInstancedMat(),
      count: kit.length,
    });
    const [cx, cy, cz] = field.parseChunkKey(key);
    const dim = field.CHUNK_DIM * store.cellSize;
    const ox = cx * dim;
    const oy = cy * dim;
    const oz = cz * dim;
    const packed = new Float32Array(16 * kit.length);
    const m = mat4.create();
    const t = new Float32Array(3);
    const s = new Float32Array(3);
    kit.forEach((k, i) => {
      t[0] = k.position[0] + ox;
      t[1] = k.position[1] + oy;
      t[2] = k.position[2] + oz;
      s[0] = k.box[0];
      s[1] = k.box[1];
      s[2] = k.box[2];
      mat4.fromRotationTranslationScale(m, yawQuat(k.yaw), t, s);
      packed.set(m, i * 16);
    });
    mesh.setInstanceMatrices(c, im, packed);
    kit.forEach((k, i) => mesh.setInstanceTint(c, im, i, pieceColor(k)));
    return { im, g };
  };

  const destroyChunkRender = (c: Context, cm: ChunkRender): void => {
    for (const e of cm.entries) {
      mesh.destroy(c, e.m);
      geometry.destroy(c, e.g);
    }
    if (cm.kit) mesh.destroyInstanced(c, cm.kit);
    if (cm.kitGeo) geometry.destroy(c, cm.kitGeo);
  };

  // Replace a chunk's GPU render state with a fresh remesh result: one mesh per
  // non-empty per-class bucket + one instanced kit mesh. Empty buckets AND empty
  // kit (a fully re-buried chunk) destroys any stale state and creates none —
  // never skipped, since a neighbour's owned crossing may have vanished here.
  const applyMesh = (
    c: Context,
    key: string,
    buckets: WireBucket[],
    kit: field.KitInstance[],
  ): void => {
    const old = chunkMeshes.get(key);
    if (old) {
      destroyChunkRender(c, old);
      chunkMeshes.delete(key);
    }
    const [cx, cy, cz] = field.parseChunkKey(key);
    const origin = chunkOrigin(cx, cy, cz);
    const entries: ChunkRender["entries"] = [];
    for (const bucket of buckets) {
      const indices = new Uint32Array(bucket.indices);
      if (indices.length === 0) continue;
      const g = geometry.create(c, {
        positions: new Float32Array(bucket.positions),
        normals: new Float32Array(bucket.normals),
        uvs: new Float32Array(bucket.uvs),
        indices,
      });
      const m = mesh.create(c, {
        geometry: g,
        material: bucketMaterial(bucket.classId, bucket.backing),
      });
      mesh.setPosition(c, m, origin);
      entries.push({ m, g, classId: bucket.classId, backing: bucket.backing });
    }
    const kitRes = buildKit(c, key, kit);
    if (entries.length === 0 && kitRes === null) return; // re-buried chunk
    chunkMeshes.set(key, {
      entries,
      kit: kitRes?.im ?? null,
      kitGeo: kitRes?.g ?? null,
    });
  };

  // Mesh one chunk through the worker. The client rejects on dispose and on a
  // worker-side mesh error; callers must catch (the client does not) or a
  // post-dispose rejection becomes an unhandled rejection.
  const remeshOne = async (key: string): Promise<void> => {
    const c = ctx;
    if (!c) return;
    const aprons = field.extractFieldAprons(store, key);
    const t0 = performance.now();
    try {
      const res = await worker.mesh(key, aprons, table, store.cellSize);
      lastRemeshMs = performance.now() - t0;
      if (disposed) return;
      applyMesh(c, key, res.buckets, res.kit);
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

  // --- tool application ---------------------------------------------------

  // Cursor client coords → NDC (Y-up, [-1,1]). Copied from viewport-host/index.ts.
  const toNdc = (clientX: number, clientY: number): [number, number] => {
    if (!canvasEl) return [0, 0];
    const r = canvasEl.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    const y = -(((clientY - r.top) / r.height) * 2 - 1);
    return [x, y];
  };

  const sphereShape = (center: Vec3T, radius: number): field.BrushShape => ({
    kind: "sphere",
    center,
    radius,
  });

  // MIGRATION (until Task 11): the target math (raycast + eyeInRock branch) and
  // the lattice snap live inline here. Task 11 extracts computeBrushCenter +
  // snappedKitBox into the pure frontend/lib/field-brush.ts module (adding the
  // bite / carve-from-eye feel, the ghost marker, and radius defaults).

  // Snap one box-face axis onto the 0.5 m lattice: given the box centre coord and
  // half-side, round the min corner to the lattice and re-derive the centre so
  // both faces land on it (assertOpValid requires this for kit-class fills).
  const snapAxis = (c: number, half: number): number =>
    Math.round((c - half) / KIT_LATTICE) * KIT_LATTICE + half;

  const snappedKitBox = (center: Vec3T, radius: number): field.BrushShape => {
    const side = Math.max(
      KIT_LATTICE,
      Math.round((2 * radius) / KIT_LATTICE) * KIT_LATTICE,
    );
    const half = side / 2;
    return {
      kind: "box",
      center: [
        snapAxis(center[0], half),
        snapAxis(center[1], half),
        snapAxis(center[2], half),
      ],
      halfExtents: [half, half, half],
    };
  };

  // Build the brush op for the active tool at a world centre. A kit-class FILL
  // snaps to a lattice box; organic fill and all paint use a sphere; dig is a
  // material-free sphere. `classOf` throws on an unknown material id (caught by
  // applyTool), so a stray tool selection can't corrupt the field.
  const toolOp = (center: Vec3T): field.BrushOp => {
    if (tool.effect === "dig") {
      return {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: sphereShape(center, digRadius),
      };
    }
    const kitFill =
      tool.effect === "fill" &&
      field.classOf(table, tool.materialId).kind === "kit";
    const shape = kitFill
      ? snappedKitBox(center, digRadius)
      : sphereShape(center, digRadius);
    return {
      id: 0,
      kind: "brush",
      effect: tool.effect,
      material: tool.materialId,
      shape,
    };
  };

  // Apply the active tool where the cursor ray meets rock. In virgin (all-solid)
  // space the centre depends on where the eye sits relative to rock (see the
  // branch below: raycastField can't be trusted to find a wall when the eye is
  // embedded).
  const applyTool = (clientX: number, clientY: number): void => {
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
    const ahead: Vec3T = [
      ox + dx * FIRST_DIG_DISTANCE_M,
      oy + dy * FIRST_DIG_DISTANCE_M,
      oz + dz * FIRST_DIG_DISTANCE_M,
    ];
    // If the eye is embedded in rock (virgin world or buried), raycastField would
    // hit the origin's OWN voxel at t=0 (raycast.ts: "a start inside rock hits its
    // own voxel at t=0") and carve a sphere around the camera — there is no visible
    // wall to aim at, so aim ahead. Otherwise apply where the ray meets rock, or
    // ahead when it reaches maxDist through only air (a cavity aimed at open space).
    const cs = store.cellSize;
    const eyeInRock =
      field.getDensity(
        store,
        field.worldToVoxel(ox, cs),
        field.worldToVoxel(oy, cs),
        field.worldToVoxel(oz, cs),
      ) < 0;
    const hit = eyeInRock
      ? null
      : field.raycastField(store, origin, direction, DIG_RANGE_M);
    const at: Vec3T = hit ? hit.point : ahead;
    try {
      const dirtied = field.logApply(store, log, toolOp(at), table);
      markDirtyWithNeighbors(dirtied);
    } catch (err) {
      // A kit fill off the lattice or an unknown material class throws here
      // (assertOpValid / classOf, setup-loud) — swallow so a bad brush can't
      // escape the pointer handler; the stroke is simply dropped.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`field-host: tool apply failed: ${message}`);
    }
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
    const meshes: mesh.Mesh[] = [];
    const instanced: mesh.InstancedMesh[] = [];
    for (const cm of chunkMeshes.values()) {
      for (const e of cm.entries) meshes.push(e.m);
      if (cm.kit) instanced.push(cm.kit);
    }
    // Kit instances always render with the lit-instanced material, even in flat
    // mode — there is no flat-instanced variant; FLAT_AMBIENT (full white) makes
    // them readable headlamp-independently. A deliberate v0 choice.
    frame.render(c, {
      meshes,
      instanced,
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
      applyTool(e.clientX, e.clientY);
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
    applyTool(e.clientX, e.clientY);
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

  // Reset the field session + free every GPU chunk render. Shared by newWorld/loadWorld.
  const resetWorld = (): void => {
    store.chunks.clear();
    store.materials.clear();
    log.ops.length = 0;
    log.undoStack.length = 0;
    log.redoStack.length = 0;
    log.nextId = 1;
    dirty.clear();
    const c = ctx;
    if (c) for (const [, cm] of chunkMeshes) destroyChunkRender(c, cm);
    chunkMeshes.clear();
  };

  return {
    async init(canvas) {
      if (ctx) throw new Error("field-host: already initialized");
      disposed = false; // clear a prior dispose() so a re-init'd instance lives
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
        for (const [, cm] of chunkMeshes) destroyChunkRender(c, cm);
        chunkMeshes.clear();
        if (flatMat) material.destroy(c, flatMat);
        destroyLitMaterials(c);
        if (kitMat) material.destroy(c, kitMat);
        if (kitBind) binding.destroy(c, kitBind);
        unbindCamera?.();
        gpu.dispose(c); // LAST — a clean shutdown is the leak check.
      }
      flatMat = null;
      kitMat = null;
      kitBind = null;
      unbindCamera = null;
      cam = null;
      ctx = null;
    },
    newWorld() {
      resetWorld();
    },
    loadWorld(data) {
      // Setup-loud: the store's cellSize is fixed at construction and captured by
      // the closures above, so it can't be cheaply rebuilt. A world baked at a
      // different scale would decode at the wrong size silently — refuse it.
      if (data.manifest.cellSize !== store.cellSize) {
        throw new Error(
          `FieldHost.loadWorld: world cellSize ${data.manifest.cellSize} != host ${store.cellSize} (multi-cellSize load not supported in v0)`,
        );
      }
      resetWorld();
      for (const { key, bytes } of data.chunks)
        store.chunks.set(key, field.decodeChunkFile(bytes));
      for (const { key, bytes } of data.materials ?? [])
        store.materials.set(key, field.decodeMaterialFile(bytes));
      for (const op of data.ops) log.ops.push(op);
      log.nextId = data.ops.reduce((max, o) => Math.max(max, o.id), 0) + 1;
      // v0: manifest.playerStart/playerYaw are the dungeon runtime spawn — the
      // editor keeps its current fly pose on load (not applied to the camera here).
      for (const key of store.chunks.keys()) dirty.add(key);
    },
    setDigRadius(r) {
      digRadius = clampRadius(r);
    },
    setShading(mode) {
      shading = mode;
      const c = ctx;
      if (!c) return;
      for (const cm of chunkMeshes.values())
        for (const e of cm.entries)
          mesh.setMaterial(c, e.m, bucketMaterial(e.classId, e.backing));
    },
    setTool(next) {
      tool = next;
    },
    setMaterialTable(next) {
      table = next;
      const c = ctx;
      if (!c) return;
      // A table swap re-buckets every chunk. Drop all chunk renders first so
      // nothing references the outgoing per-class materials, rebuild the cache,
      // then re-mesh from scratch. Async (shader/material creation is async).
      void (async () => {
        try {
          for (const [, cm] of chunkMeshes) destroyChunkRender(c, cm);
          chunkMeshes.clear();
          destroyLitMaterials(c);
          await buildLitMaterials(c); // yields; dispose() may land here
          if (disposed) return;
          for (const key of store.chunks.keys()) dirty.add(key);
        } catch (err) {
          // dispose() during the await tears the context down; the trailing GPU
          // creation then throws — expected, swallow (mirrors remeshOne). Without
          // this, the void-IIFE rejection would surface as an unhandled rejection.
          if (disposed) return;
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`field-host: material table swap failed: ${message}`);
        }
      })();
    },
    exportArtifact(name) {
      return field.bakeFieldWorld(store, log, table, {
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
