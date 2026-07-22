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

/** Smooth-effect parameters (research: the shipped voxel-plugin pattern).
 *  `strength` = MAX density delta per iteration per sample (int8 units,
 *  integer 1..64) — the max-delta clamp that doubles as the thin-wall-erosion
 *  guard. `iterations` (integer 1..4) re-runs the blur within the one
 *  application. `mode`: `erode` = remove bumps only (density may only rise
 *  toward air), `fill` = fill depressions only (density may only fall toward
 *  solid), `both` = unrestricted. */
export type SmoothParams = {
  strength: number;
  iterations: number;
  mode: "both" | "erode" | "fill";
};

/** The default {@link SmoothParams} — a gentle single-pass smooth. */
export const SMOOTH_DEFAULTS: SmoothParams = {
  strength: 16,
  iterations: 1,
  mode: "both",
};

/** One brush operation — the only way the field mutates. Bounded influence by
 *  construction. `effect` selects the channel work: `dig` opens air (density
 *  only), `fill` solidifies AND writes `material` on solid interior cells
 *  (cells solid after the fill — including ambient rock it leaves unchanged),
 *  `paint` retints solid cells inside the shape without changing density,
 *  `smooth` relaxes the density field toward its local 3³ mean inside the
 *  shape (density only; requires `smooth` params). `material` is the class
 *  fill writes / paint applies (defaults {@link MAT_ROCK} for fill; ignored by
 *  dig and smooth). `mask` filters the affected cells cross-cuttingly
 *  ({@link BrushMask}); `hollow` restricts a fill to a shell band (see
 *  `hollow` below). */
export type BrushOp = {
  id: number;
  kind: "brush";
  effect: "dig" | "fill" | "paint" | "smooth";
  shape: BrushShape;
  material?: number;
  mask?: BrushMask;
  smooth?: SmoothParams;
  /** Shell-band thickness in metres — FILL-effect only. A hollow fill writes
   *  only samples within `hollow` of the shape surface (positive-inside sdf in
   *  `(0, hollow]`); samples deeper inside are SKIPPED, never dug — the
   *  variant is NON-destructive. In air the result is a shell with an air
   *  interior (the cave use-case); over existing rock the interior rock stays
   *  (harmless, revealed only if dug). Kit-class fills require a positive
   *  multiple of 0.5 m so the shell's INNER faces land on lattice planes too. */
  hollow?: number;
};

/** One chunk's slice of a {@link PatchOp} — the cells it writes IN THAT CHUNK
 *  and nothing else. Masks are 4096-bit sets (512 bytes = `CHUNK_SAMPLES / 8`),
 *  bit index `lx + CHUNK_DIM·(ly + CHUNK_DIM·lz)` — the same x-fastest cell
 *  layout `localIndex` (in `chunks.ts`) defines for every other per-cell array.
 *  `density` holds one Int8 per SET `densityMask` bit, in ascending bit order;
 *  `materials` one GLOBAL class id per set `materialMask` bit, likewise — each
 *  value array tracks its OWN mask, so the two channels need not agree on which
 *  cells they write. A null `materialMask` (with null `materials`) = this slice
 *  writes no material. Validation rejects a slice whose masks are both empty,
 *  so a slice's key is always a chunk the op really writes. */
export type PatchChunk = {
  key: ChunkKey;
  densityMask: Uint8Array;
  density: Int8Array;
  materialMask: Uint8Array | null;
  materials: Uint8Array | null;
};

/** A patch op: ABSOLUTE masked per-cell writes — the semantic-compaction
 *  primitive (a run of plain dig/fill/paint ops folds into one patch without
 *  changing the field) and a procedural generator's emission form (the noise
 *  math stays in `evaluate`; the log keeps flat per-cell arrays in memory
 *  instead of re-deriving them). NOTE: those typed arrays have no WIRE encoding
 *  yet — `serializeOps` is still JSON, which mangles them; a compact on-disk
 *  form is a follow-up (see the MIGRATION note in `artifact.ts`). Bounded
 *  influence = exactly its masked cells, which is what makes replay byte-exact
 *  by construction: unlike a brush op it derives nothing from surrounding state,
 *  so it never bakes context in and never drifts when an UPSTREAM op is
 *  reconfigured. */
export type PatchOp = { id: number; kind: "patch"; chunks: PatchChunk[] };

/** How a stamp treats pre-existing air in its footprint: `replace` overwrites
 *  (default); `keep-existing-air` masks the shell fill solid-only so user
 *  carvings survive (compiles into the op record — replay-safe). */
export type MergePolicy = "replace" | "keep-existing-air";

