import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as field from "@furnace/core/field";
import type { Ambient, Light } from "@furnace/core/frame";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { InstancedMesh, Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { mat4, vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import { FLAG_MEANING, type FlagRow } from "./flag-legend.ts";
import help from "./help.ts";

type Rgba = [number, number, number, number];

// The material table is catalog DATA, declared inline: class 0 must be organic
// rock (the validateMaterialTable floor); masonry is a kit class whose KitStyle
// is everything the skinner needs (piece colours, panel proudness, collar).
const MAT_MOSS = 1;
const MAT_MASONRY = 2;
const TABLE: field.MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
    {
      id: MAT_MOSS,
      name: "moss",
      kind: "organic",
      color: [0.38, 0.52, 0.42, 1],
    },
    {
      id: MAT_MASONRY,
      name: "masonry",
      kind: "kit",
      color: [0.55, 0.53, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.34, 0.32, 0.3, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

const CAVERN_RADIUS = 6; // metres; the world is solid rock until dug
// A flat floor for the cavern: one fill slab that buries the dug bowl up to
// FLOOR_Y. Flat ground is what makes the walkability flags below legible — on a
// curved bowl every quantized cell step is its own finding.
const FLOOR_Y = -4.25;
const FLOOR_CENTER: [number, number, number] = [0, FLOOR_Y - 1.5, 0];
const FLOOR_HALF: [number, number, number] = [4.5, 1.5, 4.5];
// The masonry wall: kit-class fills must be boxes on the 0.5 m lattice.
const WALL_CENTER: [number, number, number] = [0, -3, 0];
const WALL_HALF: [number, number, number] = [2, 1.5, 0.5];
// The moss band retints the cavern wall where it crosses this slab.
const BAND_CENTER: [number, number, number] = [0, -1, 0];
const BAND_HALF: [number, number, number] = [6, 0.75, 6];

// Two deliberate traps dug into that floor, sized against AGENT below: the pit
// drops further than the agent can climb back out, the step does not.
const PIT_DEPTH = 1.0;
const PIT_CENTER: [number, number, number] = [
  2.8,
  FLOOR_Y - PIT_DEPTH / 2,
  1.6,
];
const PIT_HALF: [number, number, number] = [0.7, PIT_DEPTH / 2, 0.7];
const STEP_DEPTH = 0.5;
const STEP_CENTER: [number, number, number] = [
  0.8,
  FLOOR_Y - STEP_DEPTH / 2,
  1.6,
];
const STEP_HALF: [number, number, number] = [0.5, STEP_DEPTH / 2, 0.7];
// …and a third: two blocks standing on the floor with a 0.50 m lane between
// them, under the capsule's 0.68 m pinch bar (2·radius + skin). A box fill takes
// the samples STRICTLY inside it, so each block loses a 0.25 m cell off its
// authored box — and the lane between two of them GAINS one, since both facing
// samples stay air. Hence a 1.25 m authored height for 1.00 m blocks, and a
// 0.25 m authored gap for the 0.50 m lane.
const SLOT_HALF: [number, number, number] = [0.5, 0.625, 0.7];
const SLOT_Y = FLOOR_Y + 0.375;
const SLOT_Z = 3.3;
const SLOT_A: [number, number, number] = [1.0, SLOT_Y, SLOT_Z];
const SLOT_B: [number, number, number] = [2.25, SLOT_Y, SLOT_Z];

// The capsule the analyzer is parameterized on — consuming-project DATA, never
// hard-coded in core. `clearance` is the capsule's own height and may not be
// less; `climbCeiling` must exceed `stepHeight`; `skin` is the mover's contact
// margin and must be under the radius (all three checked setup-loud).
const AGENT: field.AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};

// Flag markers: warm + large for `candidate` (shown by default — worth a look),
// cool + small for `info` (a band the mover is known to handle).
const FLAG_COLOR: Record<field.FlagSeverity, Rgba> = {
  candidate: [1, 0.45, 0.2, 1],
  info: [0.35, 0.65, 1, 1],
};
const FLAG_SIZE: Record<field.FlagSeverity, number> = {
  candidate: 0.18,
  info: 0.11,
};
/** The same marker tints as CSS, so the legend swatches cannot drift from what
 *  the viewport draws. */
const cssRgb = (c: Rgba): string =>
  `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
const FLAG_CSS: Record<field.FlagSeverity, string> = {
  candidate: cssRgb(FLAG_COLOR.candidate),
  info: cssRgb(FLAG_COLOR.info),
};
/** Legend sort key — `candidate` is what a triage UI shows by default. */
const SEVERITY_ORDER: Record<field.FlagSeverity, number> = {
  candidate: 0,
  info: 1,
};

// Per-piece tint jitter, deterministic from the skinner's variant hash.
const TINT_JITTER_BASE = 0.92;
const TINT_JITTER_SPAN = 0.16;
const PIECE_COLOR: Record<
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

const CLEAR_COLOR: Vec4 = vec4.fromValues(0.02, 0.02, 0.03, 1);
const AMBIENT: Ambient = {
  sky: [0.45, 0.5, 0.6],
  ground: [0.12, 0.11, 0.1],
  intensity: 0.12,
};
// A cave has no sky: the point light at its heart does the reading, the soft
// directional keys the floor. (Lights pass through rock — no shadows here.)
const LIGHTS: Light[] = [
  {
    type: "directional",
    direction: [-0.35, -1, -0.25],
    color: [1, 0.96, 0.9],
    intensity: 0.7,
  },
  {
    type: "point",
    position: [0, 0.5, 0],
    color: [1, 0.85, 0.6],
    intensity: 1.6,
    range: 12,
  },
];

// The camera orbits the dug features, not the origin: high enough to clear the
// masonry wall (top −1.5 m) and steep enough to read the flag markers on the
// floor. The far side of the orbit stays inside the cavern — 1.27 + 4.3 = 5.57 m
// out at 0.55 m above the equator, against a 6 m wall.
const ORBIT_CENTER: [number, number, number] = [0.9, FLOOR_Y, 0.9];
const ORBIT_RADIUS = 4.3;
const ORBIT_HEIGHT = 4.8;
const ORBIT_SPEED = 0.12; // rad/s
const MS_PER_SEC = 1000;
// Aimed between the step and the pit.
const TARGET = vec3.fromValues(1.6, FLOOR_Y + 0.2, 1.6);
const scratchCamPos = vec3.create();

type SceneRef = {
  cam: Camera;
  meshes: Mesh[];
  instanced: InstancedMesh[];
  geometries: Geometry[];
  materials: Material[];
  bindings: Binding[];
};

/** Mutate the field the only way it mutates: brush ops through the op log.
 *  Returns the store plus the union of every op's dirty chunk set. */
function buildField(): { store: field.FieldStore; dirty: Set<field.ChunkKey> } {
  const store = field.createFieldStore();
  const log = field.createOpLog();
  const ops: field.BrushOp[] = [
    // Dig a cavern out of the uniform solid. Ids are placeholders — logApply
    // stamps the real log id on each op.
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [0, 0, 0], radius: CAVERN_RADIUS },
    },
    // Fill the dug bowl back up to a flat floor to stand on.
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: field.MAT_ROCK,
      shape: { kind: "box", center: FLOOR_CENTER, halfExtents: FLOOR_HALF },
    },
    // Paint a moss band across the cavern wall (density untouched).
    {
      id: 0,
      kind: "brush",
      effect: "paint",
      material: MAT_MOSS,
      shape: { kind: "box", center: BAND_CENTER, halfExtents: BAND_HALF },
    },
    // Fill a lattice-snapped masonry wall — solid density + kit material.
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: MAT_MASONRY,
      shape: { kind: "box", center: WALL_CENTER, halfExtents: WALL_HALF },
    },
    // Two traps for the analyzer to find: a pit the agent cannot climb out of…
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: PIT_CENTER, halfExtents: PIT_HALF },
    },
    // …a shallow step it handles fine…
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: STEP_CENTER, halfExtents: STEP_HALF },
    },
    // …and two blocks pinching a lane too tight to walk down.
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: field.MAT_ROCK,
      shape: { kind: "box", center: SLOT_A, halfExtents: SLOT_HALF },
    },
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: field.MAT_ROCK,
      shape: { kind: "box", center: SLOT_B, halfExtents: SLOT_HALF },
    },
  ];
  const dirty = new Set<field.ChunkKey>();
  for (const op of ops)
    for (const key of field.logApply(store, log, op, TABLE)) dirty.add(key);
  return { store, dirty };
}

/** Walkability flags for the ONE chunk holding the pit floor. The analyzer is
 *  ADVISORY: a pure read that never writes the store, never blocks a brush, and
 *  never fixes anything — the same store is meshed and skinned below whether it
 *  returns nothing or a hundred findings.
 *
 *  Analysis is per chunk because editing is: a stroke dirties a handful of
 *  chunks and only those are re-analysed. Neighbour reads cross chunk borders
 *  freely (an unallocated chunk reads as solid rock, exactly what the runtime
 *  voxel collider derives from), so one chunk's pass sees the whole cavern
 *  around it. `analyzeWorld` is the same pass over every allocated chunk. */
function analyzeWalkability(store: field.FieldStore): {
  chunk: field.ChunkKey;
  flags: field.FieldFlag[];
} {
  const cellOf = (w: number): number =>
    field.voxelChunk(field.worldToVoxel(w, store.cellSize));
  const chunk = field.chunkKey(
    cellOf(PIT_CENTER[0]),
    cellOf(FLOOR_Y - PIT_DEPTH),
    cellOf(PIT_CENTER[2]),
  );
  return { chunk, flags: field.analyzeChunk(store, chunk, AGENT) };
}

/** The legend rows: one per (kind, severity) actually present, candidates
 *  first. Derived from the flags, so the panel cannot disagree with the pass. */
function tallyFlags(flags: readonly field.FieldFlag[]): FlagRow[] {
  const counts = new Map<string, FlagRow>();
  for (const f of flags) {
    const id = `${f.kind}/${f.severity}`;
    const row = counts.get(id);
    if (row) row.count += 1;
    else
      counts.set(id, {
        kind: f.kind,
        severity: f.severity,
        count: 1,
        meaning: FLAG_MEANING[f.kind],
      });
  }
  return [...counts.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.count - a.count,
  );
}

/** One marker per flag, at the flag's own `world` point (the floor surface
 *  centre under its anchor cell), as ONE instanced draw. */
function buildFlagMarkers(
  ctx: Context,
  cubeGeo: Geometry,
  markerMat: Material,
  flags: readonly field.FieldFlag[],
): InstancedMesh {
  const im = mesh.createInstanced(ctx, {
    geometry: cubeGeo,
    material: markerMat,
    count: flags.length,
  });
  const packed = new Float32Array(16 * flags.length);
  const m = mat4.create();
  const noRotation = vec4.fromValues(0, 0, 0, 1);
  flags.forEach((f, i) => {
    const size = FLAG_SIZE[f.severity];
    const t = vec3.fromValues(f.world[0], f.world[1] + size / 2, f.world[2]);
    const s = vec3.fromValues(size, size, size);
    mat4.fromRotationTranslationScale(m, noRotation, t, s);
    packed.set(m, i * 16);
  });
  mesh.setInstanceMatrices(ctx, im, packed);
  flags.forEach((f, i) =>
    mesh.setInstanceTint(ctx, im, i, FLAG_COLOR[f.severity]),
  );
  return im;
}

/** A bucket's lit colour: its class colour, except a kit class's raw surface
 *  (the `backing` bucket — mortar behind the proud pieces) uses backingColor. */
function bucketColor(bucket: field.MeshBucket): Rgba {
  const cls = field.classOf(TABLE, bucket.classId);
  return cls.kind === "kit" && bucket.backing
    ? cls.kit.backingColor
    : cls.color;
}

/** A kit piece's instance tint: its KitStyle piece colour, jittered by the
 *  deterministic variant so neighbouring panels don't read as one slab. */
function pieceTint(k: field.KitInstance): Rgba {
  const cls = field.classOf(TABLE, k.classId);
  if (cls.kind !== "kit") return [1, 1, 1, 1];
  const [r, g, b, a] = cls.kit.pieceColors[PIECE_COLOR[k.piece]];
  const j = TINT_JITTER_BASE + TINT_JITTER_SPAN * k.variant;
  return [r * j, g * j, b * j, a];
}

/** One chunk's kit pieces as ONE instanced draw: a shared unit cube, each piece
 *  transformed by its (quarter-turn yaw · box) TRS at the chunk's origin. */
function buildKit(
  ctx: Context,
  cubeGeo: Geometry,
  kitMat: Material,
  key: field.ChunkKey,
  pieces: field.KitInstance[],
  cellSize: number,
): InstancedMesh {
  const im = mesh.createInstanced(ctx, {
    geometry: cubeGeo,
    material: kitMat,
    count: pieces.length,
  });
  const [cx, cy, cz] = field.parseChunkKey(key);
  const dim = field.CHUNK_DIM * cellSize;
  const packed = new Float32Array(16 * pieces.length);
  const m = mat4.create();
  pieces.forEach((k, i) => {
    const yaw = vec4.fromValues(0, Math.sin(k.yaw / 2), 0, Math.cos(k.yaw / 2));
    const t = vec3.fromValues(
      k.position[0] + cx * dim,
      k.position[1] + cy * dim,
      k.position[2] + cz * dim,
    );
    const s = vec3.fromValues(k.box[0], k.box[1], k.box[2]);
    mat4.fromRotationTranslationScale(m, yaw, t, s);
    packed.set(m, i * 16);
  });
  mesh.setInstanceMatrices(ctx, im, packed);
  pieces.forEach((k, i) => mesh.setInstanceTint(ctx, im, i, pieceTint(k)));
  return im;
}

async function buildScene(
  ctx: Context,
  store: field.FieldStore,
  dirty: ReadonlySet<field.ChunkKey>,
  flags: readonly field.FieldFlag[],
): Promise<SceneRef> {
  const scene: SceneRef = {
    cam: camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(
        ORBIT_CENTER[0],
        ORBIT_CENTER[1] + ORBIT_HEIGHT,
        ORBIT_CENTER[2] + ORBIT_RADIUS,
      ),
    }),
    meshes: [],
    instanced: [],
    geometries: [],
    materials: [],
    bindings: [],
  };
  camera.bindToCanvas(ctx, scene.cam);

  const litShader = await shader.lit(ctx);
  const matCache = new Map<string, Material>();
  const matFor = async (color: Rgba): Promise<Material> => {
    const cacheKey = color.join(",");
    const hit = matCache.get(cacheKey);
    if (hit) return hit;
    const b = binding.create(ctx, litShader);
    binding.set(ctx, b, { color: new Float32Array(color) });
    const mat = await material.create(ctx, { shader: litShader, binding: b });
    scene.bindings.push(b);
    scene.materials.push(mat);
    matCache.set(cacheKey, mat);
    return mat;
  };

  // One white-base lit-instanced material for ALL kit pieces (colour rides the
  // per-instance tint), sharing one unit-cube geometry across chunks.
  const litInstShader = await shader.litInstanced(ctx);
  const kitBinding = binding.create(ctx, litInstShader);
  binding.set(ctx, kitBinding, { color: vec4.fromValues(1, 1, 1, 1) });
  const kitMat = await material.create(ctx, {
    shader: litInstShader,
    binding: kitBinding,
  });
  scene.bindings.push(kitBinding);
  scene.materials.push(kitMat);
  const cubeGeo = geometry.cube(ctx, { size: 1 });
  scene.geometries.push(cubeGeo);

  // Rebuild each dirty chunk: one 20³ apron pair feeds BOTH the mesher (per-
  // class surface buckets) and the skinner (kit piece instances).
  for (const key of dirty) {
    const aprons = field.extractFieldAprons(store, key);
    const [cx, cy, cz] = field.parseChunkKey(key);
    const dim = field.CHUNK_DIM * store.cellSize;
    const origin = vec3.fromValues(cx * dim, cy * dim, cz * dim);
    for (const bucket of field.meshChunkField(aprons, TABLE, store.cellSize)
      .buckets) {
      const g = geometry.create(ctx, bucket.mesh);
      const handle = mesh.create(ctx, {
        geometry: g,
        material: await matFor(bucketColor(bucket)),
      });
      mesh.setPosition(ctx, handle, origin);
      scene.geometries.push(g);
      scene.meshes.push(handle);
    }
    const kit = field.skinChunkKit(aprons, TABLE, store.cellSize, key);
    if (kit.length > 0)
      scene.instanced.push(
        buildKit(ctx, cubeGeo, kitMat, key, kit, store.cellSize),
      );
  }

  // The advisory layer, drawn ON TOP of a field the analyzer never touched.
  if (flags.length > 0)
    scene.instanced.push(buildFlagMarkers(ctx, cubeGeo, kitMat, flags));
  return scene;
}

// The field is pure CPU data, so it is built and analysed BEFORE any GPU work —
// the flag tally is ready in time to be the controls panel's props.
field.validateMaterialTable(TABLE);
const { store, dirty } = buildField();
const analyzed = analyzeWalkability(store);

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    chunk: analyzed.chunk,
    total: analyzed.flags.length,
    rows: tallyFlags(analyzed.flags),
    stepHeight: AGENT.stepHeight,
    climbCeiling: AGENT.climbCeiling,
    clearance: AGENT.clearance,
    severityCss: FLAG_CSS,
  },
  setup: async (ctx) => {
    const scene = await buildScene(ctx, store, dirty, analyzed.flags);
    return {
      scene,
      dispose: () => {
        // Meshes first (they decrement geometry/material refcounts), then
        // materials, bindings, geometries — the instancing demo's order.
        for (const im of scene.instanced) mesh.destroyInstanced(ctx, im);
        for (const m of scene.meshes) mesh.destroy(ctx, m);
        for (const mat of scene.materials) material.destroy(ctx, mat);
        for (const b of scene.bindings) binding.destroy(ctx, b);
        for (const g of scene.geometries) geometry.destroy(ctx, g);
      },
    };
  },
  frame: ({ ctx, scene, info }) => {
    const angle = (info.elapsedMs / MS_PER_SEC) * ORBIT_SPEED;
    vec3.set(
      scratchCamPos,
      ORBIT_CENTER[0] + Math.sin(angle) * ORBIT_RADIUS,
      ORBIT_CENTER[1] + ORBIT_HEIGHT,
      ORBIT_CENTER[2] + Math.cos(angle) * ORBIT_RADIUS,
    );
    camera.setPosition(scene.cam, scratchCamPos);
    camera.setTarget(scene.cam, TARGET);
    frame.render(ctx, {
      meshes: scene.meshes,
      instanced: scene.instanced,
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
      lights: LIGHTS,
      ambient: AMBIENT,
    });
  },
});
