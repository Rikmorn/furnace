import type { Vec3Tuple } from "../physics/types.ts";

/** Key of one 16³ chunk: `"cx,cy,cz"` in chunk coordinates. */
export type ChunkKey = string;

/** The sparse chunked density field. Missing chunk = uniform solid rock
 *  (the pay-only-for-dirty invariant). Densities are Int8, air-positive
 *  (>0 air, <0 rock, surface at 0 — the engine-wide field convention),
 *  quantized at DENSITY_SCALE per metre. */
export type FieldStore = {
  /** Sample spacing in metres (world position = sample index * cellSize). */
  readonly cellSize: number;
  readonly chunks: Map<ChunkKey, Int8Array>;
  /** Material channel; absent entry = uniform MAT_ROCK. */
  readonly materials: Map<ChunkKey, ChunkMaterials>;
};

/** Rock — the universal default material class (id 0). */
export const MAT_ROCK = 0;

/** Discriminates a material class by how it is rendered/skinned. */
export type MaterialKind = "organic" | "kit";

/** Kit-class render/skin parameters — catalog DATA, consumed by the generic
 *  skinner (the values W2 hardcoded in substrate/pieces.ts, ported out). */
export type KitStyle = {
  panelProud: number;
  panelReveal: number;
  collarSection: number;
  /** Backing-bucket (mortar / "stone inside the wall") surface color. */
  backingColor: [number, number, number, number];
  pieceColors: {
    panel: [number, number, number, number];
    floor: [number, number, number, number];
    trim: [number, number, number, number];
    collar: [number, number, number, number];
  };
};

/** The kit-piece kinds the skinner emits: wall `panel`, `floorTile` (an
 *  exposed +y face) / `ceilTile` (exposed −y face), corner `post`, and the
 *  collar `rimPostV` / `rimEdgeH` at suppressed↔kept junctions (Task 5). */
export type KitPieceId =
  | "panel"
  | "floorTile"
  | "ceilTile"
  | "post"
  | "rimPostV"
  | "rimEdgeH";

/** One kit piece instance, CHUNK-LOCAL position (metres), exact quarter-turn
 *  yaw, box dims from the kit style, deterministic variant value in [0,1). */
export type KitInstance = {
  piece: KitPieceId;
  classId: number;
  position: [number, number, number];
  yaw: number;
  box: [number, number, number];
  variant: number;
};

/** One resolved material class: an organic (raw-surface) class or a kit
 *  (skinned) class carrying its {@link KitStyle} catalog data. */
export type MaterialClass =
  | {
      id: number;
      name: string;
      kind: "organic";
      color: [number, number, number, number];
    }
  | {
      id: number;
      name: string;
      kind: "kit";
      color: [number, number, number, number];
      kit: KitStyle;
    };

/** The resolved material table: classes indexed by id (classes[i].id === i;
 *  class 0 is organic rock). Validated by validateMaterialTable. */
export type MaterialTable = { classes: MaterialClass[] };

/** Per-chunk material storage: uniform (one class — the elision analogue) or
 *  indexed (per-chunk palette + bit-packed per-cell indices). Encoding is
 *  PRIVATE — all reads/writes go through the materials.ts accessors. */
export type ChunkMaterials =
  | { kind: "uniform"; classId: number }
  | { kind: "indexed"; palette: Uint8Array; bits: number; packed: Uint8Array };

/** A brush's spatial extent — the bounded influence, implied by the shape. */
export type BrushShape =
  | { kind: "sphere"; center: [number, number, number]; radius: number }
  | {
      kind: "box";
      center: [number, number, number];
      halfExtents: [number, number, number];
    };

/** A brush op's cross-cutting cell filter, evaluated per sample during
 *  application after the effect's own guards. Part of the OP RECORD: a masked
 *  op replays identically — a selection mask embeds its deterministic
 *  {@link SelectionSpec}, re-materialized against pre-op state at each
 *  application. `solid-only` is the keep-existing-air merge policy's building
 *  block; the class kinds resolve against the material table the op is
 *  applied with, and fail CLOSED on a cell whose stored material id is
 *  missing from that table (the cell is skipped — never a mid-application
 *  throw). */
export type BrushMask =
  | { kind: "organic-only" }
  | { kind: "kit-only" }
  | { kind: "class"; classId: number }
  | { kind: "solid-only" }
  | { kind: "selection"; selection: SelectionSpec };

/** One brush operation — the only way the field mutates. Bounded influence by
 *  construction. `effect` selects the channel work: `dig` opens air (density
 *  only), `fill` solidifies AND writes `material` on solid interior cells
 *  (cells solid after the fill — including ambient rock it leaves unchanged),
 *  `paint` retints solid cells inside the shape without changing density.
 *  `material` is the class fill writes / paint applies (defaults {@link
 *  MAT_ROCK} for fill; ignored by dig). `mask` filters the affected cells
 *  cross-cuttingly ({@link BrushMask}). */
export type BrushOp = {
  id: number;
  kind: "brush";
  effect: "dig" | "fill" | "paint";
  shape: BrushShape;
  material?: number;
  mask?: BrushMask;
};

/** One committed generator application — the log's smart-object record (L4).
 *  `opSpan` = [firstOpId, lastOpId] of the brush ops the commit appended.
 *  Reconfigure/re-evaluate is F3; F2b records full provenance. */
export type GeneratorEntity = {
  entityId: number;
  type: "generator";
  generator: string;
  params: Record<string, unknown>;
  seed: number;
  region: { min: [number, number, number]; max: [number, number, number] };
  opSpan: [number, number];
};