/** One staged generator: JSON-Schema params (SchemaForm-compatible plain data —
 *  no array-typed fields, the form renders those as fallback), defaults, and a
 *  pure evaluate to a span of lattice-snapped brush ops (world coords).
 *  Emitted ops carry the placeholder id 0 — the committer assigns real log
 *  ids when the span is applied through the op log. */
export type GeneratorDef = {
  id: string;
  name: string;
  paramSchema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  evaluate(
    params: Record<string, unknown>,
    seed: number,
    region: { min: [number, number, number]; max: [number, number, number] },
    table: MaterialTable,
    policy: MergePolicy,
  ): BrushOp[];
};

/** One committed generator application — the log's smart-object record (L4).
 *  `opSpan` = [firstOpId, lastOpId] of the brush ops the commit appended, which
 *  sit immediately BEFORE the entity op in `log.ops` with sequential ids — the
 *  contiguity invariant `reconfigureGenerator` locates the span by and
 *  preserves. `entityId` equals the entity op's own log id and survives
 *  reconfigure unchanged (the span's ids do not: a reconfigured span takes fresh
 *  ones). */
export type GeneratorEntity = {
  entityId: number;
  type: "generator";
  generator: string;
  params: Record<string, unknown>;
  seed: number;
  region: { min: [number, number, number]; max: [number, number, number] };
  opSpan: [number, number];
  /** Frozen: reconfigure is blocked until unfrozen (cheap protection). Written
   *  by `setGeneratorFrozen`. The type is `true`, not `boolean`, so ABSENT is
   *  the only way to spell "not frozen" — unfreezing must `delete` the field;
   *  `frozen = false` does not type-check. */
  frozen?: true;
  /** Baked: the recipe is severed — reconfigure is gone permanently; the span
   *  ops are plain history eligible for compaction. Written by
   *  `bakeGeneratorEntity`, which also clears `frozen`. `true`-not-`boolean`
   *  for the same reason as `frozen`; no verb clears it, and only undo of the
   *  bake entry reverses it. */
  baked?: true;
};

/** One drifted/orphaned finding from a reconfigure replay (spec D-F3-4).
 *  `drifted` = the op replayed onto changed context, so its outcome differs from
 *  before the reconfigure; `orphaned` = the op replayed and wrote NOTHING at
 *  all. Orphaned wins when both would apply. */
export type DriftFinding = {
  opId: number;
  kind: "drifted" | "orphaned";
  /** Chunk-quantized location for jump-to-bounds UI: the op's written chunks
   *  ({@link FieldOp} bounded influence), every one of which is in the
   *  reconfigure's affected set. */
  chunks: ChunkKey[];
};

/** An entity operation in the one log (charter §2.2 — one log, one ordering,
 *  one undo system). F2b ships `place` for generator entities only. */
export type EntityOp = {
  id: number;
  kind: "entity";
  action: "place";
  entity: GeneratorEntity;
};

/** The field-op union: brush strokes, entity ops and patches share the log. */
export type FieldOp = BrushOp | EntityOp | PatchOp;

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

/** One undo/redo unit.
 *
 *  `ops` = an op LIST appended to the tail — a single brush op, or a generator
 *  commit's whole span + its entity op (one ⌘Z per commit, charter §2.3) —
 *  with the chunk pre-images taken before the list applied.
 *
 *  `splice` = an in-place span replacement (reconfigure): `at` is the index in
 *  `ops` where `removed` sat, and `before`/`after` are the affected chunks'
 *  FULL pre/post images. Undo and redo restore those bytes — they never
 *  re-execute the span.
 *
 *  `entity-update` = an in-place swap of one entity op's record at `opIndex`
 *  (freeze/bake); it touches no chunks, so it carries no images. */
export type LogEntry =
  | { kind: "ops"; ops: FieldOp[]; inverse: OpInverse }
  | {
      kind: "splice";
      at: number;
      removed: FieldOp[];
      inserted: FieldOp[];
      before: OpInverse;
      after: OpInverse;
    }
  | {
      kind: "entity-update";
      opIndex: number;
      before: EntityOp;
      after: EntityOp;
    };

/** The op log — `ops` in replay order, plus the two entry stacks.
 *
 *  Undo/redo are strictly LIFO: an entry's images assume the state produced by
 *  everything below it on the stack, so entries are only ever applied in stack
 *  order. `ops` entries cover the tail of `ops` when pushed — and, by the LIFO
 *  rule above, still do when undone (every append pairs with an undoStack push,
 *  so undo peels the tail by entry length); splice and entity-update entries
 *  restore positionally. */
export type OpLog = {
  ops: FieldOp[];
  undoStack: LogEntry[];
  redoStack: LogEntry[];
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
