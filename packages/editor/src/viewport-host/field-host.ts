// FieldHost: the F1 dig-loop surface. It owns its canvas context, camera,
// render loop, and the field session (store + op log + dirty-set + remesh
// client). React chrome talks to it via methods; the host is FREE of React. It
// runs a continuous rAF (fly movement integrates per frame and the dirty-set
// drains across frames) and creates NO physics world (colliders are derived at
// dungeon-load time, T11).
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
import {
  type AnalyzeInput,
  AnalyzerWorkerClient,
  createAnalyzePump,
} from "../frontend/lib/analyzer-client.ts";
import type {
  EntityArchetype,
  EntityCatalog,
  EntityCollision,
} from "../frontend/lib/catalog.ts";
import {
  type BrushEffect,
  computeBrushCenter,
  latticeClearance,
  nudgeRegion,
  regionSampleCount,
  snappedKitBox,
  snapSpan,
  spanCells,
} from "../frontend/lib/field-brush.ts";
import {
  FieldWorkerClient,
  type WorkerLike,
} from "../frontend/lib/field-client.ts";
import { openBlockedReason } from "../frontend/lib/field-entity.ts";
import type { WireBucket } from "../frontend/lib/field-protocol.ts";
import { deriveSizeDefaults } from "../frontend/lib/field-size.ts";
import { boxCentre, boxEdges } from "./box-edges.ts";
import {
  dolly,
  flyLook,
  flyMove,
  frameBox,
  type OrbitState,
  orbitAbout,
  snapToAxis,
  toEyeTarget,
} from "./camera-control.ts";
import {
  bankDolly,
  flySpeed,
  lookDeltas,
  readFlyMove,
} from "./field-camera.ts";
import {
  createFlagStore,
  type FlagFilters,
  type FlagRow,
  type FlagsSummary,
  flagCellBox,
  flagMarkerCenter,
  flagMarkerStyle,
  INFO_TINT,
} from "./field-flags.ts";
import {
  boxCorners,
  crossSegments,
  GHOST_COLOR,
  generatorFootprint,
  segmentGhostSegments,
  sphereGhostSegments,
} from "./field-ghost.ts";
import { type FieldHistory, fieldHistory } from "./field-history.ts";
import {
  advanceMove,
  type MoveDrag,
  moveIsIdle,
  movePoint,
  reanchored,
  resolveMapping,
  startMove,
  unanchored,
} from "./field-move.ts";
import { type PickCandidate, pickNearest } from "./field-pick.ts";
import {
  ARCHETYPE_PARAM,
  FALLBACK_COLLISION,
  FALLBACK_TINT,
  groupPlacements,
  type PlacedArchetype,
  PROXY_PRIMITIVE,
  placementGhostBatch,
  placementOwners,
  placementsByEntity,
  placesProps,
  proxyRecords,
  proxyScale,
  seedArchetypeParams,
  touchedParamKeys,
  withArchetypeOptions,
} from "./field-placements.ts";
import {
  SELECTION_DISPLAY_CAP,
  selectionDisplayCells,
} from "./field-selection-cells.ts";
import {
  createPreviewCoalescer,
  previewIsEmpty,
  type StampSession,
  startReconfigureSession,
  startSession,
  toPreviewing,
  withoutMoving,
  withParams,
  withPreviewError,
  withPreviewResult,
  withRegion,
} from "./field-stamp.ts";
import {
  type Axis,
  axisLines,
  type GizmoSpan,
  gizmoSpan,
  pickAxis,
} from "./gizmo.ts";
import { arrowNudgeSteps } from "./input-map.ts";
import { buildGridLines, segmentsToBatch } from "./reference-grid.ts";
import {
  cursorAffordance,
  type ViewportCursor,
  viewportCursor,
} from "./viewport-cursor.ts";

/** How the field is lit. `studio` is the DEFAULT and the state of seeing (D-F4.5-17):
 *  per-class lit materials under a camera-following key light plus a hemisphere fill,
 *  so form and material read at once. `normals` is a named DEBUG flag — unlit
 *  normal-colour, which shows structure and nothing else (every class looks identical). */
export type FieldHostShading = "studio" | "normals";

/** The orbit camera's orientation, in radians ({@link FieldHost.subscribeCameraPose}).
 *  Orientation only: distance and target don't change which way the axes point, which is
 *  all the corner triad draws. */
export type CameraPose = { yaw: number; pitch: number };

/** The pending segment, in metres ({@link FieldHost.subscribeSegmentHud}) — how long the
 *  capsule the next click would sweep is, and how long it is allowed to be.
 *
 *  There is no `anchored` flag because `null` already IS that answer: the seam pushes
 *  `null` for "no point is down", and a record whose fields describe a segment that does
 *  not exist would be a second spelling of the same state.
 *
 *  `capM` rides in the payload rather than being a number the chrome writes down: it is
 *  {@link FieldHost}'s own cap, and this is the seam that carries it at runtime. */
export type SegmentHud = { lenM: number; capM: number };

/** The panel's mask choice for the active brush — maps onto a core BrushMask
 *  at op-build time. `none` = unmasked; `selection` embeds the host's current
 *  selection spec (no selection → the mask is dropped and reported via
 *  subscribeToolError once per stroke). Mirrors {@link field.BrushMask} minus
 *  `solid-only` (a merge-policy building block, not a user-facing brush mask). */
export type FieldMaskChoice =
  | { kind: "none" }
  | { kind: "organic-only" }
  | { kind: "kit-only" }
  | { kind: "class"; classId: number }
  | { kind: "selection" };

/** Which brush the pointer applies: `dig` opens air, `fill` solidifies + writes
 *  a material, `paint` retints solid cells, `smooth` relaxes the density field
 *  (material-free). `materialId` is the class fill/paint write (ignored by dig
 *  and smooth). `mask` filters affected cells; `smooth` carries the smooth
 *  effect's params (present on every tool, used only when effect is smooth);
 *  `hollow` is the fill-only shell-band thickness in metres (`null` = solid
 *  fill). */
export type FieldTool = {
  effect: BrushEffect;
  materialId: number;
  mask: FieldMaskChoice;
  smooth: {
    strength: number;
    iterations: number;
    mode: "both" | "erode" | "fill";
  };
  hollow: number | null;
};

/** What {@link FieldHost.subscribeTool} pushes: the effective tool AND the brush
 *  radius.
 *
 *  TWO FIELDS RATHER THAN A RADIUS INSIDE {@link FieldTool}, and the reason is the
 *  momentary overrides — stated precisely, because the obvious version of it is wrong.
 *  `deriveMomentary` SPREADS the saved tool (`{ ...momentarySaved, effect }`), so a
 *  radius inside `FieldTool` would survive the press intact. The defect is on RELEASE:
 *  that path assigns `tool = momentarySaved` wholesale, so any resize made while the
 *  modifier was held would be silently reverted — the brush changing size because the
 *  user let go of ⇧. The radius is not part of what a modifier changes, so it rides
 *  ALONGSIDE.
 *
 *  It rides this seam rather than {@link FieldStats} or a seam of its own for the
 *  reason `FieldStats.voidCastPending` gives from the other side: the seams are
 *  single-slot, so a new one is a new thing to claim exactly once — and unlike that
 *  flag, radius is USER-paced (a slider drag, a wheel notch, `[` / `]`), which is
 *  this seam's cadence and emphatically not the frame-paced stats push. Folding a
 *  user-paced value into the frame-paced one is the thing `useFieldHostState`'s
 *  header is built to avoid. */
export type FieldToolPush = {
  tool: FieldTool;
  /** The brush/capsule radius in metres, clamped (`clampRadius`). */
  radius: number;
};

/** Which selection gesture LMB performs while a selection mode is armed:
 *  `box` = two clicks spanning a lattice-snapped region; `material` = flood
 *  the same-class solid from the hit voxel; `void` = flood the air pocket the
 *  cursor ray crosses just before its hit. */
export type SelectionMode = "box" | "material" | "void";

/** What an LMB click DOES in the viewport — ONE slot, so arming any of these
 *  disarms the others: `pointer` (select the ENTITY under the cursor — the
 *  DEFAULT a host opens armed with, D-F4.5-7), a {@link SelectionMode} gesture,
 *  the two-click `segment` brush (D-F3-14: anchor, then commit ONE swept-capsule
 *  op with the active tool's effect/material — dig carves a tunnel, fill raises
 *  a rampart), or `null` for a plain brush stroke.
 *
 *  `segment` is a BRUSH gesture, not a selection: it makes no selection, and
 *  the brush parameters (radius = the capsule radius, effect, material, mask)
 *  stay live under it — which is why the panel keeps the brush inspector open
 *  for `segment` and hides it for the cell-selection modes and for `pointer`.
 *
 *  `pointer` selects OBJECTS (an entity, or a prop/marker that resolves to
 *  one); the three {@link SelectionMode}s select CELLS. Two different kinds of
 *  selection sharing one slot because they share one button. */
export type ViewportGesture = SelectionMode | "segment" | "pointer";

/** A stamp armed for REGION-DRAW: the generator {@link FieldHost.startStamp}
 *  picked with nothing selected, waiting on the two clicks that span its region
 *  (D-F4.5-7). `name` is the generator's display name, carried so every surface
 *  that names the arm names the same one — see
 *  {@link FieldHost.subscribePendingStamp}.
 *
 *  Deliberately NOT a {@link ViewportGesture} member. The arm is modal ON TOP of
 *  the gesture — LMB routes here first while it stands — so `gesture` keeps
 *  naming what the button does underneath and there is nothing to restore when
 *  the arm ends. Folding it into the one-armed slot would also desynchronise the
 *  chrome, which OWNS `gesture` and pushes it one way. */
export type PendingStamp = { id: string; name: string };

/** The panel's view of the host's current selection. `spec` is the replayable
 *  selection spec (the same object shape a selection-masked op embeds);
 *  `count` = selected cells for flood kinds, and for a `region` the number of
 *  sample lattice points inside the metre AABB (min-inclusive/max-exclusive
 *  per axis — the exact set core's selectionHas region test admits);
 *  `truncated` = the flood hit SELECTION_UI_BUDGET (always false for regions);
 *  `aabb` = metre bounds enclosing the selection (a flood's cell bounds
 *  expanded to whole voxel volumes, a region's own min/max), null when the
 *  selection is empty. Count/aabb are a CLICK-TIME snapshot — ops re-
 *  materialize the spec against pre-op state, so later field edits can drift
 *  from the displayed numbers until the next selection. */
export type SelectionInfo = {
  spec: field.SelectionSpec;
  count: number;
  truncated: boolean;
  aabb: { min: [number, number, number]; max: [number, number, number] } | null;
  /** How many of `count` cells the viewport is actually DRAWING as cubes, present
   *  only when the display was capped (`SELECTION_DISPLAY_CAP`) and therefore only
   *  on `cells` selections. Absent means "what you see is all of it" — including
   *  for a region, whose display is its box and is never partial. The chrome says
   *  so on the status chip; a display that quietly showed a third of a flood would
   *  be a selection the user cannot trust. */
  displayed?: number;
};

/** One registry generator as the panel sees it ({@link FieldHost.listGenerators}):
 *  core's GeneratorDef minus its evaluate. `paramSchema` feeds the stamp form
 *  (Task 15) — augmented with the installed entity catalog's ids where the
 *  generator takes an `archetypeId`, so it is the registry's schema plus what
 *  only the HOST knows; `defaults` seed its initial params. */
export type FieldGeneratorInfo = {
  id: string;
  name: string;
  paramSchema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  /** Whether this generator PLACES props — core's own `GeneratorDef.emits`
   *  declaration, through `field-placements.ts`'s `placesProps` (D-F4-15).
   *  Carried host-side because the chrome cannot value-import core to read the
   *  registry itself. The stamp form reads it to decide whether a props count
   *  means anything: a carver's is always 0 and showing it is noise. */
  placesProps: boolean;
  /** Whether this generator READS its seed — core's own `GeneratorDef.usesSeed`
   *  declaration, passed through unchanged. Carried for `placesProps`'s reason
   *  (the chrome cannot read the registry), and the session card gates its seed
   *  row and ⚄ re-roll on it: a hall's seed changes nothing, so a field and a
   *  button for it are two controls that do nothing when pressed. */
  usesSeed: boolean;
};

/** One committed generator entity as the panel sees it
 *  ({@link FieldHost.listEntities}): core's `GeneratorEntity` clone plus what
 *  that entity's span PLACED. Host-derived for the same reason
 *  {@link FieldGeneratorInfo.placesProps} is — the attribution needs the op LOG,
 *  which the chrome does not have. */
export type FieldEntityInfo = field.GeneratorEntity & {
  /** One entry per archetype this entity's placement records name, with that
   *  archetype's record count, in first-seen order. EMPTY for everything that
   *  places nothing (every carver), which is also the entities list's test for
   *  whether a row has a prop line to show at all. */
  placed: PlacedArchetype[];
};

/** The standing reconfigure drift report as the chrome reads it
 *  ({@link FieldHost.subscribeDrift}): core's findings plus the ANSWER to the one
 *  question a palette row asks of them.
 *
 *  `entityIds` is derived rather than carried, and derived HERE rather than in the
 *  chrome, because both of its inputs are the host's: the findings' chunk keys and
 *  every entity's footprint box. Quantizing one into the other's space needs
 *  `CHUNK_DIM` and `store.cellSize`, which the chrome cannot value-import core to
 *  reach — so the alternative was publishing every entity's whole chunk box down
 *  the entity list for the chrome to intersect, which is a per-entity allocation
 *  growing with the CUBE of region size (a 200 m region is ~133k keys) paid on
 *  every `listEntities()` call, for a question that is only ever asked while a
 *  report is standing. One derived set, computed at push time, replaces it. */
export type FieldDriftReport = {
  findings: field.DriftFinding[];
  /** The committed entities whose FOOTPRINT box overlaps some finding's chunks —
   *  the rows that wear a drift badge.
   *
   *  Chunk-granular and therefore an OVER-approximation on both sides: the box is
   *  the union of the span's op bounds rather than the cells it wrote, and a chunk
   *  counts as touched when the box reaches any part of it. The badge means "the
   *  last reconfigure disturbed something where this stamp is", which over-
   *  inclusion keeps true; under-inclusion would silently drop the pointer. */
  entityIds: number[];
};

/** The host's live stats readout ({@link FieldHost.subscribeStats}, pushed
 *  every rAF). `remeshVersion` is a monotonic counter bumped on every remesh
 *  COMPLETION: an event-driven "a remesh landed" signal that survives
 *  `lastRemeshMs` being a clock read (Safari clamps `performance.now()` to
 *  ~1 ms, so consecutive remeshes can quantize identically and a
 *  value-equality guard would miss them).
 *
 *  It was introduced as the panel's entity-refresh trigger and NO LONGER HAS
 *  that consumer — F3a moved entity refresh onto {@link
 *  FieldHost.subscribeEntities}, a real signal rather than a proxy. The counter
 *  is kept because it is the only honest "the field changed" tick the stats
 *  carry; whoever next touches this readout should either give it a consumer or
 *  delete it. */
export type FieldStats = {
  chunks: number;
  lastRemeshMs: number;
  remeshVersion: number;
  /** Op-cost meter fields (spec D-F3-16), lifted from core's
   *  {@link field.logStats}: `totalOps` = the whole log's length;
   *  `liveGenerators` = entities whose recipe is intact; `compactableOps` = what
   *  the next load's compaction COULD fold once `compactableOps` crosses
   *  `COMPACT_THRESHOLD_OPS` (the ceiling — nothing pinned, matching the
   *  load-time call's empty `keepIds`; below the threshold the next load folds
   *  nothing while this stays non-zero, which is the meter climbing toward that
   *  point); `undoDepth` = the history that compaction requires empty, and what
   *  {@link FieldHost.undo} has left to step; `redoDepth` the same for
   *  {@link FieldHost.redo} (both are what a chrome Undo/Redo control reads to
   *  know whether it has anything to do).
   *  Recomputed only when the log changed (an O(ops) scan is not a per-frame
   *  cost) — see the tick's log-signature gate. */
  totalOps: number;
  liveGenerators: number;
  compactableOps: number;
  undoDepth: number;
  redoDepth: number;
  /** Wall-clock of the last LANDED {@link FieldHost.applyReconfigure}, ms
   *  (0 = none has run this session; a reconfigure core REJECTED does not update
   *  it). The reconfigure stall grows with the LOG, so this is the meter's
   *  honest read on how heavy the recipe has become. */
  lastReconfigureMs: number;
  /** Walkability-advisor passes the host is still owed an answer for: 1 for a
   *  posted-and-unanswered pass, plus 1 for edits queued behind it. 0 means the
   *  flag markers describe the field as it stands. Never above 2 — the analyze
   *  pump is a latest-wins latch, so at most one pass is in flight and everything
   *  behind it collapses into one re-fire.
   *
   *  Counts work the pump would actually RUN, not flags the host happens to hold.
   *  Two states set a flag and owe nothing: no agent profile in hand — whether
   *  none was ever installed or the catalog fetch has not landed yet (see
   *  {@link FieldHost.setAgentProfile}) — where nothing is ever posted; and a
   *  world with no chunks in it, where the pending whole-world pass has nothing
   *  to analyse until something is dug or loaded. Both read 0. */
  analyzerPending: number;
  /** Whether a void cast (D-F3-15) is posted and unanswered — the X-ray's whole-world
   *  worker job, which is the only edit-loop job long enough for a user to wonder about.
   *  A BOOLEAN rather than a count: `requestVoidCast` refuses a second one while the
   *  first stands, so there is never more than one.
   *
   *  It rides the stats push rather than a subscription of its own for two reasons. The
   *  seams are single-slot, so a fourteenth would be a fourteenth thing to claim exactly
   *  once — and this fact has no consumer that does not already read stats. What it
   *  BUYS is legibility for a refusal that already ships: "a void cast is still building
   *  — re-tick the void layer once it lands" names a state nothing on screen showed,
   *  and toggling off-and-on is exactly the sequence a user with no in-flight signal
   *  performs.
   *
   *  Stays true across a `discardVoidCast`, and truthfully: the discard strands the
   *  RESULT, it does not call the worker off. */
  voidCastPending: boolean;
};

/** Per-layer render visibility. `field` = the per-class bucket surface meshes;
 *  `kit` = the instanced kit pieces; `props` = the instanced placed-prop proxies
 *  (committed placement records); `ghost` = the brush ghost (cube + lines) + the
 *  stamp session's hologram preview + its placement wireframes + the segment
 *  brush's pending anchor and capsule outline (a preview of a brush op, so it
 *  rides with the other ghosts, not with `selection`); `selection` = the amber
 *  selection overlay + pending box anchor + the amber-dim entity highlight box;
 *  `grid` = the reference grid (minor + major); `flags` = the walkability
 *  advisor's severity markers (D-F4-9). Display-only — hiding a layer never
 *  affects targeting, ops, or bakes. Hiding `flags` in particular does not stop
 *  the analyzer: the findings keep arriving and {@link
 *  FieldHost.subscribeFlags} keeps firing, exactly as a hidden `selection` layer
 *  keeps masking ops.
 *
 *  All default true EXCEPT `voidCast` (D-F3-15), which is a view MODE wearing a
 *  layer's clothes: the X-ray that meshes the field's negative space, so a cave
 *  network reads as a solid from outside. Unlike the other six it names no
 *  resident GPU state — its meshes exist only while it is on, and they are
 *  BUILT by its false→true edge (one all-chunk worker job) and DROPPED by the
 *  next field mutation, which reports the drop on
 *  {@link FieldHost.subscribeToolError}. A cast is therefore a snapshot of the
 *  field at the moment it was enabled; re-toggle to refresh. See
 *  {@link FieldHost.setLayers}. */
export type FieldLayers = {
  field: boolean;
  kit: boolean;
  props: boolean;
  ghost: boolean;
  selection: boolean;
  grid: boolean;
  flags: boolean;
  voidCast: boolean;
};

/** How loud a {@link FieldHost.subscribeToolError} message is.
 *
 *  `error` is the default and every REFUSAL's severity — something the user asked for
 *  did not happen. `warn` is for the report that is not a refusal at all: the advisor
 *  standing down because the project installs no agent profile is a fact about the
 *  project, and reporting it as an error opened a clean boot with a red unread badge.
 *
 *  The strings are the chrome's `NotifySeverity` members verbatim, so the toast tone,
 *  the fade rule and the ⚠ chip's count all follow from this one word without a
 *  translation table in between. */
export type ToolErrorSeverity = "warn" | "error";

export type FieldHost = {
  /** Acquires the GPU context on `canvas`, builds the materials and starts the render
   *  loop. Throws if a context already exists — one host, one live canvas.
   *
   *  `sampleCount` is the scene pass's MSAA (default 4; `1` = off), and it is fixed for
   *  the context's life: changing it is a `dispose()` + `init()` on the same host, which
   *  is exactly what the View popover's AA switch does. Everything the editor cannot
   *  rebuild — the field store, the op log, the tool, the camera, the selection — is CPU
   *  state that survives a dispose; only GPU objects are torn down, and `init` puts back
   *  what depended on them: every allocated chunk is re-marked for re-meshing, and a
   *  ticked void layer re-requests its cast.
   *
   *  ONE thing does not survive: a live stamp session dies with its ghost, announced
   *  through {@link subscribeStamp} so the chrome sees it go. A round trip taken with a
   *  stamp open therefore discards it. */
  init(
    canvas: HTMLCanvasElement,
    opts?: { sampleCount?: 1 | 4 },
  ): Promise<void>;
  dispose(): void;
  newWorld(): void;
  /** Loads a previously saved world (manifest + chunk bytes + material siblings + ops). */
  loadWorld(data: {
    manifest: field.FieldManifest;
    chunks: { key: string; bytes: Uint8Array }[];
    /** Material sibling files — optional so an F1 (rock-only) world still loads. */
    materials?: { key: string; bytes: Uint8Array }[];
    /** Raw oplog.json text (null when the world has none). Parsed inside the
     *  host via field.parseOps so legacy F1 `kind:"dig"` ops map forward to
     *  brush/dig — the chrome can't call parseOps itself (type-only imports). */
    oplog: string | null;
  }): void;
  setDigRadius(r: number): void;
  setShading(mode: FieldHostShading): void;
  /** Selects the active brush (effect + material class + mask + smooth params
   *  + hollow). Default dig/rock, unmasked, solid fill. The chassis is the
   *  enforcement point for parameter ranges: smooth strength/iterations are
   *  clamped to the core ceilings and `hollow` is clamped to ≥ 0.5 m (core
   *  accepts any hollow > 0 — it cannot clamp against cellSize — but a
   *  sub-cell shell band on organic shapes can produce holey shells, and 0.5
   *  matches the UI's step). */
  setTool(tool: FieldTool): void;
  /** Subscribes to HOST-initiated tool changes (eyedropper, momentary
   *  Shift/Ctrl enter/leave) so the chrome can mirror them. NOT fired for a
   *  plain chrome setTool — EXCEPT when that setTool lands while a momentary
   *  modifier is held: that re-derives the effective tool and DOES fire,
   *  carrying the DERIVED tool (not what the chrome set), so the mirror must
   *  value-compare against its own state before re-pushing (echo guard).
   *  Single subscriber (the shell's host-state provider, which publishes the
   *  mirror and the `setTool` funnel together at `useFieldTool` — they are one
   *  concern precisely because of that guard); returns an unsubscribe. */
  subscribeTool(cb: (push: FieldToolPush) => void): () => void;
  /** Subscribes to the host's user-facing messages: swallowed stroke failures (kit
   *  fill off the lattice, unknown material class — F2a buried these in
   *  console.warn; the console trail stays) and the selection-mask-without-a-
   *  selection drop (reported once per pointer-down stroke, re-armed on the
   *  next stroke, so a drag can't spam at stroke rate). Single subscriber
   *  (the shell's host-state provider, which posts each message as a toast);
   *  returns an unsubscribe.
   *
   *  Each message carries its {@link ToolErrorSeverity}. Every refusal on this
   *  seam is an `error` — the whole seam was, until the advisor-idle report
   *  ({@link setAgentProfile}) proved it needed a volume below that. */
  subscribeToolError(
    cb: (msg: string, severity: ToolErrorSeverity) => void,
  ): () => void;
  /** Arms what an LMB click does ({@link ViewportGesture}): `pointer` (entity
   *  select — what a fresh host is ALREADY armed with), a cell-selection
   *  gesture (`box`/`material`/`void`), the two-click `segment` brush, or
   *  `null` for a plain brush stroke. ONE slot — arming any gesture disarms
   *  the one before it. A gesture governs only the GESTURE: an existing cell
   *  selection persists across changes (it keeps masking ops until cleared),
   *  and so does the entity selection ({@link subscribeEntitySelection}).
   *  Any pending box OR segment anchor is dropped on a change.
   *  Esc cancels a pending SEGMENT anchor (only when no stamp session owns the
   *  key); the gestures deliberately have no keyboard shortcuts —
   *  selection clear is the panel button. */
  setGesture(gesture: ViewportGesture | null): void;
  /** Clears the current selection into the Reselect slot (and drops a pending
   *  box anchor); subscribers are notified with null. */
  clearSelection(): void;
  /** Photoshop Reselect: swaps the current selection with the one-deep
   *  previous slot — restores what the last clear/replace displaced. After a
   *  REPLACE, pressing again toggles between the two selections; after a
   *  CLEAR, the swap parks null in the slot, so a second press is a no-op
   *  (there is no cleared state to toggle back to). No-op when the slot is
   *  empty. */
  reselect(): void;
  /** Subscribes to selection changes (null = no selection). Immediately
   *  pushes the CURRENT state on subscribe, so a surface that (re)mounts while
   *  a selection exists never shows "no selection" beside a visible overlay.
   *  Single subscriber (the shell's host-state provider, which publishes it at
   *  `useFieldSelection`); returns an unsubscribe. */
  subscribeSelection(cb: (info: SelectionInfo | null) => void): () => void;
  /** Sets per-layer render visibility (see {@link FieldLayers}; default all
   *  true but `voidCast`). Layer flags are view state like shading — they
   *  survive world loads and dispose/re-init.
   *
   *  `voidCast` alone has an EDGE effect: false→true snapshots every allocated
   *  chunk into one worker job and builds the X-ray from what comes back
   *  (refused, loudly, past `VOID_CAST_CHUNK_BUDGET` chunks — the cast is a
   *  region-scale tool); true→false frees it. A call that leaves the flag true
   *  rebuilds NOTHING, so a cast the field's next edit dropped stays gone until
   *  the user toggles it off and on — which is also how it comes back after a
   *  dispose/re-init or a world load, both of which free the meshes while the
   *  flag rides through. */
  setLayers(layers: FieldLayers): void;
  /** Sets the slice-view clip plane (world metres; `null` = off). DISPLAY
   *  only: every chunk re-meshes through the worker's slice clamp (samples
   *  at/above the plane read as air) and brush TARGETING respects the same
   *  plane — the target raycast passes the clip and an eye at/above the
   *  plane counts as in-air even inside rock, so strokes land on the sliced
   *  surface the user sees. The field, the oplog, and bakes are untouched.
   *  Like the layer flags, the plane survives world loads (the load's
   *  full remesh re-applies it). */
  setSlice(y: number | null): void;
  /** The world-Y (metres) of the highest AUTHORED solid sample, or `null` when
   *  the world has nothing authored in it. What the chrome seeds
   *  {@link setSlice} with the first time the plane is switched on
   *  (D-F4.5-16's "default plane at the highest occupied cell").
   *
   *  "Authored" is the load-bearing word, and it is why this can be answered at
   *  all. An untouched field is uniform rock with ZERO allocated chunks
   *  (`getDensity` reads an absent chunk as `SOLID`), so "the topmost solid
   *  sample" over the whole domain is unbounded and meaningless. Over the
   *  ALLOCATED chunks it is exactly the top of what somebody built — the
   *  ceiling of the dig, or the top of the tallest stamp.
   *
   *  `null` for a store with no allocated chunks, and also for the degenerate
   *  case where every allocated chunk is fully air (a world dug and then filled
   *  back to nothing): both mean "no plane height is more informative than the
   *  chrome's park", which is a decision the CHROME makes, not this verb.
   *
   *  Cost is a descending scan with an early exit, so the ordinary answer is
   *  found in the first sample layer it looks at; the worst case (every
   *  allocated chunk fully air) reads every allocated sample. Click-time, not
   *  per-frame — measured in the header comment on the implementation. */
  occupiedTopY(): number | null;
  /** The core smooth-parameter ceilings (strength 1..max, iterations 1..max),
   *  surfaced through the host because the panel cannot value-import core. */
  getSmoothLimits(): { maxStrength: number; maxIterations: number };
  /** Swaps the project's resolved material table (the panel calls this once
   *  after catalog load, Task 12). Re-buckets and re-meshes every chunk. */
  setMaterialTable(table: field.MaterialTable): void;
  /** Installs the project's entity catalog (`catalog/entities.json`), the
   *  chrome's run-once fetch twin of {@link setMaterialTable}. It SEEDS three
   *  things and gates none of them: the `archetypeId` param's picker options
   *  ({@link listGenerators}), a scatter session's opening params
   *  ({@link startStamp} overlays the chosen archetype's authored `scatter`
   *  block), and each placed prop's proxy size + tint. `null` (no catalog file)
   *  leaves scatter fully usable on its schema defaults, with every prop drawn
   *  at a nominal 0.5 m box.
   *
   *  Rebuilds the COMMITTED prop layer, because the catalog decides its geometry
   *  and colour. A live stamp session is neither cancelled nor re-ghosted (unlike
   *  a material-table swap): the catalog is not an input to evaluate, so a
   *  previewed ghost still describes exactly what commit would build — but its
   *  placement wireframes are a prebuilt line batch over records this host does
   *  not retain, so a live ghost keeps its OLD-SIZE boxes until the next preview.
   *  In practice the catalog installs long before any session exists (one
   *  run-once fetch at engine-ready). */
  setEntityCatalog(catalog: EntityCatalog | null): void;
  /** The registry's staged generators (id/name/param schema/defaults/`usesSeed`)
   *  for the SESSION CARD's form — surfaced through the host because the chrome
   *  cannot value-import core's FIELD_GENERATORS. Schema/defaults are CLONED per
   *  call (plain-data records), so the chrome never holds registry state.
   *
   *  Its one consumer is `shell/SessionCard.tsx` (F4.5b Task 10 — it moved there
   *  with the form, out of the field panel that used to hold both).
   *
   *  A generator with an `archetypeId` param has that property's `enum` filled
   *  from the installed entity catalog ({@link setEntityCatalog}), turning the
   *  form's free-text field into a picker. With no catalog the schema passes
   *  through untouched — free text still commits.
   *
   *  SNAPSHOT, not a subscription: the result reflects the catalog installed
   *  AT CALL TIME. The catalog necessarily arrives later than the first possible
   *  call (it comes off an async fetch, and engine-ready fires before that fetch
   *  can settle), so a caller that renders the schema MUST call again when the
   *  catalog lands or it will render the pre-catalog one forever. The chrome
   *  does exactly that — the catalog provider ticks once it has installed the
   *  catalog, and the field panel re-reads the registry on that tick — and
   *  `tests/chrome/field-panel.test.tsx` pins the ordering. */
  listGenerators(): FieldGeneratorInfo[];
  /** The committed prop layer as the LAST REBUILD decided it: per archetype id,
   *  the instance count of its instanced draw — a COPY, keyed exactly as the
   *  draws are grouped. Empty when the log carries no placement records.
   *
   *  The one readable fact about a layer that is otherwise write-only GPU state,
   *  so it is what a caller (and a test) can hold the rebuild to. Refreshed by
   *  every path that rebuilds the layer — commit, reconfigure apply, ⌘Z/⇧⌘Z,
   *  world new/load, {@link setEntityCatalog}.
   *
   *  "Last rebuild", not "currently drawing", because the two can differ in the
   *  states where no draws exist at all: before GPU init the counts are decided
   *  but the upload is deferred to `init`, and after {@link dispose} the draws
   *  are freed while the counts stand. Both report what the layer WILL be once a
   *  context exists, because both rebuild from the op log — which, like the log
   *  and {@link listEntities}, survives a dispose. */
  propInstanceCounts(): Map<string, number>;
  /** Opens a stamp session for a registry generator, its region the CURRENT
   *  selection's AABB snapped OUTWARD to the 0.5 m lattice, its seed a fresh
   *  random uint16, its params the generator's schema defaults — and fires
   *  the first ghost preview. A truncated-flood selection carries
   *  `truncatedSelection` into the session so the stamp UI can surface that
   *  the region under-covers the flood. Replaces any existing session (its
   *  ghost is destroyed; in-flight previews are dropped).
   *
   *  With NO selection this ARMS REGION-DRAW instead of refusing (D-F4.5-7):
   *  the generator is published on {@link subscribePendingStamp}, the next two
   *  LMB clicks span a region, and THAT opens the session — the "select a
   *  region first" refusal is what the spec calls discovery-by-refusal and it
   *  is gone. An unknown generator id still refuses (setup-loud, through
   *  {@link subscribeToolError}) and arms nothing.
   *
   *  An archetype-driven generator (one with an `archetypeId` param) opens on
   *  the catalog archetype its defaults name — falling back to the catalog's
   *  first — with that archetype's authored `scatter` hints overlaid on the
   *  schema defaults. Seeding happens ONCE, at open: picking a different
   *  archetype in the form afterwards changes the id alone and leaves the
   *  density/spacing/scale the user is looking at, rather than silently
   *  discarding their edits. */
  startStamp(generator: string): void;
  /** Re-parameterizes the live session (params/seed/policy) and re-previews.
   *  Any in-flight preview is superseded (its response is dropped). No-op
   *  without a session. */
  updateStamp(
    params: Record<string, unknown>,
    seed: number,
    policy: field.MergePolicy,
  ): void;
  /** Moves the live session's placement region and re-previews. Arguments are
   *  whole LATTICE STEPS, not metres — one step is 0.5 m — applied on WORLD
   *  axes (+Y is up), never on camera axes. Both corners translate, so the
   *  region keeps its size and stays on the lattice the selection snap put it
   *  on.
   *
   *  Camera-relative mapping is deliberately NOT v0: world axes stay
   *  predictable whatever the fly camera is doing and match the region numbers
   *  everything else in the field surfaces. The viewport's arrow bindings live
   *  in `arrowNudgeSteps`; the session card's d-pad calls this same seam.
   *
   *  Supersedes any in-flight preview (its response is dropped — the run
   *  bumps like a params change). No-op without a session. */
  nudgeStamp(dx: number, dy: number, dz: number): void;
  /** Cycles the live session's `rotation` param to the next quarter turn and
   *  re-previews — the viewport's `R`, and the seam a session card's rotate
   *  affordance calls (the canvas binding only fires while the CANVAS has focus,
   *  which clicking any panel control takes away; {@link undo}'s rationale).
   *
   *  The turns come from the generator's OWN `paramSchema` enum, never from a
   *  list spelled here, so the editor cannot drift from what core will accept.
   *  A generator with no `rotation` param (cave, scatter) reports through
   *  {@link subscribeToolError} and changes nothing — the rotation is a property
   *  of the recipe, not of the editor. No session at all is a silent no-op.
   *
   *  Session-scoped, not move-scoped: a plain reconfigure turns too. */
  rotateStamp(): void;
  /** Re-previews the live session under a fresh random seed (params/policy
   *  unchanged). No-op without a session. */
  rerollStamp(): void;
  /** Commits the previewed stamp as ONE undo entry + ONE entity op (Enter).
   *  Ready-phase only — a configuring/previewing session is a no-op. Preview
   *  and commit run the SAME pure evaluate, so the committed field matches
   *  the ghost exactly. On success the session ends (subscribers get null) and
   *  {@link subscribeEntities} ticks.
   *
   *  STAMP-mode only: a live RECONFIGURE session is a no-op here, because
   *  committing one would append a SECOND entity over the same region while the
   *  original survived. {@link applyReconfigure} is that session's verb; Enter
   *  in the viewport routes to whichever the mode calls for.
   *
   *  A PROP generator whose preview evaluated to NOTHING (zero ops AND zero
   *  placements — a scatter whose region holds no matching surfaces) never
   *  reaches core: core rejects an empty result outright, so the host reports it
   *  through {@link subscribeToolError} as a sentence about props and leaves the
   *  session standing to re-tune. A CARVER that evaluates to nothing still goes
   *  to core and surfaces core's own message — for a hall, "nothing to build" is
   *  a misconfiguration, and prop advice would be nonsense. */
  commitStamp(): void;
  /** Ends the live session with whichever verb its MODE calls for —
   *  {@link commitStamp} for a stamp, {@link applyReconfigure} for a
   *  reconfigure. A panel commit button is this, and so is the app-level ⏎, so
   *  the mode→verb mapping lives in ONE place instead of being re-derived from
   *  the session a surface mirrors. Ready-phase only (both verbs are); no-op
   *  without a session.
   *
   *  A live MOVE is the one case this does NOT cover — {@link confirmSession} is
   *  the verb for that, and for ⏎ generally. */
  commitSession(): void;
  /** What ⏎ MEANS: drop a live grab, else end the session by mode
   *  ({@link commitSession}). Both keys that spell it route here — the canvas's
   *  own ⏎ and the app-level one — so a confirm cannot mean two different things
   *  depending on where the focus is.
   *
   *  Public because `beginMove` does NOT focus the canvas: a grab started from
   *  the Edit menu, or by `G` with a palette control focused, leaves the canvas
   *  listener unreachable, and without this the only key the status bar advertises
   *  for that state ("⏎ drop") would do nothing at all.
   *
   *  The extra thing it does over {@link commitSession} is `dropMove`'s two rules:
   *  the zero-step rule (a grab dropped where it started ends the session rather
   *  than spending a history entry on a reconfigure that changed nothing) and the
   *  pending-preview latch (a drop that lands mid-preview is spent when the
   *  preview settles). Known limit, filed rather than fixed here: that zero-step
   *  test reads the CURSOR's travel, so a grab moved only by the ARROW keys reads
   *  as idle and is discarded —
   *  `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *A `G` grab moved by the ARROW keys reads as idle, and ⏎ discards it*.
   *  Routing both ⏎s through one verb is what keeps that a single defect instead
   *  of a difference between two keys. */
  confirmSession(): void;
  /** Discards the session + its ghost. No-op without a session. The panel's Cancel
   *  button; Esc goes through {@link escape}, which reaches this as one rung of a
   *  ladder rather than unconditionally. */
  cancelStamp(): void;
  /** The Esc LADDER (D-12): cancels exactly ONE thing, most recent intent first —
   *  a half-drawn box/segment anchor, then the live session (a move included),
   *  then the selected entity ({@link selectEntity}), then the cell selection
   *  ({@link clearSelection}'s parking behaviour, so Reselect is still the way
   *  back). With nothing to cancel it is a silent no-op.
   *
   *  Public because the CANVAS binding is not enough: it fires only while the
   *  canvas has focus, and clicking any palette control takes focus away — the
   *  standing F2b finding that a viewport binding dies the moment the user
   *  touches a panel ({@link undo}'s rationale). Both entry points run the same
   *  ladder function, so they cannot disagree about which rung comes first, and
   *  the canvas branch stops the event when it acts so one press runs one rung. */
  escape(): void;
  /** Steps the field's own undo/redo history — the ⌘Z / ⇧⌘Z twins, and the
   *  seam any panel affordance for them must call.
   *
   *  This history lives entirely in this host's op log. The canvas binding keeps
   *  it the ONLY one a ⌘Z over the canvas can step: it stops the event before
   *  the editor's window-level ⌘Z listener sees it, so whatever that listener
   *  comes to own cannot step in the same keystroke.
   *
   *  Which is also why this is public API rather than an internal helper: that
   *  binding lives on the CANVAS, so it fires only while the canvas has focus,
   *  and clicking any panel control takes focus away and silently stops it
   *  working (the standing F2b gate finding about the nudge buttons —
   *  `docs/reference/editor-architecture.md` §18.9, where the arrows-are-canvas-only
   *  position it settled into is recorded). A panel affordance is the fix, and it
   *  calls this.
   *
   *  Remeshes what the step dirtied, refreshes the entity highlight (a
   *  reconfigure step moves the region it outlines) and ticks
   *  {@link subscribeEntities} — freeze/bake/reconfigure entries dirty no chunk
   *  or none of interest, so the tick is the only signal they happened. Empty
   *  stacks are a quiet no-op. */
  undo(): void;
  /** Re-applies the last undone step ({@link undo}'s ⇧⌘Z twin) — same refresh
   *  set, same quiet no-op on an empty stack. How core replays depends on the
   *  entry: a reconfigure or a freeze/bake restores the RECORDED record and
   *  images (byte-identical to what the undo took away), while a stroke or a
   *  stamp commit re-executes its ops against current state. */
  redo(): void;
  /** Subscribes to stamp-session changes (null = no session). Immediately
   *  pushes the CURRENT state on subscribe (the subscribeSelection remount
   *  rationale); sessions are CLONED — the chrome never holds host state.
   *  Single subscriber (the shell's host-state provider, which publishes it at
   *  `useFieldStamp`); returns an unsubscribe. */
  subscribeStamp(cb: (s: StampSession | null) => void): () => void;
  /** Subscribes to the PENDING stamp arm (null = none): the generator
   *  {@link startStamp} armed region-draw for, waiting on the two clicks that
   *  will span its region (D-F4.5-7).
   *
   *  Published rather than inferred because it is what four surfaces read and
   *  they must not disagree: the rail's pressed family, the status bar's keymap
   *  line, the canvas cursor and the viewport's own click routing. The
   *  generator's display NAME rides the push for the same reason — resolving
   *  the id chrome-side against the ⇧S cursor would name a different generator
   *  the moment that cursor moved.
   *
   *  The arm SHADOWS the gesture rather than occupying its slot: `gesture` goes
   *  on naming what LMB does underneath, and clearing the arm (Esc, the region
   *  landing, arming any tool) restores it with nothing to put back.
   *
   *  Immediately pushes the current state on subscribe; pushes on CHANGE only.
   *  Single subscriber (the shell's host-state provider, which publishes it at
   *  `useFieldTool`); returns an unsubscribe. */
  subscribePendingStamp(cb: (p: PendingStamp | null) => void): () => void;
  /** Opens a RECONFIGURE session on a committed entity (F3a): the SAME staged
   *  session {@link startStamp} opens — ghost preview, nudges, re-roll — seeded
   *  from the entity's recorded provenance (params/seed/region) instead of the
   *  schema defaults, ended by {@link applyReconfigure} rather than
   *  {@link commitStamp}. Replaces any existing session (its ghost is
   *  destroyed; in-flight previews are dropped).
   *
   *  The session opens at the `replace` merge policy WHATEVER the original
   *  commit used: `GeneratorEntity` does not record the policy, so it is not
   *  recoverable (core's `reconfigureGenerator` falls back the same way). The
   *  policy select re-previews and the apply honours it, so the ghost never
   *  lies about what Apply will build — but a stamp committed under
   *  `keep-existing-air` reconfigures under `replace` unless the user re-picks
   *  it.
   *
   *  Known v0 limit — the ghost previews against CURRENT field state, not
   *  against the state the entity was committed into: the preview snapshot is
   *  the store as it stands (everything dug/stamped since included), so the
   *  ghost shows the new SHAPE correctly but its merge against existing air can
   *  differ from what the apply produces (the apply rewinds the affected chunks
   *  to their pre-span state first). Exactness needs worker-side restore —
   *  backlogged:
   *  `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Reconfigure ghost
   *  previews against CURRENT field state, not the entity's pre-span state*.
   *
   *  Runtime-quiet on everything it can refuse: an unknown id, a FROZEN or
   *  BAKED entity, and an entity whose recorded generator has left the registry
   *  all report through {@link subscribeToolError} and open no session. */
  openEntity(entityId: number): void;
  /** Starts a MOVE on a committed entity — the `G` grab (D-9), and what the
   *  viewport's own drag and gizmo paths call.
   *
   *  A move IS a reconfigure: this opens exactly the session {@link openEntity}
   *  opens, with the same refusals (unknown id, frozen, baked, retired
   *  generator — all runtime-quiet through {@link subscribeToolError}), the same
   *  ghost, and {@link commitSession} as its terminal verb. What it adds is a
   *  MODE: the session is flagged {@link StampSession.moving}, and the CURSOR
   *  now drives the region — moving the pointer slides the ghost in whole 0.5 m
   *  lattice steps on the ground plane, ⇧ promotes that to the vertical axis,
   *  LMB or Enter drops it as ONE undo entry, Esc discards it.
   *
   *  No button need be held: this is the grab, so the pointer moves the ghost
   *  free-hand. Leaving the viewport (a blur — clicking a panel control) CANCELS
   *  it, the way it cancels every other stranded keydown state; the region is
   *  untouched until the drop.
   *
   *  Nothing is written to the log until that drop, so a move that is cancelled
   *  costs nothing and leaves no history entry. */
  beginMove(entityId: number): void;
  /** Applies the live RECONFIGURE session (its Enter twin): re-evaluates the
   *  entity's span in place through core's `reconfigureGenerator`, remeshes the
   *  affected chunks, pushes the replay's drift report to
   *  {@link subscribeDrift} and ends the session. ONE undo entry.
   *
   *  Ready-phase only (the {@link commitStamp} discipline) and reconfigure-mode
   *  only — a stamp session, or a configuring/previewing one, is a no-op. A core
   *  rejection (the entity was frozen or undone from under the session) reports
   *  through {@link subscribeToolError} and LEAVES the session standing so the
   *  user can retry or cancel. A PROP generator's empty re-evaluate (zero ops
   *  AND zero placements) is caught before core the same way
   *  {@link commitStamp} catches it; a carver's still goes to core.
   *
   *  COST — this blocks the main thread, and the stall grows with the LOG, not
   *  with the edit. The host passes no snapshot records, so core takes its
   *  full-prefix restore route: every op below the entity's span is replayed
   *  into a scratch store before the new span is applied. Measured (core's
   *  P-F3-2 bench, JSC): ~310 ms at 2137 ops. Reconfiguring an old entity in a
   *  long session is therefore a visible freeze on Enter, with no progress
   *  signal — surfacing or shrinking that is not v0 (records are the lever;
   *  `captureDueSnapshots` exists and is unwired here). */
  applyReconfigure(): void;
  /** Freezes/unfreezes a committed entity — cheap reversible protection:
   *  {@link openEntity} refuses a frozen entity until it is unfrozen. Touches
   *  no chunk, so nothing remeshes; ONE undo entry per REAL change (a redundant
   *  call is a no-op core does not log). A baked entity has nothing left to
   *  protect and reports through {@link subscribeToolError}.
   *
   *  FREEZING cancels a live reconfigure session on that same entity — core
   *  would refuse its Apply, so the session has nothing left to offer.
   *  Unfreezing never cancels anything (a frozen entity has no session). */
  setEntityFrozen(entityId: number, frozen: boolean): void;
  /** Severs a committed entity's recipe — PERMANENT (no unbake; the caller
   *  confirms before calling). The record keeps its provenance for history, but
   *  reconfigure is gone for good and the span becomes plain history. ONE undo
   *  entry, which is the only way back and only until it leaves the stack. An
   *  already-baked entity reports through {@link subscribeToolError}.
   *
   *  A live reconfigure session on that entity is CANCELLED — its Apply could
   *  no longer land. */
  bakeEntity(entityId: number): void;
  /** Deletes a committed entity — core `deleteGeneratorEntity`: the span AND its
   *  entity op are spliced out, the chunks the span wrote are rewound, and the
   *  downstream ops reaching them replay on top. The log reads as though the
   *  stamp had never been committed, with every later edit preserved. ONE undo
   *  entry, which is the whole way back.
   *
   *  Core is SETUP-LOUD on all three refusals (an unknown id, a FROZEN entity, a
   *  BAKED one) and this is the editor, so each throw is caught and reported
   *  verbatim through {@link subscribeToolError} — the F3b refusal-visibility
   *  rule. Nothing is written on a refusal; core validates before its first
   *  store touch.
   *
   *  A live reconfigure session on that entity is CANCELLED, for
   *  {@link bakeEntity}'s reason: its Apply could never land.
   *
   *  The prop layer is re-derived from the LOG, never from the dirty set — core's
   *  contract, and it bites here: a placements-only entity (a scatter) writes no
   *  cells, so deleting it dirties NOTHING while every prop it placed leaves the
   *  log with it. Selecting THIS entity clears the selection (and notifies
   *  {@link subscribeEntitySelection}); selecting another leaves it standing. */
  deleteEntity(entityId: number): void;
  /** Commits a COPY of a committed entity beside it — a fresh `commitGenerator`
   *  from the record's own provenance, not a second reference to it. ONE undo
   *  entry (the commit's own), and the copy becomes the selected entity.
   *
   *  The copy is offset +X by the original's FOOTPRINT extent snapped UP to the
   *  0.5 m lattice (`latticeClearance` — the lattice `startStamp` snaps a region
   *  onto), floored at one step. It clears the original along X by construction
   *  and lands on the grid the stamp UI works in.
   *
   *  A span with no field-writing ops (a pure placer's) has no footprint, and the
   *  shift is then by the recorded REGION's extent — not by a bare minimum step.
   *  That falls out of `entityFootprints`, which resolves the null footprint to
   *  the region once for every reader (the emphasis box and the pick share it), so
   *  a scatter's copy clears its own region rather than landing half inside it.
   *
   *  Its seed is a fresh uint16 when the generator READS one (core's
   *  `GeneratorDef.usesSeed`), so duplicating a cave or a scatter gives a
   *  genuinely different arrangement — and the recorded seed otherwise, so the
   *  hall's copy is not left wearing a different number for an identical shape.
   *
   *  Merge policy is `"replace"`: `GeneratorEntity` does not record the policy the
   *  original commit used, so it is not recoverable (core's `reconfigureGenerator`
   *  falls back the same way, and {@link openEntity} opens on it too).
   *
   *  FROZEN and BAKED entities can both be duplicated, and that is deliberate: the
   *  copy is a new commit from recorded provenance rather than an edit of the
   *  protected record — freeze guards THIS entity and bake severed THIS entity's
   *  recipe. Duplicating is how a baked stamp's recipe becomes live again.
   *
   *  Runtime-quiet ids like the rest of the entity verbs: an id no entity op
   *  carries, or a generator that has left the registry, reports through
   *  {@link subscribeToolError} and commits nothing. */
  duplicateEntity(entityId: number): void;
  /** Subscribes to the latest reconfigure drift report: the downstream ops the
   *  last {@link applyReconfigure} replayed whose outcome moved (`drifted`) or
   *  vanished (`orphaned`). Pushed on every apply that LANDS — null when that
   *  apply found nothing, so a clean reconfigure clears the previous report —
   *  and null on world reset/load (a report names op ids the new log does not
   *  have). An apply core REJECTS pushes nothing at all: it changed no op, so
   *  the standing report still describes the log as it is, and clearing it
   *  would destroy findings on behalf of an edit that never happened.
   *  Each push carries the findings AND the entities they touch
   *  ({@link FieldDriftReport.entityIds}), derived at push time from the footprints
   *  as they stand — so a row badge cannot outlive the geometry it points at.
   *  Reports are CLONED and the CURRENT one is pushed immediately on subscribe
   *  (the {@link subscribeStamp} remount rationale). Dismissal is a HOST verb
   *  ({@link dismissDrift}) that nulls the report and notifies, not the UI's own
   *  state — so a remount after a dismiss re-subscribes to null rather than
   *  resurrecting a cleared report. NOT cleared by ⌘Z: undoing a reconfigure
   *  leaves its findings standing, still addressed by op id and chunk, describing
   *  an edit that is no longer applied. Single subscriber (the shell's host-state
   *  provider, which publishes it with the entity list at `useFieldEntities`);
   *  returns an unsubscribe. */
  subscribeDrift(cb: (report: FieldDriftReport | null) => void): () => void;
  /** Clears the standing drift report: nulls it and notifies
   *  {@link subscribeDrift}. The verb behind the report's Dismiss button —
   *  the report is host state, so this is how the UI discards it. Idempotent:
   *  dismissing an already-null report re-pushes null and is otherwise inert. */
  dismissDrift(): void;
  /** Re-points the fly camera at a set of chunks — moves the orbit pivot (and
   *  with it the eye, offset from the pivot by the unchanged distance/yaw/pitch)
   *  to the centre of the chunks' world-space AABB, then re-renders next frame.
   *  The drift report's click-to-frame seam: the caller passes a finding's
   *  `chunks`. Empty set is a no-op; a re-centre, not a cinematic fit (angle and
   *  distance are kept). No-op on the camera before init (no `cam` yet), but it
   *  still moves the stored orbit target so the first frame lands framed. */
  frameChunks(chunks: readonly field.ChunkKey[]): void;
  /** Frames what is selected — the `F` key's verb, and a FIT rather than a
   *  re-centre: it moves the orbit pivot to the selection's centre AND pulls the
   *  distance in to the box's longest edge, keeping the angle the user is
   *  looking from ({@link frameChunks} moves the pivot alone).
   *
   *  What it frames, in order: the selected ENTITY's stamped footprint
   *  ({@link selectEntity}), else the cell selection's AABB
   *  ({@link SelectionInfo.aabb}), else nothing at all. The two selections are
   *  INDEPENDENT state — neither verb clears the other, so both can stand at
   *  once and either can be the more recent — and the entity wins
   *  UNCONDITIONALLY. Not a recency rule: an object selection names one thing,
   *  a cell selection names a volume, and the more specific intent is the one
   *  worth flying to. Framing EVERYTHING is a different verb, and it exists now:
   *  {@link frameWorld}.
   *
   *  With neither selected it moves no camera and pushes no
   *  {@link subscribeCameraPose} — it reports through {@link subscribeToolError}
   *  instead. Framing "everything" would be a different verb, and one that flies
   *  the user somewhere they did not ask to go; refusing SILENTLY would be
   *  indistinguishable from a broken key, since `F` swallows the press anyway.
   *
   *  A CUT, not a tween — the editor has no camera animation, and this shares
   *  that stance with every other camera path (see the class comment on the
   *  camera verbs in the implementation). */
  frameSelection(): void;
  /** Frames the WHOLE WORLD — the verb {@link frameSelection}'s docblock says
   *  "framing everything would be a different verb". This is that verb, added at
   *  the F4.5 holistic gate because `Open` left the camera wherever it already
   *  was, which on a fresh session is a 6 m orbit about the origin — outside
   *  anything the loaded world contains.
   *
   *  A FIT, like {@link frameSelection} and unlike {@link frameChunks}: pivot to
   *  the centre and pull the distance in to the box's longest edge, keeping the
   *  angle the user is looking from.
   *
   *  WHAT IT FRAMES is the allocated chunks' world-space AABB with its TOP
   *  lowered to {@link occupiedTopY} whenever that answers. The two disagree
   *  more than they look: a chunk is 16 samples tall, so a world whose only rock
   *  sits at the bottom of a chunk column still allocates the whole column, and
   *  framing the chunk box would fit the camera to padding. `occupiedTopY` is the
   *  top of what somebody BUILT, so it is the top a reader means. It is left
   *  alone when it answers `null` — an all-air store has nothing to lower to.
   *
   *  With NO allocated chunks it moves no camera and pushes no
   *  {@link subscribeCameraPose}, reporting through {@link subscribeToolError}
   *  instead — the same stance {@link frameSelection} takes with nothing
   *  selected, and for the same reason: a camera verb that silently did nothing
   *  is indistinguishable from a broken one.
   *
   *  Cost is `occupiedTopY`'s (a descending scan with an early exit — click-time,
   *  and see the measurements on its implementation) plus one pass over the chunk
   *  keys. A CUT, not a tween.
   *
   *  DELIBERATELY NOT counted as the user aiming the camera — see
   *  {@link cameraAimedByHand}. */
  frameWorld(): void;
  /** Has the user aimed this camera themselves since the host was created?
   *
   *  `false` until an interactive camera gesture (look drag, fly, dolly) or a
   *  deliberate aim-at-something verb ({@link frameSelection}, {@link snapView},
   *  {@link frameChunks} — the entities palette's per-row frame and the drift
   *  report's — or the flag report's click-to-frame) has run. Seven sites in all;
   *  `aimCamera`'s own comment lists where each one is pinned. {@link frameWorld}
   *  is excluded on
   *  purpose: framing the whole world is exactly the state the automatic frame
   *  produces, so counting it would make one `Open` suppress the next one's frame
   *  and re-open the defect this pair was added to close.
   *
   *  A LATCH RATHER THAN A POSE COMPARISON, and the difference is the point. The
   *  gate's ruling says "when the camera pose is the boot default", which is what
   *  this approximates; comparing floats against the boot literal would answer
   *  "yes" for a user who orbited and happened to land back on it, and would need
   *  an epsilon nobody can pick honestly. What the condition is FOR is not
   *  yanking a camera somebody arranged, and "did they arrange it" is the
   *  question a latch answers exactly.
   *
   *  Read by the chrome's Open (`hooks/useWorld.tsx`), where ruling 5's automatic frame
   *  lives — NOT by {@link loadWorld}, which deliberately frames nothing (its own
   *  comment says why). Exposed because the chrome's
   *  own surfaces may want the same question later; nothing pushes it, because
   *  nothing needs to re-render when it changes. */
  cameraAimedByHand(): boolean;
  /** Snaps to an axis-aligned view: `sign: 1` puts the EYE on the POSITIVE side
   *  of `axis` looking back at the pivot, `-1` on the negative side. The corner
   *  triad's six tips are this verb, and they are labelled with the same
   *  convention — the tip marked +X sends the camera to +X.
   *
   *  The FRAMING is untouched: pivot and distance are whatever the user last
   *  arranged, so a snap re-angles the current view rather than resetting it.
   *  Needs no selection — it is a view verb.
   *
   *  The two Y views land one hundredth of a radian off the pole (the same
   *  clamp the look drag uses, which is what keeps the up vector defined) and
   *  KEEP the current yaw, because yaw means nothing straight up. */
  snapView(axis: "x" | "y" | "z", sign: 1 | -1): void;
  /** Subscribes to "the entity list may have changed" — a bare TICK, not a
   *  value: the subscriber re-reads {@link listEntities} itself (the records are
   *  clones; pushing them would clone on every fire whether or not anything
   *  moved). Fires on commit, apply, freeze/unfreeze, bake, ⌘Z/⇧⌘Z, world
   *  new/load, and ONCE immediately on subscribe (a surface that mounts after the
   *  world loaded must not render an empty list). Freeze and bake dirty NO
   *  chunk, so this is the only signal that carries them — the remesh counter
   *  never moves. Single subscriber (the shell's host-state provider, whose
   *  callback re-reads {@link listEntities} and publishes the result at
   *  `useFieldEntities`); returns an unsubscribe. */
  subscribeEntities(cb: () => void): () => void;
  /** Subscribes to the NAMED history (D-F4.5-11) — what each undo/redo step
   *  would do, in words, derived from the op log's two entry stacks.
   *
   *  A VALUE rather than {@link subscribeEntities}' bare tick, because the
   *  labels are derived and the chrome cannot value-import core to derive them
   *  itself. Fires whenever the stacks actually move — every brush stroke,
   *  commit, apply, freeze/bake, delete/duplicate, ⌘Z/⇧⌘Z and world new/load —
   *  and ONCE on subscribe with the current history. Pushes that change
   *  NOTHING are suppressed: several paths tick the entity list without
   *  touching the log (an already-satisfied freeze, a dismissed drift report),
   *  and a 50-row palette must not re-render for them.
   *
   *  Bounded per side to the most recent `HISTORY_TAIL` entries (the constant
   *  lives in `field-history.ts` and deliberately stays behind this barrel —
   *  the chrome cannot value-import it); the DEPTHS beside them are the true
   *  stack depths, so a consumer can say how much it is not showing without
   *  knowing the bound. Single subscriber (the shell's host-state
   *  provider, publishing at `useFieldHistory`); returns an unsubscribe. */
  subscribeHistory(cb: (history: FieldHistory) => void): () => void;
  /** The committed generator entities, in log order (CLONES — read from the
   *  op log's entity ops, so undo/redo and world loads stay accurate), each
   *  carrying the {@link FieldEntityInfo.placed} summary of its own span's
   *  placement records. */
  listEntities(): FieldEntityInfo[];
  /** Selects one committed entity, or nothing (`null`). The SAME state a
   *  `pointer` click writes, so the palette and the viewport cannot disagree
   *  about what is selected — there is one selection concept, not a selection
   *  and a highlight.
   *
   *  Runtime-quiet on an id no entity op carries (an undone commit, a stale
   *  panel row): it selects NOTHING rather than reporting, because the ids come
   *  from a list that can lag the log. Re-selecting what is already selected is
   *  a no-op that notifies nobody.
   *
   *  The selected entity wears its stamped FOOTPRINT box in the theme's primary
   *  colour — the union of its span's op bounds, falling back to the recorded
   *  selection region only when the span holds no field-writing ops (a pure
   *  placer's). That emphasis is display-only and rides the `selection` layer
   *  gate; the selection itself is not display state and survives the layer
   *  being off. */
  selectEntity(entityId: number | null): void;
  /** Subscribes to the selected entity id (`null` = nothing selected), pushed on
   *  every change — a `pointer` click, a {@link selectEntity} call, and the
   *  INVALIDATION that fires when the selected entity leaves the log (⌘Z over a
   *  commit, a world new/load). Immediately pushes the CURRENT id on subscribe
   *  (the {@link subscribeSelection} remount rationale). Single subscriber;
   *  returns an unsubscribe.
   *
   *  Distinct from {@link subscribeSelection}, which carries the CELL selection
   *  that masks ops. The two are independent state: selecting an entity does not
   *  disturb a cell selection and vice versa. */
  subscribeEntitySelection(cb: (entityId: number | null) => void): () => void;
  /** Installs the project's agent profile (`catalog/agent.json`) — the capsule,
   *  step and clearance the walkability advisor is parameterized on (D-F4-4).
   *
   *  A GATE, like the material table is for a kit fill: with no profile the
   *  advisor posts nothing at all, and the first edit that would have analysed
   *  says so ONCE through {@link subscribeToolError} rather than repeating at
   *  stroke rate — as a `warn` ({@link ToolErrorSeverity}), because an idle
   *  advisor over a project that installed no profile is not a failure of
   *  anything. Nothing else is refused — every verb still works, because the
   *  advisor never blocks one (D-F4-1).
   *
   *  Installing catches the world up in full: the mirror re-syncs and the next
   *  pass is whole-world, so the first findings describe the field as it stands
   *  rather than only what has been edited since.
   *
   *  `null` is the OTHER answer, and it carries a fact the host cannot otherwise
   *  have: *this project has no agent profile*. The profile arrives over HTTP and
   *  the analyze pump does not wait for it, so "no profile in hand" reads
   *  identically before any answer and after a negative one — and the idle notice
   *  is a claim about the PROJECT, which only the second state can support. Until
   *  this is called with either argument the host stays silent about it. Passing
   *  `null` catches nothing up (there is nothing to analyse with) and posts
   *  nothing on its own; it only licenses the next pass to say so.
   *
   *  Only a load that KNOWS may answer `null` — a `404` on the catalog. A fetch
   *  that failed and a catalog that would not parse are not answers: the first
   *  does not know, the second knows the opposite, and both have already told the
   *  user what happened in terms more useful than "idle". */
  setAgentProfile(profile: field.AgentProfile | null): void;
  /** Subscribes to the advisor's findings, pushed after every analyzer response
   *  and after every {@link setFlagFilters}. Immediately pushes the CURRENT
   *  summary on subscribe (the {@link subscribeSelection} remount rationale).
   *  Single subscriber (the shell's host-state provider, which publishes it at
   *  `useFieldFlags`); returns an unsubscribe.
   *
   *  The summary is derived fresh per push and shared with nothing — but the
   *  `FieldFlag` inside each row is the analyzer's own and must be treated as
   *  read-only. */
  subscribeFlags(cb: (summary: FlagsSummary) => void): () => void;
  /** Sets which triage bands the markers and the list show (default: candidates
   *  only). A VIEW filter and nothing more — it hides findings, never drops
   *  them, and a filtered-out finding still counts in
   *  {@link FlagsSummary.total}. Survives world loads, like the layer flags. */
  setFlagFilters(filters: FlagFilters): void;
  /** Runs STAGE 2 on one finding, named by the {@link FlagRow.key} the summary
   *  handed out: the project's own `/engine.js` mover, driven at that flag under
   *  a time budget. The verdict arrives on the next {@link subscribeFlags} push,
   *  joined onto the row it was taken on.
   *
   *  Fire-and-forget, and an ADVISOR verb throughout (D-F4-1) — it mutates no
   *  field, blocks nothing, and fixes nothing. Every refusal is a
   *  {@link subscribeToolError} report and nothing else, and all four are decided
   *  SYNCHRONOUSLY, before this returns. Listed in the order they are checked,
   *  which is itself deliberate:
   *  1. a verify is already in flight (budgeted seconds of real mover; one at a time),
   *  2. no agent profile is installed yet ({@link setAgentProfile}) — checked
   *     before the key, so the message names the root cause rather than the
   *     missing finding that absence necessarily implies,
   *  3. the key names no current finding (a re-analysis moved on),
   *  4. the finding is a `pit` — region-level, so one anchor's directed lanes
   *     would prove nothing about it; walking it is the answer.
   *
   *  A stage-2 failure (no bundle, a mover that threw) is the one ASYNC outcome:
   *  it reports through the same seam and releases the latch. */
  verifyFlag(key: string): void;
  /**
   * Selects ONE finding, named by the {@link FlagRow.key} the summary handed out
   * — or `null` to deselect (D-F4.5-15).
   *
   * The selection publishes on the flags seam itself
   * ({@link FlagsSummary.selected}), not on a seam of its own: a highlight and the
   * rows it highlights have to arrive together, or a palette can paint a selection
   * against a list from a different analyzer response.
   *
   * Two things happen beyond the state write. The selected marker is drawn bigger
   * and its anchor CELL gets a `--primary` outline, and the camera FRAMES that
   * cell — ONE `store.cellSize` on a side (0.25 m at the default lattice), where
   * the route this replaces framed the finding's whole chunk, sixteen cells across
   * (4 m at that same default), and left the user hunting inside the box (the F4
   * gate's first item). Both figures are lattice-relative and neither is fixed:
   * `cellSize` is a per-world manifest value, which is exactly why
   * {@link flagCellBox} derives the box rather than naming a number.
   * The viewport's own marker click deliberately does NOT frame: the user
   * is already looking at what they clicked, and a camera that jumped on every
   * marker press would be unusable.
   *
   * Refuses ONE way, synchronously, on {@link subscribeToolError}: a key that
   * names no VISIBLE finding (a re-analysis moved on, or the filters hid it since
   * the row was drawn). A refusal changes nothing — the standing selection
   * survives it, and no push is made. `null` is the deselect and is never refused.
   */
  selectFlag(key: string | null): void;
  /** How many flag markers the LAST rebuild decided to draw — the
   *  {@link propInstanceCounts} twin, and for the same reason: the marker layer
   *  is otherwise write-only GPU state, so this is what a caller (and a test) can
   *  hold the rebuild to. Equals the visible-flag count, including before GPU
   *  init and after {@link dispose}, where the number is decided but no draw
   *  exists. */
  flagMarkerCount(): number;
  /** How many selection CELL cubes the last rebuild decided to draw — the
   *  {@link flagMarkerCount} twin, for the same reason (the instanced layer is
   *  otherwise write-only GPU state) and settled before the same context guard.
   *  0 for a region selection, which keeps its honest AABB box, and 0 with no
   *  selection at all. */
  selectionCellCount(): number;
  /** Bakes the current field to the artifact file set (pure, for upload). */
  exportArtifact(name: string): field.BakedFile[];
  /** Subscribes to the live stats readout ({@link FieldStats}), pushed every
   *  rAF — which is why the subscriber is the shell's provider, whose
   *  value-equality guard is what keeps an idle field from re-rendering the
   *  chrome 60×/s. Single subscriber (that provider, which publishes it at
   *  `useFieldHostState`); returns an unsubscribe. */
  subscribeStats(cb: (s: FieldStats) => void): () => void;
  /** Is the right button down and driving the camera? The app-level key gate polls
   *  this on EVERY keypress (`frontend/lib/actions.ts`), because while a look drag
   *  is running the letters belong to the fly — `S` is fly-backward as well as the
   *  stamp family, and this is what decides which. Deliberately a POLL rather than
   *  a subscription: the button goes down and up between renders, so a mirrored
   *  boolean would answer for a frame that has already gone.
   *
   *  It is also the other half of the RMB-gated fly (D-10): fly travel only applies
   *  while this is true. */
  isLooking(): boolean;
  /** Subscribes to the orbit camera's orientation ({@link CameraPose}), pushed on
   *  every camera move — a fly step, a look drag, a frame-chunks retarget — and
   *  ONCE immediately on subscribe, so a triad mounting into a session already
   *  under way draws the pose the user is actually at rather than the default one.
   *
   *  Pushed at pointer/frame rate while the camera is moving, which is why the
   *  subscriber is the shell's provider (one slot, one guard) rather than the
   *  overlay. Single subscriber (that provider, which publishes it at
   *  `useCameraPose`); returns an unsubscribe. */
  subscribeCameraPose(cb: (pose: CameraPose) => void): () => void;
  /** Subscribes to the PENDING segment ({@link SegmentHud}) — `null` whenever no
   *  point is down (D-25). Pushed on both anchor edges, throttled to the stroke
   *  cadence while the cursor moves between them, and once immediately on
   *  subscribe (the {@link subscribeCameraPose} rationale: a status bar
   *  re-subscribing mid-gesture must not read blank beside a capsule the
   *  viewport is plainly drawing).
   *
   *  This is what makes the length cap VISIBLE while the user is still aiming —
   *  before F4.5c it was reachable only as a refusal after the second click. The
   *  chrome cannot value-import the cap, so `capM` rides in the payload.
   *
   *  Pointer-rate while a point is down, which is why the subscriber is the
   *  shell's provider (one slot, one guard) rather than the status bar. Single
   *  subscriber (that provider, which publishes it at `useFieldSegmentHud`);
   *  returns an unsubscribe. */
  subscribeSegmentHud(cb: (hud: SegmentHud | null) => void): () => void;
};

type Vec3T = [number, number, number];

/** The host's stored selection: the replayable spec + its click-time
 *  materialization. The materialization feeds UI info + the overlay ONLY —
 *  a selection-masked op embeds the SPEC and core re-materializes it against
 *  pre-op state at each application (replay-safe by construction). */
type SelectionState = {
  spec: field.SelectionSpec;
  materialized: field.MaterializedSelection;
};

/** A prebuilt drawLines batch (vertices + per-vertex colors). */
type LineBatch = { vertices: Float32Array; colors: Float32Array };

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

/** One archetype's committed prop draw: an instanced proxy primitive + the
 *  geometry it owns (one draw call for every placed record of that archetype). */
type PropRender = { im: mesh.InstancedMesh; g: geometry.Geometry };

const REMESH_PER_FRAME = 2; // dirty-set drain budget per rAF
/** The pointer-rate cadence: how often a drag applies the brush, and (since D-25) how
 *  often the pending segment's length reaches the chrome. Exported for the segment
 *  suite's clock, which advances by exactly one window to prove the HUD's throttle
 *  RELEASES — an assertion that spelled `40` here would go stale silently the first time
 *  the cadence was tuned. Deliberately NOT re-exported from `index.ts`: the chrome has
 *  no business with it, and everything behind that barrel value-imports core. */
export const STROKE_MIN_MS = 40;
const DIG_RANGE_M = 30;
/** The longest capsule the segment gesture will sweep (D-F4-16). A segment's
 *  cost is linear in its length — every chunk on the line is dirtied, remeshed
 *  and re-analysed — and the two clicks are independent, so an orbit between
 *  them can pair points across the whole world by accident. The cap refuses that
 *  op and keeps the anchor armed, making the fix one nearer click.
 *
 *  Twice DIG_RANGE_M is not a round number, it is the geometry: each endpoint
 *  lands within DIG_RANGE_M of the eye that resolved it, so two clicks from ONE
 *  camera can never be more than 2·30 m apart. The cap therefore admits every
 *  segment a stationary user can draw and refuses only the ones that needed the
 *  camera to move between clicks — which is exactly the accident it is for.
 *
 *  CARRIED to the chrome at runtime as {@link SegmentHud}'s `capM` (D-25), which
 *  is the only place the number reaches a user while it still matters — the
 *  status bar's segment line counts against it as the cursor moves. The chrome
 *  cannot value-import anything under `viewport-host/`, so a seam is the one way
 *  the two can be the same number rather than two numbers that agree.
 *
 *  Still RESTATED, once, in the tool rail's Segment member hint (`BRUSH_FAMILY`
 *  in `frontend/lib/actions.ts`): that hint is a static sentence describing the
 *  gesture before it starts, with no push to read, so it agrees by review (the
 *  FlagsSection tint-palette precedent). It lived on `ToolPalette`'s Segment
 *  tooltip until F4.5b Task 8 deleted that file. */
const MAX_SEGMENT_M = 2 * DIG_RANGE_M;
/** How long a segment between these two world points is (m).
 *
 *  ONE function for the two readers rather than two spellings of Pythagoras, and the
 *  reason is that they must agree exactly: `segmentClick` measures the pair to decide
 *  whether to REFUSE it, and the HUD measures the pending pair to say whether it is
 *  about to be refused. A readout that computed the length even slightly differently
 *  would show a number inside the cap for a click the very next line rejects. */
const segmentLength = (a: Vec3T, b: Vec3T): number =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
/** How far a `pointer` pick reaches — the DIG reach, deliberately the same
 *  number rather than an independent one: "you can select what you could dig" is
 *  one rule to hold in the head, and the same range bounds the pick's occlusion
 *  probe, so nothing can be picked through terrain the probe never tested. */
const PICK_RANGE_M = DIG_RANGE_M;
/** The project's runtime-built engine bundle, which is where stage 2's mover
 *  lives. The daemon serves it at this path; the analyzer worker imports it. */
const ANALYZER_ENGINE_URL = "/engine.js";
/** Wall-clock ceiling for ONE stage-2 verify. The mover is real and the lanes
 *  are budgeted, so the verb has to be able to give up: past this the verdict
 *  comes back `inconclusive` with reason `budget`, which the panel paints as no
 *  answer rather than as a third one. */
const VERIFY_BUDGET_MS = 8000;
const EDITOR_FOV_Y = Math.PI / 3;
const MAX_FRAME_DT = 0.1; // clamp dt so a stall can't lurch the camera
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 4;
const RADIUS_WHEEL_STEP = 0.1;

const CLEAR = vec4.fromValues(0.03, 0.03, 0.045, 1);
// The studio key light: camera-following, warm, and the only light in the scene.
const STUDIO_KEY_COLOR: Vec3T = [1, 0.95, 0.85];
const STUDIO_KEY_INTENSITY = 6;
const STUDIO_KEY_RANGE = 18;
// Hemisphere fill, low enough that the key still shapes the surface. These are the
// dungeon-torch numbers this mode started as: D-F4.5-17 wants them TUNED for form +
// material legibility, and P5 (the slice's own readability check) is what decides
// whether that tuning is needed — untouched until it says so.
const STUDIO_AMBIENT: frame.Ambient = {
  sky: [0.4, 0.42, 0.48],
  ground: [0.16, 0.16, 0.2],
  intensity: 0.28,
};
// The debug mode draws through shader.normalColor, which ignores lights and ambient
// entirely. Full white is what keeps the kit's instanced-lit pieces (no unlit variant
// exists) readable beside it.
const NORMALS_AMBIENT: frame.Ambient = {
  sky: [1, 1, 1],
  ground: [1, 1, 1],
  intensity: 1,
};

const DEFAULT_GRID: Vec3T = [0.42, 0.42, 0.46];
const GRID_MINOR_DIM = 0.5; // minors dimmed vs majors (two-tone depth cue)

// Shared specular for every lit bucket / kit material (color-only variation).
const LIT_SPECULAR: [number, number, number, number] = [0.06, 0.06, 0.06, 16];

// Kit-fill ghost cube opacity: translucent enough to read the field through
// the hologram volume, solid enough to make "fill writes this whole box"
// unmistakable (the fill-tool-solid-volume-surprise fix).
const GHOST_CUBE_ALPHA = 0.25;

// Stamp-ghost surface opacity — a touch denser than the kit-fill cube: the
// ghost is a real surface mesh (walls occlude walls), so it needs presence to
// read as "this is what commit builds" while the field stays visible through it.
const STAMP_GHOST_ALPHA = 0.35;

// Void-cast X-ray (D-F3-15) — a dim CYAN, deliberately off the hologram-blue
// GHOST_COLOR: the cast is ambient context (what the air already is), never a
// preview of a pending action. Dimmer than either ghost because it can cover
// the whole viewport.
const VOID_CAST_COLOR: Vec3T = [0.25, 0.85, 0.75];
const VOID_CAST_ALPHA = 0.3;
// Enabling the cast snapshots + meshes EVERY allocated chunk in ONE worker job,
// so its cost is linear in the whole world, not in what the camera sees. The
// ceiling makes that honest: past it the enable REFUSES loudly rather than
// queueing a job that gets slower with no upper bound. 512 chunks is 2.1 MB of
// density on the wire and, packed, a 32 m cube of field at the default 0.25 m
// cell — a region-scale tool by design; world-scale X-ray belongs to F5's
// streaming work.
//
// Measured at the ceiling (bun/JSC, 512 dug chunks, one cast): ~1.3 s of worker
// time. That is a real wait, and it buys the tool no progress state in v0 — the
// overlay simply appears. The number is recorded here rather than tuned because
// the spec set the ceiling; a gate that finds the wait unacceptable should move
// THIS constant, and browser V8 is not JSC, so re-measure there before doing so.
const VOID_CAST_CHUNK_BUDGET = 512;

// Walkability-marker cube edge (metres) — under the 0.25 m cell, so a marker
// reads as a pin ON a floor cell rather than as a block filling it. FIXED in
// metres while the marker's Y lift is `cellSize / 2`, which is deliberate but
// only safe because this host is single-lattice: `createFieldStore()` takes the
// default and `loadWorld` REFUSES a world of another cellSize. On a coarser
// lattice the pin would shrink against its cell, and on a much finer one it
// would span several — make it lattice-relative if that refusal ever lifts.
const FLAG_MARKER_SIZE_M = 0.18;
// Quiet time after the last density write before the WHOLE-WORLD pass runs
// (reachability demotion + pit detection). Those two are world-cadence: one dug
// cell can open or seal a trap anywhere, so they cannot be done per dirty chunk,
// and a whole-world re-flood costs ~72% of a full analyzeWorld on top of it
// (F4 tranche A measured 2.9–3.2 ms against 4.1–4.2 ms over 108 chunks, both
// growing with the world). This debounce is the budget knob: long enough that a
// drag re-arms it
// instead of running it, short enough that the markers settle while the user is
// still looking at what they dug.
const ANALYZER_IDLE_MS = 500;

const clampRadius = (r: number): number =>
  Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r));

const clampIntRange = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

// Fill-only shell-band floor (metres). Core accepts any hollow > 0 (it cannot
// clamp against cellSize); the CHASSIS enforces the floor because a sub-cell
// shell thickness on organic shapes can produce holey shells, and 0.5 matches
// the UI's step + the kit lattice.
const HOLLOW_MIN_M = 0.5;

// Selection flood budget for the click gestures — under core's
// MAX_SELECTION_BUDGET (262144) so a UI selection never rides the op-replay
// ceiling exactly; truncation at this cap surfaces via SelectionInfo.
const SELECTION_UI_BUDGET = 200_000;
// Selection overlay colour — amber, deliberately distinct from the
// hologram-blue brush ghost (GHOST_COLOR). Shared with the advisor's INFO_TINT
// rather than restated: both mark CONTEXT the user is not being asked to act on,
// and two copies of four numbers is how that claim quietly stops being true.
const SELECTION_COLOR: [number, number, number, number] = INFO_TINT;
// THE selection accent: the CHROME's `--primary`, so "this is what is selected" is
// one colour across the whole editor. Two overlays wear it — the selected entity's
// footprint box and (since F4.5b Task 13, D-F4.5-15's "reuse --primary, no new hue")
// the selected finding's cell outline — and neither reads as the amber cell-selection
// overlay beside them. Named for the ROLE rather than for the entity box, because it
// stopped being the entity box's alone.
//
// The theme token is `--primary: oklch(0.62 0.11 240)` (styles.css); these are
// its LINEAR-sRGB components, which is what a shader writes (engine-conventions
// §Color space: shaders write linear, the swap chain encodes). Converted once
// here rather than eyeballed — the two surfaces are meant to be the same colour,
// and a hand-picked approximation is how that quietly stops being true. The
// chrome cannot value-import anything under `viewport-host/`, so the two agree
// by review (the MAX_SEGMENT_M / FlagsSection tint-palette precedent): if the
// token moves, this moves.
const SELECTED_COLOR: [number, number, number, number] = [
  0.048, 0.271, 0.536, 1,
];
// How opaque one selected CELL cube is. Low on purpose: the display's job is to
// show a flood's SHAPE from inside it, and cells stack six deep along any view
// ray through a solid blob — at a readable single-cube alpha the far side of a
// room would be an opaque wall of blue. 0.18 keeps a single cell visible against
// rock while a thick stack still reads through.
const SELECTION_CELL_ALPHA = 0.18;
// Box-select anchor cross: half-length of each of the three axis strokes (m).
const ANCHOR_CROSS_HALF_M = 0.25;

// --- the translate gizmo (D-9) ---------------------------------------------
// Semantic axis colours — X red, Y green, Z blue. The SAME palette the chrome's
// AxisTriad draws (its own comment already promises they match this gizmo),
// converted from those CSS hexes to LINEAR sRGB by the sRGB EOTF
// (`c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`). The conversion is the
// whole point: shaders write LINEAR and the swap chain applies the sRGB encoding
// on output (engine-conventions §Color space), so shipping the 0-1 hex directly
// would be double-encoded and the arms would render as pale pastels — "red"
// around rgb(243,145,148). SELECTED_COLOR is converted the same way.
//
// No test can catch this: the GPU fixtures request `surfaceFormat: "linear"`, so
// the encode this compensates for never runs there. It is arithmetic plus review,
// like SELECTED_COLOR, and the hexes are kept in the trailing comments so
// the conversion stays checkable.
const AXIS_COLOR: Record<Axis, [number, number, number, number]> = {
  x: [0.7835, 0.0648, 0.0742, 1], // #e5484d
  y: [0.0612, 0.3864, 0.0976, 1], // #46a758
  z: [0.1046, 0.2664, 0.8632, 1], // #5b8def
};
// The schema key the quarter-turn cycles. Core spells it the same way (its own
// `ROTATION_KEY`), and both hall and maze carry it; cave and scatter do not.
const ROTATION_PARAM = "rotation";
// Cursor travel (px) before a press on the SELECTED entity stops being a click
// and becomes a move. Below it a hand tremor between mousedown and mouseup must
// not open a session, let alone splice the log.
const DRAG_THRESHOLD_PX = 4;

// Load-time compaction fires only when the loaded log carries MORE than this
// many foldable ops (spec D-F3-16). Named, not inlined: the meter's
// `compactable N` reads against the SAME logStats ceiling, so a user watches
// the number climb toward the point where the next load will fold it.
const COMPACT_THRESHOLD_OPS = 200;

// Default tool: dig/rock, unmasked, SMOOTH_DEFAULTS-equivalent literal (a
// fresh object per call — never an alias of core's shared SMOOTH_DEFAULTS).
function defaultTool(): FieldTool {
  return {
    effect: "dig",
    materialId: 0,
    mask: { kind: "none" },
    smooth: { ...field.SMOOTH_DEFAULTS },
    hollow: null,
  };
}

// Deep-enough copy so host state never aliases panel-held (or panel-handed)
// objects: mask + smooth are the only nested fields.
function cloneTool(t: FieldTool): FieldTool {
  return {
    effect: t.effect,
    materialId: t.materialId,
    mask: { ...t.mask },
    smooth: { ...t.smooth },
    hollow: t.hollow,
  };
}

// The chassis-side parameter clamp applied on every setTool (see the FieldHost
// TSDoc for why the chassis is the enforcement point).
function clampTool(t: FieldTool): FieldTool {
  const c = cloneTool(t);
  c.smooth.strength = clampIntRange(
    c.smooth.strength,
    1,
    field.SMOOTH_MAX_STRENGTH,
  );
  c.smooth.iterations = clampIntRange(
    c.smooth.iterations,
    1,
    field.SMOOTH_MAX_ITERATIONS,
  );
  if (c.hollow !== null) c.hollow = Math.max(HOLLOW_MIN_M, c.hollow);
  return c;
}

/** The generator's JSON-Schema `properties` map, narrowed off the loosely-typed
 *  `paramSchema` — the clamp-bound source {@link deriveSizeDefaults} reads. A
 *  schema without a properties object yields `{}`, not a throw: a size-less
 *  generator derives nothing, so the empty map flows to deriveSizeDefaults'
 *  no-op branch untouched (setup-loud stays with `boundOf`, which fires only for
 *  a generator that DOES derive but is missing a specific numeric bound). */
function generatorSchemaProperties(
  def: field.GeneratorDef,
): Record<string, unknown> {
  const props = def.paramSchema["properties"];
  if (typeof props !== "object" || props === null) return {};
  // Boundary cast: GeneratorDef.paramSchema is typed Record<string, unknown>;
  // the runtime check above proves `properties` is a non-null object, which is
  // always index-readable as Record<string, unknown> (values stay unknown).
  return props as Record<string, unknown>;
}

/**
 * Create an uninitialized field host. `init(canvas)` must run before any GPU
 * operation. The host owns its whole lifecycle (own context, own camera, own
 * listeners), drives a fly camera + dig loop, and remeshes carved chunks off the
 * main thread via the field worker.
 *
 * `deps.spawnWorker` / `deps.spawnAnalyzer` override how the two workers (the
 * remesher and the walkability analyzer) are created; production omits both and
 * gets the real `/field-worker.js` and `/analyzer-worker.js`. They exist because
 * the host's worker-backed paths are otherwise unreachable under `bun test`: a
 * job posted to a Worker spawned from those browser URLs never settles
 * in-process (measured: still pending after 1 s), so nothing downstream of a
 * request ever runs. Injecting the protocol handler directly is what lets a test
 * see the request the host builds AND drive the response back through it.
 *
 * `deps.requestContext` overrides how {@link FieldHost.init} acquires the GPU
 * context, and exists for the same class of reason: a real context never reports
 * the options it was built from, so the only way to prove `init` asks for the MSAA
 * the caller wanted is to record the request. Production omits it.
 */
export function createFieldHost(deps?: {
  spawnWorker?: () => WorkerLike;
  spawnAnalyzer?: () => WorkerLike;
  requestContext?: typeof gpu.requestContext;
}): FieldHost {
  const requestContext = deps?.requestContext ?? gpu.requestContext;
  let ctx: Context | null = null;
  let cam: camera.Camera | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let unbindCamera: (() => void) | null = null;

  const store = field.createFieldStore();
  const log = field.createOpLog();
  const dirty = new Set<string>();
  const worker = new FieldWorkerClient(deps?.spawnWorker);
  const chunkMeshes = new Map<string, ChunkRender>();

  // ONE material for the `normals` debug mode (normalColor): every class looks
  // identical under it — the v0 coarseness is deliberate (structure legibility over
  // class colour, which is what `studio` is for).
  let normalsMat: material.Material | null = null;
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
  // Filled kit-fill ghost: ONE unit cube + ONE translucent hologram-blue
  // material, positioned + scaled to the snapped box per frame (mesh.setScale
  // exists — no per-size rebuild needed) and pushed into the render list only
  // while a kit-fill ghost is live.
  let ghostMat: material.Material | null = null;
  let ghostBind: binding.Binding | null = null;
  let ghostCube: mesh.Mesh | null = null;
  let ghostCubeGeo: geometry.Geometry | null = null;
  // Studio is the state of seeing (D-F4.5-17), so it is what a host with no chrome
  // attached already renders — the chrome pushing its own default is agreement, not
  // the thing that turns the lights on.
  let shading: FieldHostShading = "studio";

  // The project's resolved material table — drives the mesher's bucket split,
  // logApply validation, and the bake. Defaults rock-only until setMaterialTable.
  let table: field.MaterialTable = field.BUILTIN_TABLE;
  let tool: FieldTool = defaultTool();
  // Momentary tool overrides (Shift = smooth, Ctrl = dig↔fill invert). ONE
  // saved slot: the pre-momentary tool, saved when the FIRST modifier engages
  // and restored when BOTH are released. The effective tool is DERIVED, not
  // stacked — a pure function of (saved, shiftHeld, ctrlHeld), so any
  // press/release order restores the original tool (see deriveMomentary).
  let momentarySaved: FieldTool | null = null;
  let momentaryShift = false;
  let momentaryCtrl = false;
  // Panel mirror for host-initiated tool changes (eyedropper, momentary).
  let toolCb: ((p: FieldToolPush) => void) | null = null;
  // The user-facing message channel (the chrome's toast stack + message log).
  let toolErrorCb: ((msg: string, severity: ToolErrorSeverity) => void) | null =
    null;
  // Once-per-GESTURE guard for the "selection mask but no selection" report.
  // The gesture whose repeats need suppressing is the drag: a stroke re-arms
  // this at pointer-down, so one 40ms-throttled drag reports once. The segment
  // brush re-arms per COMMIT instead — its unit is the two-click pair, not a
  // drag, so sharing the stroke's re-arm point would silence every segment
  // after the first.
  let maskDropReported = false;

  // --- gesture + selection state (armed slot, current + Reselect, overlay) --
  // What LMB does: one slot for `pointer`, the three cell-selection gestures
  // AND the segment brush (see ViewportGesture) — they all bind the same click,
  // so they cannot be armed independently.
  //
  // POINTER is the default (D-F4.5-7): a host opens ready to SELECT, not ready
  // to dig, so the first click on a world can never be a destructive one. Two
  // existing behaviours fall out of that with no new rule — the brush ghost
  // hides (renderScene draws it only while `gesture === null`) and LMB bypasses
  // applyTool (the arbitration below) — which is exactly right: nothing on
  // screen promises a stroke that will not happen. Arming a brush effect is what
  // the chrome does to get back to `null`.
  let gesture: ViewportGesture | null = "pointer";
  // Pending box-select anchor: the first click's world point (null = none).
  let boxAnchor: Vec3T | null = null;
  // Pending SEGMENT anchor: the first click's world point (null = none). Its
  // own slot rather than a shared one — the two gestures are mutually
  // exclusive through `gesture`, but a shared anchor would silently survive a
  // box→segment switch as a segment start the user never clicked.
  let segmentAnchor: Vec3T | null = null;
  let selection: SelectionState | null = null;
  // The Reselect slot: the one previous selection (clear/replace park it here).
  let lastSelection: SelectionState | null = null;
  let selectionCb: ((info: SelectionInfo | null) => void) | null = null;
  // Overlay line batches, rebuilt on selection/anchor CHANGE — never per frame
  // (materializeSelection cost lives on the click; the overlay is stored). The
  // box preview below is the one exception to "on change": it rebuilds on
  // pointer MOVE while a box anchor is pending — still never per frame.
  let selectionBatch: LineBatch | null = null;
  let anchorBatch: LineBatch | null = null;
  // The snapped-region AABB the pending anchor + cursor would commit, rebuilt on
  // pointer MOVE (never per frame). Null unless a box anchor is pending; cleared
  // with the anchor (setBoxAnchor(null)).
  let boxPreviewBatch: LineBatch | null = null;
  // The segment brush's two overlays, both hologram-blue and both under the
  // GHOST layer (a pending capsule is a preview of a brush op, not a selection):
  // the anchor cross, and the capsule wireframe the second click would commit —
  // rebuilt on pointer MOVE, never per frame, like boxPreviewBatch.
  let segmentAnchorBatch: LineBatch | null = null;
  let segmentPreviewBatch: LineBatch | null = null;
  // The segment preview's far endpoint — the last cursor point that resolved to
  // a surface while an anchor was pending. Kept beside the batch so a RADIUS
  // change can re-fatten the capsule without a fresh raycast (the raycast is
  // what makes updateSegmentPreview a pointer-MOVE job; the batch itself is
  // cheap). Cleared with the anchor.
  let segmentPreviewEnd: Vec3T | null = null;

  // --- the pending stamp arm (region-draw entry, D-F4.5-7) ------------------
  // The generator picked with nothing selected: LMB spans a region for it, and
  // that region opens the session. See the PendingStamp type for why it is NOT
  // a `gesture` member — it SHADOWS the armed gesture rather than replacing it,
  // so ending it restores what LMB did with nothing to put back.
  let pendingStamp: PendingStamp | null = null;
  let pendingStampCb: ((p: PendingStamp | null) => void) | null = null;
  // Once-per-SESSION guard for the brush-suspension report (`suspendedByStamp`).
  // Re-armed where a session opens rather than where one ends, so the unit is
  // the session the user is looking at: one sentence per session, however many
  // times they click into it.
  let suspendReported = false;

  // The project's entity catalog, indexed by archetype id (empty until
  // setEntityCatalog — a project with no catalog stays empty forever and every
  // prop draws at the fallback proxy). The ARRAY is kept beside the map because
  // the two seeding paths need ORDER (the archetypeId enum, and startStamp's
  // "the catalog's first" fallback), which a Map's iteration order gives but
  // reads worse.
  let archetypes: readonly EntityArchetype[] = [];
  let archetypeById: ReadonlyMap<string, EntityArchetype> = new Map();
  // The committed prop layer: one instanced draw per archetype, rebuilt from the
  // op log's placement records by rebuildProps.
  const propMeshes: PropRender[] = [];
  // The layer's per-archetype instance counts as of the last rebuildProps — the
  // ONE observable fact about a layer that is otherwise write-only GPU state
  // (see propInstanceCounts). Recorded even when there is no context, because
  // rebuildProps' whole job is to decide these numbers and only then upload
  // them; init() replays the upload from the same source.
  let propCounts = new Map<string, number>();

  // The walkability advisor's marker layer: ONE instanced unit cube for every
  // VISIBLE finding, its per-instance tint the severity/verdict colour. Null
  // when nothing is visible or before GPU init. `markerCount` is its
  // propCounts twin — decided by every rebuild, uploaded only when a context
  // exists.
  let flagMarkers: { im: mesh.InstancedMesh; g: geometry.Geometry } | null =
    null;
  let flagMarkerMat: material.Material | null = null;
  let flagMarkerBind: binding.Binding | null = null;
  let markerCount = 0;

  // The cell-level selection display (f2b gate item 1): ONE translucent instanced
  // cube per drawn cell of a `cells` selection, so a flood the camera is standing
  // inside reads as a shape rather than as an AABB outline the user cannot see
  // from within. Null for a region selection, for no selection, and before GPU
  // init. `selectionCellsCount` is the markerCount twin — decided by every
  // rebuild, uploaded only when a context exists.
  let selectionCells: { im: mesh.InstancedMesh; g: geometry.Geometry } | null =
    null;
  let selectionCellMat: material.Material | null = null;
  let selectionCellBind: binding.Binding | null = null;
  let selectionCellsCount = 0;

  // --- view state (layers + slice plane) ----------------------------------
  let layers: FieldLayers = {
    field: true,
    kit: true,
    props: true,
    ghost: true,
    selection: true,
    grid: true,
    flags: true,
    voidCast: false, // an X-ray costs a whole-world remesh — opt in
  };
  // Slice-view clip plane (world metres; null = off). Display + targeting
  // only — never read by logApply, the oplog, or bakeFieldWorld.
  let sliceY: number | null = null;

  // --- stamp session (ghost preview → commit) -----------------------------
  let stamp: StampSession | null = null;
  // Session generation: the pure module's run counter restarts at 0 on every
  // startSession, so run alone cannot tell a stale PREVIOUS session's response
  // from the current session's run-0 job. Bumped on every startStamp; preview
  // handlers drop responses whose captured generation is stale.
  let stampGen = 0;
  // Which of the LIVE session's params the user has spoken about, accumulated over its
  // updates. Session-scoped (cleared wherever a session opens), because it is a claim
  // about THIS conversation: an edit made to the stamp before last says nothing about
  // the one on screen now. Its one reader is the archetype re-seed below.
  let stampTouched: ReadonlySet<string> = new Set();
  // Panel mirror for stamp-session changes (Task 15).
  let stampCb: ((s: StampSession | null) => void) | null = null;
  // The last reconfigure's drift report (null = the last apply was clean, or
  // none has run) + its panel subscriber.
  let drift: field.DriftFinding[] | null = null;
  let driftCb: ((report: FieldDriftReport | null) => void) | null = null;
  // Entity-list change tick (freeze/bake dirty no chunk, so the remesh counter
  // cannot carry them — see subscribeEntities).
  let entitiesCb: (() => void) | null = null;
  // The named-history subscriber, plus the signature that decides whether a
  // republish would say anything new (see notifyHistory).
  let historyCb: ((history: FieldHistory) => void) | null = null;
  let historySig: {
    undoLen: number;
    redoLen: number;
    undoTop: field.LogEntry | undefined;
    redoTop: field.LogEntry | undefined;
  } | null = null;
  // Ghost render state: one entry per previewed chunk, every bucket drawn with
  // the ONE translucent stamp-ghost material. Rebuilt per preview response;
  // destroyed on cancel/commit/re-preview/world-reset + dispose.
  const ghostMeshes = new Map<
    string,
    { m: mesh.Mesh; g: geometry.Geometry }[]
  >();
  let stampGhostMat: material.Material | null = null;
  let stampGhostBind: binding.Binding | null = null;
  // The previewed PLACEMENTS' wireframe proxies, as ONE merged line batch
  // (hologram-blue, occlude:false) — rebuilt with the ghost meshes on every
  // preview response, cleared with them. Null = the preview placed nothing.
  let placementGhost: LineBatch | null = null;
  // The SELECTED entity (selectEntity / a `pointer` click) and its footprint
  // box, prebuilt on every change and drawn under the selection layer gate.
  // CPU-only line batch.
  //
  // The ID is tracked BESIDE the batch because a committed region is no longer
  // immutable: F3a's reconfigure can move it (the card offers nudge), and undo
  // can move it back — so the batch has to be rebuildable from the id rather
  // than only from the call that first drew it. Before F3a the box could not go
  // stale, which is why the id was not kept.
  let selectedEntityId: number | null = null;
  let entitySelectionBatch: LineBatch | null = null;
  let entitySelectionCb: ((entityId: number | null) => void) | null = null;
  // The translate gizmo's span, rebuilt with the selection box it hangs on (same
  // footprint, same invalidation), and the line batch drawn from it. The SPAN is
  // kept beside the batch because the pick needs its numbers and re-deriving
  // them from a vertex buffer is how the drawn handles and the pickable ones
  // part company. Both null whenever nothing is selected; whether they are DRAWN
  // is a separate question (gizmoVisible).
  let gizmo: GizmoSpan | null = null;
  let gizmoBatch: LineBatch | null = null;
  // The live move (null = none). Its session is the `stamp` slot — this is only
  // the cursor mapping over it, which is why every path that ends a session
  // clears this too (endMove).
  let moveDrag: MoveDrag | null = null;
  // A drop that arrived while the ghost was still in flight. The commit is
  // ready-phase gated like every other, and a release lands within a preview
  // round trip of the last cursor move far more often than not — so the drop
  // LATCHES here and the preview's settle spends it. Without it, letting go
  // straight after moving would be swallowed and the session would hang open.
  let moveCommitPending = false;
  // A press on the ALREADY-SELECTED entity, waiting to see whether the cursor
  // travels far enough to mean "move" (DRAG_THRESHOLD_PX) — the press itself
  // changes nothing, so a plain click on what is already selected stays the
  // no-op it has always been.
  let pendingMove: {
    entityId: number;
    x: number;
    y: number;
    pointerId: number;
  } | null = null;
  // The SELECTED finding's cell outline (D-F4.5-15), rebuilt with every flags
  // push. The key itself lives in the flag store — beside the findings it names,
  // so `summary()` can answer "is that row still visible?" without the host
  // holding a second copy that would have to be invalidated by every filter
  // change, every analyzer response and every world reset. Null when nothing is
  // selected, and equally when the selected key no longer resolves.
  let flagSelectionBatch: LineBatch | null = null;

  // --- void cast (the X-ray) ----------------------------------------------
  // A ghostMeshes sibling: one entry per cast chunk, every bucket on the ONE
  // translucent void material. Built by the layer's enabling edge, dropped by
  // the next field mutation (see invalidateVoidCast) — never rebuilt on its own.
  const voidCastMeshes = new Map<
    string,
    { m: mesh.Mesh; g: geometry.Geometry }[]
  >();
  let voidCastMat: material.Material | null = null;
  let voidCastBind: binding.Binding | null = null;
  // Generation guard (the stampGen pattern): bumped by every discard, so a job
  // whose field moved under it — or whose layer was switched off — lands stale
  // and is dropped instead of showing an X-ray of a world that no longer is.
  let voidCastGen = 0;
  // The generation of the job the WORKER is still computing (null = none). One
  // piece of state answering both questions, so they can never disagree: the
  // worker is busy while it is non-null, and the user is still waiting for THIS
  // cast while it equals `voidCastGen` — a discard bumps the generation, which
  // is exactly what makes a stranded job stop counting as awaited without
  // pretending the worker stopped working on it.
  let voidCastJobGen: number | null = null;

  let digRadius = 1.25;
  let digging = false;
  let lastStroke = 0;
  // Last cursor position over the viewport, so the ghost target marker can
  // preview where the next stroke lands each frame. DELIBERATELY NOT cleared
  // on pointer-leave (the size-preview affordance): the ghost keeps rendering at
  // the last hover target while the mouse is over the panel, so panel-slider
  // radius drags preview live in the viewport (renderGhost recomputes from
  // this + the CURRENT radius per frame). The ghost lingering while the mouse
  // is off-canvas is that feature's accepted trade-off.
  let lastPointer: { x: number; y: number } | null = null;
  let lastRemeshMs = 0;
  // Monotonic remesh counter (see the FieldStats TSDoc): bumped once per
  // remesh completion so the panel's entity refresh has an event-driven
  // trigger that Safari's ~1 ms performance.now() clamp can't alias.
  let remeshVersion = 0;
  let statsCb: ((s: FieldStats) => void) | null = null;
  let cameraPoseCb: ((pose: CameraPose) => void) | null = null;
  let segmentHudCb: ((hud: SegmentHud | null) => void) | null = null;
  // The segment HUD's own throttle clock, NOT `lastStroke`'s (D-25). Both admit one
  // event per STROKE_MIN_MS and that CONSTANT is shared deliberately — a readout that
  // refreshed on a different cadence from the brush it describes would be a second
  // number to reason about.
  //
  // The VARIABLE is separate because the two paths are: the segment branch in
  // `onPointerMove` returns above the stroke throttle and so never touches `lastStroke`.
  // Keeping them apart is HYGIENE rather than a fix for a live bug, and the honest size
  // of it is small — a stroke and a segment cannot be live at once (`onPointerDown`
  // routes `gesture !== null` to the gesture branch and never sets `digging`), so
  // sharing the slot would cost at most one dropped brush application, and only if the
  // user disarmed the gesture, pressed LMB and moved within one 40 ms window of the last
  // HUD push — a couple of frames, with the lost application a few px from the
  // pointerdown one that already landed. Cheap to prevent, so prevented.
  let lastSegmentHud = 0;
  // Last LANDED applyReconfigure wall-clock (ms); 0 until the first one lands.
  let lastReconfigureMs = 0;
  // logStats cache: recomputing it every rAF is an O(ops) scan that allocates
  // per frame, but the readout only moves when the LOG does. The signature is
  // the three lengths logStats reads structurally (ops + both undo stacks) —
  // every log mutation (a stroke, a commit/reconfigure, freeze/bake, ⌘Z/⇧⌘Z, a
  // load-time compaction) moves at least one of them, so a matched signature
  // proves the numbers are unchanged. The one gap it tolerates — several
  // mutations within ONE frame that net all three lengths back (undo, then a
  // fresh op) — is unreachable from single-event-per-frame input and self-heals
  // on the next mutation; a hint meter can carry that. Trackers start at -1 to
  // force the first read to compute.
  let cachedLogStats: field.LogStats = field.logStats(log);
  let statsOpsLen = -1;
  let statsUndoLen = -1;
  let statsRedoLen = -1;
  let raf = 0;
  let lastFrameT = 0;
  let disposed = false;

  // Fly camera: start a few metres up looking down at the grid origin, so the
  // blank-canvas bootstrap digs the first hole at the ground-grid centre.
  // POSITIVE pitch puts the eye ABOVE the target (toEyeTarget: eye.y = target.y +
  // distance·sin(pitch)); at distance 6 this seats the eye at y ≈ 3.9. A negative
  // pitch would sink it below the y=0 grid looking up.
  let orbitState: OrbitState = {
    target: [0, 1, 0],
    distance: 6,
    yaw: 0.6,
    pitch: 0.5,
  };
  /** Backing store for {@link FieldHost.cameraAimedByHand}. Written ONLY through
   *  {@link aimCamera} / {@link placeCamera} below, never here. */
  let cameraAimed = false;
  /** The user aimed the camera: every interactive gesture and every aim-at-a-thing
   *  verb goes through this rather than assigning `orbitState` directly.
   *
   *  A FUNNEL rather than a flag set at each of the seven call sites, and the
   *  reason is that the eighth is the one that would forget. The chrome's Open reads
   *  the latch to decide whether the user has arranged this camera, so a new camera
   *  verb that assigned `orbitState` on its own would
   *  silently make Open start yanking an arranged view. Now it cannot: assigning
   *  `orbitState` outside these two helpers is the only way to get it wrong, and all
   *  SEVEN sites are pinned — `tests/field-host-camera.test.ts` takes the three that
   *  need no GPU ({@link FieldHost.frameSelection}, {@link FieldHost.snapView},
   *  {@link FieldHost.frameChunks}), `tests/field-host-flag-select.test.ts` takes the
   *  flag report's click-to-frame, and `tests/field-host-camera.gpu.test.ts` takes the
   *  three gestures that need a live camera (the fly step, the look/orbit drag, the
   *  wheel dolly). Converting any one of them to `placeCamera` reddens exactly one. */
  const aimCamera = (next: OrbitState): void => {
    orbitState = next;
    cameraAimed = true;
  };
  /** Move the camera WITHOUT claiming the user aimed it — {@link FieldHost.frameWorld},
   *  including when the chrome's Open calls it. See
   *  {@link FieldHost.cameraAimedByHand} for why framing the world is not aiming. */
  const placeCamera = (next: OrbitState): void => {
    orbitState = next;
  };
  const keys = new Set<string>();
  // RMB-drag camera state (null when the button is up). `pivot` LATCHES which of
  // the two drags this is, decided once at the press: a world point = orbit
  // about it, null = fly-look. Latched rather than re-derived per move so the
  // gesture cannot change under the user's hand — selecting something else,
  // deleting the entity, or disarming the pointer tool mid-drag all leave the
  // drag that is running exactly as it started.
  let look: { lastX: number; lastY: number; pivot: Vec3T | null } | null = null;
  // Scroll banked toward the next dolly step, in CSS pixels — the remainder
  // `bankDolly` hands back, held here because it has to survive between wheel
  // events (see onWheel, its only reader).
  let dollyPixels = 0;

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

  // Write the current orbitState into the camera's position/target/up, and tell
  // whoever is drawing the orientation triad. The publish sits ABOVE the camera
  // guard on purpose: every path that moves the orbit ends here, and a pose change
  // is just as true before the GPU exists as after it.
  //
  // Being the ONE place every camera path ends is also why a live move's anchor
  // is retired here (see reaimMove): the anchor is a world point read under the
  // old view, and it goes stale for a fly step, a wheel dolly and an `F` framing
  // exactly as it does for a look drag. Retiring it at each of those call sites
  // instead is how one of them ends up forgotten. Inert while no move is in
  // flight, which is every call before F4.5b's move sessions existed.
  const applyOrbit = (): void => {
    reaimMove();
    cameraPoseCb?.({ yaw: orbitState.yaw, pitch: orbitState.pitch });
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
    const normalsShd = await shader.normalColor(c); // unlit, normal-distinct faces
    normalsMat = await material.create(c, { shader: normalsShd });
    const kitShd = await shader.litInstanced(c);
    kitBind = binding.create(c, kitShd);
    // White base color — per-instance tint carries the piece colour.
    binding.set(c, kitBind, { color: [1, 1, 1, 1], specular: LIT_SPECULAR });
    kitMat = await material.create(c, { shader: kitShd, binding: kitBind });
    // Kit-fill ghost cube: GHOST_COLOR's hologram-blue as a premultiplied
    // translucent volume (unlit; color = rgb·a so blend.premultiplied
    // composes correctly), depth write OFF so it never occludes the field.
    const ghostShd = await shader.unlit(c);
    ghostBind = binding.create(c, ghostShd);
    binding.set(c, ghostBind, {
      color: [
        GHOST_COLOR[0] * GHOST_CUBE_ALPHA,
        GHOST_COLOR[1] * GHOST_CUBE_ALPHA,
        GHOST_COLOR[2] * GHOST_CUBE_ALPHA,
        GHOST_CUBE_ALPHA,
      ],
    });
    ghostMat = await material.create(c, {
      shader: ghostShd,
      binding: ghostBind,
      blend: material.blend.premultiplied,
      depth: { write: false },
    });
    ghostCubeGeo = geometry.cube(c, { size: 1 });
    ghostCube = mesh.create(c, { geometry: ghostCubeGeo, material: ghostMat });
    // Stamp-ghost material: the same premultiplied hologram-blue recipe as the
    // kit-fill cube, denser (STAMP_GHOST_ALPHA), shared by ALL ghost buckets —
    // the ghost shows the stamp's SHAPE; classes/kit appear on commit.
    stampGhostBind = binding.create(c, ghostShd);
    binding.set(c, stampGhostBind, {
      color: [
        GHOST_COLOR[0] * STAMP_GHOST_ALPHA,
        GHOST_COLOR[1] * STAMP_GHOST_ALPHA,
        GHOST_COLOR[2] * STAMP_GHOST_ALPHA,
        STAMP_GHOST_ALPHA,
      ],
    });
    stampGhostMat = await material.create(c, {
      shader: ghostShd,
      binding: stampGhostBind,
      blend: material.blend.premultiplied,
      depth: { write: false },
    });
    // Void-cast material: the stamp-ghost recipe with two deliberate changes.
    // The tint is cyan (context, not a pending action), and depth COMPARES
    // ALWAYS — the load-bearing one, because an X-ray that respects depth is
    // not an X-ray. Under the default `less`, ANY front-facing opaque surface
    // between eye and cast hides it: a ground/terrain top surface (front-facing
    // from above, and it writes depth) buries every cave beneath it, and so do
    // a nearer cavity's far wall, kit pieces, and placed props — which is
    // exactly the "see the network from outside" case the tool exists for.
    //
    // NOT for z-fighting: the cast's triangles ARE the field's, same diagonal
    // wound backwards (mesher.ts), so with the engine's default `cullMode:
    // "back"` exactly one of any coincident pair survives culling and the two
    // never contend for a pixel. And NOT `depth: false`, which builds a
    // depth-LESS pipeline — invalid in frame.render's depth-having pass
    // (engine-conventions §Depth buffer).
    voidCastBind = binding.create(c, ghostShd);
    binding.set(c, voidCastBind, {
      color: [
        VOID_CAST_COLOR[0] * VOID_CAST_ALPHA,
        VOID_CAST_COLOR[1] * VOID_CAST_ALPHA,
        VOID_CAST_COLOR[2] * VOID_CAST_ALPHA,
        VOID_CAST_ALPHA,
      ],
    });
    voidCastMat = await material.create(c, {
      shader: ghostShd,
      binding: voidCastBind,
      blend: material.blend.premultiplied,
      depth: { write: false, compare: "always" },
    });
    // Walkability markers: UNLIT instanced, white base, so the per-instance
    // severity tint is the pixel and nothing else. Deliberately not the kit's
    // litInstanced material — a marker that dims when the studio key light looks
    // away is a marker that stops doing its job in the mode the editor lives in.
    const markerShd = await shader.unlitInstanced(c);
    flagMarkerBind = binding.create(c, markerShd);
    binding.set(c, flagMarkerBind, { color: [1, 1, 1, 1] });
    flagMarkerMat = await material.create(c, {
      shader: markerShd,
      binding: flagMarkerBind,
    });
    // Selection cells: the same UNLIT instanced shader, premultiplied and
    // depth-write-free like the ghosts — a selection has to read from inside the
    // volume it encloses, which is the whole point (f2b item 1), and a
    // depth-writing translucent would hide the cells behind it. The colour is the
    // material's, not the instances': every cube is the same `--primary` and
    // `createInstanced` already seeds each tint slot white.
    selectionCellBind = binding.create(c, markerShd);
    binding.set(c, selectionCellBind, {
      color: [
        SELECTED_COLOR[0] * SELECTION_CELL_ALPHA,
        SELECTED_COLOR[1] * SELECTION_CELL_ALPHA,
        SELECTED_COLOR[2] * SELECTION_CELL_ALPHA,
        SELECTION_CELL_ALPHA,
      ],
    });
    selectionCellMat = await material.create(c, {
      shader: markerShd,
      binding: selectionCellBind,
      blend: material.blend.premultiplied,
      depth: { write: false },
    });
    await buildLitMaterials(c);
  };

  const stampGhostMaterial = (): material.Material => {
    if (!stampGhostMat)
      throw new Error("field-host: stamp ghost material not initialized");
    return stampGhostMat;
  };

  const voidCastMaterial = (): material.Material => {
    if (!voidCastMat)
      throw new Error("field-host: void cast material not initialized");
    return voidCastMat;
  };

  // Material for one surface/backing bucket under the current shading mode. The
  // `normals` debug mode collapses every class to normalsMat; `studio` looks up the
  // per-class lit material (falling back to class-0 surface if the key is missing).
  const bucketMaterial = (
    classId: number,
    backing: boolean,
  ): material.Material => {
    if (shading === "normals") {
      if (!normalsMat) throw new Error("field-host: materials not initialized");
      return normalsMat;
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
    // An EMPTY set is not a field change, and saying so is load-bearing rather
    // than defensive: a pure scatter writes no cells (core `scatter.ts`'s
    // `{ ops: [], placements }`, and a placement op returns null from
    // applyFieldOp — pinned by core's "commitGenerator accepts a pure scatter",
    // which asserts `dirty.size === 0`), so committing one — or undoing it,
    // through stepHistory — arrives here with nothing changed. Without this the
    // void cast, which shows SHAPE and never props, would tear itself down on
    // the commit of a scatter that could not have staled it, and announce a
    // field change that did not happen. The loop below is already inert for an
    // empty set; only the invalidation below is not.
    if (changed.size === 0) return;
    // THE density-mutation choke point (strokes, stamp commits, ⌘Z/⇧⌘Z,
    // reconfigure apply) — and so where the void cast learns its snapshot went
    // stale. The paths that bypass it change no density: setSlice and
    // setMaterialTable re-mesh the DISPLAY, and a world new/load routes through
    // resetWorld, which discards the cast with everything else.
    invalidateVoidCast();
    // Same choke point, second consumer: the analyzer mirrors this store, so
    // this is where it learns what to copy across. Only what was WRITTEN goes in
    // — the worker widens to the chunks whose answer could have changed, and the
    // apron neighbours below are a MESH-seam rule, not that one.
    for (const k of changed) analyzerDirty.add(k);
    analyzePump.request();
    scheduleWholeWorldPass();
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

  // Build one chunk's instanced kit mesh: a unit cube drawn once per piece, each
  // transformed by its (yaw · box) matrix at its world position, tinted per piece.
  // Matrix packing + tinting live in @furnace/core/field kit-render; only GPU
  // calls here. The unit-cube + quarter-turn no-normal-matrix invariant that
  // makes litInstanced safe is documented on `packKitMatrices` — do NOT swap to
  // non-axis-aligned kit geometry (it would skew normals with no test to catch).
  const buildKit = (
    c: Context,
    key: string,
    kit: field.KitInstance[],
  ): { im: mesh.InstancedMesh; g: geometry.Geometry } | null => {
    if (kit.length === 0) return null;
    const g = geometry.cube(c, { size: 1 });
    const im = mesh.createInstanced(c, {
      geometry: g,
      material: kitInstancedMat(),
      count: kit.length,
    });
    const [cx, cy, cz] = field.parseChunkKey(key);
    const dim = field.CHUNK_DIM * store.cellSize;
    mesh.setInstanceMatrices(
      c,
      im,
      field.packKitMatrices(kit, [cx * dim, cy * dim, cz * dim]),
    );
    kit.forEach((k, i) =>
      mesh.setInstanceTint(c, im, i, field.pieceColor(table, k)),
    );
    return { im, g };
  };

  // The unit-sized proxy primitive for a collision kind — cube `size: 1`,
  // sphere/cylinder ⌀1 — so `proxyRecords`' folded scale IS the world extent.
  // Do NOT change these sizes without changing proxyScale: the two are one
  // formula split across the CPU/GPU boundary.
  const proxyGeometry = (
    c: Context,
    collision: EntityCollision,
  ): geometry.Geometry => {
    const primitive = PROXY_PRIMITIVE[collision.kind];
    if (primitive === "sphere") return geometry.sphere(c, { radius: 0.5 });
    if (primitive === "cylinder")
      return geometry.cylinder(c, { radius: 0.5, height: 1 });
    return geometry.cube(c, { size: 1 });
  };

  const destroyProps = (c: Context): void => {
    for (const p of propMeshes) {
      mesh.destroyInstanced(c, p.im);
      geometry.destroy(c, p.g);
    }
    propMeshes.length = 0;
  };

  // Rebuild the committed prop layer from the op log: one instanced proxy draw
  // per archetype, its instance count the archetype's record count, its matrices
  // core's packPlacementMatrices over records re-scaled to the catalog collision
  // primitive, its tint the archetype's catalog colour. Called by every path that
  // can change which placement ops are in the log (commit, reconfigure apply,
  // ⌘Z/⇧⌘Z, world new/load) plus the two that change how they DRAW (init,
  // setEntityCatalog). Whole-layer teardown-and-rebuild, like a chunk remesh:
  // instance counts are fixed at creation, and a placement op is a whole
  // generator's worth of props at once, so there is no partial update to make.
  // Silent no-op before GPU init — init() rebuilds once the materials exist, so
  // a world loaded pre-init still gets its props.
  const rebuildProps = (): void => {
    // The prop layer and the analyzer's collider set are derived from the SAME
    // log, so one call site keeps them in step. Whole-world, not incremental:
    // props rasterize into the solidity stage 1 reads, and there is no
    // incremental placement-sync path — `voxelizePlacements` is whole-map
    // replacement by construction.
    analyzerPlacementsStale = true;
    analyzerWholeWorld = true;
    analyzePump.request();
    const groups = groupPlacements(log.ops);
    // The counts settle FIRST and unconditionally: they are what the layer IS,
    // and recording them before the GPU guard keeps them honest for a host that
    // has not initialized yet (init replays the upload from this same log).
    propCounts = new Map([...groups].map(([id, r]) => [id, r.length]));
    const c = ctx;
    if (!c || !kitMat) return;
    destroyProps(c);
    for (const [archetypeId, records] of groups) {
      const archetype = archetypeById.get(archetypeId);
      const collision = archetype?.collision ?? FALLBACK_COLLISION;
      const g = proxyGeometry(c, collision);
      const im = mesh.createInstanced(c, {
        geometry: g,
        material: kitInstancedMat(),
        count: records.length,
      });
      mesh.setInstanceMatrices(
        c,
        im,
        field.packPlacementMatrices(proxyRecords(records, collision)),
      );
      const tint: [number, number, number, number] =
        archetype === undefined
          ? FALLBACK_TINT
          : [archetype.color[0], archetype.color[1], archetype.color[2], 1];
      records.forEach((_, i) => mesh.setInstanceTint(c, im, i, tint));
      propMeshes.push({ im, g });
    }
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
      const res = await worker.mesh(
        key,
        aprons,
        table,
        store.cellSize,
        sliceY ?? undefined,
      );
      lastRemeshMs = performance.now() - t0;
      remeshVersion++;
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

  // Report something the user should see: console (developer trail, the F2a
  // behaviour kept) + the panel subscriber.
  //
  // `error` by default because every refusal is one, and a refusal is what almost
  // every caller here has. A caller passes `warn` only when nothing went wrong;
  // exactly one does today, the advisor-idle report.
  const reportToolError = (
    msg: string,
    severity: ToolErrorSeverity = "error",
  ): void => {
    console.warn(`field-host: ${msg}`);
    toolErrorCb?.(msg, severity);
  };

  // The host's current selection spec for a selection-mask op (null = no
  // selection — toolMask drops the mask and reports once per stroke). The
  // stored spec is never mutated in place (selections replace wholesale), so
  // embedding it into ops without a copy is aliasing-safe.
  const currentSelectionSpec = (): field.SelectionSpec | null =>
    selection?.spec ?? null;

  // The active tool's mask choice as a core BrushMask (undefined = unmasked).
  // The organic/kit/class choices are structurally the core mask variants; the
  // selection choice embeds the current selection spec.
  const toolMask = (): field.BrushMask | undefined => {
    const m = tool.mask;
    if (m.kind === "none") return undefined;
    if (m.kind === "selection") {
      const spec = currentSelectionSpec();
      if (spec === null) {
        if (!maskDropReported) {
          maskDropReported = true;
          reportToolError(
            "selection mask active but there is no selection — stroke applies unmasked",
          );
        }
        return undefined;
      }
      return { kind: "selection", selection: spec };
    }
    return m;
  };

  // Build the brush op for the active tool over a caller-chosen SHAPE. The
  // shape is a parameter because two gestures build different ones from the
  // same tool: a plain stroke sweeps nothing (sphere, or the snapped lattice
  // box for a kit fill — see strokeShape), the segment brush hands in a
  // capsule. Everything else — effect, material, mask, the fill's `hollow` —
  // is the tool's and identical either way. Dig and smooth stay material-free.
  //
  // The kit question is asked ONCE, through isKitFillTool, and the answer is
  // shared with strokeShape: this used to re-derive it with a bare `classOf`,
  // which throws on an unknown id where isKitFillTool returns false — so the
  // two disagreed on exactly the input that made one of them throw.
  const toolOp = (shape: field.BrushShape): field.BrushOp => {
    const mask = toolMask();
    const base = {
      id: 0,
      kind: "brush",
      shape,
      ...(mask !== undefined && { mask }),
    } as const;
    if (tool.effect === "dig") return { ...base, effect: "dig" };
    if (tool.effect === "smooth")
      return { ...base, effect: "smooth", smooth: { ...tool.smooth } };
    const kitFill = isKitFillTool();
    // Kit-class hollow snaps to the 0.5 m lattice (floored) — core REJECTS
    // non-multiples (the shell's inner faces must land on lattice planes).
    const hollow =
      tool.effect === "fill" && tool.hollow !== null
        ? kitFill
          ? Math.max(
              HOLLOW_MIN_M,
              Math.round(tool.hollow / HOLLOW_MIN_M) * HOLLOW_MIN_M,
            )
          : tool.hollow
        : null;
    return {
      ...base,
      effect: tool.effect,
      material: tool.materialId,
      ...(hollow !== null && { hollow }),
    };
  };

  // The shape a plain (non-segment) stroke applies at a world centre: the
  // snapped lattice box when the tool is a kit fill, else the brush sphere.
  const strokeShape = (center: Vec3T): field.BrushShape =>
    isKitFillTool()
      ? snappedKitBox(center, digRadius)
      : sphereShape(center, digRadius);

  // BUILD the op for a shape and apply it through the log, marking the touched
  // chunks (+ apron neighbours) dirty. Shared by the stroke and the segment
  // commit so both carry the same failure contract: every setup-loud throw on
  // the path — a kit fill off the lattice, a kit class under a non-box shape
  // (reachable ONLY through the segment gesture), an unknown material class —
  // is reported to the panel and the op DROPPED, rather than escaping the
  // pointer handler. Reported per occurrence (each becomes its own message in
  // the chrome); only the mask-drop report is once-per-gesture.
  //
  // toolOp is called INSIDE the try deliberately, though as of this commit it
  // is TOTAL — its one throwing call became isKitFillTool, which swallows
  // classOf's unknown-id throw. So this placement is defence in depth, not a
  // live fix, and no test can currently tell the two apart (verified by
  // sabotage: hoisting the build above the try breaks nothing). What it
  // defends is real: a caller writing `commitToolOp(toolOp(shape))` evaluates
  // the build BEFORE this function is entered, so any future build-time throw
  // would escape the catch, back out through onPointerDown, and skip its
  // setPointerCapture — stranding `digging === true` with no capture, so a
  // pointerup outside the canvas latches the stroke on.
  const commitToolOp = (shape: field.BrushShape): void => {
    try {
      markDirtyWithNeighbors(field.logApply(store, log, toolOp(shape), table));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(`tool apply failed: ${message}`);
    }
    // The ONE log-mutating path that rewrites no entity record, so it is the one
    // that cannot reach `notifyHistory` through `notifyEntities` (see there).
    // OUTSIDE the try: a refused op leaves the log untouched and the push is a
    // guarded no-op, and putting it in the `catch` as well would be two spellings
    // of one call.
    notifyHistory();
  };

  // Whether the active tool fills a kit class — its ghost + op use the snapped
  // lattice box, not a sphere. Guards classOf's unknown-id throw (setup-loud) so
  // the per-frame ghost can't crash on a stray selection; returns false instead.
  const isKitFillTool = (): boolean => {
    if (tool.effect !== "fill") return false;
    try {
      return field.classOf(table, tool.materialId).kind === "kit";
    } catch {
      return false;
    }
  };

  // Cursor → world ray + the eye-in-rock probe, shared by computeTarget, the
  // eyedropper, and the selection-gesture seeds. Returns null when there is
  // no camera or the view is singular.
  //
  // `eyeInRock` is the DISPLAY-space probe (slice coherence, F2b sweep): with
  // an active slice, an eye at/above the clip plane sits in DISPLAY air even
  // when the field there is rock — the slice hides that rock and the
  // raycast's maxY clip suppresses its t=0 self-hit — so it reports false and
  // EVERY gesture site then raycasts onto the sliced surface the user sees
  // (what you see is what you target). Quantized to the eye's VOXEL BASE
  // (worldToVoxel·cellSize) because the raycast clips whole voxels by base —
  // a continuous origin-Y compare disagrees for a non-lattice-aligned sliceY
  // inside the eye's own voxel.
  const cursorRay = (
    clientX: number,
    clientY: number,
  ): { origin: Vec3T; dir: Vec3T; eyeInRock: boolean } | null => {
    if (!cam) return null;
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
    if (Math.hypot(dx, dy, dz) < 1e-8) return null; // singular VP → no valid ray
    const cs = store.cellSize;
    const buried =
      field.getDensity(
        store,
        field.worldToVoxel(ox, cs),
        field.worldToVoxel(oy, cs),
        field.worldToVoxel(oz, cs),
      ) < 0;
    const eyeInRock =
      buried && (sliceY === null || field.worldToVoxel(oy, cs) * cs < sliceY);
    return { origin: [ox, oy, oz], dir: [dx, dy, dz], eyeInRock };
  };

  // Slice-coherence (F2b Task 15 disposition): EVERY cursor-driven field
  // raycast passes the slice clip, not just computeTarget — an eyedrop, a
  // box-select corner, or a flood seed under an active slice must land on the
  // sliced surface the user SEES, never on rock the display hides (what you
  // see is what you target). The four gesture sites below share this helper.
  const sliceOpts = (): { maxY: number } | undefined =>
    sliceY === null ? undefined : { maxY: sliceY };

  // The world-space brush centre for a cursor position under the dig-feel contract
  // (field-brush.computeBrushCenter). The eye-in-rock probe + field raycast live
  // HERE — they need the field + camera — while the pure module does the arithmetic.
  // Returns null when there is no camera or the view is singular.
  const computeTarget = (clientX: number, clientY: number): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    const { origin, dir, eyeInRock } = ray;
    // If the eye is embedded in rock (virgin world or buried), raycastField would
    // hit the origin's OWN voxel at t=0 (raycast.ts: "a start inside rock hits its
    // own voxel at t=0"), so we pass eyeInRock and the pure module mines forward
    // from the eye. When the eye is in (display) air, apply where the ray meets
    // rock, or dig ahead when it reaches maxDist through only air (a cavity aimed
    // at open space). Under an active slice, cursorRay's display-space probe
    // already treats a buried eye at/above the plane as in-air, so strokes land
    // on the sliced surface shown.
    const rc = eyeInRock
      ? null
      : field.raycastField(store, origin, dir, DIG_RANGE_M, sliceOpts());
    return computeBrushCenter(
      { origin, dir, eyeInRock, hit: rc ? rc.point : null },
      digRadius,
    );
  };

  // Alt-click eyedropper: read the material class at the TARGET voxel — the
  // SOLID voxel the cursor ray hits (raycastField's `voxel`, never the pre-hit
  // air voxel), or the eye's own voxel when embedded in rock — into the active
  // tool. A miss (open air to max range) changes nothing. Never strokes.
  const eyedropper = (clientX: number, clientY: number): void => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return;
    const cs = store.cellSize;
    let voxel: [number, number, number];
    if (ray.eyeInRock) {
      voxel = [
        field.worldToVoxel(ray.origin[0], cs),
        field.worldToVoxel(ray.origin[1], cs),
        field.worldToVoxel(ray.origin[2], cs),
      ];
    } else {
      // Slice-coherent (sliceOpts): sample the class at the VISIBLE sliced
      // surface, never at hidden rock above the plane.
      const rc = field.raycastField(
        store,
        ray.origin,
        ray.dir,
        DIG_RANGE_M,
        sliceOpts(),
      );
      if (!rc) return;
      voxel = rc.voxel;
    }
    const id = field.getMaterial(store, voxel[0], voxel[1], voxel[2]);
    // Paint is organic-only: the swatch strip disables kit classes while
    // paint is armed (a kit materialId arms a stroke core rejects every
    // time) — mirror that rule here, so a kit-cell Alt-click under paint
    // adopts nothing, like a miss. Guarded lookup, not classOf: an id
    // missing from the table keeps the pre-existing adopt-as-is behaviour
    // (the stroke path owns that setup-loud throw).
    if (
      tool.effect === "paint" &&
      table.classes.find((c) => c.id === id)?.kind === "kit"
    )
      return;
    if (id === tool.materialId) return;
    // Immutable replacement (never in-place mutation) so the effective tool
    // can't alias the momentary-saved slot; the saved base picks up the same
    // material so a later momentary release keeps the eyedropped class.
    tool = { ...tool, materialId: id };
    if (momentarySaved !== null)
      momentarySaved = { ...momentarySaved, materialId: id };
    notifyTool();
  };

  // Apply the active tool at a cursor position: compute the dig-feel centre,
  // build the op, and commit it through the shared failure contract.
  const applyTool = (clientX: number, clientY: number): void => {
    const at = computeTarget(clientX, clientY);
    if (!at) return;
    commitToolOp(strokeShape(at));
  };

  // --- selection gestures + overlay ---------------------------------------

  // Metre AABB of a stored selection: a region's own bounds; a flood's cell
  // bounds expanded to enclose whole voxel volumes (sample i spans
  // [i·h, (i+1)·h) — bounds×h alone would give a single cell zero volume).
  const selectionAabb = (
    s: SelectionState,
  ): { min: Vec3T; max: Vec3T } | null => {
    if (s.materialized.kind === "region")
      return { min: [...s.materialized.min], max: [...s.materialized.max] };
    const b = s.materialized.bounds;
    if (b === null) return null;
    const h = store.cellSize;
    return {
      min: [b.min[0] * h, b.min[1] * h, b.min[2] * h],
      max: [(b.max[0] + 1) * h, (b.max[1] + 1) * h, (b.max[2] + 1) * h],
    };
  };

  // Clone a spec so the panel (via SelectionInfo) never holds references into
  // host selection state.
  const cloneSelectionSpec = (s: field.SelectionSpec): field.SelectionSpec => {
    if (s.kind === "region")
      return { kind: "region", min: [...s.min], max: [...s.max] };
    if (s.kind === "flood-material")
      return {
        kind: "flood-material",
        seed: [...s.seed],
        classId: s.classId,
        budget: s.budget,
      };
    return { kind: "flood-void", seed: [...s.seed], budget: s.budget };
  };

  const selectionInfo = (s: SelectionState): SelectionInfo => {
    const count =
      s.materialized.kind === "cells"
        ? s.materialized.count
        : regionSampleCount(
            s.materialized.min,
            s.materialized.max,
            store.cellSize,
          );
    return {
      spec: cloneSelectionSpec(s.spec),
      count,
      truncated: s.materialized.kind === "cells" && s.materialized.truncated,
      aabb: selectionAabb(s),
      // Present only when the display is PARTIAL. A region's `selectionCellsCount`
      // is 0 by design (it draws a box, not cubes) and reporting that as
      // "displaying 0 of 400" would be a truthful number describing the wrong
      // thing, so the test is against the cell layer's own domain.
      ...(s.materialized.kind === "cells" && selectionCellsCount < count
        ? { displayed: selectionCellsCount }
        : {}),
    };
  };

  const notifySelection = (): void => {
    selectionCb?.(selection === null ? null : selectionInfo(selection));
  };

  // The 12-edge line batch of a metre AABB — the cell-selection overlay and the
  // selected entity's footprint box share it.
  const aabbEdgeBatch = (
    aabb: { min: Vec3T; max: Vec3T },
    color: [number, number, number, number],
  ): LineBatch => {
    const center = boxCentre(aabb);
    const half: Vec3T = [
      (aabb.max[0] - aabb.min[0]) / 2,
      (aabb.max[1] - aabb.min[1]) / 2,
      (aabb.max[2] - aabb.min[2]) / 2,
    ];
    return boxEdges(boxCorners(center, half), color);
  };

  const rebuildSelectionBatch = (): void => {
    const aabb = selection === null ? null : selectionAabb(selection);
    selectionBatch =
      aabb === null ? null : aabbEdgeBatch(aabb, SELECTION_COLOR);
  };

  const destroySelectionCells = (c: Context): void => {
    if (!selectionCells) return;
    mesh.destroyInstanced(c, selectionCells.im);
    geometry.destroy(c, selectionCells.g);
    selectionCells = null;
  };

  // Rebuild the cell-level selection display: ONE translucent instanced cube per
  // drawn cell, shell first, capped (see field-selection-cells.ts). Runs on
  // selection COMMIT and never per frame — the enumeration is O(selected cells)
  // and the cells cannot change without a new selection.
  //
  // `cells` materializations ONLY. A REGION keeps the honest AABB outline it has
  // always had: a region IS its box, so filling it with cubes would draw the same
  // information at 65 000× the cost. The outline stays for floods too — it is the
  // extent, and the cubes are the shape.
  const rebuildSelectionCells = (): void => {
    const materialized = selection?.materialized;
    const plan =
      materialized === undefined || materialized.kind !== "cells"
        ? null
        : selectionDisplayCells(materialized.chunks, SELECTION_DISPLAY_CAP);
    // The count settles FIRST and unconditionally (rebuildFlagMarkers' rule): it
    // is what the layer IS, and a host with no context has still decided it.
    selectionCellsCount = plan?.displayed ?? 0;
    const c = ctx;
    if (!c || !selectionCellMat) return;
    destroySelectionCells(c);
    if (plan === null || plan.displayed === 0) return;
    const g = geometry.cube(c, { size: 1 });
    const im = mesh.createInstanced(c, {
      geometry: g,
      material: selectionCellMat,
      count: plan.displayed,
    });
    // One cell cube per instance, the flag-marker matrix layout: uniform scale on
    // the diagonal, position in the last column, no rotation. A cell spans
    // `[i·h, (i+1)·h)` so its CENTRE is half a cell past its sample corner —
    // the same offset `selectionAabb` applies when it expands a flood's cell
    // bounds to whole voxel volumes.
    const h = store.cellSize;
    const matrices = new Float32Array(16 * plan.displayed);
    for (let i = 0; i < plan.displayed; i++) {
      const o = i * 16;
      matrices[o] = h;
      matrices[o + 5] = h;
      matrices[o + 10] = h;
      matrices[o + 12] = ((plan.cells[i * 3] as number) + 0.5) * h;
      matrices[o + 13] = ((plan.cells[i * 3 + 1] as number) + 0.5) * h;
      matrices[o + 14] = ((plan.cells[i * 3 + 2] as number) + 0.5) * h;
      matrices[o + 15] = 1;
    }
    mesh.setInstanceMatrices(c, im, matrices);
    // No per-instance tint: `createInstanced` seeds every slot WHITE and the
    // material's premultiplied `--primary` is the colour, so 65 000 setInstanceTint
    // calls would each write the same four floats they already hold.
    selectionCells = { im, g };
  };

  const setBoxAnchor = (p: Vec3T | null): void => {
    boxAnchor = p;
    if (p === null) {
      anchorBatch = null;
      boxPreviewBatch = null; // the pending-region preview dies with its anchor
      return;
    }
    anchorBatch = segmentsToBatch(
      crossSegments(p, ANCHOR_CROSS_HALF_M),
      SELECTION_COLOR,
    );
  };

  // The pending stamp arm (null = none). Pushes on CHANGE only: the clear runs
  // from several paths that are usually no-ops (every gesture arm), and a
  // subscriber re-rendering on each of those would pay for nothing.
  //
  // DISARMING TAKES THE CORNER WITH IT, and it happens HERE rather than at each
  // caller because five paths clear the arm and only one of them (the Esc
  // ladder, whose earlier rung owns the anchors) was clearing the corner: a
  // `setGesture` re-arming what is already armed, `openEntitySession` — reached
  // by the Entities palette's Open AND by every `G` grab through
  // `beginMoveSession` — and a selection-first `startStamp`, reachable with no
  // click at all through Reselect. Each left an amber cross drawing with nothing
  // armed to close it, and each ate an Esc rung on the way out.
  //
  // Safe by construction rather than by care: while an arm stands, ANY box
  // anchor belongs to it. `startStamp` clears both anchors before arming, and
  // LMB routes to `stampRegionClick` ahead of the gesture branch, so
  // `selectionClick` — the only other route into `boxCorner` — cannot run.
  // The change guard above is what keeps this off the plain `setGesture` path,
  // so "re-arming the same gesture must not drop a pending anchor" still holds.
  const setPendingStamp = (next: PendingStamp | null): void => {
    if ((pendingStamp?.id ?? null) === (next?.id ?? null)) return;
    const disarming = pendingStamp !== null && next === null;
    pendingStamp = next;
    if (disarming) setBoxAnchor(null);
    pendingStampCb?.(next === null ? null : { ...next });
  };

  // Install a new current selection (null = clear): park the displaced one in
  // the Reselect slot, rebuild the overlay, notify the panel.
  // Both halves of what a selection LOOKS like — the extent outline and the cell
  // cubes — through one call, so no path can refresh one and forget the other.
  // It exists because a path did: `reselect` does its own swap (setSelection
  // would overwrite the slot it is restoring) and so had its own pair of rebuild
  // calls, which is precisely how the cell layer came back empty from a Reselect
  // while the outline came back correct.
  //
  // Always BEFORE a `notifySelection`, because `selectionInfo` reports how many
  // cells the display settled on (the publishFlags ordering rule: no subscriber
  // may read a payload whose overlay is still the previous selection's).
  const refreshSelectionDisplay = (): void => {
    rebuildSelectionBatch();
    rebuildSelectionCells();
  };

  const setSelection = (next: SelectionState | null): void => {
    if (selection !== null) lastSelection = selection;
    selection = next;
    refreshSelectionDisplay();
    notifySelection();
  };

  // The surface point for a box-select click: the RAW raycast hit point — NOT
  // computeTarget's brush-offset centre (a region corner must sit ON the wall,
  // not bitten past it). Falls back to the dig-feel target when the ray misses
  // everything or the eye is buried, so a click into open air still anchors.
  const selectionPoint = (clientX: number, clientY: number): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    if (!ray.eyeInRock) {
      // Slice-coherent (sliceOpts): a corner clicked under an active slice
      // sits ON the sliced surface shown, not on a hidden wall above it.
      const rc = field.raycastField(
        store,
        ray.origin,
        ray.dir,
        DIG_RANGE_M,
        sliceOpts(),
      );
      if (rc) return rc.point;
    }
    return computeTarget(clientX, clientY);
  };

  // The outward-0.5 lattice snap lives in field-brush.ts (snapSpan) — shared
  // with the stamp session's selection→region derivation.
  const boxRegionSpec = (a: Vec3T, b: Vec3T): field.SelectionSpec => {
    const [x0, x1] = snapSpan(a[0], b[0]);
    const [y0, y1] = snapSpan(a[1], b[1]);
    const [z0, z1] = snapSpan(a[2], b[2]);
    return { kind: "region", min: [x0, y0, z0], max: [x1, y1, z1] };
  };

  // Box-select live preview: the amber AABB of the SNAPPED region the second
  // click would commit (boxRegionSpec of anchor→cursor), rebuilt on pointer
  // MOVE while a box anchor is pending. A region spec's min/max ARE its metre
  // AABB, so build the edge batch directly (no materializeSelection). A cursor
  // that resolves to no surface point leaves the last preview untouched — a
  // transient miss must not flicker the box off.
  const updateBoxPreview = (clientX: number, clientY: number): void => {
    if (boxAnchor === null) return;
    const p = selectionPoint(clientX, clientY);
    if (!p) return;
    const spec = boxRegionSpec(boxAnchor, p);
    // boxRegionSpec only ever builds a region; this kind check narrows the
    // field.SelectionSpec union so min/max are accessible (cf. cloneSelectionSpec).
    if (spec.kind !== "region") return;
    // spec.min/max are fresh tuples nothing else aliases, and aabbEdgeBatch
    // reads them without retaining a reference — pass them directly (no copy).
    boxPreviewBatch = aabbEdgeBatch(
      { min: spec.min, max: spec.max },
      SELECTION_COLOR,
    );
  };

  // Material-select seed: the SOLID voxel under the cursor — the raycast hit
  // voxel, or the eye's own voxel when embedded in rock (eyedropper parity).
  // A miss (open air to max range) reports and yields null.
  const materialSeedVoxel = (
    clientX: number,
    clientY: number,
  ): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    const cs = store.cellSize;
    if (ray.eyeInRock)
      return [
        field.worldToVoxel(ray.origin[0], cs),
        field.worldToVoxel(ray.origin[1], cs),
        field.worldToVoxel(ray.origin[2], cs),
      ];
    // Slice-coherent (sliceOpts): the flood seed is the first VISIBLE solid
    // under the cursor — the flood itself then runs on the real field.
    const rc = field.raycastField(
      store,
      ray.origin,
      ray.dir,
      DIG_RANGE_M,
      sliceOpts(),
    );
    if (!rc) {
      reportToolError("material select: no rock under the cursor within range");
      return null;
    }
    return rc.voxel;
  };

  // Void-select seed: the last AIR voxel the ray traverses before its rock
  // hit (FieldHit.prev — guaranteed air here: with the eye in air, every
  // pre-hit voxel the DDA crossed was non-rock). A miss (all air to max
  // range) falls back to the brush TARGET's voxel — computeTarget's
  // open-space point, itself in air on an all-air ray. An eye embedded in
  // rock has no air on the ray at all (the cast self-hits at t=0), so that
  // reports and bails instead of yielding an empty flood.
  const voidSeedVoxel = (clientX: number, clientY: number): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    if (ray.eyeInRock) {
      reportToolError(
        "void select: the eye is inside rock — aim from open air",
      );
      return null;
    }
    // Slice-coherent (sliceOpts): `prev` then precedes the first VISIBLE rock
    // hit. Under an active slice it can be a display-air voxel that is rock in
    // the real field — the flood then finds no air there and reports "no
    // matching cells" instead of selecting a pocket the display hides.
    const rc = field.raycastField(
      store,
      ray.origin,
      ray.dir,
      DIG_RANGE_M,
      sliceOpts(),
    );
    if (rc) return rc.prev;
    const target = computeTarget(clientX, clientY);
    if (!target) return null;
    const cs = store.cellSize;
    return [
      field.worldToVoxel(target[0], cs),
      field.worldToVoxel(target[1], cs),
      field.worldToVoxel(target[2], cs),
    ];
  };

  // Materialize a gesture-built spec into the current selection. Runs on the
  // CLICK only (never per frame — full-budget floods cost ~60-80ms). A flood
  // can legitimately come up empty (nothing matched); that reports instead of
  // silently displacing the current selection.
  const commitSelectionSpec = (spec: field.SelectionSpec): void => {
    let materialized: field.MaterializedSelection;
    try {
      materialized = field.materializeSelection(store, spec);
    } catch (err) {
      // Setup-loud spec validation (integer seeds, budget range) — gesture-
      // built specs shouldn't trip it; swallow so a bug can't escape the
      // pointer handler.
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(`selection failed: ${message}`);
      return;
    }
    if (materialized.kind === "cells" && materialized.count === 0) {
      reportToolError("selection found no matching cells at the click point");
      return;
    }
    setSelection({ spec, materialized });
  };

  // --- segment brush (two-click swept capsule, D-F3-14) -------------------

  // The chrome's mirror of the pending segment (D-25). Measured between the SAME two
  // endpoints the preview capsule is swept between, so the number on the status bar and
  // the wireframe in the viewport can never describe different segments.
  //
  // With no far end resolved the only point the host has is the anchor, so the honest
  // length is 0 rather than nothing — which is what makes the anchoring click's own push
  // meaningful. Two ways to be in that state, and 0 is right for both: the cursor has
  // not moved since the click, or it has moved and resolved no surface (`if (!p) return`
  // in `updateSegmentPreview`, which deliberately leaves the last preview standing).
  const publishSegmentHud = (): void => {
    if (segmentAnchor === null) {
      segmentHudCb?.(null);
      return;
    }
    const lenM =
      segmentPreviewEnd === null
        ? 0
        : segmentLength(segmentAnchor, segmentPreviewEnd);
    segmentHudCb?.({ lenM, capM: MAX_SEGMENT_M });
  };

  // The HUD's pointer-rate half, on the stroke cadence. Throttled because it crosses
  // into React: an unthrottled push re-renders the status bar once per pointermove,
  // which is the cost the whole cadence split in `useFieldHostState` exists to avoid.
  //
  // Called only from the RESOLVED-point path in `updateSegmentPreview`, deliberately:
  // a cursor that hits nothing leaves the preview capsule standing, so publishing
  // there would spend the window's one push on a length that did not change and stale
  // the next real move by up to STROKE_MIN_MS. The edge pushes in `setSegmentAnchor`
  // are what guarantee the readout is never left WRONG — this only decides how often
  // a live one refreshes.
  const publishSegmentHudThrottled = (): void => {
    const now = performance.now();
    if (now - lastSegmentHud < STROKE_MIN_MS) return;
    lastSegmentHud = now;
    publishSegmentHud();
  };

  // The pending segment start (null = none), plus its hologram-blue cross. The
  // preview capsule dies with the anchor: without a start point there is no
  // second endpoint to sweep to.
  //
  // THE edge for the HUD, and the reason the push lives here rather than at the call
  // sites: every path that arms or drops an anchor goes through this one function (six
  // today — the anchoring click, the committing one, the Esc ladder, `resetWorld`,
  // `setGesture` and a stamp arm), so a chrome readout left standing over a segment
  // that no longer exists is not reachable rather than merely unobserved.
  const setSegmentAnchor = (p: Vec3T | null): void => {
    segmentAnchor = p;
    if (p === null) {
      segmentAnchorBatch = null;
      segmentPreviewBatch = null;
      segmentPreviewEnd = null;
      publishSegmentHud();
      return;
    }
    segmentAnchorBatch = segmentsToBatch(
      crossSegments(p, ANCHOR_CROSS_HALF_M),
      GHOST_COLOR,
    );
    publishSegmentHud();
  };

  // The capsule the second click would build: same endpoints, same radius as
  // the op. Rebuilt on pointer MOVE while an anchor is pending. A cursor that
  // resolves to no surface point leaves the last preview standing — a
  // transient miss must not flicker the capsule off (updateBoxPreview's rule).
  //
  // This is the WHOLE preview: no worker ghost, no scratch mesh. A brush op is
  // cheap and reversible, and the generator preview protocol exists for
  // recipes whose output cannot be guessed from their inputs — a swept capsule
  // can.
  //
  // The RAYCAST is what makes this a pointer-MOVE job; the batch is cheap. So
  // the resolved endpoint is stored and the batch built from it in
  // `rebuildSegmentPreview` below, which the radius paths call too — a wheel
  // notch or `[` / `]` with a still cursor now re-fattens the pending capsule
  // instead of leaving it at the old radius until the pointer twitches (f2b
  // item 9; the plain sphere ghost, rebuilt per frame, never had that gap).
  //
  // The capsule batch itself comes from the anchor, the last resolved endpoint
  // and the LIVE radius. No raycast, so it is affordable from any path that
  // changes the radius; a no-op until the cursor has resolved a far end once.
  const rebuildSegmentPreview = (): void => {
    if (segmentAnchor === null || segmentPreviewEnd === null) return;
    segmentPreviewBatch = segmentsToBatch(
      segmentGhostSegments(segmentAnchor, segmentPreviewEnd, digRadius),
      GHOST_COLOR,
    );
  };

  const updateSegmentPreview = (clientX: number, clientY: number): void => {
    if (segmentAnchor === null) return;
    const p = selectionPoint(clientX, clientY);
    if (!p) return;
    segmentPreviewEnd = p;
    rebuildSegmentPreview();
    publishSegmentHudThrottled();
  };

  // The ONE funnel for a radius change — the panel's slider, the wheel and
  // `[` / `]` all land here. Clamped once, and the pending capsule re-fattens
  // with it (f2b item 9): three call sites each remembering to refresh is how
  // one of them would come to forget.
  const applyRadius = (next: number): void => {
    const clamped = clampRadius(next);
    if (clamped === digRadius) return;
    digRadius = clamped;
    rebuildSegmentPreview();
    // MIRROR IT (F4.5 holistic gate, W-2). The wheel and `[` / `]` reach the radius
    // without going through the chrome, so before this the strip readout kept the
    // last number the chrome itself had set and drifted from the brush the viewport
    // was drawing. Pushing HERE rather than at the three call sites is the same
    // argument the clamp above already makes: this is the one funnel, so a fourth
    // way to change the radius cannot forget to announce it.
    //
    // WHAT THE EARLY RETURN ABOVE DOES AND DOES NOT DO, measured rather than assumed:
    // it suppresses a NO-OP set only. A chrome slider drag changes the value every step,
    // so every step DOES round-trip (measured: a four-step drag pushes 1.3, 1.35, 1.4,
    // 1.45). That is harmless for a different reason — `useFieldHostState` adopts the
    // pushed number with a plain `setState`, and React bails out on an identical value,
    // so the drag's own echo costs no render.
    //
    // The CLAMP not looping IS this guard's work: a set outside the range pushes once at
    // the boundary, and the next out-of-range set finds the boundary already current and
    // returns (measured: [4, 0.25], then silence).
    notifyTool();
  };

  // One LMB click while the segment brush is armed. First click anchors; the
  // second builds ONE capsule op with the ACTIVE tool's effect/material and
  // commits it through the ordinary log path — so it is one ⌘Z, exactly like a
  // stroke, and needs no undo machinery of its own.
  //
  // The endpoints are selectionPoint's RAW surface hits, not computeTarget's
  // bitten-past centres: a tunnel must start and end where the user clicked
  // (the box-select corner rule, and the same reason).
  const segmentClick = (clientX: number, clientY: number): void => {
    const p = selectionPoint(clientX, clientY);
    if (!p) return;
    if (segmentAnchor === null) {
      setSegmentAnchor(p);
      return;
    }
    // Copy the anchor BEFORE clearing it — setSegmentAnchor nulls the field,
    // and the op is built after.
    const a: Vec3T = [...segmentAnchor];
    // The length cap (MAX_SEGMENT_M), decided BEFORE the anchor is cleared so a
    // refusal leaves the gesture exactly as it was: the pending start stands and
    // the user re-clicks nearer, rather than losing a point they meant to keep.
    const len = segmentLength(a, p);
    if (len > MAX_SEGMENT_M) {
      reportToolError(
        `segment is ${len.toFixed(1)} m — the cap is ${MAX_SEGMENT_M} m; click nearer`,
      );
      return;
    }
    setSegmentAnchor(null);
    // Re-arm the once-per-stroke mask-drop report. A stroke re-arms it at
    // pointer-down (a drag is one stroke, many ops); a segment's unit is ONE
    // commit, so without this every segment after the first would drop a
    // selection mask SILENTLY.
    maskDropReported = false;
    commitToolOp({ kind: "capsule", a, b: p, radius: digRadius });
  };

  // One LMB click while a selection mode is armed (applyTool is bypassed). The
  // mode is a PARAMETER, not a read of `gesture`: the segment gesture shares
  // that slot, and a bare else-fallthrough would have silently flood-selected
  // void for it.
  // One click of the two-click BOX corner machinery, shared by the cell-select
  // box gesture and the pending stamp's region draw (D-F4.5-7). The first click
  // anchors and answers null; the second closes and answers the snapped region
  // the pair spans. A cursor that resolves to no surface point answers null and
  // changes nothing.
  //
  // The two callers differ only in what they DO with the region — one
  // materializes a cell selection, the other opens a stamp session on it — so
  // this is the whole of what they share, and sharing it is what stops the
  // stamp's corners from snapping differently to the selection's.
  const boxCorner = (
    clientX: number,
    clientY: number,
  ): field.SelectionSpec | null => {
    const p = selectionPoint(clientX, clientY);
    if (!p) return null;
    if (boxAnchor === null) {
      setBoxAnchor(p); // first corner — the amber cross previews it
      return null;
    }
    const spec = boxRegionSpec(boxAnchor, p);
    setBoxAnchor(null);
    return spec;
  };

  const selectionClick = (
    selectionMode: SelectionMode,
    clientX: number,
    clientY: number,
  ): void => {
    if (selectionMode === "box") {
      const spec = boxCorner(clientX, clientY);
      if (spec !== null) commitSelectionSpec(spec);
      return;
    }
    if (selectionMode === "material") {
      const seed = materialSeedVoxel(clientX, clientY);
      if (!seed) return;
      commitSelectionSpec({
        kind: "flood-material",
        seed,
        classId: field.getMaterial(store, seed[0], seed[1], seed[2]),
        budget: SELECTION_UI_BUDGET,
      });
      return;
    }
    const seed = voidSeedVoxel(clientX, clientY);
    if (!seed) return;
    commitSelectionSpec({
      kind: "flood-void",
      seed,
      budget: SELECTION_UI_BUDGET,
    });
  };

  // --- pointer pick (object selection) ------------------------------------

  // Everything a `pointer` click can land on, built fresh per click (never per
  // frame — this is the whole reason the pick is affordable on the CPU).
  //
  // Both drawn layers are GATED ON THEIR OWN LAYER FLAG, the slice-coherence
  // rule applied to objects: with props or markers switched off, clicking where
  // one would have been must not select it (what you see is what you target).
  // Entity footprints are NOT gated on the `selection` layer — that flag hides
  // the emphasis box, and a hidden box is not a hidden entity.
  const pickCandidates = (): PickCandidate[] => {
    const candidates: PickCandidate[] = [];
    for (const [entityId, aabb] of entityFootprints())
      candidates.push({ kind: "entity", entityId, aabb });

    if (layers.props) {
      // A prop click selects its OWNING entity, and `placementOwners` is what
      // pairs each record with the span that claims it (the pure module owns the
      // attribution rule, and is where it is unit-tested without a GPU).
      for (const { entityId, record } of placementOwners(log.ops)) {
        const collision =
          archetypeById.get(record.archetypeId)?.collision ??
          FALLBACK_COLLISION;
        // The record's OWN frame, not `proxyCorners`: that one allocates 24
        // floats per record for the wireframe, and the oriented box test wants
        // the frame rather than the corners. Same centre and same extents as
        // the drawn proxy (collisionCenter + proxyScale), so the click volume
        // is exactly the box on screen.
        const [sx, sy, sz] = proxyScale(collision, record.scale);
        candidates.push({
          kind: "prop",
          entityId,
          obb: {
            center: field.collisionCenter(collision, record),
            halfExtents: [sx / 2, sy / 2, sz / 2],
            quat: record.quat,
          },
        });
      }
    }

    if (layers.flags) {
      // The pick volume is the CELL — `flagCellBox`, the same box the camera
      // frames and the selected-flag outline draws, built on the same half-cell
      // lift the instanced matrices use, so none of the four can part company.
      // Deliberately NOT the drawn FLAG_MARKER_SIZE_M: a 0.18 m pin is a hard
      // click target, and the cell is what the finding is actually about.
      for (const row of flagStore.summary().visible)
        candidates.push({
          kind: "flag",
          key: row.key,
          aabb: flagCellBox(row.flag.world, store.cellSize),
        });
    }
    return candidates;
  };

  // What a `pointer` press lands on: `{ hit }` when the pick RAN — `hit: null`
  // there means it ran and found nothing, which the caller reads as deselect —
  // and a bare null when it could not run at all (no camera, a singular view).
  // The two must not collapse: a frame without a camera clearing the selection
  // would be a silent, untraceable deselect.
  //
  // A PROP hit carries its OWNING entity — a placement record is not an
  // independently editable object here.
  const pointerPick = (
    clientX: number,
    clientY: number,
  ): { hit: PickCandidate | null } | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    // The occluder, slice-coherent like every other cursor-driven raycast
    // (sliceOpts): under an active slice a pick targets the surface the user
    // SEES. Skipped when the eye is in rock, for computeTarget's reason — the
    // ray would hit its own voxel at t = 0 and occlude the entire world.
    const rc = ray.eyeInRock
      ? null
      : field.raycastField(
          store,
          ray.origin,
          ray.dir,
          PICK_RANGE_M,
          sliceOpts(),
        );
    // How far the ray is KNOWN to be clear: the terrain hit, or the probe's own
    // range when it missed — nothing past that range was tested, so nothing past
    // it may be picked either.
    const clearTo =
      rc === null
        ? PICK_RANGE_M
        : Math.hypot(
            rc.point[0] - ray.origin[0],
            rc.point[1] - ray.origin[1],
            rc.point[2] - ray.origin[2],
          );
    return {
      hit: pickNearest(
        { origin: ray.origin, dir: ray.dir },
        pickCandidates(),
        clearTo,
      ),
    };
  };

  // What a resolved pick DOES: select the object under the cursor, or deselect
  // when the press landed on bare terrain or nothing at all.
  const applyPointerPick = (hit: PickCandidate | null): void => {
    if (hit === null) {
      setSelectedEntity(null);
      return;
    }
    if (hit.kind === "flag") {
      // A marker click is NOT a miss: it leaves the entity selection standing.
      // The two are different selections, and clicking a finding is not a
      // statement about which stamp is being worked on.
      //
      // Straight to `setSelectedFlag`, past the public verb: there is nothing to
      // refuse (the key came out of the same summary the pick built its
      // candidates from, one gesture ago) and nothing to frame (the user is
      // looking at the marker they just pressed). D-F4.5-15's "the viewport is
      // the primary selection surface" is this line; the palette row lights up
      // because the seam pushes, not because the two surfaces talk.
      setSelectedFlag(hit.key);
      return;
    }
    setSelectedEntity(hit.entityId);
  };

  // One LMB press while `pointer` is armed. Three outcomes, in the order they
  // are decided — and the order IS the arbitration:
  //
  //  1. A GIZMO handle: the manipulator wins every tie, because its arms are
  //     drawn over the box they move (they all start at its centre) and one that
  //     lost the click to the thing behind it would not be a manipulator. The
  //     drag starts on the press with NO threshold, because no CLICK gesture
  //     competes for a handle press — there is nothing for it to be mistaken
  //     for, so nothing to disambiguate by waiting.
  //  2. The ALREADY-SELECTED entity (directly, or through a prop it placed):
  //     arm a pending drag and do nothing else. Re-selecting what is selected
  //     was always a no-op, so deferring costs nothing, and the threshold is
  //     what decides after the fact whether this press was a click or a move.
  //  3. Anything else: today's plain pick. Pressing an UNSELECTED entity selects
  //     it and arms nothing — otherwise the first click on any entity could
  //     shove it, and a click would never be safe.
  const pointerPress = (e: PointerEvent): void => {
    const axis = gizmoAxisAt(e.clientX, e.clientY);
    if (axis !== null && selectedEntityId !== null) {
      if (
        beginMoveSession(selectedEntityId, axis, true, {
          x: e.clientX,
          y: e.clientY,
        })
      )
        canvasEl?.setPointerCapture(e.pointerId);
      return;
    }
    const picked = pointerPick(e.clientX, e.clientY);
    if (picked === null) return;
    const hit = picked.hit;
    if (
      hit !== null &&
      hit.kind !== "flag" &&
      hit.entityId === selectedEntityId
    ) {
      pendingMove = {
        entityId: hit.entityId,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
      };
      return;
    }
    applyPointerPick(hit);
  };

  // --- stamp session (ghost preview → commit) -----------------------------

  // A fresh small random seed per session/reroll (uint16 keeps it readable in
  // the panel's seed field).
  const randomStampSeed = (): number => {
    const u = new Uint16Array(1);
    crypto.getRandomValues(u);
    return u[0] ?? 0;
  };

  // Panel mirror: sessions are CLONED so the panel never holds references
  // into host state (params/region are mutable records).
  const notifyStamp = (): void => {
    stampCb?.(stamp === null ? null : structuredClone(stamp));
  };

  // The NAMED history push (D-F4.5-11), and the guard that decides whether
  // there is anything to say.
  //
  // IDEMPOTENT BY DESIGN, and that is what makes its call sites cheap: it
  // compares a signature of the two entry stacks first and returns without
  // publishing when nothing moved. So calling it from a path that sometimes
  // mutates the log and sometimes does not costs a handful of reads, and a
  // future path can call it defensively without thinking about whether it needs
  // to. **Any new path that pushes to, pops from or clears either stack must
  // call this** — nothing in the type system enforces that, so it is written
  // here rather than assumed.
  //
  // The signature is (length, TOP ENTRY IDENTITY) per side, and the identity
  // term is load-bearing rather than defensive. Lengths alone are blind to the
  // commonest sequence in an editor: undo once, then do something new. The new
  // mutation clears the redo stack and pushes one entry, landing on exactly the
  // (undo, redo) lengths the history had before the undo — with a different
  // entry on top. A length-only guard would swallow that push and leave the menu
  // offering "Undo dig" over a log whose last act was a fill. Under LIFO those
  // two terms are also SUFFICIENT: entries only ever enter and leave at the top,
  // so a change below it implies one of them moved. (`redo` re-pushes the very
  // object it popped for splice/entity-update entries — which is correct, since
  // the resulting history really is the one already published.)
  //
  // No `worldEpoch` term, unlike the footprint memo one screen down. That memo
  // reads `log.ops`, which a world swap replaces wholesale while the numbers
  // agree; this reads ONLY the two stacks, and `resetWorld` empties both — so a
  // load that leaves them empty when they were already empty publishes nothing
  // because there is genuinely nothing new to publish.
  const notifyHistory = (): void => {
    if (historyCb === null) return;
    const prev = historySig;
    const sig = {
      undoLen: log.undoStack.length,
      redoLen: log.redoStack.length,
      undoTop: log.undoStack.at(-1),
      redoTop: log.redoStack.at(-1),
    };
    if (
      prev !== null &&
      prev.undoLen === sig.undoLen &&
      prev.redoLen === sig.redoLen &&
      prev.undoTop === sig.undoTop &&
      prev.redoTop === sig.redoTop
    )
      return;
    historySig = sig;
    historyCb(fieldHistory(log.undoStack, log.redoStack));
  };

  // The entity-list tick. Fired by every path that can add, remove or rewrite
  // an entity RECORD — including the two (freeze, bake) that dirty no chunk and
  // would otherwise reach the panel through nothing at all.
  //
  // It carries the history push, and that containment is deliberate rather than
  // convenient. Ten host paths mutate the op log; NINE of them rewrite an entity
  // record and therefore already funnel through here by this seam's own contract
  // (commit, apply, freeze, unfreeze, bake, delete, duplicate, ⌘Z/⇧⌘Z, world
  // new/load). The tenth is the brush stroke, which touches no entity — so
  // `commitToolOp` calls `notifyHistory` itself, and those two are the ONLY
  // sites. Spelling it out at all ten would be ten chances to forget.
  const notifyEntities = (): void => {
    entitiesCb?.();
    notifyHistory();
  };

  // Which committed entities the findings TOUCH — the palette's drift badges.
  //
  // Driven from the FINDINGS, not from the entities, and that direction is the
  // whole cost model: a report holds a handful of ops each naming the chunks it
  // wrote, so this is (findings × chunks × entities) box tests with NO string
  // allocation at all. The other direction — enumerate each entity's chunk box and
  // look each key up — allocates a key per chunk of every footprint, which grows
  // with the cube of region size and is unbounded in a way findings are not.
  //
  // The overlap test reproduces chunk-box membership exactly rather than
  // approximately: a box covers chunk `c` iff `floor(min/dim) <= c <= floor(max/dim)`,
  // and those two are `c·dim <= box.max` and `(c+1)·dim > box.min` respectively —
  // half-open on the high side, which is how a chunk owns its span.
  const driftedEntities = (
    findings: readonly field.DriftFinding[],
  ): number[] => {
    const boxes = entityFootprints();
    const dim = field.CHUNK_DIM * store.cellSize;
    const hit = new Set<number>();
    for (const finding of findings)
      for (const key of finding.chunks) {
        const [cx, cy, cz] = field.parseChunkKey(key);
        const lo: Vec3T = [cx * dim, cy * dim, cz * dim];
        for (const [entityId, box] of boxes) {
          if (hit.has(entityId)) continue;
          if (
            lo[0] <= box.max[0] &&
            lo[0] + dim > box.min[0] &&
            lo[1] <= box.max[1] &&
            lo[1] + dim > box.min[1] &&
            lo[2] <= box.max[2] &&
            lo[2] + dim > box.min[2]
          )
            hit.add(entityId);
        }
      }
    return [...hit];
  };

  // Cloned like the session: a drift report is plain data the palette keeps. The
  // touched-entity set is recomputed on every push rather than stored beside
  // `drift`, because the FOOTPRINTS can move under a standing report (a
  // reconfigure re-splices a span; the report survives) — deriving at push time
  // is what keeps the badge pointing at the geometry as it currently is.
  const driftPayload = (): FieldDriftReport | null =>
    drift === null
      ? null
      : { findings: structuredClone(drift), entityIds: driftedEntities(drift) };

  const notifyDrift = (): void => {
    driftCb?.(driftPayload());
  };

  // The LIVE entity record for an id (not a clone — callers that hand it on
  // clone at their own boundary), or null when no entity op carries it. The one
  // lookup behind the selection box, the reconfigure session and the verbs.
  const entityRecord = (entityId: number): field.GeneratorEntity | null => {
    const hit = log.ops.find(
      (op): op is field.EntityOp =>
        op.kind === "entity" && op.entity.entityId === entityId,
    );
    return hit === undefined ? null : hit.entity;
  };

  // Every committed entity's PICK/EMPHASIS box, memoized on the log signature.
  //
  // The box is `generatorFootprint` — the union of the span's op bounds — with
  // the recorded selection region as the fallback the helper's null means: a
  // span with no field-writing ops (a pure placer's) has no op bounds, and an
  // entity with no box at all would be silently unpickable. One rule, resolved
  // in one place, so the pick and the drawn emphasis can never outline different
  // volumes.
  //
  // MEMOIZED because the pick needs EVERY entity's box on every click, and
  // `generatorFootprint` walks the whole op log per entity — O(entities × ops)
  // per click. The in-repo measurement nearest to that shape is
  // `placementsByEntity`'s (field-placements.ts): 2.3 ms for its WHOLE pass at
  // 200 entities × 500 records over 100 000 ops — two scans plus
  // placement-ops × entities attribution, not the unit cost of one
  // `generatorFootprint` walk. It is the right order of magnitude for one pass
  // over a log that size and nothing more precise has been taken; what makes the
  // memo obviously right is the MULTIPLIER this path adds (one such walk per
  // entity per click), not the constant. Recomputed once per log mutation
  // instead, which is a discrete user action.
  //
  // The signature is `currentLogStats`' three lengths plus TWO more, each
  // closing a gap that is reachable:
  //   - `nextId`, because a reconfigure can splice out N ops and back in N,
  //     moving no length — but it always allocates fresh ids.
  //   - `worldEpoch`, because a world swap CLEARS the log (resetWorld empties
  //     ops and both stacks and resets nextId), so two worlds whose logs agree
  //     on all four log-derived numbers share a signature and the incoming world
  //     would read the outgoing world's boxes. Not hypothetical: two variant
  //     files out of one authoring flow collide easily — same op count, same
  //     ids, different geometry — and the symptom is a click on empty space
  //     selecting an entity that is gone, with a box drawn where nothing is.
  //     `worldEpoch` is bumped by resetWorld for the analyzer's sake; this rides
  //     the same counter rather than adding a second one.
  // What remains uncovered is several mutations within ONE frame that net all
  // the log numbers back, unreachable from single-event-per-frame input; a stale
  // box mis-aims a click and self-heals on the next mutation, it corrupts
  // nothing. (`currentLogStats` at the op-cost meter has the world-swap exposure
  // too — filed rather than fixed here: `docs/backlog/editor-and-tooling/
  // field-tool-follow-ons.md` § *Log-signature caches can miss a world swap*.)
  let footprintCache: Map<number, { min: Vec3T; max: Vec3T }> | null = null;
  let footprintSig = "";
  const entityFootprints = (): Map<number, { min: Vec3T; max: Vec3T }> => {
    const sig = `${worldEpoch}/${log.ops.length}/${log.undoStack.length}/${log.redoStack.length}/${log.nextId}`;
    const cached = footprintCache;
    if (cached !== null && sig === footprintSig) return cached;
    const boxes = new Map<number, { min: Vec3T; max: Vec3T }>();
    for (const op of log.ops) {
      if (op.kind !== "entity") continue;
      const record = op.entity;
      boxes.set(
        record.entityId,
        generatorFootprint(log.ops, record, store.cellSize) ?? record.region,
      );
    }
    footprintCache = boxes;
    footprintSig = sig;
    return boxes;
  };

  // Re-derive the selected entity's box from the CURRENT record, and DROP the
  // selection when that record has left the log. Every path that can move or
  // remove a committed region calls this: a reconfigure apply (the region is an
  // editable field of the session) and undo/redo (which restores the previous
  // record). An entity that left the log clears the box, the id AND notifies —
  // an undone commit must not leave a box floating over nothing, nor a palette
  // row highlighted for a stamp that no longer exists.
  //
  // The box outlines the stamped FOOTPRINT, not the recorded selection region —
  // an oversized region boxed mostly-empty space (F3a gate finding); see
  // entityFootprints for the fallback.
  const rebuildEntitySelectionBatch = (): void => {
    const box =
      selectedEntityId === null
        ? undefined
        : entityFootprints().get(selectedEntityId);
    if (box === undefined) {
      entitySelectionBatch = null;
      gizmo = null;
      return;
    }
    entitySelectionBatch = aabbEdgeBatch(box, SELECTED_COLOR);
    // The gizmo hangs on the SAME box, so it moves and dies with it — one
    // rebuild, one invalidation, and no way for the handles to end up outlining
    // a different volume than the emphasis does. While a move is live only the
    // CONSTRAINED arm is drawn (see gizmoVisible): the other two would advertise
    // motion this drag will not make.
    gizmo = gizmoSpan(box);
    gizmoBatch = axisLines(gizmo, AXIS_COLOR, activeGizmoAxis());
  };

  // Whether the gizmo is on screen — and therefore pickable. ONE predicate for
  // both, so a handle can never be grabbable while invisible (a click that moves
  // something the user cannot see) or visible while inert.
  //
  // The POINTER tool has to be armed (a brush click digs, and a manipulator
  // floating over a dig cursor promises an action LMB will not take) and
  // something has to be SELECTED (the gizmo is the selection's own affordance).
  //
  // The third condition is "no session the gizmo did not open". A session opened
  // by another path — the Open button, `G` — already owns the region through its
  // own affordances, and a second way to move one thing is how the two disagree.
  // But the gizmo's OWN drag is a session too, and hiding the handles the instant
  // one is grabbed deletes the only thing naming the axis the ghost is sliding
  // along. So a live move keeps them, restricted to the constrained arm.
  const gizmoVisible = (): boolean =>
    gizmo !== null &&
    gesture === "pointer" &&
    selectedEntityId !== null &&
    (stamp === null || moveDrag !== null);

  // The one arm to draw while a move is CONSTRAINED to an axis, or null for the
  // full triad. A free ground drag has no single axis to name, so it keeps all
  // three — they are then the frame the ghost is moving within rather than a
  // constraint indicator.
  const activeGizmoAxis = (): Axis | null => {
    const m = moveDrag?.mapping;
    return m === undefined || m === "plane" ? null : m;
  };

  const gizmoAxisAt = (clientX: number, clientY: number): Axis | null => {
    const g = gizmo;
    if (g === null || !gizmoVisible()) return null;
    const ray = cursorRay(clientX, clientY);
    if (ray === null) return null;
    // Every bound comes off the ONE span the batch was drawn from, so the
    // pickable arm and the visible arm cannot be different segments.
    return pickAxis(
      { origin: ray.origin, dir: ray.dir },
      g.origin,
      g.len,
      g.tol,
      g.inner,
    );
  };

  // --- camera verbs -------------------------------------------------------
  //
  // Both CUT rather than tween, and deliberately: the host has no camera
  // animation and adding one here would need a per-frame tween arbitrating with
  // the fly keys, the look drag, the wheel and a live move's anchor — every one
  // of those an interruption rule of its own. It would also have to honour
  // `prefers-reduced-motion`, which the host cannot read (it touches no `window`;
  // the CHROME can). `frameChunks` has always cut, so cutting is also what keeps
  // the editor's two framing verbs behaving the same way.

  // The centre of the selected entity's footprint, or null when there is nothing
  // to pivot on. Gated on the POINTER tool for the gizmo's reason: with a brush
  // armed the selection is not what the user is working on, and a right-drag
  // that suddenly orbits something they are not looking at is a surprise.
  //
  // Read off the GIZMO rather than re-derived from the footprint memo, and the
  // point is not brevity: `gizmoSpan(box).origin` IS the footprint centre, and
  // `gizmo` is non-null on exactly the condition a re-derivation would test
  // (rebuildEntitySelectionBatch nulls it when the selected entity has no box).
  // Taking it from there makes the pivot the same number the drawn handles hang
  // on, so the camera can never orbit a centre other than the one on screen.
  const orbitPivot = (): Vec3T | null =>
    gesture !== "pointer" || gizmo === null ? null : gizmo.origin;

  // The box `F` frames: the selected ENTITY's footprint, else the CELL
  // selection's AABB, else nothing. A FIXED priority, not "whichever is newer":
  // `selectionClick` never touches `selectedEntityId` and `setSelectedEntity`
  // never touches `selection`, so either order of arrival is reachable (select
  // an entity from the palette, then draw a box — the entity still wins). The
  // entity is the more SPECIFIC intent: one object rather than a volume.
  const frameTargetBox = (): { min: Vec3T; max: Vec3T } | null => {
    const box =
      selectedEntityId === null
        ? undefined
        : entityFootprints().get(selectedEntityId);
    if (box !== undefined) return box;
    return selection === null ? null : selectionAabb(selection);
  };

  const frameSelection = (): void => {
    const box = frameTargetBox();
    if (box === null) {
      // Says so rather than doing nothing quietly. `F` swallows the key either
      // way, so a silent refusal is indistinguishable from a broken binding —
      // the same reason every other refused verb here reports.
      reportToolError("nothing selected to frame");
      return;
    }
    aimCamera(frameBox(orbitState, box));
    applyOrbit();
  };

  /** The world-space AABB of a set of chunk keys. Used by {@link frameChunks} (which
   *  takes its centre) and {@link frameWorld} (which fits to the whole box), because
   *  two copies of this arithmetic is how a re-centre and a fit come to disagree
   *  about where a world is — and there WERE two until the F4.5 gate added the second
   *  verb and a review noticed the docblock claiming a de-duplication that had not
   *  happened. `null` for an empty set: a box with no chunks in it has no centre and
   *  no edges, and both callers refuse rather than fit to infinities. */
  const chunkSetBox = (
    chunks: Iterable<field.ChunkKey>,
  ): { min: Vec3T; max: Vec3T } | null => {
    const dim = field.CHUNK_DIM * store.cellSize;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let any = false;
    for (const key of chunks) {
      any = true;
      const [cx, cy, cz] = field.parseChunkKey(key);
      minX = Math.min(minX, cx * dim);
      maxX = Math.max(maxX, (cx + 1) * dim);
      minY = Math.min(minY, cy * dim);
      maxY = Math.max(maxY, (cy + 1) * dim);
      minZ = Math.min(minZ, cz * dim);
      maxZ = Math.max(maxZ, (cz + 1) * dim);
    }
    return any ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : null;
  };

  /** {@link FieldHost.occupiedTopY}'s body, hoisted out of the returned object so
   *  {@link frameWorld} can call it directly. It was inline until the F4.5 gate added
   *  a second caller; a `host.occupiedTopY()` self-call from inside the same literal
   *  would have worked and would also have been the one place a reader cannot see that
   *  the two verbs share a scan. */
  const occupiedTopYOf = (): number | null => {
    // Walk SAMPLE layers from the top down, and stop at the first solid one.
    // Sample-layer order rather than chunk order is what makes the answer
    // exact: two chunks in the same cy layer can have their topmost rock 15
    // samples apart, and taking the first chunk that has any rock in it would
    // answer with the wrong one whenever the map iterates them in that order.
    //
    // Density is int8 with the isosurface at 0 (`SOLID` = -127, `AIR` = 127),
    // so "solid" is `< 0` — the same test the mesher's sign change uses. Not
    // `=== SOLID`: a smoothed or partially-dug ceiling is solid rock the user
    // can see and stand under, and it is never exactly -127.
    //
    // COST, measured on Bun/JSC over synthetic stores, 5 runs each. Per
    // sample layer this reads at most 256 int8s per chunk in that layer and
    // returns on the first hit, so the early exit is what the numbers are
    // about:
    //
    //   192 chunks, rock in every chunk (a floor)    0.29 - 1.26 ms
    //   5 000 chunks, same shape                     1.27 - 1.40 ms
    //   192 chunks, ALL AIR (worst case)             0.61 - 2.30 ms
    //   5 000 chunks, ALL AIR                       16.1 - 17.9 ms
    //
    // The pair that matters is rows 2 and 4: at the SAME 5 000 chunks the
    // answerable world costs 1.3 ms and the unanswerable one 16 ms, because
    // the first returns out of the top layer and the second reads every
    // allocated sample (4096 int8s per chunk, ~20 M). So the cost tracks the
    // top layer, not the world — and the worst case is a store dug out and
    // then filled back to nothing, which is both rare and still inside the
    // editor's 100 ms interaction ceiling. Once per slice-enable, never per
    // frame and never per slider drag (the chrome seeds once, then owns the
    // value — see `useView.tsx`).
    if (store.chunks.size === 0) return null;
    // Bucket by chunk-Y once so each sample layer looks at only the chunks
    // that can contain it, rather than re-filtering the whole map per layer.
    const byLayer = new Map<number, Int8Array[]>();
    let maxCy = Number.NEGATIVE_INFINITY;
    let minCy = Number.POSITIVE_INFINITY;
    for (const [key, density] of store.chunks) {
      const cy = field.parseChunkKey(key)[1];
      if (cy > maxCy) maxCy = cy;
      if (cy < minCy) minCy = cy;
      const bucket = byLayer.get(cy);
      if (bucket) bucket.push(density);
      else byLayer.set(cy, [density]);
    }
    const D = field.CHUNK_DIM;
    for (let cy = maxCy; cy >= minCy; cy--) {
      const chunks = byLayer.get(cy);
      if (!chunks) continue;
      for (let ly = D - 1; ly >= 0; ly--) {
        for (const density of chunks) {
          // The layer's samples are `lx + D*(ly + D*lz)`, so one ly spans D
          // runs of D contiguous entries — walked as runs rather than with a
          // multiply per sample.
          for (let lz = 0; lz < D; lz++) {
            const base = D * (ly + D * lz);
            for (let lx = 0; lx < D; lx++)
              if ((density[base + lx] ?? 0) < 0)
                return (cy * D + ly) * store.cellSize;
          }
        }
      }
    }
    return null;
  };

  const frameWorld = (): void => {
    const box = chunkSetBox(store.chunks.keys());
    if (box === null) {
      // Same stance as frameSelection's: an empty world is a refusal with a
      // sentence, not a camera verb that quietly does nothing.
      reportToolError(
        "nothing in this world to frame yet — dig something first",
      );
      return;
    }
    // Lower the ceiling to what was BUILT rather than to the chunk column that
    // holds it. A chunk is CHUNK_DIM samples tall, so a floor-only world fits the
    // camera to ~16 cells of empty headroom without this.
    //
    // NO CLAMP AGAINST `box.min[1]`, and there is nothing to restore here: both
    // numbers come off the SAME `store.chunks` in the same synchronous call, with
    // the same `store.cellSize`. `box.min[1]` is `minCy · CHUNK_DIM · cellSize`;
    // `top` is `(cy · CHUNK_DIM + ly) · cellSize` for some `cy ≥ minCy` and
    // `ly ≥ 0`. So `top ≥ box.min[1]` always, and a lowered ceiling can never sink
    // below the box floor.
    const top = occupiedTopYOf();
    const fitted =
      top === null
        ? box
        : { min: box.min, max: [box.max[0], top, box.max[2]] as Vec3T };
    // `placeCamera`, NOT `aimCamera`: framing the world is the state the automatic
    // frame produces, so counting it as the user aiming would make one Open
    // suppress the next one's frame.
    placeCamera(frameBox(orbitState, fitted));
    applyOrbit();
  };

  const snapView = (axis: Axis, sign: 1 | -1): void => {
    aimCamera(snapToAxis(orbitState, axis, sign));
    applyOrbit();
  };

  // Select one entity, or NOTHING — the single mutator of the entity selection,
  // whoever is asking: a pointer click, the public verb, an entity leaving the
  // log, a world reset. There is deliberately no second "clear" entry point;
  // `setSelectedEntity(null)` is the clear, and two parallel mutators of one
  // piece of state is how a side effect added to one and not the other drifts
  // silently.
  //
  // Validated against the log — an id no entity op carries selects NOTHING
  // rather than reporting, because the ids come from a panel list that can lag
  // it (openEntitySession's stance, minus the report: a stale click is not worth
  // a toast). Selecting what is already selected is a no-op that notifies
  // nobody, so a palette row can call this on every render, and so a world reset
  // with nothing selected pushes nothing — which is what lets the seam's
  // "pushed on every change" contract be read literally.
  //
  // Named apart from the PUBLIC `selectEntity` it backs (the openEntity →
  // openEntitySession precedent): the method could shadow-call this one
  // correctly by lexical scope, but a reader has to stop and prove it is not
  // recursion.
  const setSelectedEntity = (entityId: number | null): void => {
    const next =
      entityId === null || entityRecord(entityId) === null ? null : entityId;
    if (next === selectedEntityId) return;
    selectedEntityId = next;
    rebuildEntitySelectionBatch();
    entitySelectionCb?.(next);
  };

  const revalidateEntitySelection = (): void => {
    if (selectedEntityId === null) return;
    // The record is gone (an undone commit): setSelectedEntity's own validation
    // resolves the stale id to null, so passing it back IS the clear.
    if (entityRecord(selectedEntityId) === null) {
      setSelectedEntity(null);
      return;
    }
    rebuildEntitySelectionBatch();
  };

  // Tears down BOTH halves of the stamp ghost: the surface meshes (GPU) and the
  // placement wireframes (CPU-only line batch). One function because they are
  // one preview's worth of promise — a session whose ghost meshes are gone but
  // whose prop boxes linger would show props the field no longer previews.
  const destroyStampGhosts = (): void => {
    const c = ctx;
    if (c)
      for (const entries of ghostMeshes.values())
        for (const e of entries) {
          mesh.destroy(c, e.m);
          geometry.destroy(c, e.g);
        }
    ghostMeshes.clear();
    placementGhost = null;
  };

  // The stamp-preview snapshot: density COPIES + cloned materials of every
  // allocated chunk in the region's chunk box grown by one (the protocol's
  // completeness contract — every allocated chunk intersecting the region +
  // its 26-halo; the grown box over-includes by at most one boundary chunk,
  // harmless since completeness is a floor). The COPY is load-bearing: the
  // client TRANSFERS density buffers to the worker — sending the store's live
  // buffers would detach them and destroy the field. Known limit (protocol
  // TSDoc): a generator whose params overflow the region past the one-chunk
  // halo can preview against solid where the store is carved — the region-vs-
  // params mismatch is the stamp UI's to surface.
  const snapshotChunks = (region: {
    min: Vec3T;
    max: Vec3T;
  }): {
    key: string;
    density: ArrayBuffer;
    materials: field.ChunkMaterials | null;
  }[] => {
    const dim = field.CHUNK_DIM * store.cellSize;
    const lo: Vec3T = [
      Math.floor(region.min[0] / dim) - 1,
      Math.floor(region.min[1] / dim) - 1,
      Math.floor(region.min[2] / dim) - 1,
    ];
    const hi: Vec3T = [
      Math.floor(region.max[0] / dim) + 1,
      Math.floor(region.max[1] / dim) + 1,
      Math.floor(region.max[2] / dim) + 1,
    ];
    const out: {
      key: string;
      density: ArrayBuffer;
      materials: field.ChunkMaterials | null;
    }[] = [];
    for (const [key, density] of store.chunks) {
      const [cx, cy, cz] = field.parseChunkKey(key);
      if (cx < lo[0] || cx > hi[0]) continue;
      if (cy < lo[1] || cy > hi[1]) continue;
      if (cz < lo[2] || cz > hi[2]) continue;
      const mats = store.materials.get(key);
      out.push({
        key,
        density: chunkCopy(density),
        materials: mats === undefined ? null : field.cloneChunkMaterials(mats),
      });
    }
    return out;
  };

  // Build the ghost render state from a preview response: one mesh per
  // non-empty bucket, ALL under the one stamp-ghost material (shape only —
  // classes/kit appear on commit), at chunk origins.
  // Deliberate v0 (slice-coherence disposition, F2b Task 15): the stamp ghost
  // renders FULL-HEIGHT even over a sliced field — the preview evaluate never
  // sees sliceY, so "see what you're stamping" wins over slice consistency.
  // The commit's real chunk meshes then re-clip through the slice as usual.
  const applyStampGhost = (
    chunks: { key: string; buckets: WireBucket[] }[],
  ): void => {
    const c = ctx;
    if (!c) return;
    destroyStampGhosts();
    for (const { key, buckets } of chunks) {
      const [cx, cy, cz] = field.parseChunkKey(key);
      const origin = chunkOrigin(cx, cy, cz);
      const entries: { m: mesh.Mesh; g: geometry.Geometry }[] = [];
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
          material: stampGhostMaterial(),
        });
        mesh.setPosition(c, m, origin);
        entries.push({ m, g });
      }
      if (entries.length > 0) ghostMeshes.set(key, entries);
    }
  };

  // --- void cast (D-F3-15) -------------------------------------------------

  const destroyVoidCast = (): void => {
    const c = ctx;
    if (c)
      for (const entries of voidCastMeshes.values())
        for (const e of entries) {
          mesh.destroy(c, e.m);
          geometry.destroy(c, e.g);
        }
    voidCastMeshes.clear();
  };

  // Free the cast and strand whatever job is in flight for it. SILENT: the
  // callers that owe the user an explanation give one themselves. The bumped
  // generation is the whole strand — `voidCastJobGen` is deliberately NOT
  // cleared, because nothing here reaches the worker, which goes on computing a
  // result that will now be dropped on arrival.
  const discardVoidCast = (): void => {
    voidCastGen++;
    destroyVoidCast();
  };

  // Any field mutation ages the cast out: it was meshed from a snapshot, and
  // re-casting per stroke would mean a whole-world worker job per stroke. So the
  // v0 drops it and SAYS so — a silently vanishing X-ray beside a still-ticked
  // checkbox would read as a bug. Self-limiting: the second mutation finds
  // nothing live and returns, so a drag cannot spam the report channel.
  const invalidateVoidCast = (): void => {
    const awaited = voidCastJobGen === voidCastGen;
    if (!awaited && voidCastMeshes.size === 0) return;
    discardVoidCast();
    reportToolError(
      "void cast cleared — the field changed; re-toggle the void layer to refresh it",
    );
  };

  // One chunk's density as a buffer another realm may own. Boundary cast:
  // `.slice()` allocates a fresh ArrayBuffer, which the Int8Array declaration
  // widens to ArrayBufferLike. Shared by the void cast and the analyzer mirror —
  // the two differ in WHY they copy (see each call site), not in how.
  const chunkCopy = (density: Int8Array): ArrayBuffer =>
    density.slice().buffer as ArrayBuffer;

  // Every allocated chunk's density as a COPY, keyed as the store keys it. The
  // copy is load-bearing for the same reason snapshotChunks' is: the client
  // TRANSFERS these buffers, and sending the store's live ones would detach
  // them and destroy the field.
  const snapshotAllChunks = (): { key: string; density: ArrayBuffer }[] =>
    [...store.chunks].map(([key, density]) => ({
      key,
      density: chunkCopy(density),
    }));

  // Build the cast's render state from a void-cast response: one mesh per
  // non-empty bucket, ALL under the one void material, at chunk origins. The
  // applyStampGhost twin, deliberately not folded into it — see the material's
  // comment for why the two differ in depth state, and the invisible-overlay
  // learning (2026-07-21) for why working render code is not refactored without
  // a visual gate.
  const applyVoidCast = (
    chunks: { key: string; buckets: WireBucket[] }[],
  ): void => {
    const c = ctx;
    if (!c) return;
    destroyVoidCast();
    for (const { key, buckets } of chunks) {
      const [cx, cy, cz] = field.parseChunkKey(key);
      const origin = chunkOrigin(cx, cy, cz);
      const entries: { m: mesh.Mesh; g: geometry.Geometry }[] = [];
      for (const bucket of buckets) {
        const indices = new Uint32Array(bucket.indices);
        if (indices.length === 0) continue;
        const g = geometry.create(c, {
          positions: new Float32Array(bucket.positions),
          normals: new Float32Array(bucket.normals),
          uvs: new Float32Array(bucket.uvs),
          indices,
        });
        const m = mesh.create(c, { geometry: g, material: voidCastMaterial() });
        mesh.setPosition(c, m, origin);
        entries.push({ m, g });
      }
      if (entries.length > 0) voidCastMeshes.set(key, entries);
    }
  };

  // Cast the void of the CURRENT field: one worker job over a snapshot of every
  // allocated chunk. Four refusals, in the order a user experiences them.
  //
  // The in-flight one is a cost guard, and it is keyed on the WORKER being busy
  // rather than on the user still wanting the result: the client is a plain
  // request pipe over ONE worker whose handler is synchronous per message, so a
  // second cast posted now delays every chunk remesh and every stamp preview
  // behind a second full sweep of the world — and a discard cannot call it off,
  // only agree to ignore it. Toggling off and on again is therefore NOT free,
  // and it is the sequence that would otherwise stack them.
  //
  // The same synchronous handler is why this job gets D-F4.5-19's PROGRESS and not
  // its "cooperative cancel" — "the job polls; no cancel theater", and there is
  // nothing here that can poll. The per-chunk loop lives in the worker
  // (`field-protocol.ts`'s handleVoidCast), whose handler runs to completion per
  // message: a cancel `postMessage` sent mid-job is not delivered, it QUEUES behind
  // the very work it means to stop. The only real interrupt is `worker.terminate()`,
  // which would take every chunk remesh and every stamp preview down with it. What
  // exists instead is strand-not-cancel (`discardVoidCast`), and the honest chrome
  // for that is the readout `voidCastPending` feeds, with no ✕ on it.
  //
  // Re-check if the worker ever gains a mid-handler yield, or the client a second
  // worker the cast could own alone.
  //
  // Determinate progress IS available and is deliberately declined: the worker can
  // `post` mid-handler (posting does not block) and the total is `store.chunks.size`.
  // It would cost a new worker→host message and its plumbing to put a percentage on
  // a job whose CEILING is ~1.3 s (see VOID_CAST_CHUNK_BUDGET). Indeterminate is
  // honest at that length.
  const requestVoidCast = (): void => {
    if (voidCastJobGen !== null) {
      reportToolError(
        "a void cast is still building — re-tick the void layer once it lands",
      );
      return;
    }
    discardVoidCast(); // an enable while a settled cast stands replaces it
    const count = store.chunks.size;
    if (count === 0) {
      // Loud, by this feature's own rule (see invalidateVoidCast): a ticked box
      // with nothing behind it reads as a bug. There is no air to cast in a
      // world nothing has been dug out of yet.
      reportToolError("nothing to cast yet — dig something first");
      return;
    }
    if (count > VOID_CAST_CHUNK_BUDGET) {
      reportToolError(
        `void cast covers ${count} chunks, over the ${VOID_CAST_CHUNK_BUDGET}-chunk budget — the X-ray is a region-scale tool, not a world-scale one`,
      );
      return;
    }
    // Quiet: layer flags survive a dispose, so a call that lands while there is no
    // context must not fire a job it has nowhere to put. Nobody has to re-toggle to
    // get it back — `init` re-requests the cast the flag still asks for.
    if (!ctx) return;
    // Snapshot BEFORE the latch, not as an argument after it: a throw while
    // building it (a detached store buffer — not reachable today, since nothing
    // transfers the store's own chunks) would otherwise leave the latch set with
    // no job to clear it, and every later cast refused forever.
    const snapshot = snapshotAllChunks();
    const gen = voidCastGen;
    voidCastJobGen = gen;
    worker
      .voidCast(snapshot, store.cellSize)
      .then((res) => {
        // Cleared BEFORE the staleness guard: the worker is free either way,
        // and a stranded job that left this set would refuse every later cast.
        voidCastJobGen = null;
        if (disposed || gen !== voidCastGen) return;
        applyVoidCast(res.chunks);
      })
      // .catch, not then's second argument: applyVoidCast above can throw (a
      // context torn down mid-flight, a lost device), and a two-argument then
      // would route that into an unhandled rejection instead of into this
      // handler — leaving the job latch stuck, which refuses every later cast.
      .catch((err: unknown) => {
        voidCastJobGen = null;
        if (disposed || gen !== voidCastGen) return;
        // The remeshOne posture, one level louder: a cast the user asked for
        // and will not get is a tool problem, not a background hiccup.
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(`void cast failed: ${message}`);
      });
  };

  // --- walkability advisor (D-F4-9) ---------------------------------------
  //
  // The analyzer worker holds a MIRROR of this store: every density write is
  // copied across, and stage 1 re-runs over the chunks whose answer could have
  // changed. ADVISORY throughout (D-F4-1) — nothing it reports blocks a verb,
  // mutates the field, or fixes anything. It draws markers and fills a list.
  //
  // Two cadences, and the split is the whole cost story. Per-edit passes analyse
  // what was written; the CONNECTIVITY passes (reachability demotion, pit
  // detection) are whole-world by nature and run on the idle tail — see
  // ANALYZER_IDLE_MS.

  const analyzer = new AnalyzerWorkerClient(deps?.spawnAnalyzer);
  const flagStore = createFlagStore();
  let flagsCb: ((summary: FlagsSummary) => void) | null = null;
  // The project's capsule (setAgentProfile). NOTHING is posted without one: the
  // analyzer is parameterized on the agent, and a guessed capsule would be the
  // advisor inventing its own premise.
  let agentProfile: field.AgentProfile | null = null;
  // Whether the profile QUESTION has been answered — by a profile, or by the
  // catalog 404 that says the project has none. `agentProfile === null` alone
  // cannot tell those apart from "the fetch is still in flight", and the idle
  // notice below is a claim about the PROJECT: posted from the in-flight state it
  // would be reporting which of two async arrivals won a race, on a project that
  // may well ship a profile. So the notice waits for this, and only this gets to
  // be a second boolean rather than an `undefined` third state on the profile
  // itself — every OTHER reader of `agentProfile` (the verify guard, the pending
  // meter, the pump) asks "is there a usable capsule", where the two null-ish
  // states are correctly the same answer.
  let agentProfileAnswered = false;
  // Once-EVER report for the missing profile (the maskDropReported discipline):
  // an edit loop would otherwise repeat it at stroke rate. Never re-armed,
  // because a profile can only be installed, never removed — and never ARMED
  // until the answer above lands, so there is never a claim to take back.
  let profileMissingReported = false;
  // Chunks whose density this host has written since the last mirror sync —
  // what it WROTE, never widened. The worker owns the widening (`reanalysisKeys`
  // spreads to the neighbourhood AND down the cardinal columns, because the
  // column pass's upward scans are uncapped); a host that pre-widened would be
  // second-guessing a rule it does not hold.
  const analyzerDirty = new Set<field.ChunkKey>();
  // Keys the mirror may still hold that this store no longer does. The protocol
  // has no reset verb on purpose, so a world swap lists the outgoing keys as
  // removals; resetWorld fills this and the next sync drains it.
  const analyzerStale = new Set<field.ChunkKey>();
  // The next pass syncs the WHOLE store rather than `analyzerDirty` (a world
  // load, or a profile installed after edits the mirror never saw).
  let analyzerResync = false;
  // The next pass re-posts the placement collider set (props rasterize into the
  // solidity stage 1 reads, so the analyzer and the runtime see one prop set).
  let analyzerPlacementsStale = false;
  // The next pass is the whole-world one: reachability demotion + pit detection.
  let analyzerWholeWorld = false;
  // Reachability + pit seeds: the loaded world's manifest `playerStart`. EMPTY
  // for a new world, and honestly so — both connectivity passes refuse an empty
  // seed set outright (markUnreachable would otherwise demote everything,
  // detectPits would have no notion of "enterable"), and inventing a spawn is
  // the one thing an advisor must not do.
  let analyzerSeeds: [number, number, number][] = [];
  // True while a pass is posted and unanswered. A flag and not a count: the pump
  // is a latest-wins latch, so exactly one pass can ever be in flight.
  let analyzerBusy = false;
  let analyzerIdle: ReturnType<typeof setTimeout> | null = null;

  // An advisor failure is a TOOL problem, not a background hiccup (the void
  // cast's posture): the user is looking at markers that have stopped updating.
  const reportAnalyzerFailure = (err: unknown): void => {
    if (disposed) return; // dispose rejects every pending job — expected, swallow
    const message = err instanceof Error ? err.message : String(err);
    reportToolError(`walkability analyzer: ${message}`);
  };

  // The placement colliders as core's rasterizer takes them: one group per
  // archetype, its primitive the catalog's — or FALLBACK_COLLISION, which is
  // exactly what the viewport already DRAWS for an uncatalogued archetype, so
  // the analysis and the picture agree either way.
  const analyzerPlacementGroups = (): field.PlacementCollisionGroup[] =>
    [...groupPlacements(log.ops)].map(([archetypeId, records]) => ({
      collision:
        archetypeById.get(archetypeId)?.collision ?? FALLBACK_COLLISION,
      records,
    }));

  // Would a pass find anything to analyse if one fired RIGHT NOW? The one
  // answer, read by both the pump (`analyzerFire`, which decides on it) and the
  // meter (`analyzerPendingCount`, which reports it) — the aimCamera/placeCamera
  // funnel's reason. Two call sites deriving this separately is exactly how the
  // chip came to say "1 pass owed" forever on a world the pump had already
  // decided held nothing (the F4.5 gate's F-3).
  //
  // A PREDICATE and not the key list `analyzerFire` goes on to build: the meter
  // is read from the per-frame stats push, and a helper returning
  // `[...store.chunks.keys()]` would allocate one array per chunk every frame.
  // Both branches here are O(1).
  const analyzerHasWork = (): boolean =>
    analyzerWholeWorld ? store.chunks.size > 0 : analyzerDirty.size > 0;

  // Bring the mirror level with the store. Buffers are COPIES, and NOT because
  // the wire needs them to be: the client structured-clones rather than
  // transferring, so a real Worker would copy the store's own buffers safely.
  // The copy is for the case where the handler runs IN THIS REALM — the tests
  // wire it directly, and its `handleSync` says so — where the mirror would
  // otherwise install a view onto the very array the next stroke writes into.
  const postMirrorSync = (): void => {
    const keys = analyzerResync ? [...store.chunks.keys()] : [...analyzerDirty];
    analyzerResync = false;
    const upserts: { key: field.ChunkKey; density: ArrayBuffer }[] = [];
    for (const key of keys) {
      const density = store.chunks.get(key);
      if (density !== undefined)
        upserts.push({ key, density: chunkCopy(density) });
    }
    // Tested against the LIVE store rather than trusted from the reset that
    // recorded them: a new world can reuse a key the old one had, and the worker
    // applies upserts BEFORE removals — so a key listed in both would delete the
    // chunk that was just sent.
    const removed = [...analyzerStale].filter((key) => !store.chunks.has(key));
    analyzerStale.clear();
    if (upserts.length === 0 && removed.length === 0) return;
    void analyzer
      .sync(store.cellSize, upserts, removed)
      .catch(reportAnalyzerFailure);
  };

  /**
   * The pump's fire-time work: bring the mirror level, then say what to analyse.
   *
   * A COMMAND as much as a query, deliberately. The sync and the analysis are
   * ONE round trip, and the pump owns the moment it happens — which is the point
   * of reading it at FIRE time, so the accumulated edits go out rather than the
   * ones that happened to be current when a key was pressed. Both posts land in
   * this turn and the worker dispatches in strict arrival order, so the analysis
   * is guaranteed to see the sync without anyone awaiting its ack.
   *
   * `undefined` = nothing to analyse, which leaves the pump's latch idle (a
   * mirror sync may still have gone out — emptying the mirror after a world
   * reset is real work with no analysis attached).
   */
  const analyzerFire = (): AnalyzeInput | undefined => {
    // The `createPreviewCoalescer` guard, for the same reason: the pump settles
    // its latch on EVERY settlement, and `analyzer.dispose()` rejects the job in
    // flight — so a queued request re-fires from inside that rejection, after the
    // host is gone. Without this, the client's lazy `ensure()` would spawn a
    // FRESH worker to receive it, leaving a live thread holding a megabyte-scale
    // mirror and running a whole-world analysis nobody will read. Safe across
    // re-init: `init` clears `disposed` before anything can request a pass.
    if (disposed) return undefined;
    const profile = agentProfile;
    if (profile === null) {
      // ANSWERED-and-absent, not merely absent. Unanswered means the catalog
      // fetch is still in flight, and this sentence is about the PROJECT — said
      // then it would be a fact about which arrival won a race, and a project
      // that ships `catalog/agent.json` would read it whenever its fetch lost.
      // The one-shot makes that permanent, so the gate has to be here rather
      // than a retraction later.
      if (agentProfileAnswered && !profileMissingReported) {
        profileMissingReported = true;
        // A WARNING, not a refusal: the advisor is behaving correctly and every
        // verb still works. As an `error` this one sentence was enough to open
        // the editor with a red unread badge over a world where nothing is wrong.
        reportToolError(
          "walkability advisor idle — this project installs no agent profile",
          "warn",
        );
      }
      // Every pending flag stays set, so an install later catches up in full —
      // and that is what carries the UNANSWERED case: the answer posts nothing
      // itself, so the next pass is where it gets said (or, if the answer was a
      // profile, where the advisor simply starts working).
      return undefined;
    }
    postMirrorSync();
    if (analyzerPlacementsStale) {
      analyzerPlacementsStale = false;
      void analyzer
        .placements(analyzerPlacementGroups())
        .catch(reportAnalyzerFailure);
    }
    // Nothing to analyse — which for a whole-world request means an empty STORE,
    // because that request analyses the store rather than `analyzerDirty`. The
    // request is DEFERRED rather than consumed: dropping it would be harmless
    // today (every path that later fills the store re-requests it, and the idle
    // tail would catch the rest), but only by a coupling a reader has to
    // re-derive, and the flag surviving is free. The first pass that has
    // something to analyse then honours it, instead of downgrading to
    // incremental and making the user wait out the idle tail.
    //
    // The deferral is invisible to the user because `analyzerPendingCount` asks
    // the SAME question below: a request parked over an empty store is not work
    // owed, and a meter that said otherwise would sit at "1 pass owed" for the
    // life of a brand-new world.
    if (!analyzerHasWork()) return undefined;
    const dirty = analyzerWholeWorld
      ? [...store.chunks.keys()]
      : [...analyzerDirty];
    const wholeWorld = analyzerWholeWorld;
    analyzerWholeWorld = false;
    analyzerDirty.clear();
    analyzerBusy = true;
    return { profile, dirty, reachability: wholeWorld, seeds: analyzerSeeds };
  };

  // Settle the marker layer on the current findings, then tell the subscriber —
  // in that order, because a subscriber may read the host back synchronously
  // (the panel does) and none may observe a summary whose markers are stale.
  // The ONE path from "the findings changed" to "everything that shows them
  // agrees", shared by the response, the filters and a world reset.
  const publishFlags = (): void => {
    const summary = flagStore.summary();
    rebuildFlagMarkers(summary);
    rebuildFlagSelection(summary);
    flagsCb?.(summary);
  };

  // Adopt a selected finding and republish. The RAW write, with no validation and
  // no camera: `selectFlag` refuses first and frames after, and the viewport's own
  // marker click deliberately does neither — the user is looking at what they just
  // clicked, so a frame there would be the camera jumping on every press.
  const setSelectedFlag = (key: string | null): void => {
    flagStore.setSelected(key);
    publishFlags();
  };

  // The public verb. Refuses one way — a key no VISIBLE row answers to — through
  // the same sentence `verifyFlag` uses for the same situation, and a refusal
  // leaves the standing selection and publishes nothing.
  const selectFlagImpl = (key: string | null): void => {
    if (key === null) {
      setSelectedFlag(null);
      return;
    }
    const row = flagStore.rowByKey(key);
    if (row === undefined) {
      reportToolError("that flag was re-analyzed away");
      return;
    }
    setSelectedFlag(key);
    // The flag's CELL, not its chunk: `flagCellBox` is the same box the pointer
    // pick clicks and the outline draws, so the camera lands on exactly what the
    // user selected. (The chunk-sized frame this replaces is the F4 gate's first
    // finding — 4 m of world round a 0.18 m pin.)
    aimCamera(
      frameBox(orbitState, flagCellBox(row.flag.world, store.cellSize)),
    );
    applyOrbit();
  };

  const analyzePump = createAnalyzePump(analyzer, {
    next: analyzerFire,
    onFlags: (res) => {
      analyzerBusy = false;
      if (disposed) return;
      flagStore.applyFlags(res.chunks, res.pits);
      publishFlags();
    },
    onError: (err) => {
      analyzerBusy = false;
      reportAnalyzerFailure(err);
    },
  });

  // Re-arm the whole-world pass. Every density write calls this, so a drag
  // pushes it out rather than running it; it fires once the writes stop. The
  // per-edit passes are unaffected — they go out immediately.
  const scheduleWholeWorldPass = (): void => {
    if (analyzerIdle !== null) clearTimeout(analyzerIdle);
    analyzerIdle = setTimeout(() => {
      analyzerIdle = null;
      analyzerWholeWorld = true;
      analyzePump.request();
    }, ANALYZER_IDLE_MS);
  };

  // --- stage 2: the verify verb --------------------------------------------
  //
  // One at a time, by a flag rather than a count: a verify is seconds of the
  // project's REAL mover under a time budget, and the panel shows exactly one
  // row as running. Queueing a second would spend that budget on a field the
  // first may have outlived, with nothing on screen saying so.
  let verifyInFlight = false;
  // Bumped by every world reset. A verify is seconds long and `resetWorld` runs
  // `flagStore.clear()`, so a verdict landing after one would be re-added to a
  // store that has just dropped every verdict it had — describing a field that
  // no longer exists. The store's own staleness rule (a chunk's re-analysis
  // drops its verdicts) cannot catch that one, because the clear already
  // happened; every OTHER way a verdict goes stale is that rule's job.
  let worldEpoch = 0;

  const verifyFlagImpl = (key: string): void => {
    if (verifyInFlight) {
      reportToolError("a verify is already running");
      return;
    }
    const profile = agentProfile;
    // Checked BEFORE the lookup so the message names the ROOT cause: with no
    // profile nothing was ever analysed, so every key is missing, and "that flag
    // was re-analyzed away" would send the user hunting the wrong thing.
    //
    // IT IS THE SAME RACE `analyzeChunks`'s idle notice had (the F4.5 gate's F-2) and it is
    // NOT gated on `agentProfileAnswered` here, deliberately: this sentence is only reachable
    // through a verify, a verify is only reachable from a flag ROW, and rows exist only once
    // the analyzer has produced findings — which needs a profile. So the window in which the
    // answer is still in flight has no route to this call. If a verify ever becomes reachable
    // from somewhere that does not imply a finding (a palette verb, a command-palette row),
    // that stops being true and this wants the same latch the notice took.
    if (profile === null) {
      reportToolError(
        "verify needs the project's agent profile — none is installed",
      );
      return;
    }
    // The store owns key→row: `flagKey` is private to field-flags.ts, so a
    // lookup written here would be re-spelling a format it cannot see.
    const row = flagStore.rowByKey(key);
    if (row === undefined) {
      reportToolError("that flag was re-analyzed away");
      return;
    }
    // A pit is refused HERE and not only in the panel, which disables the button
    // with the same reason. Defence in depth on a verb whose cost is real: stage
    // 2 drives directed lanes at ONE anchor cell and a pit is a whole region, so
    // an anchor's lanes would prove nothing about it. The two spellings of the
    // reason agree by REVIEW — the chrome cannot value-import anything under
    // `viewport-host/` (the FlagsSection tint-palette precedent).
    if (row.flag.kind === "pit") {
      reportToolError("that finding is region-level — walk it");
      return;
    }
    verifyInFlight = true;
    const epoch = worldEpoch;
    void analyzer
      .verify({
        engineUrl: ANALYZER_ENGINE_URL,
        flag: row.flag,
        profile,
        budgetMs: VERIFY_BUDGET_MS,
      })
      .then((res) => {
        // Dropped when the host is gone, or when the WORLD is: an answer about a
        // field that has since been swapped out would be re-added past the
        // clear that reset made, and would then badge whatever finding of the
        // NEW world happened to key alike. Everything else — a re-analysis
        // retiring or moving this finding — is the flag store's own rule, which
        // drops a chunk's verdicts when that chunk is replaced.
        if (disposed || worldEpoch !== epoch) return;
        flagStore.setVerdict(row.flag, res.verdict);
        publishFlags();
      })
      .catch(reportAnalyzerFailure)
      // The latch releases on every SETTLEMENT, or one dead bundle costs the
      // verb for the rest of the session (the pump's own rule). That covers the
      // realistic bundle failure: a build error makes the daemon answer
      // /engine.js with a 500, the worker's dynamic import rejects, and the
      // typed analyzer-error lands in the catch above (the worker also drops its
      // engine memo, so a later verify retries a bundle that has since built).
      //
      // It does NOT cover a `bundler.build()` that never settles at all: that
      // import runs BEFORE `budgetMs` is consulted and nothing here bounds it,
      // so this promise never settles and the latch stays shut. Deliberately not
      // fixed with a host-side timeout — the worker dispatches on a serialized
      // tail, so a hung import has already wedged sync and analyze too. A
      // timeout would re-enable a button whose every request queues behind the
      // hang, trading a visibly stuck verb for an invisibly stuck one.
      .finally(() => {
        verifyInFlight = false;
      });
  };

  // Advisor passes still owed an answer — see FieldStats.analyzerPending. Two
  // states where a flag is set and NOTHING is owed, and they are the same
  // mistake from two directions: a meter stuck at 1 forever describes an advisor
  // that is permanently working.
  //
  // With no profile IN HAND the pending flags DO accumulate (they are the
  // catch-up an install would run), but nothing is posted and nothing will be
  // until one arrives: the advisor is off, not busy. Both null-ish states read
  // the same here on purpose — a host still waiting on `catalog/agent.json` owes
  // exactly as much analysis as one whose project has no agent at all, namely
  // none. Only the idle NOTICE has to tell them apart.
  //
  // With a profile and an EMPTY store, the whole-world request `analyzerFire`
  // deferred is real and will be honoured — but there is nothing for it to look
  // at yet, so `analyzerHasWork` is what both this and the pump ask. That shared
  // answer is the point: the pump had already decided not to fire, and only this
  // count disagreed (the F4.5 gate's F-3, on a brand-new world).
  // COVERAGE NOTE (F4.5 seal): the `|| analyzerResync` term is not pinned by any test —
  // deleting it leaves the whole suite green. It is kept rather than dropped because the two
  // flags answer different questions (`analyzerHasWork` asks whether any chunk is dirty;
  // `analyzerResync` asks whether the NEXT pass must re-read the whole store, which
  // `setAgentProfile` and the world-load paths set on a store that may have no dirty chunk
  // at all), and the reason the suite cannot tell them apart is timing: a queued resync
  // normally survives only the frame in which `analyzerBusy` is already contributing 1. That
  // is an argument, not a proof. If this ever needs changing, write the case first —
  // profile installed on a loaded world, before the pump fires — rather than trusting the green.
  const analyzerPendingCount = (): number => {
    if (agentProfile === null) return 0;
    const queued = analyzerHasWork() || analyzerResync;
    return (analyzerBusy ? 1 : 0) + (queued ? 1 : 0);
  };

  const destroyFlagMarkers = (c: Context): void => {
    if (!flagMarkers) return;
    mesh.destroyInstanced(c, flagMarkers.im);
    geometry.destroy(c, flagMarkers.g);
    flagMarkers = null;
  };

  // Rebuild the marker layer from a settled summary: ONE instanced unit cube,
  // scaled to FLAG_MARKER_SIZE_M, at each visible finding's floor surface raised
  // half a cell (so the marker sits in the AIR cell the flag anchors on, not
  // sunk into the floor under it). Whole-layer teardown-and-rebuild, like
  // rebuildProps: instance counts are fixed at creation and a response replaces
  // whole chunks at a time, so there is no partial update to make. Silent no-op
  // before GPU init — init() rebuilds once the materials exist.
  //
  // The SELECTED finding's instance is drawn bigger (flagMarkerStyle) and keeps
  // its own colour; the `--primary` half of D-F4.5-15's emphasis is the cell
  // outline `rebuildFlagSelection` builds beside this.
  const rebuildFlagMarkers = (summary: FlagsSummary): void => {
    // The count settles FIRST and unconditionally: it is what the layer IS
    // (rebuildProps' rule), and a host with no context has still decided it.
    markerCount = summary.visible.length;
    const c = ctx;
    if (!c || !flagMarkerMat) return;
    destroyFlagMarkers(c);
    if (summary.visible.length === 0) return;
    const g = geometry.cube(c, { size: 1 });
    const im = mesh.createInstanced(c, {
      geometry: g,
      material: flagMarkerMat,
      count: summary.visible.length,
    });
    // Column-major TRS with no rotation: uniform scale on the diagonal, position
    // in the last column (the packPlacementMatrices layout, by hand because
    // there is nothing to rotate). The POSITION comes from flagMarkerCenter,
    // shared with the pointer pick's cell box so the drawn marker and the
    // clickable one cannot part company by the height of the lift.
    const matrices = new Float32Array(16 * summary.visible.length);
    let i = 0;
    for (const row of summary.visible) {
      const o = i * 16;
      const [cx, cy, cz] = flagMarkerCenter(row.flag.world, store.cellSize);
      const style = flagMarkerStyle(row, row.key === summary.selected);
      const size = FLAG_MARKER_SIZE_M * style.scale;
      matrices[o] = size;
      matrices[o + 5] = size;
      matrices[o + 10] = size;
      matrices[o + 12] = cx;
      matrices[o + 13] = cy;
      matrices[o + 14] = cz;
      matrices[o + 15] = 1;
      mesh.setInstanceTint(c, im, i, style.tint);
      i++;
    }
    mesh.setInstanceMatrices(c, im, matrices);
    flagMarkers = { im, g };
  };

  // The selected finding's cell outline — one cell of `--primary` wireframe round
  // the marker, drawn under the flags layer gate. Built from `summary.selected`
  // rather than from a key held here, so it can only ever outline a row the same
  // push says is visible.
  //
  // DISCLOSED AS UNPINNED, the `gizmoVisible` rider: this batch has no seam and
  // nothing reads instance data back, so no test observes that the outline (or the
  // marker's size pop) is actually drawn. What IS pinned is everything either can be
  // derived from — `flagCellBox` and `flagMarkerStyle` are pure and covered in
  // tests/viewport-host/field-flags.test.ts, and `summary.selected`'s own resolution
  // is covered there and in tests/field-host-flag-select.test.ts. An accessor added
  // for one assertion is not worth the surface; the gate is the eyeball check. The
  // third of the three is the cell layer's `selection` gate — see renderScene.
  const rebuildFlagSelection = (summary: FlagsSummary): void => {
    const row =
      summary.selected === null
        ? undefined
        : summary.visible.find((r) => r.key === summary.selected);
    flagSelectionBatch =
      row === undefined
        ? null
        : aabbEdgeBatch(
            flagCellBox(row.flag.world, store.cellSize),
            SELECTED_COLOR,
          );
  };

  // Post ONE preview job for a session state captured at fire time. Response
  // processing is guarded two ways: the session RUN (the pure module drops
  // superseded runs) and the session GENERATION (run restarts at 0 per
  // session, so a previous session's response could otherwise land on a fresh
  // session's run 0). The coalescer's settle() runs on EVERY settlement —
  // result, error, or a handler that itself threw, stale and
  // foreign-generation alike — so the latch always releases and a queued
  // re-fire is never lost.
  const sendPreviewJob = (s: StampSession, gen: number, run: number): void => {
    worker
      .stampPreview({
        generator: s.generator,
        params: structuredClone(s.params),
        seed: s.seed,
        region: structuredClone(s.region),
        policy: s.policy,
        table,
        cellSize: store.cellSize,
        chunks: snapshotChunks(s.region),
      })
      .then(
        (res) => {
          if (!disposed && gen === stampGen && stamp !== null) {
            const next = withPreviewResult(
              stamp,
              run,
              res.opCount,
              res.placements.length,
            );
            // null = superseded — a newer preview owns the ghost.
            if (next !== null) {
              stamp = next;
              applyStampGhost(res.chunks);
              // AFTER applyStampGhost, which clears both ghost halves first.
              placementGhost = placementGhostBatch(
                res.placements,
                archetypeById,
                GHOST_COLOR,
              );
              // A move DROP that landed while this preview was in flight. Spent
              // HERE, on the settle that made the session committable, and
              // BEFORE notifyStamp: a commit ends the session and notifies on
              // its own way out, so publishing "ready" first would push a
              // session the chrome never gets to see. Not spent on a STALE run
              // (`next === null` above) — a newer preview is still coming and
              // owns the drop. A commit that refuses (an empty preview, a core
              // throw) leaves the session standing and falls through to the
              // notify below, which is what keeps its message on screen.
              if (moveCommitPending) {
                moveCommitPending = false;
                commitActiveSession();
                if (stamp === null) return;
              }
              notifyStamp();
            }
          }
        },
        (err: unknown) => {
          if (!disposed && gen === stampGen && stamp !== null) {
            const message = err instanceof Error ? err.message : String(err);
            const next = withPreviewError(stamp, run, message);
            if (next !== null) {
              // The session's error field is the panel's channel; console
              // keeps the developer trail (mirrors remeshOne).
              console.warn(`field-host: stamp preview failed: ${message}`);
              // A latched drop dies with the preview it was waiting on: there is
              // no ghost to commit, and an armed latch would otherwise fire on
              // whatever settle came next — a re-roll, a param edit — committing
              // something the user never dropped. The session is demoted with it
              // (the drop already ended the mapping), which is the OTHER way a
              // move stalls: dropMove's error branch catches a preview that had
              // already failed, this one catches the drop that latched onto a
              // preview about to fail.
              moveCommitPending = false;
              stamp = demoteStalledMove(next);
              destroyStampGhosts();
              notifyStamp();
            }
          }
        },
      )
      // A HANDLER can throw — applyStampGhost against a context torn down
      // mid-flight, or a subscriber inside notifyStamp. Two-argument `then`
      // sends that to an unhandled rejection, skipping the settle() the old
      // shape put at the end of each handler and latching the coalescer shut
      // for the rest of the session (every later preview silently queued and
      // never fired). Catch it, then settle from `finally` so the latch
      // releases on EVERY path — result, rejection, or handler fault.
      .catch((err: unknown) => {
        // reportToolError, not a bare console.warn: the session's own error
        // field carries a preview REJECTION to the panel, but a fault in the
        // handler leaves the session reading "previewing" beside a ghost that
        // never arrived — the one stamp failure with nowhere to show. The
        // tool-error channel is where the void cast puts its equivalent, and
        // reportToolError keeps the console trail either way.
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(`stamp preview could not be drawn: ${message}`);
      })
      .finally(() => previewCoalescer.settle());
  };

  // Latest-wins in-flight coalescing: the worker client is a plain request
  // pipe ("callers own coalescing", field-client.ts), so the HOST collapses
  // preview bursts — while one job runs, any number of previewStamp calls
  // queue ONE re-fire against the session state CURRENT at settle. A slider
  // drag costs at most one trailing job instead of a 30-60Hz queue of
  // snapshot copies + ~100ms worker evaluates. Fire declines (false) when
  // the session vanished by fire time, leaving the latch idle.
  const previewCoalescer = createPreviewCoalescer((): boolean => {
    if (disposed || stamp === null) return false;
    sendPreviewJob(stamp, stampGen, stamp.run);
    return true;
  });

  // Fire (or queue) a ghost preview for the current session. Session-state
  // captures happen inside the coalescer's fire callback, BEFORE notifyStamp
  // runs: a subscriber may synchronously cancel/update the session from
  // inside the "previewing" notification (re-entrancy), so nothing here
  // re-reads `stamp` after notifying.
  // Known v0 divergence window (F2b Task 15 disposition): a ⌘Z DURING a live
  // session mutates the store this preview snapshotted, so a keep-existing-air
  // ghost can differ from what commit later builds (commit re-evaluates against
  // the then-current field). NARROWED to ⌘Z by F4.5b Task 9: a brush stroke is
  // no longer one of the ways in — both field-writing arms are suspended while a
  // session stands (`suspendedByStamp`), which makes the "contrived today"
  // justification stronger, not weaker. Documented rather than fixed with
  // cancel-on-undo. See also commitStampSession.
  const previewStamp = (): void => {
    if (stamp === null) return;
    stamp = toPreviewing(stamp);
    previewCoalescer.request();
    notifyStamp();
  };

  // Move the session's placement region by whole lattice steps and re-preview
  // — the ONE path behind both the arrow keys and the session card's d-pad.
  // Region changes supersede like params changes (withRegion bumps the run),
  // so an in-flight ghost for the old placement is dropped on arrival, and
  // sendPreviewJob re-snapshots chunks off the NEW region by itself.
  const nudgeStampRegion = (steps: Vec3T): void => {
    if (stamp === null) return;
    stamp = withRegion(stamp, nudgeRegion(stamp.region, steps));
    previewStamp();
  };

  // The quarter turns a generator offers, read off its OWN paramSchema — never a
  // list spelled here. Core owns the members (they are STRINGS, and its
  // validator accepts exactly those), so a copy in the editor would be a second
  // spelling of one fact, free to drift the day a turn is added or the enum goes
  // numeric. Null = this generator has no rotation (cave, scatter) or has left
  // the registry.
  const rotationOptions = (generator: string): string[] | null => {
    let def: field.GeneratorDef;
    try {
      def = field.generatorById(generator);
    } catch {
      return null;
    }
    const prop = generatorSchemaProperties(def)[ROTATION_PARAM];
    if (typeof prop !== "object" || prop === null) return null;
    // Boundary cast: the runtime check above proves a non-null object, which is
    // always index-readable as Record<string, unknown> (generatorSchemaProperties'
    // own narrowing, one level down).
    const members = (prop as Record<string, unknown>)["enum"];
    if (!Array.isArray(members)) return null;
    const turns = members.filter((m): m is string => typeof m === "string");
    return turns.length === 0 ? null : turns;
  };

  // R: the live session's next quarter turn. A params change like any other —
  // the run bumps, the ghost re-cooks, and Enter then commits what is on screen.
  // A value the schema does not offer (absent, because `rotation` is optional on
  // records written before it existed) lands on the FIRST member rather than
  // reporting: the point of the key is to turn the thing.
  const rotateStampSession = (): void => {
    const s = stamp;
    if (s === null) return;
    const turns = rotationOptions(s.generator);
    if (turns === null) {
      reportToolError(`${s.generator} has no rotation`);
      return;
    }
    const current = s.params[ROTATION_PARAM];
    const at = typeof current === "string" ? turns.indexOf(current) : -1;
    const next = turns[(at + 1) % turns.length];
    if (next === undefined) return; // unreachable: turns is non-empty
    stamp = withParams(
      s,
      { ...s.params, [ROTATION_PARAM]: next },
      s.seed,
      s.policy,
    );
    previewStamp();
  };

  const cancelStampSession = (): void => {
    // BEFORE the null guard, so a stray move mapping can never survive a session
    // that is already gone — this is the ONE teardown every discard path runs
    // (Esc, a world reset, a table swap, freeze/bake/delete, a re-open).
    endMove();
    if (stamp === null) return;
    stamp = null;
    destroyStampGhosts();
    notifyStamp();
  };

  // The ONE thing the host decides for the card when a param changes: re-pointing a
  // placer at a different catalog archetype re-seeds the params the user has NOT spoken
  // about from the new archetype's authored `scatter` hints, and leaves the ones they
  // have (D-25 — "defaults behave"). Both other readings are wrong in a way the user
  // notices: re-seed everything and their density edit vanishes without a word; re-seed
  // nothing and the new archetype arrives wearing the old one's spacing.
  //
  // HERE rather than in the session card, and not by preference. The hints come off the
  // installed entity catalog, which the CHROME deliberately does not carry — `useCatalogs`
  // publishes a tick and says why ("handing over the parsed catalog would invite a
  // consumer to read it instead of re-reading the host"). So the host owns the hints, and
  // therefore has to own the touched-key set that filters them, or the decision would be
  // split across two actors that can disagree.
  //
  // QUERY only: `stampTouched` is updated by the caller BEFORE this runs, so the incoming
  // change itself counts as touched — which is what keeps the id the user just picked from
  // being treated as a hint about itself.
  const reseedForArchetype = (
    incoming: Record<string, unknown>,
    current: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (Object.is(incoming[ARCHETYPE_PARAM], current[ARCHETYPE_PARAM]))
      return incoming;
    return seedArchetypeParams(
      incoming,
      archetypes,
      Object.keys(incoming).filter((k) => !stampTouched.has(k)),
    );
  };

  // Open a STAMP session over `aabb` and fire its first ghost preview — the half
  // of `startStamp` that runs once a region is known, shared by its two routes
  // in: a selection that was already there, and a region the user drew for a
  // pending arm (D-F4.5-7). One body, so the two cannot snap, seed or layer
  // params differently.
  //
  // `truncated` is a property of the SELECTION that supplied the region (a flood
  // that hit the UI budget under-covers what the user asked for), so a drawn
  // region passes false: a region is exactly itself.
  const openStampSession = (
    generator: string,
    def: field.GeneratorDef,
    aabb: { min: Vec3T; max: Vec3T },
    truncated: boolean,
  ): void => {
    // The region snapped OUTWARD to the 0.5 m lattice — the same snap box-select
    // regions get (a region selection and a drawn region are already snapped;
    // flood AABBs land on the voxel grid and widen out).
    const [x0, x1] = snapSpan(aabb.min[0], aabb.max[0]);
    const [y0, y1] = snapSpan(aabb.min[1], aabb.max[1]);
    const [z0, z1] = snapSpan(aabb.min[2], aabb.max[2]);
    // Seed the size params from the region extent (spec D-F3-13): the region
    // already fits, and the generator's size knobs default to fill it (clamped
    // to their schema range). A sensible default the user overrides with any
    // subsequent updateStamp edit.
    const sizes = deriveSizeDefaults(
      generator,
      [spanCells(x0, x1), spanCells(y0, y1), spanCells(z0, z1)],
      generatorSchemaProperties(def),
      field.MAZE_PITCH_CELLS,
    );
    cancelStampSession(); // a live session (+ ghost) never survives a restart
    stampGen++;
    suspendReported = false; // one suspension sentence per session
    stampTouched = new Set(); // a new session has heard nothing yet
    // Layering, outermost last: schema defaults → the archetype's authored
    // scatter hints (catalog seeding) → the region-fit sizes. The two never
    // collide today (no generator has both an archetypeId and a size param),
    // and if one ever does, the REGION the user drew should win over a catalog
    // default.
    stamp = startSession(
      generator,
      {
        ...seedArchetypeParams(structuredClone(def.defaults), archetypes),
        ...sizes,
      },
      { min: [x0, y0, z0], max: [x1, y1, z1] },
      randomStampSeed(),
      truncated,
    );
    previewStamp();
  };

  // The second click of a pending stamp's region draw: the drawn box IS the
  // region the session opens on. The arm is spent either way the click goes —
  // once the region lands, and not at all while a corner is still owed.
  const stampRegionClick = (clientX: number, clientY: number): void => {
    const armed = pendingStamp;
    if (armed === null) return;
    const spec = boxCorner(clientX, clientY);
    // A region spec's min/max ARE its metre AABB (cf. updateBoxPreview); the
    // kind check narrows the union, and boxCorner only ever builds a region.
    if (spec === null || spec.kind !== "region") return;
    let def: field.GeneratorDef;
    try {
      def = field.generatorById(armed.id);
    } catch (err) {
      // Unreachable today — `startStamp` resolved this id before arming, and the
      // registry is a module constant. Caught anyway because the alternative is
      // a throw out of a pointer handler.
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(message);
      setPendingStamp(null);
      return;
    }
    setPendingStamp(null);
    openStampSession(armed.id, def, { min: spec.min, max: spec.max }, false);
  };

  // The empty-preview gate both terminal verbs share, and PROP GENERATORS ONLY.
  // Core rejects an empty evaluate outright ("evaluated to an empty result"),
  // which is right for a CARVER — nothing to build means a misconfigured stamp,
  // and core's own message says so accurately. It reads as a hard failure for a
  // READER the user simply tuned down to zero props, where zero is a legitimate
  // outcome, so for those the host tests the settled preview first and reports a
  // sentence in the vocabulary of the thing that came up empty, leaving the
  // session standing to re-tune. A carver keeps core's message verbatim (through
  // the callers' catch): "0 props … raise density" would be nonsense advice for
  // a hall. Returns whether it refused.
  //
  // STALENESS — this reads the LAST SETTLED PREVIEW, not a fresh evaluate, so it
  // inherits the divergence window `previewStamp` documents: a ⌘Z during a live
  // session moves the store the preview snapshotted (a brush stroke no longer
  // can — see `suspendedByStamp`). Undo a floor out from under a scatter that
  // previewed empty and Enter still refuses, with advice that is no longer true. Cheap to escape (any param change, re-roll or
  // nudge re-previews) and it only ever refuses a commit core would reject
  // anyway, so it is documented rather than fixed with a re-evaluate on commit.
  const reportEmptyPreview = (s: StampSession): boolean => {
    if (!previewIsEmpty(s)) return false;
    let def: field.GeneratorDef;
    try {
      def = field.generatorById(s.generator);
    } catch {
      return false; // a retired generator: let the core call own the failure
    }
    if (!placesProps(def.emits)) return false;
    reportToolError(
      `${s.generator} placed no props here — nothing to commit. Widen the region, raise density, or lower spacing.`,
    );
    return true;
  };

  // Commit the previewed stamp: ONE undo entry, ONE entity op. Preview and
  // commit run the SAME pure evaluate (charter §2.2 determinism), so the
  // committed field reproduces the ghost exactly — the ghost is not an
  // approximation. Exception: the store changed since the last preview (⌘Z or
  // a stroke mid-session) — see the divergence note on previewStamp.
  const commitStampSession = (): void => {
    const s = stamp;
    if (s === null || s.phase !== "ready") return;
    // Mode guard, symmetric with applyReconfigureSession's: committing a
    // RECONFIGURE session would append a second entity over the same region and
    // leave the original standing. commitActiveSession already routes Enter by
    // mode, so this guards the PUBLIC commitStamp against the same mistake.
    if (s.mode !== "stamp") return;
    if (reportEmptyPreview(s)) return;
    try {
      const { dirty: committed } = field.commitGenerator(
        store,
        log,
        field.generatorById(s.generator),
        {
          params: s.params, // commitGenerator clones for provenance
          seed: s.seed,
          region: s.region,
          policy: s.policy,
          table,
        },
      );
      markDirtyWithNeighbors(committed);
    } catch (err) {
      // Ready-phase commits share the preview's validated inputs, but the
      // material table can change between the two — setup-loud core throws
      // land here; the session stays ready so the user can cancel or retry.
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(`stamp commit failed: ${message}`);
      return;
    }
    stamp = null;
    destroyStampGhosts();
    // The commit's placement ops (a scatter's props) are new prop-layer content.
    rebuildProps();
    notifyStamp();
    notifyEntities();
  };

  // --- reconfigure (open a committed entity → apply) ----------------------

  // Open a reconfigure session on a committed entity. Every refusal is
  // runtime-quiet (report + no session): the ids come from a panel list that
  // can lag the log, and the flags are exactly what the user is asking about.
  //
  // `moving` flags the session as a MOVE (see StampSession.moving). It is a
  // property of the session being built, not a branch — every refusal, the
  // ghost, and the terminal verb are identical either way, which is the whole
  // point of a move being a reconfigure. Returns whether a session opened, so
  // the move path knows whether to arm its cursor mapping.
  const openEntitySession = (entityId: number, moving: boolean): boolean => {
    const record = entityRecord(entityId);
    if (record === null) {
      reportToolError(`entity ${entityId} is no longer in the log`);
      return false;
    }
    // ONE rule, shared with the row's Open button (field-entity.ts): a state
    // the UI disables for and a state the host refuses can never drift apart.
    const blocked = openBlockedReason(record);
    if (blocked !== null) {
      reportToolError(`entity ${entityId} is ${blocked}`);
      return false;
    }
    try {
      field.generatorById(record.generator); // setup-loud on a retired id
    } catch (err) {
      // Fail HERE rather than opening a session whose every preview errors and
      // whose Apply can never land (startStamp's precedent).
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(message);
      return false;
    }
    cancelStampSession(); // a live session (+ ghost) never survives a re-open
    // …and neither does a pending stamp arm: opening a session answers the region
    // question the arm was asking, and leaving it set would put the next click on
    // a region-draw for a stamp nobody is looking at any more.
    setPendingStamp(null);
    stampGen++;
    suspendReported = false; // one suspension sentence per session
    stampTouched = new Set(); // a new session has heard nothing yet
    const opened = startReconfigureSession({
      entityId,
      generator: record.generator,
      // Clone at the boundary: the session must never alias the log's record.
      params: structuredClone(record.params),
      seed: record.seed,
      region: structuredClone(record.region),
      // Not provenance — see the openEntity contract.
      policy: "replace",
    });
    // Set BEFORE previewStamp, which is what pushes the session to subscribers:
    // flagging it afterwards would publish one frame of "reconfigure" ahead of
    // the move, and the strip would flicker the wrong word.
    stamp = moving ? { ...opened, moving: true } : opened;
    previewStamp();
    return true;
  };

  // Whatever ends the session ends the move with it. A `moveDrag` that outlived
  // its session would map the next cursor motion onto nothing — and, once
  // another session opened, onto the wrong thing entirely.
  const endMove = (): void => {
    moveDrag = null;
    pendingMove = null;
    moveCommitPending = false;
  };

  // Start a move on a committed entity: the reconfigure session, plus the cursor
  // mapping that will drive its region. Returns whether it started (every
  // refusal is openEntitySession's, already reported).
  const beginMoveSession = (
    entityId: number,
    axis: Axis | null,
    grabbed: boolean,
    press: { x: number; y: number } | null,
  ): boolean => {
    if (!openEntitySession(entityId, true)) return false;
    // AFTER the open because of the `?? stamp?.region` fallback, which needs the
    // session set. The memo itself is unmoved — its signature is
    // worldEpoch/ops/undo/redo/nextId and opening a session touches none of them
    // — so this is the same map either way; only the fallback needs the ordering.
    const box = entityFootprints().get(entityId) ?? stamp?.region;
    if (box === undefined) return false; // unreachable: the open proved the record
    moveDrag = startMove({ box, axis, grabbed, press });
    // The gizmo's arms narrow to the constrained one the moment a drag owns them.
    rebuildEntitySelectionBatch();
    return true;
  };

  // One cursor event's worth of move: re-read the mapping, turn the offset from
  // the anchor into whole lattice steps, and hand the DIFFERENCE to the same
  // region nudge the arrow keys drive. An imperative shell — the two `cursorRay`
  // calls and the session are the only things here that need the world;
  // `field-move.ts` owns every rule, and returns a fresh drag rather than
  // writing to this one.
  //
  // No clamp on how far a region may travel, deliberately. The field has no
  // world bounds to clamp against (chunks allocate on demand), so any limit
  // would be an invented number; the arrow-key nudge this shares a seam with has
  // none either, and a move that disagreed with the d-pad about where a region
  // may go would be a second rule for one concept. What bounds it in practice is
  // the mapping itself — a region can only go where the cursor ray can reach —
  // and the ghost shows exactly where it will land before the drop.
  const updateMove = (e: {
    clientX: number;
    clientY: number;
    shiftKey?: boolean;
  }): void => {
    let d = moveDrag;
    if (d === null || stamp === null) return;
    const mapping = resolveMapping(d, e.shiftKey === true);
    if (d.anchorPoint === null || mapping !== d.mapping) {
      // (Re-)anchor. The FIRST anchor of a drag is taken at the PRESS, not here:
      // the move opens on the event that crosses the threshold, and anchoring
      // there would throw away the travel that opened it.
      const from =
        d.anchorPoint === null && d.press !== null
          ? d.press
          : { x: e.clientX, y: e.clientY };
      const anchorRay = cursorRay(from.x, from.y);
      if (anchorRay === null) return;
      const at = movePoint(d, mapping, {
        origin: anchorRay.origin,
        dir: anchorRay.dir,
      });
      if (at === null) return;
      d = reanchored(d, mapping, at);
      moveDrag = d;
      // A gizmo drag cannot change mapping, so this only fires for ⇧ — and the
      // drawn arms follow the constraint the ghost is now under.
      if (!d.fixedAxis) rebuildEntitySelectionBatch();
    }
    const ray = cursorRay(e.clientX, e.clientY);
    if (ray === null) return;
    const point = movePoint(d, mapping, { origin: ray.origin, dir: ray.dir });
    if (point === null) return;
    const { drag, step } = advanceMove(d, point);
    moveDrag = drag;
    if (step[0] === 0 && step[1] === 0 && step[2] === 0) return;
    nudgeStampRegion(step);
  };

  // A camera change mid-move retires the anchor: it was a world point read under
  // the old view, and the press pixel that produced it now means somewhere else,
  // so the next reading would jump by metres nobody dragged. Re-anchoring carries
  // `applied` forward, so turning the view moves the region by exactly zero —
  // the same mechanism ⇧ re-anchors through.
  const reaimMove = (): void => {
    if (moveDrag !== null) moveDrag = unanchored(moveDrag);
  };

  // A session still flagged `moving` with NO mapping driving it is a
  // contradiction: nothing is following the cursor, yet the session card renders
  // the word off this flag. Demoted rather than cancelled, because the one state
  // that reaches it is an ERRORED preview and its message is the only legible
  // reason the drop did not land — cancelling would take the explanation with it.
  //
  // Gated on `moveDrag === null` because a preview can also fail MID-drag, and
  // that move is still live: the next cursor tick re-previews and may well
  // succeed. Only a move that has already ended can be stalled.
  const demoteStalledMove = (s: StampSession): StampSession =>
    moveDrag === null && s.moving === true ? withoutMoving(s) : s;

  // End a move by DROPPING it — a mouse-up on a drag, LMB on a grab.
  const dropMove = (): void => {
    const d = moveDrag;
    endMove();
    if (d === null) return;
    if (moveIsIdle(d)) {
      // Nothing actually moved — a drag whose travel rounded to no lattice step,
      // or a grab dropped where it started. A reconfigure would still re-splice
      // the span with fresh op ids and still spend an undo entry, so committing
      // here would put a no-op on the history stack for every twitchy click.
      // End the session instead.
      cancelStampSession();
      return;
    }
    if (stamp?.phase === "ready") {
      commitActiveSession();
      return;
    }
    if (stamp?.phase === "previewing") {
      // The ghost is still cooking — latch the drop so the settle spends it
      // (see moveCommitPending).
      moveCommitPending = true;
      return;
    }
    // Neither ready nor previewing: the preview had ALREADY errored when the
    // drop arrived. The session stays standing with its message, demoted.
    if (stamp !== null && stamp.moving === true) {
      stamp = demoteStalledMove(stamp);
      notifyStamp();
    }
  };

  // Apply the live reconfigure session: ONE undo entry, the entity id and every
  // reference to it preserved. Unlike commitStampSession this does NOT re-run
  // the ghost's evaluate against the ghost's inputs — core rewinds the affected
  // chunks to their pre-span state first, which is what makes the result
  // independent of what the ghost previewed against (the openEntity limit).
  const applyReconfigureSession = (): void => {
    const s = stamp;
    if (s === null || s.mode !== "reconfigure" || s.entityId === null) return;
    if (s.phase !== "ready") return;
    if (reportEmptyPreview(s)) return;
    // The try wraps the core call and NOTHING else — the catch's claim (the
    // store and the log are untouched) is true of `reconfigureGenerator`
    // validating before its first write, and of nothing below it. Anything
    // further inside would report "reconfigure failed" for a reconfigure that
    // LANDED, and skip the session teardown on the way out. That matters most
    // for notifyDrift: it invokes a SUBSCRIBER, and a subscriber that throws is
    // an ordinary React failure mode, not a hypothetical. Same shape as
    // commitStampSession's try, deliberately.
    let result: ReturnType<typeof field.reconfigureGenerator>;
    // Bracket JUST the core call for the op-cost meter's `last reconfigure` —
    // the same narrowing the try keeps (start read before, duration read after,
    // neither inside the try). A rejected apply returns before the read, so it
    // never overwrites the last landed duration.
    const reconfigureStart = performance.now();
    try {
      result = field.reconfigureGenerator(
        store,
        log,
        s.entityId,
        {
          params: s.params, // reconfigureGenerator clones for provenance
          seed: s.seed,
          region: s.region,
          policy: s.policy,
        },
        table,
      );
    } catch (err) {
      // Core validates before its first write, so a rejection here left the
      // store and the log untouched — the session stays open to retry or
      // cancel (commitStampSession's stance).
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(`reconfigure failed: ${message}`);
      return;
    }
    lastReconfigureMs = performance.now() - reconfigureStart;
    markDirtyWithNeighbors(result.dirty);
    // The region is an editable field of this session (the nudge cluster), so
    // the footprint box this entity may be wearing can be stale as of now.
    revalidateEntitySelection();
    // A clean apply CLEARS the previous report: leaving it up would attribute
    // stale findings to the edit the user just made.
    drift = result.drift.length === 0 ? null : result.drift;
    stamp = null;
    // The session this move rode has landed, so the mapping goes with it — the
    // cancel path's rule, from the other side.
    endMove();
    destroyStampGhosts();
    // A re-cooked scatter replaces its own placement op's records, and any
    // reconfigure re-splices the log the prop layer is derived from.
    rebuildProps();
    // The three notifications LAST, once every piece of host state the apply
    // moved has settled: a subscriber may read the host back synchronously from
    // inside any of them (the chrome does — subscribeEntities' callback calls
    // listEntities), so none may observe a half-applied session.
    //
    // Drift goes last of the three because a throwing subscriber aborts the
    // rest: session-ended and list-changed keep the UI CONSISTENT with a store
    // that has already been written, while a dropped drift report only costs
    // the report. None of them is wrapped — a subscriber that throws is the
    // subscriber's bug, and swallowing it here would hide it — so the order is
    // what decides how much a buggy one can break.
    notifyStamp();
    notifyEntities();
    notifyDrift();
  };

  // Enter's ONE commit path: the session's mode picks the verb. Both are
  // ready-phase-only, so a configuring/previewing session swallows the key.
  // Public as commitSession — the panel's button calls THIS rather than
  // re-deriving the same mapping from the session it mirrors.
  const commitActiveSession = (): void => {
    if (stamp === null) return;
    if (stamp.mode === "reconfigure") applyReconfigureSession();
    else commitStampSession();
  };

  // What ⏎ MEANS, for both keys that spell it: the canvas's own binding and the
  // app-level `confirmSession`. A live MOVE is DROPPED rather than applied —
  // `dropMove` carries the zero-step rule (a grab dropped where it started spends
  // no history entry) and the pending-preview latch, neither of which
  // `commitActiveSession` knows about.
  //
  // The public `commitSession` (a panel button's Commit/Apply) deliberately does
  // NOT route through here: it means "end by mode", and a move is never reachable
  // from a panel button anyway — clicking one blurs the canvas, which cancels the
  // move first. Keeping them apart is also what stops a filed defect from
  // spreading: `moveIsIdle` asks whether the CURSOR moved, so a grab moved only by
  // the ARROW keys reads as idle here and is discarded
  // (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *A `G` grab moved by the ARROW keys reads as idle, and ⏎ discards it*).
  // Both ⏎s share that one defect rather than answering differently.
  const confirmActiveSession = (): void => {
    if (moveDrag !== null) {
      dropMove();
      return;
    }
    commitActiveSession();
  };

  // --- history ------------------------------------------------------------

  // ONE undo/redo step, shared by the canvas ⌘Z/⇧⌘Z binding and the public
  // undo()/redo(). Everything a step can move is refreshed here, not at the
  // call sites: the chunks it dirtied, the entity list (a commit, a reconfigure
  // splice and a freeze/bake record swap all ride these stacks — and the last
  // two dirty NOTHING, so a remesh cannot be the panel's signal), and the entity
  // selection (a reconfigure can have moved the footprint it outlines, and
  // undoing a commit removes the entity outright — the selection has to go with
  // it, notifying whoever holds it).
  const stepHistory = (redo: boolean): void => {
    const dirtied = redo
      ? field.redo(store, log, table)
      : field.undo(store, log);
    markDirtyWithNeighbors(dirtied);
    // A live MOVE cannot survive the log moving under it. The canvas binds ⌘Z
    // itself and a `G` grab is a modal state where the canvas necessarily has
    // focus (Esc and R are on the same listener), so this is one keypress away
    // rather than contrived — and both halves are wrong. An undone COMMIT leaves
    // the session naming an entity that is gone and the drop fails outright; an
    // undone RECONFIGURE leaves it naming an entity whose region the step just
    // moved, and the drop then quietly re-applies the placement the user undid.
    // Scoped to moves: whether ANY session should survive a history step is a
    // wider question, filed as
    // `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *A live stamp session survives a ⌘Z / ⇧⌘Z step*.
    if (stamp?.moving === true) cancelStampSession();
    revalidateEntitySelection();
    // A step can add or remove placement ops (a scatter commit, a reconfigure
    // splice) and dirties NO chunk for them — placements write no cells — so the
    // prop layer cannot ride the remesh drain the way chunk state does.
    rebuildProps();
    // A standing drift report describes the LAST reconfigure's replay against
    // a log this step just rewrote — stale in either direction (F3a gate
    // finding: ⌘Z left the list up). Cleared, never recomputed; the load-path
    // clear (loadWorld) shares the rationale. An already-null report is not
    // re-notified.
    if (drift !== null) {
      drift = null;
      notifyDrift();
    }
    notifyEntities();
  };

  // --- momentary tool overrides -------------------------------------------

  // Mirror a host-initiated tool change to the chrome (cloned — the chrome must
  // never hold a reference into host state).
  const notifyTool = (): void => {
    toolCb?.({ tool: cloneTool(tool), radius: digRadius });
  };

  // Recompute the effective tool from (saved base, held modifiers). DERIVED,
  // not stacked: Shift (momentary smooth) wins over Ctrl (dig↔fill invert),
  // and Ctrl inverts only dig/fill (paint/smooth pass through). Because the
  // result is a pure function of the base + the two flags, any press/release
  // interleaving restores the ORIGINAL tool once both are released.
  // macOS caveat: Ctrl+CLICK is synthesized as a right-click (button 2), so a
  // fresh Ctrl+LMB press starts a look there — the invert still applies to a
  // stroke already in progress (LMB down, then hold Ctrl) and on Win/Linux.
  const deriveMomentary = (): void => {
    if (!momentaryShift && !momentaryCtrl) {
      if (momentarySaved === null) return;
      tool = momentarySaved;
      momentarySaved = null;
      notifyTool();
      return;
    }
    if (momentarySaved === null) momentarySaved = tool;
    let effect = momentarySaved.effect;
    if (momentaryCtrl && effect === "dig") effect = "fill";
    else if (momentaryCtrl && effect === "fill") effect = "dig";
    if (momentaryShift) effect = "smooth";
    tool = { ...momentarySaved, effect };
    notifyTool();
  };

  // --- render loop --------------------------------------------------------

  // Fly travel is RMB-GATED (D-10): the move keys only travel while the right
  // button is holding a look. This is the Unity/Unreal mechanism, and it is what
  // buys the editor its whole bare-letter budget — `S` is fly-backward AND the
  // stamp family, `B` is unbound here AND the brush family, and there is no way
  // to have both on one keycap except by letting the button that means "I am
  // driving the camera" decide which. The app-level gate is the same rule from
  // the other side (`frontend/lib/actions.ts`: a bare-key action is refused
  // while `isLooking()`), so exactly one of the two answers any letter.
  //
  // Gated HERE rather than at the call site: `keys` still collects w/a/s/d/q/e
  // whatever the button is doing (they have to, for the release to clear them),
  // so this is the one place that decides whether the set means anything.
  const applyFlyMove = (dt: number): void => {
    if (look === null) return;
    const move = readFlyMove(keys);
    if (move.f === 0 && move.r === 0 && move.u === 0) return;
    aimCamera(flyMove(orbitState, move, flySpeed(keys, dt)));
    applyOrbit();
  };

  // The studio key light rides the eye, so a surface the user turns toward is a
  // surface that lights up. `normals` needs no lights at all (normalColor ignores
  // them), and an empty list is what says that to frame.render.
  const sceneLights = (): frame.Light[] =>
    shading === "studio"
      ? [
          {
            type: "point",
            position: cameraEye(),
            color: STUDIO_KEY_COLOR,
            intensity: STUDIO_KEY_INTENSITY,
            range: STUDIO_KEY_RANGE,
          },
        ]
      : [];

  // --- ghost target marker ------------------------------------------------

  // Scratch vectors for the ghost cube's per-frame pose (setPosition/setScale
  // copy, so reuse is safe — no per-frame allocation).
  const ghostPos = new Float32Array(3);
  const ghostScale = new Float32Array(3);

  // This frame's ghost preview state: the brush centre under the last cursor
  // position + the snapped lattice box when the active tool is a kit fill
  // (null centre = nothing to preview). Computed ONCE per frame — shared by
  // the translucent cube (inside frame.render) and the edge/ring lines
  // (drawn after it).
  type GhostState = {
    center: Vec3T;
    kitBox: ReturnType<typeof snappedKitBox> | null;
  };
  const ghostState = (): GhostState | null => {
    if (!lastPointer) return null;
    const center = computeTarget(lastPointer.x, lastPointer.y);
    if (!center) return null;
    const kitBox = isKitFillTool() ? snappedKitBox(center, digRadius) : null;
    return { center, kitBox };
  };

  // Draw the ghost preview lines, occlude:false so they read through solid
  // rock: a kit fill previews its snapped box's 12 edges; every sphere tool
  // previews the two brush rings. Corner/ring math lives in field-ghost.ts.
  const renderGhostLines = (
    c: Context,
    view: camera.Camera,
    g: GhostState,
  ): void => {
    const batch = g.kitBox
      ? boxEdges(boxCorners(g.kitBox.center, g.kitBox.halfExtents), GHOST_COLOR)
      : segmentsToBatch(sphereGhostSegments(g.center, digRadius), GHOST_COLOR);
    frame.drawLines(c, {
      vertices: batch.vertices,
      colors: batch.colors,
      camera: view,
      occlude: false,
    });
  };

  // The cursor mark a two-click gesture shows before its first click. Built per
  // FRAME rather than stored per pointer-move, because it has to track the
  // camera as well as the cursor — a right-drag with the pointer still moves the
  // world point under it. That costs one `selectionPoint` raycast per frame, the
  // same cost the brush ghost has always paid on the frames it draws, and only
  // while a two-click gesture is armed and unanchored.
  //
  // Colour follows the shape, because each mark previews a specific thing: the
  // amber cross is the box/region ANCHOR the click will leave (`setBoxAnchor`),
  // and the hologram ring is the segment's own radius (`setSegmentAnchor` is
  // hologram too). Neither changes colour when the click lands.
  const renderCursorAffordance = (c: Context, view: camera.Camera): void => {
    const shape = cursorAffordance({
      gesture,
      pendingStamp: pendingStamp !== null,
      anchored: boxAnchor !== null || segmentAnchor !== null,
    });
    if (shape === null || !lastPointer) return;
    const p = selectionPoint(lastPointer.x, lastPointer.y);
    if (!p) return;
    const batch =
      shape === "ring"
        ? segmentsToBatch(sphereGhostSegments(p, digRadius), GHOST_COLOR)
        : segmentsToBatch(
            crossSegments(p, ANCHOR_CROSS_HALF_M),
            SELECTION_COLOR,
          );
    frame.drawLines(c, {
      vertices: batch.vertices,
      colors: batch.colors,
      camera: view,
      occlude: false,
    });
  };

  const renderScene = (c: Context, view: camera.Camera): void => {
    // Layer gating happens HERE, at draw-list build time: the host has no
    // per-mesh visibility flag — it reconstructs the frame.render lists (and
    // issues the drawLines calls) every frame, so a hidden layer is simply
    // never pushed/drawn. GPU chunk state stays resident either way.
    const meshes: mesh.Mesh[] = [];
    const instanced: mesh.InstancedMesh[] = [];
    for (const cm of chunkMeshes.values()) {
      if (layers.field) for (const e of cm.entries) meshes.push(e.m);
      if (layers.kit && cm.kit) instanced.push(cm.kit);
    }
    // Committed placed props: proxy primitives on the shared instanced-lit
    // material, their own layer gate (they are entities, not field — the "if you
    // can dig it, it's field" jurisdiction line drawn in the layer strip).
    if (layers.props) for (const p of propMeshes) instanced.push(p.im);
    // The walkability advisor's markers: ONE opaque unlit instanced draw covering
    // every visible finding. Their own gate — the findings keep arriving while it
    // is off (the analyzer is not a display layer), this only stops drawing them.
    if (layers.flags && flagMarkers) instanced.push(flagMarkers.im);
    // The cell-level selection display, under the `selection` layer with the
    // outlines below (hiding the layer hides the DISPLAY; the selection itself
    // stays live and keeps masking ops). Premultiplied and depth-write-free, so
    // it sorts into frame.render's blended group with the ghosts.
    //
    // DISCLOSED AS UNPINNED, the third of this task's three (see
    // `rebuildFlagSelection` for the other two): THIS GATE is unobservable. The
    // only window onto the layer is `selectionCellCount()`, which reports what the
    // rebuild DECIDED and not what the frame drew — by design, since it is the
    // markerCount twin and settles before the context guard. So switching
    // `selection` off while a flood is selected is an eyeball check, not a test.
    // A `drawnSelectionCells()` accessor would be a second count whose only
    // consumer is one assertion, and two counts that can disagree is worse than
    // one that is honest about its scope.
    if (layers.selection && selectionCells) instanced.push(selectionCells.im);
    // The void cast goes in FIRST of the three translucents on purpose. All
    // three sort after every opaque (frame.render's blended group), so this
    // position decides nothing against the field — but within the blended group
    // submission order is preserved, and that is what decides how the three
    // compose against EACH OTHER. The cast ignores depth outright
    // (compare: "always"), so submitted last it would wash cyan over every ghost
    // in the frame; submitted first, the two ghosts keep their hologram-blue and
    // read on top of it. Right priority: a ghost is the action the user is
    // steering right now, the cast is the room around it.
    if (layers.voidCast)
      for (const entries of voidCastMeshes.values())
        for (const e of entries) meshes.push(e.m);
    // Filled kit ghost (the fill-tool-solid-volume-surprise fix): pose the ONE
    // translucent unit cube at the snapped box and push it into the mesh list.
    // When there is no kit-fill ghost this frame the mesh is simply not drawn.
    // Its position in this list no longer decides compositing against OPAQUES:
    // frame.render records every blended draw after every opaque one, so the
    // hologram (no depth write) survives the field AND the instanced kit
    // pieces. Order still matters WITHIN the blended group — submission order
    // is preserved there — so this cube's position relative to the stamp
    // ghosts below (also premultiplied, also no depth write) is what decides
    // how those two translucents composite against each other.
    // THREE independent ghost gates: the LAYER flag is user intent; the gesture
    // suppression and the session suppression are both mode coherence — nothing
    // on screen may promise a stroke the next click will not make.
    //  - while ANY gesture is armed LMB doesn't stroke, so a sphere/box brush
    //    preview would promise an action that won't happen. `segment` is
    //    included: its click anchors or sweeps a capsule, never stamps the
    //    sphere this ghost draws (its own affordances are the cursor ring below
    //    and, once anchored, the capsule preview). `pointer` being the DEFAULT
    //    gesture is why a freshly opened world shows no brush ghost at all until
    //    a brush is armed.
    //  - while a SESSION stands the brush is suspended (D-F4.5-7 — see
    //    onPointerDown), so the same promise would be false with no gesture
    //    armed at all.
    const ghost =
      layers.ghost && gesture === null && stamp === null ? ghostState() : null;
    if (ghost?.kitBox && ghostCube) {
      ghostPos.set(ghost.kitBox.center);
      ghostScale[0] = ghost.kitBox.halfExtents[0] * 2;
      ghostScale[1] = ghost.kitBox.halfExtents[1] * 2;
      ghostScale[2] = ghost.kitBox.halfExtents[2] * 2;
      mesh.setPosition(c, ghostCube, ghostPos);
      mesh.setScale(c, ghostCube, ghostScale);
      meshes.push(ghostCube);
    }
    // Stamp ghosts share the ghost LAYER gate only (no selection-mode
    // suppression — the session, not LMB, owns their promise) and draw after
    // the opaque field like the kit-fill cube (premultiplied, no depth write).
    if (layers.ghost)
      for (const entries of ghostMeshes.values())
        for (const e of entries) meshes.push(e.m);
    // Kit instances always render with the lit-instanced material, even in the
    // `normals` debug mode — there is no normal-coloured instanced variant, and
    // NORMALS_AMBIENT (full white) is what keeps them readable there. A deliberate
    // v0 choice.
    frame.render(c, {
      meshes,
      instanced,
      camera: view,
      clearColor: CLEAR,
      lights: sceneLights(),
      ambient: shading === "studio" ? STUDIO_AMBIENT : NORMALS_AMBIENT,
      effects: [],
    });
    // Depth-tested grid (occlude:true): solid geometry hides it. Minors, then majors.
    if (layers.grid) {
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
    }
    // Selection overlay: the amber cell-selection AABB + pending box-select
    // anchor cross + the pending-region preview, and the SELECTED ENTITY's
    // footprint box in the chrome's primary blue — all occlude:false so a
    // selection reads through rock. Batches are prebuilt on selection change
    // (the box preview on pointer move) — nothing is materialized per frame.
    // Hiding the layer hides the DISPLAY only: both selections stay live (the
    // cell one keeps masking ops, the entity one keeps feeding its seam).
    if (layers.selection) {
      if (selectionBatch)
        frame.drawLines(c, {
          vertices: selectionBatch.vertices,
          colors: selectionBatch.colors,
          camera: view,
          occlude: false,
        });
      if (anchorBatch)
        frame.drawLines(c, {
          vertices: anchorBatch.vertices,
          colors: anchorBatch.colors,
          camera: view,
          occlude: false,
        });
      if (boxPreviewBatch)
        frame.drawLines(c, {
          vertices: boxPreviewBatch.vertices,
          colors: boxPreviewBatch.colors,
          camera: view,
          occlude: false,
        });
      if (entitySelectionBatch)
        frame.drawLines(c, {
          vertices: entitySelectionBatch.vertices,
          colors: entitySelectionBatch.colors,
          camera: view,
          occlude: false,
        });
      // The translate gizmo, LAST of the selection overlays and occlude:false
      // like them: a handle behind the box it moves must still be grabbable, and
      // what the user sees has to be what `gizmoAxisAt` hit-tests.
      if (gizmoBatch && gizmoVisible())
        frame.drawLines(c, {
          vertices: gizmoBatch.vertices,
          colors: gizmoBatch.colors,
          camera: view,
          occlude: false,
        });
    }
    // The selected FINDING's cell outline, in the same primary blue as the entity
    // box above (D-F4.5-15's "reuse --primary, no new hue") — but under the FLAGS
    // gate, not the selection one, because it is an emphasis on a marker rather
    // than a selection overlay of its own. With `flags` off there are no markers,
    // so an outline here would box empty air; the pick is gated the same way, so
    // a flag selection cannot even be made while the layer is hidden.
    // occlude:false like every other selection overlay: a finding inside rock is
    // exactly the kind the advisor is for.
    if (layers.flags && flagSelectionBatch)
      frame.drawLines(c, {
        vertices: flagSelectionBatch.vertices,
        colors: flagSelectionBatch.colors,
        camera: view,
        occlude: false,
      });
    // The stamp's PLACEMENT proxies — one merged batch of oriented wireframe
    // boxes, occlude:false like every other ghost overlay so props previewed
    // inside a cave read through its walls. Under the ghost layer gate with the
    // hologram meshes: they are two halves of one preview.
    if (layers.ghost && placementGhost)
      frame.drawLines(c, {
        vertices: placementGhost.vertices,
        colors: placementGhost.colors,
        camera: view,
        occlude: false,
      });
    // The segment brush's pending anchor + capsule preview. Under the GHOST
    // layer, not `selection`: they preview a brush op the next click commits.
    if (layers.ghost) {
      if (segmentAnchorBatch)
        frame.drawLines(c, {
          vertices: segmentAnchorBatch.vertices,
          colors: segmentAnchorBatch.colors,
          camera: view,
          occlude: false,
        });
      if (segmentPreviewBatch)
        frame.drawLines(c, {
          vertices: segmentPreviewBatch.vertices,
          colors: segmentPreviewBatch.colors,
          camera: view,
          occlude: false,
        });
    }
    // Ghost target preview last so it draws over the scene + grid (occlude:false).
    if (ghost) renderGhostLines(c, view, ghost);
    // The armed-but-unanchored cursor affordance (f2b item 10 / D-F4.5-7): what
    // a two-click gesture shows BEFORE its first click, so arming one is not a
    // mode with no affordance at all. Which mark to draw is `cursorAffordance`'s
    // decision, pinned in the pure module; here is only the drawing.
    if (layers.ghost) renderCursorAffordance(c, view);
  };

  // logStats, recomputed only when the log signature moved (see the cache
  // decls) — called once per tick to feed the op-cost meter without a per-frame
  // full-log scan.
  const currentLogStats = (): field.LogStats => {
    if (
      log.ops.length !== statsOpsLen ||
      log.undoStack.length !== statsUndoLen ||
      log.redoStack.length !== statsRedoLen
    ) {
      cachedLogStats = field.logStats(log);
      statsOpsLen = log.ops.length;
      statsUndoLen = log.undoStack.length;
      statsRedoLen = log.redoStack.length;
    }
    return cachedLogStats;
  };

  // The canvas cursor for what the viewport is armed to do (D-F4.5-8's third
  // arming channel). Driven from the FRAME rather than from the eight places
  // that change an arm — one site that cannot go stale beats eight that each
  // have to remember, and the cost is a string compare against `lastCursor`
  // with a DOM write only when the answer moves.
  //
  // An inline style rather than a class: the canvas carries no `cursor-*` class
  // to fight with, and the overlay layers above it are `pointer-events-none`
  // except on their own controls — which carry their own cursors, correctly, and
  // are the only places a different one should show.
  let lastCursor: ViewportCursor | null = null;
  const syncCursor = (): void => {
    const el = canvasEl;
    // Before the cache compare, not after: caching an answer that was never
    // written would leave a canvas attached later with no cursor at all.
    if (!el) return;
    const next = viewportCursor({
      // `MoveDrag.grabbed` reads backwards from the word: it is TRUE for a
      // pointer DRAG (a button is down) and false for the free-hand `G` grab.
      // Its own TSDoc says so; this line is where believing the name would put
      // the two cursors the wrong way round.
      move:
        moveDrag === null ? null : moveDrag.grabbed === true ? "drag" : "grab",
      pendingStamp: pendingStamp !== null,
      session: stamp !== null,
      gesture,
    });
    if (next === lastCursor) return;
    lastCursor = next;
    el.style.cursor = next;
  };

  const tick = (now: number): void => {
    if (disposed) return;
    syncCursor();
    const c = ctx;
    if (c && cam) {
      const dt =
        lastFrameT === 0
          ? 0
          : Math.min((now - lastFrameT) / 1000, MAX_FRAME_DT);
      lastFrameT = now;
      applyFlyMove(dt);
      drainDirty();
      const ls = currentLogStats();
      statsCb?.({
        chunks: store.chunks.size,
        lastRemeshMs,
        remeshVersion,
        totalOps: ls.totalOps,
        liveGenerators: ls.liveGenerators,
        compactableOps: ls.compactableOps,
        undoDepth: ls.undoDepth,
        redoDepth: ls.redoDepth,
        lastReconfigureMs,
        analyzerPending: analyzerPendingCount(),
        voidCastPending: voidCastJobGen !== null,
      });
      renderScene(c, cam);
    }
    raf = requestAnimationFrame(tick);
  };

  // --- input handlers -----------------------------------------------------

  // Is LMB's field-writing job suspended by a live session (D-F4.5-7's staged
  // grammar)? A session is a ghost being fitted to the rock around it, and a
  // stroke would carve the very thing it is being fitted to — while the
  // registry's `armsTool` gate has already stopped the user changing tools out
  // of it, so a live brush here is one the session INHERITED rather than one
  // they chose. The ghost hides for the same reason (see renderScene).
  //
  // TWO callers, because the two brushes reach the store through different
  // branches: the sphere brush strokes below, and `segment` commits its capsule
  // from the gesture branch above. Selection gestures are deliberately NOT
  // suspended — they write nothing to the store.
  //
  // It SPEAKS, once per session (the `maskDropReported` latch shape). Every
  // other signal is ambient — the strip's clause, the hidden ghost, the rail's
  // refusals — and none of them fires at the moment the user asks the question,
  // which is the click. A silent swallow at exactly that moment reads as a
  // broken editor; the per-session latch is what stops it becoming noise.
  const suspendedByStamp = (): boolean => {
    if (stamp === null) return false;
    if (!suspendReported) {
      suspendReported = true;
      reportToolError(
        "the brush is suspended while a session is live — ⏎ applies it, Esc discards it",
      );
    }
    return true;
  };

  const onPointerDown = (e: PointerEvent): void => {
    lastPointer = { x: e.clientX, y: e.clientY }; // feeds the per-frame ghost
    // A live GRAB (`G`, no button held) owns LMB: the button DROPS the move
    // rather than picking whatever is under the cursor at the end of it. RMB
    // falls through to look, so a grab can be re-aimed mid-move — the one thing
    // a free-hand move genuinely needs the camera for.
    if (moveDrag !== null && !moveDrag.grabbed && e.button === 0) {
      dropMove();
      return;
    }
    if (e.button === 0 && e.altKey) {
      // Alt-click samples a material — never strokes, so it stays live in
      // selection mode too (a brush affordance the gestures don't collide with).
      eyedropper(e.clientX, e.clientY);
      return;
    }
    // A pending stamp SHADOWS the armed gesture: while one stands LMB is drawing
    // its region, whatever the button did before (D-F4.5-7). Before the gesture
    // branch and after the eyedropper, which samples rather than commits and
    // stays live under every arm.
    if (e.button === 0 && pendingStamp !== null) {
      stampRegionClick(e.clientX, e.clientY);
      return;
    }
    if (e.button === 0 && gesture !== null) {
      // Armed gestures BYPASS applyTool entirely: no stroke, no digging flag.
      // RMB look below stays live under every gesture. `pointer` is the DEFAULT
      // one, so this branch — not the stroke below — is what a fresh host does
      // with its first click.
      //
      // `pointer` is also the ONE gesture that can drag, and therefore the one
      // that takes pointer capture: a press on a gizmo handle, or on the already
      // selected entity, can become an entity MOVE (pointerPress owns that
      // arbitration). The other three are still single clicks that capture
      // nothing.
      if (gesture === "pointer") pointerPress(e);
      else if (gesture === "segment") {
        // `segment` is a BRUSH that happens to be armed as a gesture, so the
        // suspension below applies to it too — its second click commits a
        // capsule op through `commitToolOp`, which is the "user dug a large
        // tunnel while believing they were interacting with the stamp" report
        // verbatim (F3b gate item 2). It needs its own guard because it reaches
        // the store through THIS branch, above the stroke's.
        if (suspendedByStamp()) return;
        segmentClick(e.clientX, e.clientY);
      } else selectionClick(gesture, e.clientX, e.clientY);
      return;
    }
    if (e.button === 0) {
      if (suspendedByStamp()) return;
      digging = true;
      maskDropReported = false; // re-arm the once-per-stroke mask-drop report
      applyTool(e.clientX, e.clientY);
      canvasEl?.setPointerCapture(e.pointerId);
    } else if (e.button === 2) {
      look = { lastX: e.clientX, lastY: e.clientY, pivot: orbitPivot() };
      canvasEl?.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    lastPointer = { x: e.clientX, y: e.clientY }; // feeds the per-frame ghost
    if (look) {
      const { dYaw, dPitch } = lookDeltas(
        e.clientX - look.lastX,
        e.clientY - look.lastY,
      );
      look.lastX = e.clientX;
      look.lastY = e.clientY;
      // The SAME angles either way, so the view turns the direction the hand
      // moved in both drags; the pivot decides what stays still while it does.
      aimCamera(
        look.pivot === null
          ? flyLook(orbitState, dYaw, dPitch)
          : orbitAbout(orbitState, look.pivot, dYaw, dPitch),
      );
      applyOrbit();
      return;
    }
    // A live move owns the cursor — after `look`, so RMB can still re-aim the
    // camera during a grab without the ghost chasing the same motion.
    if (moveDrag !== null) {
      updateMove(e);
      return;
    }
    // A press on the selected entity becomes a MOVE once the cursor has actually
    // travelled. The threshold is measured from the PRESS, not accumulated, so a
    // slow drift back and forth never adds its way over the line.
    if (pendingMove !== null) {
      const p = pendingMove;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD_PX)
        return;
      pendingMove = null;
      if (beginMoveSession(p.entityId, null, true, { x: p.x, y: p.y })) {
        canvasEl?.setPointerCapture(p.pointerId);
        // Anchors at the PRESS (not here) and applies this event's offset from
        // it in the same call, so the travel that crossed the threshold counts.
        updateMove(e);
      }
      return;
    }
    // Box live preview: while a corner is pending, keep the amber region the
    // second click would close updated as the cursor moves. Both users of the
    // corner machinery, since a pending stamp draws its region the same way.
    if (boxAnchor !== null && (gesture === "box" || pendingStamp !== null)) {
      updateBoxPreview(e.clientX, e.clientY);
      return;
    }
    // Segment brush: same shape, with the capsule the second click would sweep.
    if (gesture === "segment" && segmentAnchor !== null) {
      updateSegmentPreview(e.clientX, e.clientY);
      return;
    }
    if (!digging) return;
    const now = performance.now();
    if (now - lastStroke < STROKE_MIN_MS) return;
    lastStroke = now;
    applyTool(e.clientX, e.clientY);
  };

  // Abandon a move without committing it — the shared teardown behind
  // `pointercancel` and focus loss. Cancels the SESSION too (its ghost is a
  // promise about a drop that is not going to happen); a session that is not a
  // move is left alone.
  const cancelMoveInFlight = (): void => {
    if (moveDrag === null && pendingMove === null) return;
    endMove();
    if (stamp?.moving === true) cancelStampSession();
  };

  const onPointerUp = (e: PointerEvent): void => {
    // Only the button that STARTED a drag ends it. Gated on button 0 because RMB
    // look is live during a move (a grab can be re-aimed), and a right-button
    // release must not commit a splice the user is still positioning.
    if (e.button === 0) {
      if (moveDrag?.grabbed === true) dropMove();
      // A press that never crossed the threshold: it was a click on what was
      // already selected, which has always been a no-op. Nothing to undo.
      pendingMove = null;
    }
    digging = false;
    look = null; // the anchor a turned camera invalidated was retired in applyOrbit
    canvasEl?.releasePointerCapture(e.pointerId);
  };

  // `pointercancel` is NOT a quiet pointerup: the system voided the gesture (a
  // touch turned into a scroll, a device was lost), so a move in flight is
  // DISCARDED rather than dropped. Committing a splice from a gesture the
  // platform just cancelled would write history the user never asked for.
  const onPointerCancel = (e: PointerEvent): void => {
    cancelMoveInFlight();
    onPointerUp(e);
  };

  // NOTE: no pointer-leave handler on purpose — lastPointer survives the
  // pointer leaving the canvas so the ghost previews panel-driven size changes
  // (see the lastPointer declaration comment). A move drag does not need one
  // either: it takes pointer capture, so the events keep arriving.

  // The wheel is TWO bindings on one input, split by what LMB is armed to do.
  // Under `pointer` — which selects and moves rather than paints — there is no
  // brush to resize, so the scroll travels the camera instead; under everything
  // else (the brush, `segment`, the cell-selection gestures) it is the brush
  // radius it has always been. Away from the user = forward / bigger, in both.
  //
  // The two measure the scroll DIFFERENTLY, and the asymmetry is deliberate.
  // Travel is ACCUMULATED: `deltaY` magnitudes differ by two orders between a
  // notched wheel (~100 px per notch, a handful of events) and a trackpad's
  // momentum stream (many small events), so one step per EVENT would make how
  // far the camera goes a function of the event rate rather than of how far the
  // user scrolled. Radius keeps its per-event step because it is clamped to
  // [RADIUS_MIN, RADIUS_MAX] — an over-long flick just pins it — and its feel
  // was tuned at the F2b/F3a gates. Camera travel has no such clamp.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (gesture === "pointer") {
      const banked = bankDolly(dollyPixels, e);
      // Stored BEFORE the sub-threshold return, or the scroll this event just
      // banked is dropped rather than carried.
      dollyPixels = banked.banked;
      // Sub-threshold scroll banks and waits. Returning is not just an
      // optimisation: falling through would publish a pose for a camera that did
      // not move, and retire a live move's anchor on the strength of it.
      if (banked.steps === 0) return;
      aimCamera(dolly(orbitState, -banked.steps)); // negative deltaY = forward
      applyOrbit();
      return;
    }
    const notches = -Math.sign(e.deltaY);
    if (notches === 0) return; // a purely horizontal wheel means neither binding
    applyRadius(digRadius + notches * RADIUS_WHEEL_STEP);
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault(); // RMB drives look — suppress the browser menu
  };

  // The Esc ladder (D-12): ONE key, ONE rung per press, most recent intent
  // first. Two entry points share this function and therefore cannot disagree —
  // the canvas's own Esc below, and the app-level registry's `escape()`, which
  // is what keeps Esc working after a click into a palette has taken the
  // canvas's focus away.
  //
  // Returns whether it ACTED, which is how the canvas branch knows whether it
  // has claimed the event (see `stopPropagation` there).
  const escapeLadder = (): boolean => {
    // 1. A half-drawn gesture — the anchor the next click would close. Both
    //    anchors are cleared rather than only the armed gesture's: arming a
    //    gesture already drops both, so "whichever is pending" is this same set,
    //    and asking which one is live would be a second spelling of that rule.
    if (boxAnchor !== null || segmentAnchor !== null) {
      setBoxAnchor(null);
      setSegmentAnchor(null);
      return true;
    }
    // 1b. The pending stamp ARM — after its own corner, because the two are one
    //     gesture in two steps and the ladder takes the most recent step first:
    //     an Esc with a corner down re-draws the region, a second one leaves
    //     region-draw altogether. Before the session, because an arm is by
    //     definition more recent than any session still standing beside it.
    if (pendingStamp !== null) {
      setPendingStamp(null);
      return true;
    }
    // 2. The live session — a move included, since `cancelStampSession` ends the
    //    move first (its own first line, before the null guard).
    if (stamp !== null || moveDrag !== null) {
      cancelStampSession();
      return true;
    }
    // 3. The selected stamp.
    if (selectedEntityId !== null) {
      setSelectedEntity(null);
      return true;
    }
    // 4. The cell selection, PARKED in the Reselect slot exactly as the panel's
    //    Clear parks it — so an Esc that went one rung too far has the same way
    //    back a Clear does.
    if (selection !== null) {
      setSelection(null);
      return true;
    }
    return false;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    // ⌘Z/⇧⌘Z (and ctrl+z) guard FIRST — the shortcut branches below must
    // never swallow undo/redo. (On non-mac, holding Ctrl for ctrl+z briefly
    // engages the momentary invert via its own "control" keydown; the tool
    // restores on release — accepted, undo itself is untouched.)
    if ((e.metaKey || e.ctrlKey) && k === "z") {
      e.preventDefault();
      // stopPropagation, not just preventDefault: the editor ALSO binds ⌘Z on
      // `window` (the action registry's `edit.undo`), and that listener's only
      // target guard is isTextInputTarget — which matches
      // INPUT/TEXTAREA/contentEditable and NOT a focusable <canvas>. Tightening
      // that guard would not help either: a ⌘-chord is gated `"chord"`, which is
      // live even inside a text input, deliberately (pinned in
      // keybindings.test.ts). So a ⌘Z over the field canvas reaches the window
      // listener too, and this line is what keeps the chord from being handled
      // twice.
      //
      // The window handler is LIVE now (useGlobalKeybindings routes ⌘Z/⇧⌘Z to
      // FieldHost.undo/redo — the field's op log is the editor's ONE history),
      // so this line is what it prevents: without it a ⌘Z over the focused
      // canvas would run stepHistory here AND again from the window listener,
      // stepping the log twice for one chord.
      //
      // Scoped to THIS branch on purpose: ⌘S should still reach the window while
      // the field has focus, so blanket-stopping would change a second behaviour
      // to fix one. It is no longer the ONLY branch that stops, though — ⏎, Esc,
      // R and F are app-level actions too now, and each claims the event the
      // same way (see their branches below). ⌫ is the registry's alone: this
      // listener does not bind it, so it propagates untouched.
      e.stopPropagation();
      stepHistory(e.shiftKey);
      return;
    }
    // ⏎ commits the READY ghost (or applies a reconfigure — same key, the
    // session's mode decides, and a live MOVE is dropped instead); Esc runs the
    // cancel LADDER. Neither is a fly key, so returning here never starves the
    // keys set.
    //
    // Both are ALSO app-level actions (`frontend/lib/actions.ts`), which is what
    // makes them work after a click into a palette. The rule where two listeners
    // bind one key: the branch that ACTS claims the event with `stopPropagation`
    // so the window listener cannot run the same verb a second time, and a
    // branch that does NOT act lets the event through — with no session ⏎ is the
    // registry's to swallow, and an Esc with nothing left on the ladder is a
    // no-op wherever it lands.
    if (k === "enter") {
      if (stamp === null) return;
      e.preventDefault();
      e.stopPropagation();
      confirmActiveSession();
      return;
    }
    if (k === "escape") {
      if (!escapeLadder()) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Arrow keys nudge the stamp region (bindings: arrowNudgeSteps).
    // Chord-guarded on THREE modifiers, one more than the [ / ] precedent:
    // ⌘←/⌘→ are back/forward and ⌘↑/⌘↓ are document home/end on macOS, and
    // ALT+←/→ is back/forward on Windows and Linux. [ / ] needs no alt guard
    // because Alt+[ is not a navigation chord anywhere — the precedent simply
    // doesn't cover this key, so correctness wins over symmetry. Alt is
    // otherwise the pointer-path eyedropper, which no arrow touches.
    // Shift note: ⇧ ALSO arrives as its own "shift" keydown, which engages
    // momentary smooth below. That only changes what LMB does and restores on
    // release, so a ⇧-arrow vertical nudge is unaffected by it.
    const arrowSteps = arrowNudgeSteps(e);
    if (arrowSteps !== null && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (stamp !== null) {
        e.preventDefault();
        nudgeStampRegion(arrowSteps);
      }
      return;
    }
    // R quarter-turns the live session (D-9), F frames the selection. Both are
    // ALSO app-level actions, so the branch that acts calls `stopPropagation` and
    // the window listener does not run the verb again. R is the one shared key
    // that is not idempotent — a second run is a second quarter turn — which is
    // what makes the claim load-bearing rather than tidy.
    //
    // NEITHER is gated on a live look, deliberately: `readFlyMove` reads only
    // w/a/s/d/q/e, so `r` and `f` collide with nothing the fly wants, and turning
    // a ghost while orbiting round it (or framing mid-drag) is a normal gesture
    // that a blanket "no letters while looking" rule would kill for no collision.
    // The app-level gate draws the same line from the other side — it refuses only
    // the actions marked `flyLetter`, which today is `S` alone.
    //
    // Same three-modifier chord guard on both: ⌘R/ctrl+R are reload and ⌘F/ctrl+F
    // are the browser's find, and Alt is the pointer path's eyedropper modifier.
    // Neither is a fly key, so returning here starves nothing; R without a
    // session falls through and is swallowed unused (⏎'s stance).
    if (k === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (stamp !== null) {
        e.preventDefault();
        e.stopPropagation();
        rotateStampSession();
      }
      return;
    }
    if (k === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      frameSelection();
      return;
    }
    // [ / ] step the brush radius (same clamp as the wheel); key-repeat is the
    // hold-to-resize behaviour. Chord-guarded: ⌘[/⌘] (and ctrl+[/]) are the
    // browser's back/forward — never intercept those.
    if ((k === "[" || k === "]") && !e.metaKey && !e.ctrlKey) {
      const step = k === "]" ? RADIUS_WHEEL_STEP : -RADIUS_WHEEL_STEP;
      applyRadius(digRadius + step);
      return;
    }
    // Momentary modifiers (repeat-guarded). Shift ALSO lands in `keys` below
    // for the fly boost — the boost only applies while a move key is held,
    // momentary smooth only changes what LMB does; they don't conflict.
    if (k === "shift" && !momentaryShift) {
      momentaryShift = true;
      deriveMomentary();
    }
    if (k === "control" && !momentaryCtrl) {
      momentaryCtrl = true;
      deriveMomentary();
    }
    keys.add(k);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === "shift" && momentaryShift) {
      momentaryShift = false;
      deriveMomentary();
    }
    if (k === "control" && momentaryCtrl) {
      momentaryCtrl = false;
      deriveMomentary();
    }
  };

  // Focus loss strands keydown state: a key released while focus is elsewhere
  // never keyups here, leaving fly movement running or a momentary tool stuck.
  // Clear the fly set + both momentary flags (deriveMomentary restores the
  // saved tool when both drop).
  //
  // A move in flight is stranded the same way and is DISCARDED (D-9's blur
  // decision). A drag alt-tabbed away from never sees its pointerup, and a `G`
  // grab is a modal viewport state that clicking a panel control leaves.
  // Committing would land a splice nobody confirmed; leaving it live would strand
  // a ghost that answers to nothing. Cancelling costs the user only the drag —
  // the record is untouched until the drop.
  const onBlur = (): void => {
    cancelMoveInFlight();
    keys.clear();
    if (momentaryShift || momentaryCtrl) {
      momentaryShift = false;
      momentaryCtrl = false;
      deriveMomentary();
    }
  };

  const attachListeners = (canvas: HTMLCanvasElement): void => {
    // Guard: headless mocks (OffscreenCanvas cast as HTMLCanvasElement) don't
    // expose addEventListener — only attach in real browser environments.
    if (typeof canvas.addEventListener !== "function") return;
    canvasEl = canvas;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("blur", onBlur);
  };

  const detachListeners = (): void => {
    if (!canvasEl) return;
    canvasEl.removeEventListener("pointerdown", onPointerDown);
    canvasEl.removeEventListener("pointermove", onPointerMove);
    canvasEl.removeEventListener("pointerup", onPointerUp);
    canvasEl.removeEventListener("pointercancel", onPointerCancel);
    canvasEl.removeEventListener("wheel", onWheel);
    canvasEl.removeEventListener("contextmenu", onContextMenu);
    canvasEl.removeEventListener("keydown", onKeyDown);
    canvasEl.removeEventListener("keyup", onKeyUp);
    canvasEl.removeEventListener("blur", onBlur);
    canvasEl = null;
    // The cache describes a canvas that is gone. A re-init on a fresh element
    // (the AA switch) would otherwise find the answer unchanged and write
    // nothing, leaving the new canvas with the browser default.
    lastCursor = null;
  };

  // Reset the field session + free every GPU chunk render + drop the whole
  // selection state (a different world invalidates it — Reselect slot too).
  // Shared by newWorld/loadWorld. dispose() deliberately does NOT clear
  // selection state: like the tool/radius/camera pose, it is CPU-only session
  // state that survives a dispose/re-init on the same store.
  const resetWorld = (): void => {
    // BEFORE the clear, while the outgoing keys still exist: the analyzer's
    // mirror has no reset verb, so a world swap lists them as removals on the
    // next sync. Its findings describe a field that is about to be gone, and its
    // pending write set names chunks that will not be there to copy.
    for (const key of store.chunks.keys()) analyzerStale.add(key);
    analyzerDirty.clear();
    analyzerResync = true;
    analyzerSeeds = [];
    worldEpoch += 1; // retires any stage-2 verdict still in flight
    flagStore.clear();
    publishFlags();
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
    // rebuildProps, not destroyProps: the log was emptied above, so this both
    // frees the outgoing draws AND resets the counts — a bare destroy would
    // leave propInstanceCounts describing the world that just went away.
    rebuildProps();
    setBoxAnchor(null);
    // The segment anchor is a point in the OLD field — a capsule swept from it
    // into the new one would start somewhere the user never clicked.
    setSegmentAnchor(null);
    // …and so is the pending stamp arm: the region it is asking for would be
    // drawn in the new world for a question the old one posed, and every surface
    // reading the seam would go on saying "drag a region" across a world swap.
    // (Its own clear takes the box anchor again — harmless, already null.)
    setPendingStamp(null);
    selection = null;
    lastSelection = null;
    // Both display halves through the shared refresh, so the outline and the cell
    // layer cannot survive a world swap independently of each other.
    refreshSelectionDisplay();
    notifySelection(); // null — the panel must not show a stale selection
    // A different world invalidates the stamp session (its region + snapshot
    // describe the old field), the entity selection (log entity ids reset) and
    // any drift report (its findings name op ids the new log does not have).
    cancelStampSession();
    // Notified, not just cleared: the selection is a SEAM now, and a subscriber
    // left holding an id from the outgoing world is the same class of bug as the
    // stale stamp session announced above.
    setSelectedEntity(null);
    // The cast describes the field that just went away. Discarded SILENTLY,
    // unlike an edit-time invalidation: everything else on screen is being
    // replaced too, so "void cast cleared" beside a fresh world is noise.
    discardVoidCast();
    drift = null;
    notifyDrift();
  };

  // World-load compaction (spec D-F3-16 / D-F3-6): fold aged brush runs into
  // patches when the loaded log carries more than COMPACT_THRESHOLD_OPS foldable
  // ops. Load is the ONLY safe moment — compactRuns REQUIRES both undo stacks
  // empty (its entries address log.ops POSITIONALLY, which folding shifts), and
  // a freshly loaded log has none by construction: serializeOps persists
  // log.ops and never the stacks, and resetWorld cleared them just above. No
  // mid-session auto-compact, no button — compaction is for history that has
  // aged out of an edit session, which is exactly what a load carries.
  // `keepIds` is empty: nothing in the editor references an op id across a load,
  // and the meter's `compactableOps` reads the same empty-pinned ceiling so it
  // predicts this fold. DEFENSIVE: a fold can throw (a catalog that dropped a
  // class id the ops recorded — see compactRuns' TSDoc), and a failed
  // compaction is never worth failing a load; compactRuns validates before its
  // first write, so a throw leaves the log exactly as parsed. The world loads
  // uncompacted and the reason surfaces on the tool-error channel rather than
  // blanking the panel (the optional-chrome failure stance).
  const compactLoadedLog = (): void => {
    if (field.logStats(log).compactableOps <= COMPACT_THRESHOLD_OPS) return;
    try {
      field.compactRuns(store, log, table, { keepIds: new Set() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(
        `world loaded, but log compaction was skipped: ${message}`,
      );
    }
  };

  return {
    async init(canvas, opts) {
      if (ctx) throw new Error("field-host: already initialized");
      disposed = false; // clear a prior dispose() so a re-init'd instance lives
      ctx = await requestContext(canvas, {
        sampleCount: opts?.sampleCount ?? 4,
      });
      cam = camera.perspective({
        fovYRad: EDITOR_FOV_Y,
        aspect: 1,
        near: 0.1,
        far: 1000,
      });
      applyOrbit();
      unbindCamera = camera.bindToCanvas(ctx, cam);
      await initMaterials(ctx);
      // A world can be loaded BEFORE the GPU exists (the panel's Load races
      // init, and every headless caller never inits at all), and rebuildProps
      // no-ops without a context — so build the layer once here from whatever
      // the log already holds. Same for the advisor's markers: findings can
      // arrive before the GPU does, and the counts they settled are replayed
      // into draws here.
      rebuildProps();
      rebuildFlagMarkers(flagStore.summary());
      // The selection survives a dispose (it is CPU state), so its CELL display
      // has to be rebuilt here too or a re-init — the AA switch, which never
      // touches the selection — would come back with the outline and no cubes.
      rebuildSelectionCells();
      // Re-mesh whatever the store already holds. At the FIRST init this is empty
      // and costs nothing; at a re-init (the AA switch) it is the whole world, and
      // without it the field never comes back — `dispose` destroys every chunk mesh
      // and `dirty` only ever holds chunks something EDITED. The paced drain
      // (REMESH_PER_FRAME) is what keeps the burst from stalling the first frames.
      for (const key of store.chunks.keys()) dirty.add(key);
      // The X-ray's half of the same contract. `dispose` destroys the cast meshes
      // but the LAYER FLAG rides through, and `setLayers` only builds on the
      // false→true edge — so without this the box stays ticked over nothing, which
      // is the exact reading `invalidateVoidCast` refuses to ship ("a silently
      // vanishing X-ray beside a still-ticked checkbox would read as a bug").
      // Re-requesting rather than reporting: the user asked for the X-ray and
      // never withdrew it.
      if (layers.voidCast) requestVoidCast();
      attachListeners(canvas);
      lastFrameT = 0;
      raf = requestAnimationFrame(tick);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      detachListeners();
      worker.dispose();
      analyzer.dispose();
      // Disposing TERMINATES the analyzer worker, and the client spawns a fresh
      // one on the next request — with an empty mirror and no placement set. A
      // re-init'd host must therefore re-send both, or every pass fails: the
      // protocol refuses an analyse before any sync (`requireStore`), so what
      // arrives is a typed `analyzer-error` — "the mirror holds no field yet" —
      // reported on the tool-error channel, once per pass, until something happens to
      // fill `analyzerDirty`. LOUD rather than wrong, which is `requireStore`
      // doing its job; the advisor is simply dead until then. The store, the log
      // and the findings all survive a dispose (the `disposed = false` in `init`
      // exists so a re-init'd instance lives), so this is the analyzer half of
      // that same contract.
      analyzerResync = true;
      // DEFENCE IN DEPTH, and its independent effect is deliberately UNCOVERED:
      // every path that can reach the analyzer after a dispose goes through
      // `rebuildProps` (via `init`, `loadWorld` or `newWorld`) or through
      // `setAgentProfile` WITH a profile (its null answer reaches nothing — it
      // requests no pass, and no pass can run without a capsule), and all of
      // those set this flag themselves — so
      // deleting this line fails no test. It is kept because depending on that
      // coincidence is what the line above exists to stop doing, and the cost of
      // being wrong is one-directional: `voxelizePlacements` is purely additive,
      // so a worker with no placement set sees strictly MORE open air and
      // UNDER-reports, which is the miss-unsafe direction for a trap hunt.
      analyzerPlacementsStale = true;
      if (analyzerIdle !== null) {
        clearTimeout(analyzerIdle);
        analyzerIdle = null;
      }
      const c = ctx;
      if (c) {
        for (const [, cm] of chunkMeshes) destroyChunkRender(c, cm);
        chunkMeshes.clear();
        destroyProps(c);
        destroyFlagMarkers(c);
        destroySelectionCells(c);
        destroyStampGhosts();
        discardVoidCast();
        if (normalsMat) material.destroy(c, normalsMat);
        destroyLitMaterials(c);
        if (kitMat) material.destroy(c, kitMat);
        if (kitBind) binding.destroy(c, kitBind);
        if (ghostCube) mesh.destroy(c, ghostCube);
        if (ghostCubeGeo) geometry.destroy(c, ghostCubeGeo);
        if (ghostMat) material.destroy(c, ghostMat);
        if (ghostBind) binding.destroy(c, ghostBind);
        if (stampGhostMat) material.destroy(c, stampGhostMat);
        if (stampGhostBind) binding.destroy(c, stampGhostBind);
        if (voidCastMat) material.destroy(c, voidCastMat);
        if (voidCastBind) binding.destroy(c, voidCastBind);
        if (flagMarkerMat) material.destroy(c, flagMarkerMat);
        if (flagMarkerBind) binding.destroy(c, flagMarkerBind);
        if (selectionCellMat) material.destroy(c, selectionCellMat);
        if (selectionCellBind) binding.destroy(c, selectionCellBind);
        unbindCamera?.();
        gpu.dispose(c); // LAST — a clean shutdown is the leak check.
      }
      normalsMat = null;
      kitMat = null;
      kitBind = null;
      ghostCube = null;
      ghostCubeGeo = null;
      ghostMat = null;
      ghostBind = null;
      stampGhostMat = null;
      stampGhostBind = null;
      voidCastMat = null;
      voidCastBind = null;
      flagMarkerMat = null;
      flagMarkerBind = null;
      selectionCellMat = null;
      selectionCellBind = null;
      // Unlike the selection (CPU-only, survives dispose), the stamp session
      // dies with its GPU ghost: a "ready" session with no ghost after a
      // re-init would promise a commit the user can no longer see.
      //
      // ANNOUNCED, not silent. The original reasoning — "a remounting panel gets
      // null pushed on re-subscribe" — assumed every dispose came with a chrome
      // remount, and the AA switch broke that: it disposes and re-inits under
      // chrome that never unmounts, leaving the session card driving a session the
      // host has already destroyed. The seam is how the chrome finds out.
      // cancelStampSession, not a bare `stamp = null`: it runs endMove() first
      // (before its own null guard) so no cursor mapping survives the teardown,
      // and it notifies. One teardown, one place.
      //
      // Its independent effect is currently UNCOVERED, and deliberately recorded
      // as such (the analyzerPlacementsStale precedent above): `updateMove`
      // guards on `stamp === null` too, so a mapping stranded by a bare
      // `stamp = null` changes nothing while the host stays disposed — swapping
      // this line back fails no test. What it buys is the state AFTER a re-init:
      // `updateMove` RETURNS from onPointerMove, so a stranded mapping would
      // swallow every pointermove — box previews, segment previews and brush
      // strokes alike — until something else cleared it.
      cancelStampSession();
      unbindCamera = null;
      cam = null;
      ctx = null;
    },
    newWorld() {
      resetWorld();
      // The mirror is emptied by the pass resetWorld's outgoing keys ride on;
      // this request is the explicit one, so that emptying does not depend on the
      // prop layer happening to rebuild on the same path. No ANALYSIS follows
      // either way — a new world holds no field and, with no manifest, no seed.
      analyzePump.request();
      notifyEntities();
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
      const ops = data.oplog === null ? [] : field.parseOps(data.oplog);
      for (const op of ops) log.ops.push(op);
      log.nextId = ops.reduce((max, o) => Math.max(max, o.id), 0) + 1;
      // v0: manifest.playerStart/playerYaw are the dungeon runtime spawn, and the
      // editor never adopts them as its own camera. `playerStart` IS read, as the
      // walkability advisor's seed: it is
      // where the agent starts, which is exactly what "can it get there" and
      // "can it get back" are asked from. Copied, not aliased — the manifest is
      // the caller's. A world with no manifest (newWorld) leaves the seeds empty
      // and both connectivity passes skip, rather than guessing a spawn.
      const [seedX, seedY, seedZ] = data.manifest.playerStart;
      analyzerSeeds = [[seedX, seedY, seedZ]];
      // The mirror holds the OLD world (resetWorld listed its keys as removals);
      // these chunks were written straight into the store, so nothing marked them
      // dirty. Whole-world too: every chunk is new to the analyzer.
      analyzerResync = true;
      analyzerWholeWorld = true;
      for (const key of store.chunks.keys()) dirty.add(key);
      // Fold aged brush runs before the panel reads the log: quiescent history
      // is guaranteed here (see compactLoadedLog), and it never touches entity
      // ops, so the entity list below is unaffected either way.
      compactLoadedLog();
      // AFTER the ops land, not inside resetWorld: the tick must carry the
      // loaded world's entities, not the empty log the reset left behind — and
      // the prop layer must be built from the loaded placement ops, not the
      // empty log (resetWorld tore the previous world's props down).
      rebuildProps();
      // Explicit rather than left to rebuildProps' own request: a load's
      // analyzer work (full re-sync, placements, whole-world pass) must not
      // depend on the prop layer happening to rebuild on the same path.
      analyzePump.request();
      notifyEntities();
      // NO AUTOMATIC FRAME HERE, and the first attempt at ruling 5 put one in —
      // which is worth recording, because it looked like the obvious home. This
      // method holds both the freshly-decoded store and the camera, so framing
      // from here needed no seam and no ordering.
      //
      // It is still wrong: `loadWorld` is a DATA primitive, and the editor is not
      // its only caller. It is also the only headless route to a committed entity,
      // so nine GPU and analyzer suites use it to install a fixture and then pick
      // with a ray — and a camera that re-aims itself on load moves what those rays
      // hit. All nine went red, which is the honest version of "this changes what
      // every loader is pointing at". The UX belongs to the verb the RULING names,
      // `Open`, which is the chrome's (`hooks/useWorld.tsx`), and the chrome already
      // holds the host so it needs no seam either.
    },
    setDigRadius(r) {
      applyRadius(r);
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
      const clamped = clampTool(next); // chassis-side range enforcement
      if (momentarySaved !== null) {
        // Panel change while a momentary modifier is held: adopt it as the
        // BASE the momentary derives from (and restores to), so releasing the
        // modifier lands on the panel's latest choice, not a stale save.
        momentarySaved = clamped;
        deriveMomentary();
        return;
      }
      tool = clamped;
    },
    subscribeTool(cb) {
      toolCb = cb;
      return () => {
        // Guard: a STALE unsubscribe (kept past a later subscribe) must not
        // null the successor's callback.
        if (toolCb === cb) toolCb = null;
      };
    },
    subscribeToolError(cb) {
      toolErrorCb = cb;
      return () => {
        if (toolErrorCb === cb) toolErrorCb = null;
      };
    },
    setGesture(next) {
      // ABOVE the early return, deliberately: arming any tool cancels a pending
      // stamp, and the arm that would otherwise leak is the BRUSH's — `armBrush`
      // pushes `setGesture(null)` while the host already holds `null`, so a clear
      // below this line would never run and the stamp would stay armed under a
      // brush the user had just picked.
      setPendingStamp(null);
      if (next === gesture) return; // re-arming the same gesture must not drop a pending anchor
      gesture = next;
      // Nor does a move in flight. A move is a `pointer`-tool mode, and arming
      // anything else means LMB now digs or selects cells — a ghost still
      // chasing the cursor under that would promise a drop no button is going to
      // make. The blur that follows a rail click cancels it too; this covers the
      // programmatic path and anything that arms a tool without taking focus.
      cancelMoveInFlight();
      // Neither pending anchor survives a gesture change — including
      // box→segment, where a carried-over point would read as a segment start
      // the user never clicked.
      setBoxAnchor(null);
      setSegmentAnchor(null);
    },
    clearSelection() {
      setBoxAnchor(null);
      setSelection(null); // parks the current selection in the Reselect slot
    },
    reselect() {
      if (lastSelection === null) return;
      // Manual swap — setSelection would overwrite the slot being restored.
      const restored = lastSelection;
      lastSelection = selection; // may be null: the swap keeps toggle symmetry
      selection = restored;
      refreshSelectionDisplay();
      notifySelection();
    },
    subscribeSelection(cb) {
      selectionCb = cb;
      // Initial push: a subscriber (re)mounting while a selection exists must
      // not render "no selection" next to a visible amber overlay.
      cb(selection === null ? null : selectionInfo(selection));
      return () => {
        if (selectionCb === cb) selectionCb = null;
      };
    },
    setLayers(next) {
      const wasVoidCast = layers.voidCast;
      layers = { ...next }; // copy — host state never aliases panel objects
      // The one layer with an edge effect: nothing to show unless a cast was
      // built for the field as it stands (see FieldLayers). Off is a plain
      // silent free; a call that leaves it true rebuilds nothing, which is what
      // makes "re-toggle to refresh" the documented way back after an edit.
      if (!layers.voidCast) discardVoidCast();
      else if (!wasVoidCast) requestVoidCast();
    },
    setSlice(y) {
      if (y === sliceY) return; // slider-drag repeats of the same value are free
      sliceY = y;
      // Re-mesh EVERYTHING through the new clip. Plain adds, not
      // markDirtyWithNeighbors: every allocated chunk is being re-marked
      // anyway, so each chunk's 26-neighbourhood is in the set by
      // construction. The throttled drain (REMESH_PER_FRAME) paces the burst.
      for (const key of store.chunks.keys()) dirty.add(key);
    },
    occupiedTopY() {
      return occupiedTopYOf();
    },
    getSmoothLimits() {
      return {
        maxStrength: field.SMOOTH_MAX_STRENGTH,
        maxIterations: field.SMOOTH_MAX_ITERATIONS,
      };
    },
    setMaterialTable(next) {
      // A table swap invalidates a live stamp session outright: evaluate
      // depends on the table (kitClassId, class split), so the previewed
      // ghost no longer describes what commit would build — cancel rather
      // than let ghost and commit silently diverge (the resetWorld
      // precedent).
      cancelStampSession();
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
    setEntityCatalog(catalog) {
      // Copy at the boundary (the setLayers precedent): host state never aliases
      // the parsed object the chrome keeps.
      archetypes = catalog === null ? [] : [...catalog.archetypes];
      archetypeById = new Map(archetypes.map((a) => [a.id, a]));
      rebuildProps(); // the catalog decides proxy geometry + tint
    },
    listGenerators() {
      const ids = archetypes.map((a) => a.id);
      return field.FIELD_GENERATORS.map((g) => ({
        id: g.id,
        name: g.name,
        paramSchema: withArchetypeOptions(structuredClone(g.paramSchema), ids),
        defaults: structuredClone(g.defaults),
        placesProps: placesProps(g.emits),
        usesSeed: g.usesSeed,
      }));
    },
    propInstanceCounts() {
      return new Map(propCounts);
    },
    startStamp(generator) {
      let def: field.GeneratorDef;
      try {
        def = field.generatorById(generator); // setup-loud on unknown ids
      } catch (err) {
        // BEFORE the selection branch: an id no registry carries cannot open a
        // session and must not arm region-draw either — there would be nothing
        // to put in the region the user then drew.
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(message);
        return;
      }
      const sel = selection;
      const aabb = sel === null ? null : selectionAabb(sel);
      if (sel === null || aabb === null) {
        // D-F4.5-7: no region to stamp into, so ASK FOR ONE rather than refuse.
        // The stale corner goes with the arm — a half-drawn box select would
        // otherwise become this stamp's first corner without the user clicking it —
        // and so does any live session, for the reason its own re-open gives: a
        // ghost the user is no longer steering answers to nothing. That keeps the
        // two mutually exclusive, which is what lets each surface pick one to name.
        cancelStampSession();
        setBoxAnchor(null);
        // The SEGMENT anchor too, and it is not cosmetic: `cursorAffordance`
        // answers `null` for any anchored gesture, so a half-drawn capsule would
        // suppress the very cursor cross this arm exists to show — while its
        // hologram went on tracking the pointer for a sweep that can no longer
        // happen, and Esc spent its first press on a point the user thought was
        // long gone.
        setSegmentAnchor(null);
        setPendingStamp({ id: generator, name: def.name });
        return;
      }
      // A selection-first start supersedes any arm: the region question is
      // answered, so the viewport must stop asking it.
      setPendingStamp(null);
      // …and both pending ANCHORS with it, for the reasons the sibling branch
      // above spells out — they hold whichever way the session was opened, and
      // D-7 suspends the brush under a live session anyway, so a half-drawn
      // gesture waiting underneath one is a contradiction.
      //
      // NOT covered by the `setPendingStamp(null)` above, though it looks it:
      // that setter clears the box corner only when it is really DISARMING, and
      // its first line returns on an unchanged id — so with nothing armed (the
      // ordinary way here: select a region, arm a gesture, click once, pick a
      // generator) the call does nothing at all.
      setBoxAnchor(null);
      setSegmentAnchor(null);
      openStampSession(
        generator,
        def,
        aabb,
        sel.materialized.kind === "cells" && sel.materialized.truncated,
      );
    },
    updateStamp(params, seed, policy) {
      if (stamp === null) return;
      // Clone at the boundary — session params must never alias panel state.
      const incoming = structuredClone(params);
      // Record what the user has spoken about BEFORE re-seeding, so the archetype id they
      // just picked counts as touched and the filter below cannot overwrite it.
      stampTouched = touchedParamKeys(incoming, stamp.params, stampTouched);
      stamp = withParams(
        stamp,
        reseedForArchetype(incoming, stamp.params),
        seed,
        policy,
      );
      previewStamp();
    },
    nudgeStamp(dx, dy, dz) {
      nudgeStampRegion([dx, dy, dz]); // no-ops without a session
    },
    rotateStamp() {
      rotateStampSession();
    },
    rerollStamp() {
      if (stamp === null) return;
      stamp = withParams(stamp, stamp.params, randomStampSeed(), stamp.policy);
      previewStamp();
    },
    commitStamp() {
      commitStampSession();
    },
    commitSession() {
      commitActiveSession();
    },
    confirmSession() {
      confirmActiveSession();
    },
    cancelStamp() {
      cancelStampSession();
    },
    escape() {
      escapeLadder();
    },
    undo() {
      stepHistory(false);
    },
    redo() {
      stepHistory(true);
    },
    subscribeStamp(cb) {
      stampCb = cb;
      // Initial push: a subscriber (re)mounting mid-session must not render
      // "no stamp" beside a visible ghost (the subscribeSelection rationale).
      cb(stamp === null ? null : structuredClone(stamp));
      return () => {
        if (stampCb === cb) stampCb = null;
      };
    },
    subscribePendingStamp(cb) {
      pendingStampCb = cb;
      // Initial push, for the subscribeStamp reason: a rail (re)mounting while a
      // stamp is armed must not read as idle beside a viewport asking for a
      // region. Copied at the boundary — the chrome never holds host state.
      cb(pendingStamp === null ? null : { ...pendingStamp });
      return () => {
        if (pendingStampCb === cb) pendingStampCb = null;
      };
    },
    openEntity(entityId) {
      openEntitySession(entityId, false);
    },
    beginMove(entityId) {
      // The GRAB: no button is held, so the cursor drives the ghost free-hand
      // and LMB (or Enter) is what drops it. The pointer-drag and gizmo paths
      // arm the same move with `grabbed: true`.
      //
      // Anchored at the last known cursor position (null before the pointer has
      // ever been over the canvas — then the first cursor event anchors), so a
      // grab starts where the user is looking instead of jumping the ghost to
      // wherever the pointer happens to arrive next.
      beginMoveSession(
        entityId,
        null,
        false,
        lastPointer === null ? null : { x: lastPointer.x, y: lastPointer.y },
      );
    },
    applyReconfigure() {
      applyReconfigureSession();
    },
    setEntityFrozen(entityId, frozen) {
      try {
        field.setGeneratorFrozen(log, entityId, frozen);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(message);
        return;
      }
      // A freeze DOES reach a live session: the entities list stays visible
      // beside the reconfigure card, so Open #1 → Freeze #1 is one click away,
      // and core refuses the Apply that session is offering. Leaving it up would
      // mean an enabled Apply that can only ever fail — so freezing ends it, the
      // way baking does. Unfreezing (frozen=false) cannot orphan anything: no
      // session exists on a frozen entity to begin with, and the id check makes
      // it a no-op for every other session.
      if (frozen && stamp?.entityId === entityId) cancelStampSession();
      notifyEntities();
    },
    bakeEntity(entityId) {
      try {
        field.bakeGeneratorEntity(log, entityId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(message);
        return;
      }
      // Unlike freeze, baking is permanent: a live session on this entity can
      // never land, so end it rather than leave a ghost promising an Apply.
      if (stamp?.entityId === entityId) cancelStampSession();
      notifyEntities();
    },
    deleteEntity(entityId) {
      let dirtied: Set<field.ChunkKey>;
      try {
        ({ dirty: dirtied } = field.deleteGeneratorEntity(
          store,
          log,
          entityId,
          table,
        ));
      } catch (err) {
        // Setup-loud core, runtime-VISIBLE editor: all three refusals (unknown
        // id, frozen, baked) are validation failures core decides before its
        // first write, so nothing has moved — and core's own sentence is the
        // best explanation there is, so it is passed through unwrapped
        // (setEntityFrozen/bakeEntity's stance). Swallowing it would leave a
        // row delete that silently does nothing.
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(message);
        return;
      }
      markDirtyWithNeighbors(dirtied);
      // UNCONDITIONAL, never gated on `dirtied.size`, and core's TSDoc says why
      // in as many words: a placements-only entity (a scatter) writes no cells,
      // so deleting it dirties NOTHING while every prop it placed leaves the log
      // with it. Props are derived from the LOG, never from the dirty set.
      rebuildProps();
      // The record left the log, so a selection on it has to go with it — an
      // outline over a stamp that no longer exists. Surviving entities' spans do
      // not move (core locates spans by id), so nothing else re-outlines. It
      // notifies, so it sits with the pushes below rather than above the rebuild:
      // by the time anything hears about the delete, EVERY piece of host state it
      // moved has settled.
      revalidateEntitySelection();
      // The two notifications LAST, once every piece of host state has settled
      // (applyReconfigureSession's rule): a subscriber may read the host back
      // synchronously from inside either, and none may observe a half-deleted
      // world. Cancelling here rather than before the core call is deliberate —
      // a REFUSED delete must not destroy a live session on its way out.
      if (stamp?.entityId === entityId) cancelStampSession();
      notifyEntities();
    },
    duplicateEntity(entityId) {
      const record = entityRecord(entityId);
      if (record === null) {
        reportToolError(`entity ${entityId} is no longer in the log`);
        return;
      }
      let def: field.GeneratorDef;
      try {
        def = field.generatorById(record.generator); // setup-loud on a retired id
      } catch (err) {
        // openEntitySession's stance: fail HERE rather than at commitGenerator,
        // where the message would arrive wrapped in a commit failure.
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(message);
        return;
      }
      // Clear of the original along X, on the lattice the stamp UI works in. The
      // FOOTPRINT extent, not the region's: a recorded region routinely
      // over-draws its content (the F3a gate finding behind the footprint box),
      // so shifting by it would leave a visible gap. Floored at one step so a
      // footprint with no X extent at all still moves the copy off the original.
      const box = entityFootprints().get(entityId);
      const extentX = box === undefined ? 0 : box.max[0] - box.min[0];
      const shiftX = latticeClearance(extentX);
      const region = structuredClone(record.region);
      region.min[0] += shiftX;
      region.max[0] += shiftX;
      let committed: {
        dirty: Set<field.ChunkKey>;
        entity: field.GeneratorEntity;
      };
      try {
        committed = field.commitGenerator(store, log, def, {
          // commitGenerator clones for provenance; the clone here is so the
          // evaluate cannot reach the LOG's record through a shared reference.
          params: structuredClone(record.params),
          // A fresh roll only where the generator READS the seed (core's
          // `usesSeed`): duplicating a cave or a scatter should give a different
          // arrangement, while the hall — whose structure is entirely
          // params-determined — would just end up wearing a different number for
          // an identical shape.
          seed: def.usesSeed ? randomStampSeed() : record.seed,
          region,
          // `GeneratorEntity` does not record the policy its commit used, so it
          // is not recoverable — core's reconfigure and `openEntity` both fall
          // back to `replace` and this joins them.
          policy: "replace",
          table,
        });
      } catch (err) {
        // Reachable without a bug: the material table can have lost the kit
        // class the recipe needs since the original commit (commitStampSession's
        // stance, same sentence shape).
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(`duplicate failed: ${message}`);
        return;
      }
      markDirtyWithNeighbors(committed.dirty);
      rebuildProps(); // a duplicated scatter is new prop-layer content
      // The copy is what the user is now working on — and this is also what
      // re-outlines: setSelectedEntity rebuilds the emphasis box off the new
      // record. AFTER the commit, so the footprint memo it reads is rebuilt from
      // the log that now holds the copy.
      setSelectedEntity(committed.entity.entityId);
      notifyEntities();
    },
    subscribeDrift(cb) {
      driftCb = cb;
      // Initial push (the subscribeStamp/subscribeSelection remount rationale):
      // a subscriber remounting after a reconfigure must not drop its report.
      cb(driftPayload());
      return () => {
        if (driftCb === cb) driftCb = null;
      };
    },
    dismissDrift() {
      drift = null;
      notifyDrift();
    },
    frameChunks(chunks) {
      // Through `chunkSetBox`, which `frameWorld` also uses — a re-centre and a fit
      // disagreeing about where a world IS would be two copies of this arithmetic
      // drifting apart, and this method held the second copy until the F4.5 gate.
      // `null` is the empty set, which was this method's own early return.
      const box = chunkSetBox(chunks);
      if (box === null) return;
      aimCamera({ ...orbitState, target: boxCentre(box) });
      // Before init this moves the target and publishes the pose, and writes no
      // camera — applyOrbit guards on `cam`, and there is none yet.
      applyOrbit();
    },
    frameSelection,
    frameWorld,
    cameraAimedByHand: () => cameraAimed,
    snapView,
    subscribeEntities(cb) {
      entitiesCb = cb;
      cb(); // initial catch-up: the world may already hold entities
      return () => {
        if (entitiesCb === cb) entitiesCb = null;
      };
    },
    subscribeHistory(cb) {
      historyCb = cb;
      // Clearing the signature is what makes the initial push unconditional: a
      // subscriber arriving over a world with a live undo stack must be told
      // about it, and the previous subscriber's signature says nothing about
      // what THIS one has seen. (The push itself is notifyHistory's, so a
      // subscribe and a mutation hand out the same shape by construction.)
      historySig = null;
      notifyHistory();
      return () => {
        if (historyCb === cb) historyCb = null;
      };
    },
    listEntities() {
      // One attribution pass for the whole list, not one scan per row: the
      // helper walks the log once and hands back every entity's placements.
      //
      // Nothing FOOTPRINT-derived rides this. It is a general read with several
      // callers and only one of them ever wanted the boxes, so the drift badges
      // take them off `subscribeDrift` instead — where they are computed once per
      // report rather than per list read (see FieldDriftReport).
      const placed = placementsByEntity(log.ops);
      const out: FieldEntityInfo[] = [];
      for (const op of log.ops)
        if (op.kind === "entity")
          out.push({
            ...structuredClone(op.entity),
            // Fresh arrays out of the helper, so the row's summary is a clone
            // like the record it rides on.
            placed: placed.get(op.entity.entityId) ?? [],
          });
      return out;
    },
    selectEntity(entityId) {
      setSelectedEntity(entityId);
    },
    subscribeEntitySelection(cb) {
      entitySelectionCb = cb;
      // Initial push (the subscribeSelection remount rationale): a palette
      // remounting while an entity is selected must not render every row
      // unselected next to a visible box in the viewport.
      cb(selectedEntityId);
      return () => {
        if (entitySelectionCb === cb) entitySelectionCb = null;
      };
    },
    setAgentProfile(profile) {
      agentProfileAnswered = true;
      agentProfile = profile;
      // "This project has none" is an answer and nothing more. It catches nothing
      // up (there is no capsule to analyse with) and requests no pass — the idle
      // notice's moment is the first pass that would have ANALYSED, which is a
      // better one than load: at load it is an announcement about a feature the
      // user has not reached for yet, and it would spend a toast slot on every
      // boot of every project without an agent.
      if (profile === null) return;
      // Catch the world up: the mirror may be missing every edit made before the
      // profile arrived, and the first pass should describe the field as it
      // stands rather than only what has changed since.
      analyzerResync = true;
      analyzerWholeWorld = true;
      analyzerPlacementsStale = true;
      analyzePump.request();
    },
    subscribeFlags(cb) {
      flagsCb = cb;
      // Initial push (the subscribeSelection remount rationale): a subscriber
      // remounting while markers are on screen must not render an empty list.
      cb(flagStore.summary());
      return () => {
        if (flagsCb === cb) flagsCb = null;
      };
    },
    setFlagFilters(filters) {
      flagStore.setFilters(filters);
      publishFlags();
    },
    verifyFlag: verifyFlagImpl,
    selectFlag: selectFlagImpl,
    flagMarkerCount() {
      return markerCount;
    },
    selectionCellCount() {
      return selectionCellsCount;
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
        // Guard: a STALE unsubscribe (kept past a later subscribe) must not
        // null the successor's callback — the subscribeTool rule, which every
        // other seam here already follows.
        if (statsCb === cb) statsCb = null;
      };
    },
    isLooking() {
      return look !== null;
    },
    subscribeCameraPose(cb) {
      cameraPoseCb = cb;
      // Initial push (the subscribeSelection remount rationale): the camera does not
      // move on its own, so a triad that waited for the first WASD step would draw
      // the wrong orientation for as long as the user sat still.
      cb({ yaw: orbitState.yaw, pitch: orbitState.pitch });
      return () => {
        if (cameraPoseCb === cb) cameraPoseCb = null;
      };
    },
    subscribeSegmentHud(cb) {
      segmentHudCb = cb;
      // Initial push (the subscribeSelection remount rationale), and here it is the
      // SAME argument as subscribeCameraPose's: nothing moves this value on its own, so
      // a subscriber that waited for the next pointermove would read blank for as long
      // as the user held still over a segment they had already started.
      publishSegmentHud();
      return () => {
        if (segmentHudCb === cb) segmentHudCb = null;
      };
    },
  };
}