/** An entity operation in the one log (charter §2.2 — one log, one ordering,
 *  one undo system). F2b ships `place` for generator entities only. */
export type EntityOp = {
  id: number;
  kind: "entity";
  action: "place";
  entity: GeneratorEntity;
};

/** The field-op union: brush strokes and entity ops share the log. */
export type FieldOp = BrushOp | EntityOp;

/** A selection's DEFINITION — deterministic and replay-safe: floods re-evaluate
 *  against the replayed field state, so an op embedding a spec replays
 *  identically (the mask contract). Region coords are world metres; flood
 *  seeds are voxel sample ints. */
export type SelectionSpec =
  | {
      kind: "region";
      min: [number, number, number];
      max: [number, number, number];
    }
  | {
      kind: "flood-material";
      seed: [number, number, number];
      classId: number;
      budget: number;
    }
  | { kind: "flood-void"; seed: [number, number, number]; budget: number };

/** A materialized selection: region kinds stay predicates (no cell storage);
 *  floods carry chunk-keyed bitsets (4096 bits per chunk, bit index
 *  lx + 16·(ly + 16·lz)). `count` = selected cells; `truncated` = the budget
 *  capped the flood (surfaced in the UI — never silent). `bounds` are SAMPLE
 *  ints (callers convert to metres via cellSize); null when nothing selected. */
export type MaterializedSelection =
  | {
      kind: "region";
      min: [number, number, number];
      max: [number, number, number];
    }
  | {
      kind: "cells";
      chunks: Map<ChunkKey, Uint8Array>;
      count: number;
      truncated: boolean;
      bounds: {
        min: [number, number, number];
        max: [number, number, number];
      } | null;
    };

/** Pre-image of one touched chunk's BOTH channels, captured before the op's
 *  first write to that chunk. `density: null` = the chunk was unallocated;
 *  `materials: null` = the chunk had no material entry (uniform {@link
 *  MAT_ROCK}). Undo restores each channel or deletes the map entry on null. */
export type ChunkSnapshot = {
  density: Int8Array | null;
  materials: ChunkMaterials | null;
};

/** Inverse deltas for one applied op: two-channel pre-images of every chunk the
 *  op touched, keyed by chunk. Chunk-keyed undo per the charter. */
export type OpInverse = Map<ChunkKey, ChunkSnapshot>;

/** Append-only op log. An undo entry covers an op LIST — a single brush op, or
 *  a generator commit's whole span + its entity op (one ⌘Z per commit,
 *  charter §2.3). Invariant: undo entries cover the tail of `ops` in order —
 *  every `ops` append must pair with an undoStack push, so undo can peel the
 *  tail by entry length. */
export type OpLog = {
  ops: FieldOp[];
  undoStack: { ops: FieldOp[]; inverse: OpInverse }[];
  redoStack: FieldOp[][];
  nextId: number;
};

/** Mesh buffers for one chunk, positions in CHUNK-LOCAL metres. */
export type ChunkMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
};

/** The 20³ (samples −2..17) apron pair — the mesher's + skinner's shared input
 *  window. `materials` holds GLOBAL class ids (the per-chunk palette encoding
 *  never crosses the wire). */
export type FieldAprons = { density: Int8Array; materials: Uint8Array };

/** One per-class chunk mesh bucket. `backing` marks kit-owned surface (the
 *  mortar / "stone inside the wall" surface behind proud kit pieces); it is
 *  false for every organic class. */
export type MeshBucket = { classId: number; backing: boolean; mesh: ChunkMesh };

/** The per-class partition of one chunk's surface: the mesher's owned crossings
 *  split into render buckets by the owning (solid-side) material class. */
export type FieldChunkMeshes = { buckets: MeshBucket[] };

/** Voxel collider for one chunk: corner-anchored local grid ints + cell
 *  size, matching the physics `voxels` shape descriptor. */
export type ChunkCollider = {
  coords: Int32Array;
  size: Vec3Tuple;
  /** World position of the chunk's (0,0,0) sample corner. */
  position: [number, number, number];
};

/** v2 field-world manifest (kind discriminates from the v1 region world). The
 *  material fields are ADDITIVE within version 2: all optional, so a manifest
 *  that omits them (mesh entries without `classId`/`backing`, no `materials` /
 *  `kit` / `materialTable`) is a valid F1-shaped bake — the loader defaults an
 *  absent `classId` to {@link MAT_ROCK}. */
export type FieldManifest = {
  version: 2;
  kind: "field";
  cellSize: number;
  playerStart: [number, number, number];
  playerYaw: number;
  chunks: { key: ChunkKey; file: string }[];
  meshes: {
    key: ChunkKey;
    file: string;
    origin: [number, number, number];
    /** Solid-side material class of this bucket. Absent (F1 bake) = organic
     *  {@link MAT_ROCK}. */
    classId?: number;
    /** True for a kit BACKING bucket (the raw surface behind proud kit pieces);
     *  absent/false for organic classes. */
    backing?: boolean;
  }[];
  /** Material sibling files — only chunks with a real non-rock material
   *  presence (a uniform-rock chunk emits none). */
  materials?: { key: ChunkKey; file: string }[];
  /** Kit instance files — only chunks that hold kit pieces. */
  kit?: { key: ChunkKey; file: string }[];
  /** The resolved material table, embedded so the artifact is self-contained. */
  materialTable?: MaterialTable;
};
