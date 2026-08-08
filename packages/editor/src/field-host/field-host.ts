// FieldHost: the F1 dig-loop surface. It owns its canvas context, camera,
// render loop, and the field session (store + op log + dirty-set + remesh
// client). React chrome talks to it via methods; the host is FREE of React. It
// runs a continuous rAF (fly movement integrates per frame and the dirty-set
// drains across frames) and creates NO physics world (colliders are derived at
// dungeon-load time, T11).
import type * as binding from "@furnace/core/binding";
import * as field from "@furnace/core/field";
import type * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import type * as mesh from "@furnace/core/mesh";
import type { EntityArchetype, EntityCatalog } from "../shared/catalog.ts";
// `latticeClearance` — the duplicate offset's lattice step — left with
// `field-entities.ts` on 2026-08-08 (foundations T3d Task 6), with the verb that
// was its only reader here.
import type { BrushEffect } from "../shared/field-brush.ts";
// The limits the host ENFORCES and the chrome has to STATE. They live one layer down
// (`shared/`, which the chrome may value-import and this directory may not be) so the
// number a user reads and the number a click is refused by are ONE number rather than two
// that agree by review — see `field-limits.ts`' header for what that used to cost.
//
// FOUR of the six left on 2026-08-08 (foundations T3d Task 4) with the brush layer:
// `RADIUS_MIN`/`RADIUS_MAX` are `clampRadius`'s and `HOLLOW_MIN_M` is `clampTool`'s, all
// three now in `field-tool.ts`; `DIG_RANGE_M` — neither enforced nor stated, but what
// `MAX_SEGMENT_M` is twice of — went with the eyedropper's raycast, its only reader here.
import { MAX_SEGMENT_M } from "../shared/field-limits.ts";
import { createAnalyzer } from "./field-analyzer.ts";
// The rig, and with it BOTH pure camera modules: `camera-control.ts` (the orbit math) and
// `field-camera.ts` (the input arithmetic) each had every one of their readers inside the
// camera cluster, so all three import blocks left this file together on 2026-08-08
// (foundations T3d Task 4). `@furnace/core/camera` went with them — nothing here holds a
// `Camera` any more; the frame asks `cameraRig.cam()` for the one it draws with.
import { createCameraRig } from "./field-camera-rig.ts";
import { FieldWorkerClient, type WorkerLike } from "./field-client.ts";
import { createDrift } from "./field-drift.ts";
import { createEntities } from "./field-entities.ts";
import {
  createFlagStore,
  type FlagFilters,
  type FlagRow,
  type FlagsSummary,
  INFO_TINT,
} from "./field-flags.ts";
import type { FieldHistory } from "./field-history.ts";
import { createHistoryFeed } from "./field-history-feed.ts";
import { createFieldMachine, randomStampSeed } from "./field-machine.ts";
import { createMaterials } from "./field-materials.ts";
import { createPicking } from "./field-picking.ts";
// `placementsByEntity` left with `field-entities.ts` at T3d Task 6 — it was
// `listEntities`' one-pass attribution and had no other reader here. What stays
// is the type `FieldEntityInfo.placed` is made of, plus the two `listGenerators`
// helpers, which are `catalogs`' and declared facade-resident.
import {
  type PlacedArchetype,
  placesProps,
  withArchetypeOptions,
} from "./field-placements.ts";
import { createProps } from "./field-props.ts";
import { createRender } from "./field-render.ts";
import { createSegmentBrush } from "./field-segment.ts";
import { createSelection } from "./field-selection.ts";
import type { StampSession } from "./field-stamp.ts";
import { createStatsMeter } from "./field-stats.ts";
import { createTargeting } from "./field-targeting.ts";
import { createTool } from "./field-tool.ts";
import { createView } from "./field-view.ts";
import { createVoidCast } from "./field-voidcast.ts";
import { createWorld } from "./field-world.ts";
import { arrowNudgeSteps } from "./input-map.ts";
// `createRung` is NOT imported any more, and that is a fact about the closure
// rather than about this line: after T3d Task 5 there are ZERO Esc rungs left in
// `createFieldHost`. **The absent import IS that check** — which is the only claim
// here worth making in a comment, because it is the one a reader cannot get wrong
// and a future edit cannot silently falsify. Every rung now lives in the module
// that owns the state it cancels; the block at `const router =` names the owners
// and cites the grep that regenerates the list. What stays here is the ROUTER —
// assembled first, handed to each of those modules as a dep, and drained by the
// `Escape` branch of `onKeyDown`. The stack is the one piece of cross-cluster
// arbitration that never had to move, because a rung addresses it by registration
// rather than by position.
import { createInputRouter } from "./input-router.ts";
// The render-bookkeeping shapes live with the rest of the substrate an extracted
// cluster is handed, so the host and its clusters name them from one place.
import {
  type ChunkRender,
  createHostSubstrate,
  type PropRender,
} from "./substrate.ts";
// `createViewChannel` is NOT imported any more either, and the same reading
// applies — the absent import is the check. All thirteen of the host's
// `subscribe*` seams are now one-line delegates onto a channel some MODULE owns,
// one channel per seam, and `grep -c "createViewChannel<" src/field-host/*.ts`
// regenerates the ownership. The last THREE left at T3d Task 5 (`selection`'s,
// the entity tick's and the entity selection's), which is why this import went
// with them. (This said "the last four" while naming three, until the Task-5
// review.)
import { type ViewportCursor, viewportCursor } from "./viewport-cursor.ts";

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
 *  reason `FieldStats.voidCastPending` gives from the other side: a new seam is one
 *  more thing the chrome's provider has to own and release — and unlike that
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
   *  cost) — see the log-signature gate in `field-stats.ts`, which since T3b1
   *  sits inside the publish guard rather than on every tick. Only
   *  `liveGenerators` and `compactableOps` depend on that cache being fresh; the
   *  other three ARE the signature, so they cannot disagree with it. */
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
   *  A BOOLEAN rather than a count: `field-voidcast.ts`'s `requestVoidCast` refuses a
   *  second one while the first stands, so there is never more than one.
   *
   *  It rides the stats push rather than a subscription of its own for two reasons. A
   *  fourteenth seam is a fourteenth thing the chrome's provider has to own and
   *  release — and this fact has no consumer that does not already read stats. What it
   *  BUYS is legibility for a refusal that already ships: "a void cast is still building
   *  — re-tick the void layer once it lands" names a state nothing on screen showed,
   *  and toggling off-and-on is exactly the sequence a user with no in-flight signal
   *  performs.
   *
   *  Stays true across `field-voidcast.ts`'s `discardVoidCast`, and truthfully: the
   *  discard strands the RESULT, it does not call the worker off. */
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

/** The editor's dig-loop surface: verbs the chrome calls, and the thirteen
 *  `subscribe*` seams it reads back.
 *
 *  EVERY SEAM IS MULTICAST (`view-channel.ts`). N subscribers each get every push,
 *  an unsubscribe removes only its own callback and is idempotent, and one
 *  subscriber that throws is logged and does not cost its siblings their push.
 *
 *  READ THE "Single subscriber (…)" NOTE ON EACH SEAM BELOW AS ITS ONE CLAIMANT
 *  HOOK, NOT AS A COUNT. Until foundations T3b1 (2026-08-06) the two were the same
 *  thing: the shell's host-state provider held all thirteen and fanned them out
 *  through React contexts, so each seam had exactly one live subscription. T3b1
 *  Task 7 replaced that fan-out with per-consumer `useSyncExternalStore` latches
 *  (`frontend/hooks/useFieldHostState.tsx`), and TEN of the thirteen are now
 *  subscribed in the surface that reads them — so a seam read by three mounted
 *  surfaces has three live subscriptions, by design. Only `subscribeTool`,
 *  `subscribeToolError` and `subscribeFlags` are still the provider shell's.
 *  What survived is the part the notes are actually for: each seam has ONE hook
 *  that claims it, so there is still one place a comparator decides whether a push
 *  re-renders anything, and one place to look when a surface stops updating.
 *
 *  A duplicate subscription is therefore no longer a bug. A mirror that outlives
 *  its surface still is, and it has no symptom at all — `size()` and the counts in
 *  `tests/chrome/host-seams-and-catalogs.test.tsx` are what detect it.
 *
 *  A pushed value is CLONED once per publish and SHARED by every subscriber:
 *  treat it as immutable. */
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
  /** Changes the active brush (effect + material class + mask + smooth params
   *  + hollow). Default dig/rock, unmasked, solid fill. The chassis is the
   *  enforcement point for parameter ranges: smooth strength/iterations are
   *  clamped to the core ceilings and `hollow` is clamped to ≥ 0.5 m (core
   *  accepts any hollow > 0 — it cannot clamp against cellSize — but a
   *  sub-cell shell band on organic shapes can produce holey shells, and 0.5
   *  matches the UI's step).
   *
   *  ANNOUNCES the result on {@link subscribeTool} — the CLAMPED tool, which is
   *  what makes a caller's out-of-range request visible to every reader rather
   *  than only to the strokes. A set that changes nothing publishes nothing
   *  ({@link setDigRadius}'s rule, one type up).
   *
   *  THOSE TWO CLAUSES MEET, and the case where they do is the one to design
   *  against: an out-of-range request whose clamp lands on the value already
   *  held moves nothing, so it is announced to NOBODY. The clamp is visible only
   *  when it changes the held tool. A caller displaying an unclamped buffer of
   *  its own — a text field mid-edit — must therefore normalise that buffer
   *  itself rather than wait for an echo this seam is entitled to withhold.
   *  (`shell/tool-params.tsx`'s hollow field is the one that does; it learned
   *  the hard way.)
   *
   *  TAKES A PATCH — the fields the caller is SPEAKING ABOUT, shallow-merged over
   *  the held brush. A whole `FieldTool` is a valid patch (it names every field),
   *  so this is a widening; `smooth` is one field, replaced wholesale rather than
   *  deep-merged. The patch shape is load-bearing under a MOMENTARY modifier, and
   *  that is why it exists: while ⇧ or ⌃ is held the brush every surface can see
   *  is the DERIVED one, so a control that echoed the whole thing back to change
   *  one number also said `effect: "smooth"` — and the host, which reads a set
   *  under a held modifier as "this is the base to restore to", adopted it. The
   *  user let go of ⇧ and their dig had permanently become a smooth. A patch
   *  cannot say that by accident: nudge a param and the patch names the param,
   *  pick a tool and it names the effect, and the base learns only what was
   *  actually said. (foundations T3c; the defect was
   *  `param-nudge-under-a-momentary-modifier-rewrites-the-base.md`.) */
  setTool(patch: Partial<FieldTool>): void;
  /** Subscribes to the armed brush and its radius ({@link FieldToolPush}), pushing
   *  the CURRENT pair synchronously on subscribe — so a surface mounting mid-session
   *  (the tool strip, which the chrome unmounts for the whole of every stamp session)
   *  renders the brush the viewport is drawing rather than a default. N subscribers;
   *  returns an unsubscribe.
   *
   *  EVERY path that moves either value fires it: a chrome `setTool`, the Alt-click
   *  eyedropper, momentary Shift/Ctrl enter and leave, the slider, the wheel and
   *  `[` / `]`. Both funnels value-compare, so a set that changes nothing fires nothing —
   *  with one exception worth knowing before you build a counter on this seam: a `setTool`
   *  landing under a held modifier goes through the re-derive, which notifies
   *  unconditionally, so a repeated identical set publishes a repeated identical payload.
   *
   *  This contract used to read "NOT fired for a plain chrome setTool — EXCEPT when
   *  that setTool lands while a momentary modifier is held", which made the chrome the
   *  only holder of a value the host owns and left a late mount with nothing to read.
   *  What survives that clause is the reason it named: a set landing under a held
   *  modifier re-derives, so the push carries the DERIVED tool rather than what the
   *  caller set. A mirror must therefore still value-compare before pushing back —
   *  answering a derived push with a `setTool` re-derives and re-fires, which is a loop. */
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
   *  (refused, loudly, past `field-voidcast.ts`'s `VOID_CAST_CHUNK_BUDGET`
   *  chunks — the cast is a region-scale tool); true→false frees it. A call
   *  that leaves the flag true
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
  /** What ⏎ MEANS, and the ONE verb that ends a session from outside: drop a
   *  live grab, else end the session by its MODE ({@link commitStamp} for a
   *  stamp, {@link applyReconfigure} for a reconfigure). Both keys that spell it
   *  route here — the canvas's own ⏎ and the app-level one — so a confirm cannot
   *  mean two different things depending on where the focus is.
   *
   *  There used to be a second, mode-only verb beside this one (`commitSession`,
   *  "end by mode", deliberately NOT routing through `dropMove`). It was deleted
   *  in foundations T3c with zero production callers repo-wide: the panel's
   *  Commit/Apply button wears the ⏎ keycap and so must mean what the key means,
   *  which is this. Keeping a second spelling of "end the session" only bought a
   *  way for the two to answer differently.
   *
   *  Public because `beginMove` does NOT focus the canvas: a grab started from
   *  the Edit menu, or by `G` with a palette control focused, leaves the canvas
   *  listener unreachable, and without this the only key the status bar advertises
   *  for that state ("⏎ drop") would do nothing at all.
   *
   *  Over a bare end-by-mode it adds `dropMove`'s two rules: the zero-step rule
   *  (a grab dropped where it started ends the session rather than spending a
   *  history entry on a reconfigure that changed nothing) and the pending-preview
   *  latch (a drop that lands mid-preview is spent when the preview settles).
   *  That zero-step test asks whether the session's REGION differs from the
   *  entity's recorded one, so a grab moved only by the ARROW keys lands like any
   *  other — it reads the region, not the cursor.
   *  Routing both ⏎s through one verb is what keeps that a single defect instead
   *  of a difference between two keys. */
  confirmSession(): void;
  /** Discards the session + its ghost. No-op without a session. The panel's Cancel
   *  button; Esc goes through {@link escape}, which reaches this only when the
   *  session is the most recent thing standing rather than unconditionally. */
  cancelStamp(): void;
  /** The Esc CANCEL (D-12): cancels exactly ONE thing, the most recent thing the
   *  user started. Six states can be standing — a half-drawn box anchor, a
   *  half-drawn segment anchor, a pending stamp arm, the live session (a move
   *  included), the selected entity ({@link selectEntity}) and the cell selection
   *  ({@link clearSelection}'s parking behaviour, so Reselect is still the way
   *  back) — and each one is cancellable for exactly as long as it is live. With
   *  nothing standing it is a silent no-op.
   *
   *  RECENCY, not a fixed priority: the order is the order the states were
   *  acquired in, so a selection drawn after an entity was picked is cancelled
   *  before that entity. A state that is REPLACED (one selection displacing
   *  another) keeps the position it first took — replacing is not restarting.
   *
   *  Public because the CANVAS binding is not enough: it fires only while the
   *  canvas has focus, and clicking any palette control takes focus away — the
   *  standing F2b finding that a viewport binding dies the moment the user
   *  touches a panel ({@link undo}'s rationale). Both entry points cancel off the
   *  same stack, so they cannot disagree about what is most recent, and the canvas
   *  branch stops the event when it acts so one press cancels one thing. */
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
   *  ghost, and {@link confirmSession} as its terminal verb. What it adds is a
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
   *  subscriber is the shell's provider (one owner, one guard) rather than the
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
   *  shell's provider (one owner, one guard) rather than the status bar. Single
   *  subscriber (that provider, which publishes it at `useFieldSegmentHud`);
   *  returns an unsubscribe. */
  subscribeSegmentHud(cb: (hud: SegmentHud | null) => void): () => void;
};

// `Vec3T` — the three-number tuple alias — is no longer declared here: its last
// three readers in this file were `chunkSetBox`, `occupiedTopYOf` and
// `snapshotChunks`, and all three left with `field-world.ts` on 2026-08-08
// (foundations T3d Task 6). Seven modules declare the same alias locally, which
// `field-camera-rig.ts`'s `Box` note argues is right on COUNT: a name is not part
// of a structural type's identity, and the `FieldHost` surface spells its own
// vectors out.

// `SelectionState` — the stored spec + its click-time materialization — left
// with `field-selection.ts` on 2026-08-08 (foundations T3d Task 5) and is
// private there. Nothing outside that module ever needs the shape: the two
// readers that used to (`cameraRig.selectionBox`, `machine.selectionRegion`)
// take a BOX and a region-plus-truncation instead.

// `LineBatch` — the drawLines vertices/colors pair — is no longer declared here:
// every batch in the host belonged to `selection` or `entities` and both left on
// 2026-08-08. Six modules declare the same three-word structural alias locally,
// which `field-camera-rig.ts`'s `Box` note argues is right on COUNT: a name is
// not part of a structural type's identity.

// `REMESH_PER_FRAME` — the dirty-set drain budget per rAF — left with
// `field-world.ts` on 2026-08-08 (foundations T3d Task 6), along with
// `COMPACT_THRESHOLD_OPS` where that one was declared ~90 lines down. Each had
// exactly one reader in CODE (`drainDirty` and `compactLoadedLog`), so both
// travelled by Task 3's rule. The `FieldStats` TSDoc ~1,050 lines up still names
// the compaction ceiling by name and now names its new home.
/** The pointer-rate cadence: how often a drag applies the brush, and (since D-25) how
 *  often the pending segment's length reaches the chrome. Exported for the segment
 *  suite's clock, which advances by exactly one window to prove the HUD's throttle
 *  RELEASES — an assertion that spelled `40` here would go stale silently the first time
 *  the cadence was tuned. Deliberately NOT re-exported from `index.ts`: the chrome has
 *  no business with it, and everything behind that barrel value-imports core. */
export const STROKE_MIN_MS = 40;
// The advisor's four constants — the engine URL and verify budget stage 2 posts,
// the drawn marker's metre size, and the whole-world debounce — left with
// `field-analyzer.ts`. Each had exactly one reader and it went with the cluster.
const MAX_FRAME_DT = 0.1; // clamp dt so a stall can't lurch the camera
// The CAMERA's field of view (`EDITOR_FOV_Y`) went to `field-camera-rig.ts` with
// the one call that builds a camera, and the RADIUS wheel step to `field-tool.ts`
// with the one funnel that spends it — the wheel and `[` / `]` now say how many
// notches and let that module hold what a notch is worth. `MAX_FRAME_DT` stays
// because the frame is the facade's: `tick` is what clamps `dt`.

// The FRAME's eight constants — the clear colour, the studio key light's three,
// both ambient terms and the reference grid's two — left with `field-render.ts`
// on 2026-08-08 (foundations T3d). The MATERIAL layer's six went to
// `field-materials.ts` the same day: the shared specular, both ghost alphas, the
// void cast's cyan and its alpha, and the selection cell's. The gizmo's
// `AXIS_COLOR` went to `field-entities.ts` at Task 5. Each had readers in
// exactly one cluster, so each travelled with it.
//
// THE THREE BELOW STAY, and the argument has CHANGED rather than expired — this
// is the resolution of the Task-5 migration markers
// `field-materials.ts` and `field-render.ts` carried on them. They were declared
// here on a "two owners-to-be" argument: a constant shared with a reader still in
// this closure stays where both can see it. After Task 5 NO function in this file
// reads any of the three. What each has instead is readers in two or three
// DIFFERENT modules — `SELECTION_COLOR` in `field-selection.ts` +
// `field-render.ts`; `ANCHOR_CROSS_HALF_M` in those two + `field-segment.ts`;
// `SELECTED_COLOR` in `field-selection.ts` + `field-materials.ts` — so the
// declaration is now a NEUTRAL shared point rather than a shared-with-the-host
// one, and all three keep travelling as plain VALUE deps on `field-segment.ts`'s
// `anchorCrossHalfM` precedent, which is three tranches old and is literally one
// of them.
//
// Picking an owner among PEERS is a naming decision — whose vocabulary is the
// editor's accent? — with no code consequence, and the spelling that implements
// it would make two sibling modules value-import a third for a literal, which is
// a load-order edge where there is none today. That is a DELETION-PASS question
// (`working-standards.md` §Design), so it belongs to the prune tranche and not to
// a threading one. The stay is deliberate and stated here rather than left to be
// inferred from the absence of a move.

// `clampRadius` and `clampIntRange` left with `field-tool.ts` (2026-08-08,
// foundations T3d Task 4): the first is `applyRadius`'s and the second is
// `clampTool`'s, and neither had a second reader anywhere in this file.
// `field-limits.ts`' TSDoc names `clampRadius` as the enforcement point and now
// names its new home.

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
// chrome cannot value-import anything under `field-host/`, so the two agree
// by review (the FlagsSection tint-palette precedent): if the
// token moves, this moves.
const SELECTED_COLOR: [number, number, number, number] = [
  0.048, 0.271, 0.536, 1,
];
// Box-select anchor cross: half-length of each of the three axis strokes (m).
const ANCHOR_CROSS_HALF_M = 0.25;

// --- the translate gizmo (D-9) ---------------------------------------------
// `AXIS_COLOR` — the semantic X-red / Y-green / Z-blue palette, converted to
// LINEAR sRGB — left with `field-entities.ts` on 2026-08-08 (foundations T3d
// Task 5). It had exactly ONE reader in this closure, the gizmo's batch build,
// so it travelled by the same rule the material and frame constants followed at
// Task 3. Its conversion argument (and the note that no test can catch a
// double-encode, because the GPU fixtures request `surfaceFormat: "linear"`)
// went with it; `SELECTED_COLOR` above is converted the same way and says so.

// The brush's FIVE module-scope helpers — `defaultTool`, `cloneTool`,
// `clampTool`, `sameMask` and `sameTool` — left with `field-tool.ts` on
// 2026-08-08 (foundations T3d Task 4). Every one of them was reached only by that
// cluster: the first three by the tool slot and its two funnels, and the
// comparator pair by `setTool`'s no-op guard, which went with `setTool`'s body.
// `sameTool`'s destructure backstop and its argument about the chrome's second
// `toolsEqual` travelled unchanged — `tests/frontend-no-engine-leakage.test.ts`
// is what makes two comparators the right answer, and it does not care which file
// this side of the seam lives in.

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
  let canvasEl: HTMLCanvasElement | null = null;
  // The camera HANDLE and its canvas binding left with `field-camera-rig.ts`
  // (2026-08-08, foundations T3d Task 4) — the two slots §5.1 of the closure map
  // lists as `ret.init`/`ret.dispose`'s camera fan-out. Four edges, three calls:
  // `cameraRig.bind(ctx)` at init, and `unbind()` + `release()` at dispose, split
  // by the context guard on `field-materials.ts`'s precedent. `ctx` and `canvasEl`
  // stay because they are the FACADE's: one is what `init` acquires and every
  // module asks the substrate for, the other is what `attachListeners` owns.

  const store = field.createFieldStore();
  const log = field.createOpLog();
  const dirty = new Set<string>();
  const worker = new FieldWorkerClient(deps?.spawnWorker);
  const chunkMeshes = new Map<string, ChunkRender>();

  // Per-class lit materials keyed `c<classId>` (surface) / `b<classId>` (kit
  // backing), rebuilt from `table` at init and on setMaterialTable.
  //
  // THE ONE PIECE OF THE MATERIAL LAYER THAT STAYS, by decision rather than by
  // omission — the other sixteen bindings left on 2026-08-08 (foundations T3d)
  // for `field-materials.ts`, and this cache has been that module's private
  // store all along: nothing outside its four functions has ever read it. The
  // `field-view.ts` rule would therefore send it into the file with its owner.
  // It cannot go, because it is ALREADY a `HostSubstrate` VALUE member, declared
  // there at T3a ahead of any consumer. Removing a member is a different decision
  // from declining to add one: the two-extracted-readers bar governs ADDITIONS
  // (`field-props.ts` says so at `archetypeById`), and paying for a tidier record
  // by editing a behavioural fixture is not a trade this tranche makes. It is a
  // FIFTH substrate leftover beside `propMeshes`, `ghostMeshes`, `voidCastMeshes`
  // and `flagStore` — and the first whose owning cluster is also its only reader.
  //
  // MEASURED rather than reasoned: deleting the member gives EIGHT type errors,
  // exactly ONE of them in a test (`field-history-feed.test.ts`, which hands its
  // literal to `createHostSubstrate` and so gets excess-property checking). The
  // three other test files that name it build it inside a spread helper, where
  // that check does not reach — so they would go SILENTLY STALE rather than red.
  // `field-materials.ts`'s header carries the argument for why that matters.
  const litByClass = new Map<
    string,
    { mat: material.Material; bind: binding.Binding }
  >();

  // --- the `catalogs` cluster: DECLARED FACADE-RESIDENT, foundations T3d ------
  //
  // Three bindings — `table` here, `archetypes` and `archetypeById` ~110 lines
  // down — and this is the record that they stay, so a later sweep does not read
  // the absence of a `field-catalogs.ts` as an oversight.
  //
  // The row is 3 state / ZERO functions (`field-host-clusters.md` §6). What a
  // module would have contained is therefore not the cluster's own work but its
  // three SETTERS' bodies, and all three are facade members: `setMaterialTable`
  // tears down every chunk render, rebuilds the per-class lit materials and
  // re-dirties the world; `setEntityCatalog` rebuilds the prop layer;
  // `listGenerators` folds the archetype ids into the generator schemas. Lifting
  // those would drag `materials`, `world` and `props` across the line to carry
  // three `let`s that no cluster function reads.
  //
  // And two of the three ALREADY LEFT, in the only sense that matters: `table()`
  // and `archetypeById()` are `HostSubstrate` thunks, so every extracted module
  // that needs them reads them live from the record. What is left in the closure
  // is the assignment, which is the facade's.
  //
  // `archetypes` is the third and it does NOT join them, on T3a's substrate bar:
  // adding a member requires two extracted readers and it has exactly one
  // (`field-machine.ts`, through the `archetypes: () => archetypes` dep at the
  // machine assembly). It rides as a single-consumer function dep instead —
  // `field-props.ts`'s `kitMat` precedent, and the bar in its active form.
  //
  // The project's resolved material table — drives the mesher's bucket split,
  // logApply validation, and the bake. Defaults rock-only until setMaterialTable.
  let table: field.MaterialTable = field.BUILTIN_TABLE;
  // The BRUSH's eight bindings left on 2026-08-08 (foundations T3d Task 4) for
  // `field-tool.ts`: the tool slot, the momentary trio, both view channels, the
  // once-per-gesture mask-drop latch, and the radius, which sat ~270 lines
  // further down among the render bindings. Nothing of the cluster stayed — the
  // row is the third of the tranche to travel whole, and the only one whose
  // state is written from a KEY listener.
  //
  // Which is why the interesting half of that move is not here but at
  // `onKeyDown` / `onKeyUp` / `onBlur`, ~2,000 lines down: those three still write
  // the momentary flags, through `tool.noteModifierDown` / `noteModifierUp` /
  // `releaseModifiers`, because `input` is the listener layer and stays. The
  // module's header carries the contract the three verbs have to preserve, and
  // `tests/field-host-momentary.gpu.test.ts` reaches all of it through the real
  // handlers — which is the only route there is.

  // --- the Esc capture stack (D-12, was the Esc ladder) --------------------
  // ONE key, ONE rung per press, most recent intent first — except that "most
  // recent" is now the stack's own shape rather than an order spelled out in a
  // chain of ifs. Every cancellable state acquires an entry when it goes live and
  // releases it when it clears, so what Esc can cancel is exactly what is
  // standing.
  //
  // THE RUNGS ARE NAMED HERE, NOT COUNTED, and the rule has now been broken twice
  // by two different authors, which is the argument for it. This comment used to
  // open "five states here plus the segment anchor", wrong twice over: already off
  // by one when written (six rungs stood in this file, not five), and T3c then
  // moved half of them into a module the sentence had no way to mention. **T3d
  // Task 5 then moved the remaining three out and left this list naming THIS FILE
  // as their owner** — the same failure again, in a block whose whole thesis is
  // that a hand-maintained tally "has to be re-derived by anyone adding a rung,
  // and nothing fails if they don't". Nothing did. So the numbers are gone from
  // this block entirely and only the OWNER LIST stays, because a list of names is
  // checkable against the grep beside it in a way a count is not:
  //   - `field-selection.ts` — the box-select anchor, the cell selection
  //   - `field-entities.ts` — the selected entity
  //   - `field-machine.ts` — the live session (a move rides the same entry), the
  //     pending stamp arm, the sub-threshold move press
  //   - `field-segment.ts` — the segment anchor
  // `grep -rn "createRung(" src/field-host/` regenerates that list, and NOTHING in
  // this file appears in it any more. Each cluster captures for the state it OWNS,
  // which is what handing the router over whole (rather than as a capture/release
  // callback pair) is for; the rung mechanism itself lives in `input-router.ts`
  // beside the stack, so no owner can drift from another on when it acquires.
  const router = createInputRouter();

  // --- selection state (current + Reselect, overlay) ------------------------
  //
  // ALL NINE BINDINGS LEFT with `field-selection.ts` on 2026-08-08 (foundations
  // T3d Task 5) — the current selection, the Reselect slot, the panel channel,
  // the three overlay batches, the pending box anchor and the cell layer's mesh
  // and count. Nothing stayed: no other cluster wrote any of them except
  // `resetWorld`, whose two writes are one call (`selection.retireWorld()`)
  // now, and every reader takes a narrow verb off that module's seam.
  //
  // The armed-gesture slot had already left with the session machine
  // (`field-machine.ts`): what LMB does and what a live session does to it are
  // one state machine — arming anything cancels a move in flight and drops a
  // pending stamp arm — so `gesture` went with the sessions rather than staying
  // beside the selection it merely shares a click with. Read here as
  // `machine.gesture()`.
  //
  // The BOX ANCHOR stayed HERE for two tranches on the argument that it is owned
  // jointly with the two overlay batches, `updateBoxPreview`, `boxCorner` and
  // `selectionClick` — which was right, and is exactly why all six travelled
  // together in the end. The machine still reaches them as deps
  // (`setBoxAnchor`, `boxCorner`, `boxAnchor`, `updateBoxPreview`); what changed
  // is that those four are now refs onto a module seam rather than onto closure
  // functions.

  // --- the pending stamp arm (region-draw entry, D-F4.5-7) ------------------
  // All three bindings left with `field-machine.ts` — the arm, its channel and
  // the once-per-session suspension latch. The arm SHADOWS the armed gesture
  // rather than replacing it, so it could never have gone anywhere `gesture` did
  // not, and the latch is the session's own. Read here as
  // `machine.pendingStamp()`.

  // The project's entity catalog, indexed by archetype id (empty until
  // setEntityCatalog — a project with no catalog stays empty forever and every
  // prop draws at the fallback proxy). The ARRAY is kept beside the map because
  // the two seeding paths need ORDER (the archetypeId enum, and startStamp's
  // "the catalog's first" fallback), which a Map's iteration order gives but
  // reads worse.
  //
  // The other two thirds of `catalogs`, which stays in this closure by decision
  // rather than by omission — the verdict and its argument are at `table`'s
  // declaration above.
  let archetypes: readonly EntityArchetype[] = [];
  let archetypeById: ReadonlyMap<string, EntityArchetype> = new Map();
  // The committed prop layer: one instanced draw per archetype, rebuilt from the
  // op log's placement records by `field-props.ts`. Stays in the closure as a
  // `HostSubstrate` value member because `renderScene` draws it — the module
  // empties and refills the host's own array rather than a copy of it. Since T3d
  // Task 3 `renderScene` is `field-render.ts`'s and reads this through the same
  // record, so both ends of the sharing are now modules and the array is what
  // they share; every other `renderScene` mention below means that function, in
  // that file.
  const propMeshes: PropRender[] = [];

  // The walkability advisor's findings store (what the analyzer found, what the
  // filters admit, what stage 2 has since proved).
  //
  // THE ONE PIECE OF THE ADVISOR THAT STAYS, by decision rather than by omission
  // — the rest of the cluster left on 2026-08-07 (foundations T3d) for
  // `field-analyzer.ts`, and this handle could not go with it. It is a
  // `HostSubstrate` VALUE member, and the substrate is assembled ~160 lines below
  // this line and ~1,210 lines ABOVE where the advisor is now constructed; a
  // record whose value members are read eagerly cannot be built above one of
  // them, which is why T3b1 hoisted this declaration here in the first place. It
  // also has two extracted readers now — `field-analyzer.ts` and
  // `field-picking.ts`, both through `substrate.flagStore` — so it is genuinely
  // shared state and not one cluster's private store.
  //
  // That makes it one of FIVE substrate leftovers, beside `propMeshes`,
  // `ghostMeshes`, `voidCastMeshes` and `litByClass` — which the closure map's §1
  // accounting classifies as substrate rather than as cluster state.
  //
  // Until 2026-08-08 the paragraph here drew a distinction between them: those
  // three stayed because `renderScene` DREW them, this one because the substrate
  // had to hand it out before its owner existed. The first half of that expired
  // when `render` left the closure for `field-materials.ts`'s neighbour
  // `field-render.ts` — the three containers are now read by an EXTRACTED module
  // through the record, which is structurally what `field-analyzer.ts` and
  // `field-picking.ts` already did with this one, so both forces are the same
  // force. `litByClass` arrived on the list the same day by a third route (its
  // owner left and the record already named it) and lands in the same place. What
  // survives all three routes is the plain fact: a substrate leftover is state the
  // record hands out and no single extracted module may own.
  const flagStore = createFlagStore();

  // The cell-level selection display (f2b gate item 1) left with
  // `field-selection.ts` too, and it is the one piece of that cluster with a GPU
  // half: an instanced cube per drawn cell, rebuilt per selection change, freed
  // at `dispose`. So two of the module's twenty verbs are lifecycle points this
  // file still calls — `selection.rebuildCells()` from `ret.init` (the selection
  // is CPU state and survives a dispose, so a re-init has to redraw it) and
  // `selection.destroyCells(c)` from `ret.dispose`.
  //
  // Its MATERIAL and binding had already left with `field-materials.ts` — same
  // split as the advisor's marker layer, and for the same reason: they are built
  // by one `init` and freed by one `dispose` alongside every other GPU material,
  // while the instanced mesh belongs to the selection. The module reads the
  // material as a dep and never sees the bind.

  // --- view state (layers + slice plane) ----------------------------------
  //
  // Both `let`s left with `field-view.ts`, and the assembly did NOT stay here to
  // mark the spot the way the other four extractions' did: `createView` takes
  // the void cast's `discard` and `request`, so it cannot be constructed above
  // `createVoidCast` — search `const viewState =`, ~1,060 lines down. What every
  // reader of this block wants to know is that the flags and the plane are still
  // the host's own state, read as `viewState.layers()` / `viewState.sliceY()`.

  // --- stamp session (ghost preview → commit) -----------------------------
  //
  // The session slot, its generation counter, the touched-param set and the panel
  // channel all left with `field-machine.ts`. What stayed on this side of the
  // block is what OTHER clusters own and the session merely writes: the drift
  // report below (cleared by `stepHistory` and `resetWorld` too), the entity tick,
  // and the ghost MESHES — a `HostSubstrate` value member, because `renderScene`
  // draws them and one Map shared by identity is what stops the module that fills
  // it and the loop that draws it disagreeing about what is on screen.

  // The drift report's slot and its panel seam BOTH left with `field-drift.ts`,
  // and the row they left says why they could: every one of the four writes to
  // the slot comes from another cluster (the reconfigure apply, a history step, a
  // world reset, the panel's dismiss), so it looked like state that had to stay
  // where all four could reach it. The READERS are what decided — there are two
  // and both are the module's — so the writers got a two-verb seam
  // (`drift.set` + `drift.notify`) and the state went with what reads it. The
  // assembly is ~710 lines down, below `createEntities`, whose footprint memo is
  // the one thing the payload cannot derive from itself.

  // The entity-list change tick left with `field-entities.ts` (2026-08-08,
  // foundations T3d Task 5), with the other seven bindings of that cluster; see
  // the block below where the selected id was.
  // Ghost render state: one entry per previewed chunk, every bucket drawn with
  // the ONE translucent stamp-ghost material. Rebuilt per preview response;
  // destroyed on cancel/commit/re-preview/world-reset + dispose.
  // Their MATERIAL and binding left with `field-materials.ts`: one translucent
  // hologram-blue shared by every ghost bucket, built at init and freed at
  // dispose, read here as `materials.stampGhost()`.
  const ghostMeshes = new Map<
    string,
    { m: mesh.Mesh; g: geometry.Geometry }[]
  >();
  // The ghost's other half — the previewed PLACEMENTS' wireframe batch — left
  // with the machine, unlike the meshes above: it is a CPU-only line batch with
  // no GPU handle to free at dispose, so nothing here needs to reach it.
  // `renderScene` reads `machine.placementGhost()`.
  // The SELECTED entity, its footprint box, the translate gizmo that hangs on
  // that box and the panel channel that announces it ALL LEFT with
  // `field-entities.ts` on 2026-08-08 (foundations T3d Task 5), together with the
  // entity tick's channel above and the footprint memo's two cache bindings ~950
  // lines down. Eight bindings, nothing stayed, and no other cluster wrote any of
  // them — the whole inbound column of that row was zero, which is why the move
  // cost the mutation register nothing.
  //
  // What DID keep it in this file for five tranches is an ordering fact rather
  // than a coupling one, and it is recorded at the assembly: `entityFootprints`
  // is taken as a PLAIN REF by both `field-drift.ts` and `field-camera-rig.ts`,
  // so the module has to be built above the lower of the two. Read here as
  // `entities.selectedId()`, `entities.gizmo()` and the rest of its 14 verbs.
  // The live move, the mid-preview drop latch and the sub-threshold press all
  // left with `field-machine.ts`, and they had to: the move's SESSION is the
  // machine's `stamp` slot, so a boundary between them would have cut a state
  // machine in half (`field-host-clusters.md` §7.2). Their two Esc rungs went
  // with them. Read here as `machine.moveDrag()`, which the gizmo and the cursor
  // still ask; the sub-threshold press has no reader on this side at all since
  // T3c took the threshold test too.

  // The SELECTED finding's cell outline left with `field-analyzer.ts` too, and
  // unlike the ghost meshes above it could: it is a CPU-only line batch with no
  // GPU handle for `dispose` to free, and its one reader is `renderScene`, which
  // asks `advisor.selectionBatch()`.

  // --- void cast (the X-ray) ----------------------------------------------
  // A ghostMeshes sibling: one entry per cast chunk, every bucket on the ONE
  // translucent void material. Built by the layer's enabling edge, dropped by
  // the next field mutation (`field-voidcast.ts`'s `invalidateVoidCast`) — never
  // rebuilt on its own.
  //
  // The map is ALL the cast leaves in this closure, and it stays because
  // `renderScene` draws from it: it is a `HostSubstrate` value member, so the
  // module that fills it and the loop that draws it share one identity rather
  // than two copies that could disagree about what is on screen.
  // The cast's MATERIAL and binding left with `field-materials.ts` on the stamp
  // ghost's precedent above; `field-voidcast.ts` reads it as
  // `materials.voidCast()` through the dep it already took.
  const voidCastMeshes = new Map<
    string,
    { m: mesh.Mesh; g: geometry.Geometry }[]
  >();

  // The stroke's two slots — LMB-is-down and the throttle's last timestamp —
  // left with the pointer chain (`field-machine.ts`), and they were the easiest
  // of the T3c move to decide: the four pointer handlers were their only readers
  // in this file, so nothing here lost a fact it was using. The RADIUS stayed one
  // tranche longer and left at T3d Task 4 with the rest of `tool`.
  //
  // IT IS NOT A SUBSTRATE MEMBER AND THE NEAR MISS IS WORTH THE SENTENCE. By the
  // time it moved, `digRadius` had THREE extracted readers — `field-segment.ts`,
  // `field-targeting.ts` and `field-render.ts`, each holding a `() => digRadius`
  // thunk — which is past T3a's two-extracted-readers bar for ADDING a
  // `HostSubstrate` member. The bar did not apply: it governs state the HOST still
  // owns and shares, and state that acquires an OWNER rides on that owner's seam
  // instead (`editor-architecture.md` §21.1 — `layers` and `sliceY` had five
  // reader clusters between them and became `viewState.layers()`). All three
  // thunks are `tool.digRadius` now and nothing inside those three modules moved.
  //
  // `lastPointer` left with `field-targeting.ts`, and the map files it here (§5.2
  // lists the two pointer delegates as its writers) in a way that reads as though
  // the DOM owned it. It did not: the last cursor position is the ARGUMENT every
  // cursor-to-world function takes, cached — so it went with the five functions
  // that are pure functions of it, the two delegates now call
  // `targeting.notePointer` on the way past, and its three readers ask
  // `targeting.pointer()`. Two of those three (`ghostState`,
  // `renderCursorAffordance`) left this file for `field-render.ts` at T3d Task 3
  // and the third, the facade's `beginMove`, is the only one still here.
  // `lastRemeshMs` and `remeshVersion` — the two numbers the stats meter reads
  // off the remesh — left on 2026-08-08 (foundations T3d Task 6) with
  // `field-world.ts`, which is the only thing that writes them. So did
  // `worldEpoch`, which sat ~1,000 lines further down in the pre-move file, and with it the whole of what a
  // migration marker there asked this task to reconsider:
  // its hoist above the `createAnalyzer` assembly is undone by DELETION rather
  // than by moving it back.
  //
  // The camera POSE channel went with the rig (`field-camera-rig.ts`), and it is
  // the one seam of the thirteen whose snapshot and its push were two spellings
  // of one expression — both are `pose()` over there now.
  //
  // WHAT STAYS HERE IS `lifecycle`'s, and it is DECLARED rather than left over —
  // see the block above `return {` for the whole argument. `raf` and `lastFrameT`
  // are the rAF loop's; `disposed` and `ctx` back two `HostSubstrate` THUNKS that
  // SEVEN modules read through, so their storage has to be in this closure
  // whatever owns the verbs. The names are listed once, at the declaration above
  // `return {`; `prose-check.py` derives the count from
  // `grep -l "substrate\.\(ctx\|disposed\)()"`.
  let raf = 0;
  let lastFrameT = 0;
  let disposed = false;

  // --- the shared substrate handed to every extracted cluster --------------
  //
  // What a module lifted out of this closure may hold, split by whether this
  // closure can REPLACE it: the eleven `const` bindings above pass BY VALUE,
  // because the host's writes all land through the identity it hands over
  // (`chunkMeshes.set`, `propMeshes.length = 0`), and the five `let`s pass as
  // CALLS, because the host replaces them wholesale and a snapshot would be a
  // silent fork. `substrate.ts`'s doc header is the whole argument; this call is
  // where the compiler checks it, and a `let` handed over as a value fails here
  // rather than months later at a read site.
  //
  // Assembled at the TOP of the closure rather than beside its first consumer,
  // because every later extraction gets the same record and the value members
  // are read eagerly — so this line, not each consumer, is what decides where a
  // substrate member has to be declared by.
  const substrate = createHostSubstrate({
    store,
    log,
    dirty,
    worker,
    chunkMeshes,
    flagStore,
    requestContext,
    litByClass,
    propMeshes,
    ghostMeshes,
    voidCastMeshes,
    table: () => table,
    archetypeById: () => archetypeById,
    ctx: () => ctx,
    disposed: () => disposed,
    canvasEl: () => canvasEl,
  });

  // The CAMERA's eight bindings and fourteen functions left on 2026-08-08
  // (foundations T3d Task 4) for `field-camera-rig.ts`: the orbit pose and its
  // aimed-by-hand latch, the `Camera` handle and its canvas binding, the held-key
  // set, the look drag's slot, the banked scroll, the pose channel — and with
  // them BOTH pure camera modules' import blocks, since every reader of
  // `camera-control.ts` and `field-camera.ts` was inside this cluster.
  //
  // THE ASSEMBLY IS ~1,100 LINES DOWN rather than here, and the position is
  // forced from BELOW for once. Two of its nine deps name `world` functions that
  // are declared down there (`chunkSetBox`, `occupiedTopYOf`) and three more name
  // `entities`/`selection` state in between, so `createCameraRig` sits directly
  // where `frameWorld` and `snapView` were — which is also `createSegmentBrush`'s
  // precedent read the other way round, since six of the fourteen functions lived
  // exactly there. What it cost is one arrow at `createTargeting` below: that
  // module takes `cam` and is assembled ~360 lines ABOVE the rig, so its thunk
  // reaches forward into a `const` declared later. Safe for the reason spelled out
  // at the `createVoidCast` assembly — nothing between this closure's brace and
  // its `return {` ever RUNS — and cheaper than the six arrows placing the rig up
  // here would have needed.
  //
  // What the LOOK drag left behind is `capturePointer`/`releasePointer` below.
  // T3c split the RMB gesture three ways and the third piece is still here: the
  // chain arbitrates (`field-machine.ts`), the turn is the camera's
  // (`beginLook`/`lookDrag`/`endLook`, now the rig's), and the DOM capture needs
  // the canvas ELEMENT — this closure's `canvasEl`, reassigned by every
  // attach/detach — which no module is given.

  // The DOM's pointer capture, which is unrelated to the Esc capture stack
  // despite the shared word: this one routes the pointer's events to the canvas
  // after the cursor leaves it, which is what makes a drag that runs off the
  // viewport keep working (and is why there is no pointerleave handler — see the
  // note beside `attachListeners`).
  //
  // Optional-chained on the element for `attachListeners`' reason: a headless
  // fixture has no real canvas, and every one of these calls is best-effort.
  const capturePointer = (pointerId: number): void => {
    canvasEl?.setPointerCapture(pointerId);
  };
  const releasePointer = (pointerId: number): void => {
    canvasEl?.releasePointerCapture(pointerId);
  };

  // --- THE ASSEMBLY RUN: seventeen module records, ~1,080 lines -------------
  //
  // From here to `createWorld` every top-level binding is a module record, and
  // almost every one of the blocks below states its own ordering constraint AND
  // how much slack it has. That is deliberate per-block and useless in
  // aggregate: a reader cannot tell from this file which of the seventeen
  // orderings are load-bearing and which are merely where something happened to
  // land. **`docs/reference/field-host-clusters.md` is where that question is
  // answered** — §2.6–§2.11 carry the per-task ordering findings and §6 carries
  // the per-cluster constraint. This pointer exists so nobody builds a second
  // map inside this file to answer it.
  //
  // The one invariant every block here leans on is stated once, at the
  // `createVoidCast` assembly: nothing between this closure's brace and its
  // `return {` ever RUNS, so an arrow body cannot be evaluated early — and its
  // TDZ half, which is why a forward dep may never be written as a value.

  // Every GPU material the viewport draws with, lifted out whole
  // (`field-materials.ts`): fifteen handles and the shading mode. What stayed is
  // `litByClass` — a substrate value member since T3a, so it could not follow its
  // own owner; the verdict is at its declaration ~350 lines up.
  //
  // THE ASSEMBLY SITS WHERE THE FUNCTIONS WERE, on `createSegmentBrush`'s
  // precedent (a cluster's remaining footprint marks where the cluster was), and
  // for once that position is also the one the ordering forces. It has to be
  // ABOVE `createProps` ~110 lines down, which takes `kitMat` and `kitInstanced`,
  // and above `createAnalyzer` ~970 lines down, which takes `flagMarker` —
  // `createAnalyzer` being the closure's ordering pivot, whose own block names
  // this line as one of the two constraints this task adds to it. `substrate` is
  // its only other requirement and is ~240 lines up, so nothing here is forced
  // any higher.
  //
  // NO FORWARD REFERENCE AT ALL, which is worth recording because the map
  // predicted one. §6's `materials` row lists a read of `stamp` in
  // `stampGhostMaterial`, which would have made this assembly depend on the
  // machine ~1,070 lines below. Grepping the function finds no such read: the only
  // occurrence of the word is inside its own throw message, "field-host: stamp
  // ghost material not initialized". A §2.1 phantom, on a binding name the map's
  // own list of ordinary English words already names. The cluster's real outbound
  // reads are three, all on the substrate.
  const materials = createMaterials({
    substrate,
    // The editor's `--primary`, premultiplied into the cell-selection material.
    // Passed as a VALUE rather than moved, because `field-selection.ts`' outline
    // reads the same constant — `field-segment.ts`'s `anchorCrossHalfM`
    // precedent, and both modules' headers argue it. Since T3d Task 5 the two
    // readers are peer modules and this file reads it nowhere; the declaration
    // block above says why it is still declared there.
    selectedColor: SELECTED_COLOR,
  });

  // --- dirty set + remesh: ALL OF IT LEFT (`field-world.ts`) ---------------
  //
  // The choke point, the chunk-origin arithmetic, the kit builder, the render
  // teardown, the mesh apply, the worker round trip and the paced drain — seven
  // of the cluster's fourteen functions sat here, and the other seven were
  // scattered across the next 1,700 lines. All fourteen left on 2026-08-08
  // (foundations T3d Task 6), the LAST cluster out of this closure.
  //
  // WHAT COULD NOT LEAVE is the five bindings this region opens over: `store`,
  // `log`, `dirty`, `worker` and `chunkMeshes` are `HostSubstrate` VALUE members
  // (declared ~450 lines up) and the closure is the only place their backing can
  // live while the substrate hands out their identity. `field-world.ts` reads all
  // five back through the record, exactly as its eleven siblings do — that module's
  // header is the authority on why a substrate value member does not belong to
  // the cluster that writes it most.
  //
  // THE ASSEMBLY IS ~1,150 LINES DOWN, below `createFieldMachine`, and the
  // position was decided by an arrow COUNT rather than by a constraint: every one
  // of `createWorld`'s twenty-three deps names a module declared above it, so the
  // record holds no forward arrow at all, and the price is the six one-line
  // arrows its consumers pay (this file's `createTool`, `createVoidCast`,
  // `createAnalyzer`, `createFieldMachine` and `createCameraRig`). Assembling it
  // HERE instead would have inverted that at about twenty arrows to six.

  // The committed prop layer, lifted out whole (`field-props.ts`): its three
  // functions and its instance-count map left, `propMeshes` stayed as a
  // substrate value member because `renderScene` draws it. The assembly sits
  // where the functions were, on `createSegmentBrush`'s precedent — a cluster's
  // remaining footprint marks where the cluster was.
  //
  // The arrow below FORWARD-REFERENCES a binding declared hundreds of lines down
  // (`materials` is above, but `advisor` is not). That is safe for the reason
  // spelled out at the `createVoidCast` assembly below — nothing between this
  // closure's brace and its `return {` ever RUNS, so an arrow body cannot be
  // evaluated before the declarations it names. The object literal itself is
  // eager, which is why `substrate` and `materials` are both declared above this
  // line.
  //
  // The two material deps were `() => kitMat` and `kitInstancedMat` — a thunk
  // over a host `let` and the host's own throwing getter over it — until
  // 2026-08-08 (foundations T3d), when the material layer got an owner. Both are
  // now plain refs onto that module's seam. What the CALL bought has not changed;
  // what changed is who answers it.
  const props = createProps({
    substrate,
    kitMat: materials.kitMat,
    kitInstancedMat: materials.kitInstanced,
    // Straight through to the advisor's verb of the same name, which is where the
    // act now lives: the two analyzer flags AND the pump request, as ONE named
    // thing. The three lines were one statement of intent inside `rebuildProps`,
    // the host named the act when `props` left, and `field-analyzer.ts` kept that
    // name when the flags followed — the prop layer and the analyzer's collider
    // set are derived from the SAME log, so a rebuild of the layer IS a change to
    // what stage 1 must re-run over.
    markPlacementsStale: () => {
      advisor.markPlacementsStale();
    },
  });

  // --- the brush (`field-tool.ts`) ------------------------------------------
  //
  // The armed tool, its radius, the momentary overrides and the whole op path,
  // lifted out whole: all eight bindings and all fourteen functions. NOTHING of
  // the cluster stayed, and since T3d Task 5 nothing of `selection` is in this
  // region either — the selection spec `toolMask` asks for was the one function
  // here that was never the brush's, and it travelled.
  //
  // THE POSITION IS FORCED FROM BELOW, hard, and mostly by ONE member:
  // `reportToolError` has NINE call sites in this file and SIX other modules take
  // it as a dep. The lowest thing that must see it is nothing in particular — it
  // is the SUM. `createTargeting` (~50 lines down) takes it and `digRadius`;
  // `createSegmentBrush` (~350) takes four members; `createVoidCast`,
  // `createAnalyzer`, `createFieldMachine`, `createRender` and `createCameraRig`
  // each take one to four. So this line sits as high as its own deps allow, and
  // since T3d Task 5 every one of its eight deps is either the substrate, a host
  // function declared far above, or an arrow.
  //
  // FIVE OF THE EIGHT DEPS ARE ARROWS, and they are the price of that height:
  // `field-targeting.ts`, `field-segment.ts`, `field-history-feed.ts` and
  // `field-view.ts` are all assembled BELOW this line, and this module reads back
  // out of all four. The `segment` pair is a real two-way edge — four members
  // out, `rebuildPreview` back — and it is broken exactly the way
  // `field-props.ts`'s `markPlacementsStale` breaks its own, because an arrow
  // body cannot run before the declaration it names.
  //
  // THE SIXTH ARROW IS `currentSelectionSpec`, AND THAT FORK IS NOW SETTLED. It
  // was a plain ref to a closure `const` declared two lines above this assembly,
  // and the marker here said Task 5 would either pin this line below
  // `createSelection` or spend one more arrow. It spent the arrow, on a count:
  // `field-selection.ts` takes `reportToolError` off THIS module and three cursor
  // verbs off `field-targeting.ts` (~50 lines down), so assembling it above this
  // line would have cost four forward arrows to save one. The module is built
  // where its last functions were instead, and this dep reaches down.
  const tool = createTool({
    substrate,
    // A SEVENTH forward arrow since T3d Task 6: this was a plain ref to a closure
    // `const` ~100 lines above, and `createWorld` is assembled 1,418 lines below.
    markDirtyWithNeighbors: (changed) => world.markDirtyWithNeighbors(changed),
    currentSelectionSpec: () => selection.spec(),
    notifyHistory: () => {
      historyFeed.notify();
    },
    cursorRay: (clientX, clientY) => targeting.cursorRay(clientX, clientY),
    computeTarget: (clientX, clientY) =>
      targeting.computeTarget(clientX, clientY),
    sliceOpts: () => viewState.sliceOpts(),
    rebuildSegmentPreview: () => {
      segment.rebuildPreview();
    },
  });

  // --- selection gestures + overlay ---------------------------------------
  //
  // TWENTY FUNCTIONS LEFT for `field-selection.ts` (2026-08-08, foundations T3d
  // Task 5) — the AABB derivation, the spec clone, the panel payload, the four
  // overlay rebuilds, the cell layer's build and teardown, both Esc rungs, the
  // two setters, the display refresh, the snap, the box gesture's three
  // functions and the click that drives them. Nothing stayed. The assembly is
  // ~100 lines down, where the last of them (`selectionClick`) was, on
  // `createSegmentBrush`'s precedent — a cluster's remaining footprint marks
  // where the cluster was — and it sits BELOW `createTargeting`, which is what
  // decided the arrow at `createTool` above.
  //
  // TWELVE OF THE TWENTY ARE PRIVATE THERE, including four that were reached
  // from OUTSIDE this cluster before the move (`setSelection`, `notifySelection`,
  // `refreshSelectionDisplay`, `syncSelectionCapture`). Their two callers were
  // `resetWorld` and the facade's `reselect`, and each wanted a STATEMENT GROUP
  // and its ORDER rather than the functions themselves — so they are
  // `selection.retireWorld()` and `selection.reselect()` now, one call each.
  // That is Task 4's `applyOrbit` rule applied a second time, and it is why a
  // 20-function row leaves an 20-verb seam rather than a 30-verb one.
  // --- the cursor chain (`field-targeting.ts`) -----------------------------
  //
  // Six functions and one `let` — client pixels → NDC → a world ray → the four
  // world answers a gesture can want from that ray, plus the last cursor position
  // every per-frame preview is a function of. The assembly sits HERE, where the
  // last of them was, on `createSegmentBrush`'s precedent: a cluster's remaining
  // footprint marks where the cluster was.
  //
  // The two view members arrive as ARROWS rather than plain refs, and that is the
  // one ordering fact worth carrying: `createView` is assembled ~540 lines BELOW
  // this line and the deps literal is eager, so a plain `viewState.sliceY` would
  // be a TDZ read. Same shape and same reason as the machine's
  // `noteReconfigureMs`. The alternative — assembling this below `createView` —
  // would have cost an arrow at `createSegmentBrush` instead, and that one is
  // read on every pointer move.
  //
  // `toNdc` did not survive the move as surface: it has one caller inside the
  // module and is private there now. The module's header argues the rest.
  const targeting = createTargeting({
    substrate,
    // The one arrow the camera rig's LOW assembly costs (see its block ~300
    // lines down): `cameraRig` is a `const` declared after this line, so the
    // thunk reaches forward. Called from `cursorRay`, i.e. on a pointer event
    // and never during construction.
    cam: () => cameraRig.cam(),
    digRadius: tool.digRadius,
    sliceY: () => viewState.sliceY(),
    sliceOpts: () => viewState.sliceOpts(),
    reportToolError: tool.reportError,
  });

  // --- segment brush (two-click swept capsule, D-F3-14) -------------------

  // The gesture's whole state and logic live in `field-segment.ts` — the first
  // cluster to leave this closure intact (`docs/reference/field-host-clusters.md`
  // measured it at eight external edges and ONE boundary mutation). What stays
  // here is the wiring, and its shape is the point: the two REASSIGNED bindings
  // travel as calls, not values. `digRadius` is moved by `applyRadius` and
  // `maskDropReported` is re-armed by the machine's stroke branch as well as by
  // the segment's own commit — either one handed over as a number or a boolean
  // would give the module a private copy that diverges silently the first time
  // its owner wrote to its own. The three constants are `const` here and travel
  // as values for the same reason read backwards.
  //
  // FOUR OF THE EIGHT MEMBERS NOW COME OFF ANOTHER MODULE, and the owner is no
  // longer this closure at all: `digRadius`, `reportToolError`, `commitToolOp`
  // and `armMaskDropReport` are `field-tool.ts`'s since 2026-08-08. The dep NAMES
  // did not change — which is the point of naming a dep for what it reads rather
  // than for who it reads from — so nothing inside `field-segment.ts` moved. The
  // edge also became two-way in the same change: that module's `rebuildPreview`
  // is what `applyRadius` calls, and it reaches back through an arrow at
  // `createTool` ~90 lines up, because this assembly is below it.
  const segment = createSegmentBrush({
    strokeMinMs: STROKE_MIN_MS,
    anchorCrossHalfM: ANCHOR_CROSS_HALF_M,
    maxSegmentM: MAX_SEGMENT_M,
    digRadius: tool.digRadius,
    selectionPoint: targeting.selectionPoint,
    reportToolError: tool.reportError,
    commitToolOp: tool.commitOp,
    armMaskDropReport: tool.armMaskDropReport,
    router,
  });

  // --- the selection (`field-selection.ts`) --------------------------------
  //
  // Nine bindings, twenty functions, twenty verbs on the seam. The state block
  // 567 lines up records what left (it read ~700 until T3d Task 6 deleted the
  // dirty-set and snapshot regions above this line); this is where the last of its functions
  // (`boxCorner` and `selectionClick`) were, on `createSegmentBrush`'s precedent.
  //
  // THE POSITION IS PINNED FROM ABOVE AND PINS TWO THINGS BELOW. From ABOVE:
  // four of the ten deps are refs onto `field-targeting.ts` (~70 lines up) and
  // `field-tool.ts` (~130 up), and `materials.selectionCell` is a third module's.
  // BELOW: `createEntities` takes `outline` as a plain ref and so may not rise
  // above this line — the ONE coupling the two clusters have, and the whole of
  // why the plan paired them (see either module's header for why they are two
  // modules anyway). `createAnalyzer`, `createCameraRig`, `createFieldMachine`
  // and `createRender` all take verbs off this seam too, but every one of those
  // is hundreds of lines further down and pinned harder by something else.
  //
  // TEN DEPS AND NOT ONE ARROW, which no other assembly in this file can say:
  // one substrate, one router, five refs onto sibling module seams and three
  // constants by value. It is the payoff of sitting low — the cluster's own
  // readers are all below it, so nothing here reaches forward, and the single
  // forward reach in the whole boundary is the `currentSelectionSpec` arrow at
  // `createTool`, which that block prices.
  //
  // THE THREE CONSTANTS travel by VALUE and stay declared at the top of this
  // file; the block that declares them argues why, and it is no longer the "two
  // owners-to-be" argument the migration markers carried.
  const selection = createSelection({
    substrate,
    router,
    selectionCellMat: materials.selectionCell,
    selectionPoint: targeting.selectionPoint,
    materialSeedVoxel: targeting.materialSeedVoxel,
    voidSeedVoxel: targeting.voidSeedVoxel,
    reportToolError: tool.reportError,
    selectionColor: SELECTION_COLOR,
    selectedColor: SELECTED_COLOR,
    anchorCrossHalfM: ANCHOR_CROSS_HALF_M,
  });
  // --- pointer pick (object selection) ------------------------------------
  //
  // The whole cluster left with `field-picking.ts` — the candidate build, the
  // occluder raycast, the arbitration and what a press DOES with the answer. Four
  // functions and no state; the seam is ONE verb, because each of the first three
  // had exactly one caller (the next one down) and the module made that pipeline
  // sayable.
  //
  // The assembly did NOT stay here, and the reason is ordering rather than
  // preference: the press interrogates the entity footprints, the gizmo hit-test,
  // the entity-selection setter, `viewState` and the advisor's `setSelectedFlag`,
  // all of which are declared BELOW this point, and the deps literal is eager.
  // Assembling it here would have cost five arrows to save two. (Three of the five
  // are `field-entities.ts`' since T3d Task 5, so the constraint is now "below
  // `createEntities`" rather than below three closure functions — same floor, one
  // name.) Search `const picking =`, ~600 lines down, immediately above the
  // machine that dispatches it.

  // The named-history feed (`field-history-feed.ts`): its channel, its change
  // signature and two of its three functions left, and no state stayed behind —
  // the second extraction of which that is true, after `stats`. The assembly sits
  // where those two functions were, on `createSegmentBrush`'s precedent — a
  // cluster's remaining footprint marks where the cluster was — rather than where
  // its channel was declared, which is above the `substrate` this record needs.
  //
  // The third function, `stepHistory`, STAYED and is untouched by this move. It
  // wears the cluster's name and belongs to none of it: it calls into five other
  // clusters and never names the history seam at all — its push arrives through
  // `notifyEntities`. See the module header.
  //
  // What left with it that the closure cannot get back: `FieldHost.subscribeHistory`
  // was the LAST of the host's thirteen `subscribe*` members that did work before
  // delegating. It recorded the change signature ahead of the channel's snapshot;
  // that line now lives inside `historyFeed.subscribe`, and the facade seam is a
  // one-line delegate like the other twelve.
  //
  // The forward reference here is the one that was already there, one module
  // further away since 2026-08-08: `commitToolOp` calls this feed, and it is
  // `field-tool.ts`'s now, so the call arrives through the `notifyHistory` arrow
  // in that module's deps record ~180 lines up rather than from a closure
  // function. Safe for the reason spelled out at the `createVoidCast` assembly
  // below — nothing between this closure's brace and its `return {` ever RUNS.
  // No hoist was needed: the one dep is `substrate`, assembled ~520 lines
  // above.
  const historyFeed = createHistoryFeed({ substrate });

  // --- the entity selection (`field-entities.ts`) --------------------------
  //
  // Eight bindings, ten functions, fourteen verbs on the seam. The state block
  // ~620 lines up records what left; this is where the cluster's first function
  // (`notifyEntities`) was, and it is the TOP of a window rather than a free
  // choice.
  //
  // THE WINDOW, both ends stated because they nearly closed. From ABOVE:
  // `createHistoryFeed` directly overhead (the entity tick carries the history
  // push) and `createSelection` ~100 lines up (the emphasis outline, the ONE
  // thing this module takes from that one). From BELOW: `createDrift` ~40 lines
  // down and `createCameraRig` ~200 down BOTH take `footprints` as a PLAIN REF,
  // and the rig's record carried a Task-5 migration marker for two
  // tasks saying exactly that — assemble this below either and the ref becomes an
  // arrow, with the rig's two `entities` thunks following it. Nothing forced the
  // choice inside the window, so it sits at the top of it.
  //
  // FOURTEEN DEPS SINCE T3d TASK 6, and the split is the shape a cluster read
  // from every direction makes: substrate + router, FIVE plain refs onto seams
  // above (`historyFeed.notify`, `selection.outline`, `targeting.cursorRay`,
  // `props.rebuild`, `tool.reportError`), ONE plain ref onto a module-scope
  // function this file imports (`randomStampSeed`), and SIX thunks reaching DOWN
  // — four into `field-machine.ts` (472 lines below; the gizmo's visibility asks
  // it three questions and the short-circuit order between them is preserved
  // verbatim) and two into `field-world.ts` (1,192 below).
  //
  // THE FIVE ENTITY VERBS CAME AFTER ALL, and the marker that sat here is the
  // reason this is a decision rather than an inheritance. It named four blockers
  // holding `setEntityFrozen`, `bakeEntity`, `deleteEntity`, `duplicateEntity`
  // and `listEntities` in the facade — `markDirtyWithNeighbors`, `table()`,
  // `props.rebuild()` and `machine.cancelSession()` — and said all four would
  // dissolve at Task 6 and that Task 6 must RE-DECIDE. They did and it did: the
  // first is `field-world.ts`'s verb, the second has ridden the substrate since
  // T3a, and the last two were already module verbs. The five bodies are
  // `field-entities.ts`'s now and the facade members are three-line delegates.
  // That module's header carries the merits (each verb had exactly ONE caller —
  // its own facade member — which is the test that separates them from
  // `stepHistory`, whose three callers include a listener), the arithmetic, and
  // why `randomSeed` is passed through this file rather than imported across two
  // extracted modules.
  const entities = createEntities({
    substrate,
    router,
    // `world`'s counter, and a thunk onto `field-world.ts`' seam rather than over
    // a host `let` since T3d Task 6. Still a call for the obvious reason and for
    // a specific one: `createWorld` is assembled 1,192 lines BELOW this line, so
    // a value would not merely fork, it would be a TDZ read.
    worldEpoch: () => world.epoch(),
    notifyHistory: historyFeed.notify,
    selectionOutline: selection.outline,
    cursorRay: targeting.cursorRay,
    gesture: () => machine.gesture(),
    session: () => machine.session(),
    moveDrag: () => machine.moveDrag(),
    // The five verbs' dependencies. Two reach forward, and both are the reason
    // the arrows exist rather than plain refs: `field-world.ts` and
    // `field-machine.ts` are assembled below this line.
    markDirtyWithNeighbors: (changed) => world.markDirtyWithNeighbors(changed),
    cancelSession: () => machine.cancelSession(),
    rebuildProps: props.rebuild,
    reportToolError: tool.reportError,
    randomSeed: randomStampSeed,
  });
  // The reconfigure-drift report's three functions went with its slot to
  // `field-drift.ts`. The assembly could not stay here — `driftedEntities` reads
  // the entity footprints, and the module that owns them is assembled directly
  // above — so it sits just past the entity assembly instead; search
  // `const drift =`. (Until T3d Task 5 the thing it could not rise above was a
  // closure `const` ~60 lines below this point; the constraint is the same one at
  // a new address.)
  // --- the reconfigure-drift report (`field-drift.ts`) ---------------------
  //
  // The slot, its panel channel and its three functions. The map called this row
  // a RESULT SLOT and not a cluster (§3.3) because all four writes to it come
  // from elsewhere — and that is exactly why it looked like state that had to stay
  // in the closure. Its READERS decided instead: there are two and both went with
  // it, so the four writers share a two-verb seam (`set` then `notify`, in that
  // order, because notifications go last).
  //
  // The position is FORCED and this is the line that says by what:
  // `driftedEntities` derives the touched-entity badges from the entity footprint
  // memo, which is `field-entities.ts`' since T3d Task 5 and assembled directly
  // above — so this cannot rise back to where the cluster's functions were ~180
  // lines up. Everything that READS it — the machine's apply, `stepHistory`,
  // `resetWorld`, and the facade's `subscribeDrift`/`dismissDrift` — is below.
  const drift = createDrift({
    substrate,
    entityFootprints: entities.footprints,
  });
  // --- what the camera can be put ON (`field-camera-rig.ts`'s two callers) ---
  //
  // The framing VERBS left with the rig — `orbitPivot`, `frameTargetBox`,
  // `frameCameraOn`, `frameSelection`, `frameWorld` and `snapView` all sat here,
  // which is why the assembly a few lines down is where it is. The two `world`
  // functions they read, `chunkSetBox` and `occupiedTopYOf`, sat here too until
  // 2026-08-08 (foundations T3d Task 6) and are `field-world.ts`'s now. The split
  // they were kept apart for is unchanged and is now spelled across a boundary:
  // the box arithmetic is the world's and the FRAMING is the camera's, so the rig
  // takes a box and a ceiling rather than a store (§2.7's rule, the one that kept
  // `orbitState` out of `field-analyzer.ts`).
  //
  // Both framing verbs CUT rather than tween, and deliberately: the host has no
  // camera animation and adding one would need a per-frame tween arbitrating with
  // the fly keys, the look drag, the wheel and a live move's anchor — every one
  // of those an interruption rule of its own. It would also have to honour
  // `prefers-reduced-motion`, which the host cannot read (it touches no `window`;
  // the CHROME can). `frameChunks` has always cut, so cutting is also what keeps
  // the editor's two framing verbs behaving the same way.

  // --- the camera rig (`field-camera-rig.ts`) -------------------------------
  //
  // The whole cluster: eight bindings, fourteen functions, twenty-two verbs on
  // the seam. The state block ~1,100 lines up records what left; this is where
  // its six framing functions were, on `createSegmentBrush`'s precedent (a
  // cluster's remaining footprint marks where the cluster was).
  //
  // THE POSITION IS PINNED FROM ONE SIDE SINCE T3d TASK 6, and the side it lost
  // is the upper one. It used to be pinned from BOTH — `occupiedTopYOf` directly
  // overhead and `chunkSetBox` above it were `world`'s and are read by
  // `frameWorld` — but both left with `field-world.ts`, whose assembly is 1,083
  // lines BELOW this line, so those two deps became forward arrows and stopped
  // constraining anything. What still holds from ABOVE is `createEntities` ~200
  // lines up and `createSelection` ~300 up, which own three of the nine. From
  // BELOW: `createAnalyzer` ~290 down takes `frameOn`, `createFieldMachine` takes
  // four look-drag members, and `createRender` takes the eye — so this line may
  // not sink past the first of those.
  //
  // TWO FORWARD arrows — that is a count of the arrows pointing DOWN, not of the
  // record, which since T3d Task 5 is 2 forward + 1 composed arrow + 1 plain ref
  // to a host arrow + 5 module refs = 9 (the module's own `CameraRigDeps` doc
  // carries the same split and is the authority; it was 2/2/2/2/1 before Task 5
  // gave `selection` and `entities` owners, and nothing inside that file moved).
  // Both forward ones reach
  // `field-machine.ts` ~400 lines below, for the reason every arrow in this file
  // has: the literal is eager, and a body is not. `reaimMove` is called from
  // `applyOrbit`, which is to say from every path that turns the camera;
  // `gesture` from the orbit pivot alone.
  //
  // NO SUBSTRATE, which is a first for an extracted cluster here. `frameWorld`'s
  // two world facts arrive as `worldBox()` and `occupiedTopY()` — a box and a
  // ceiling, not a store — because what the camera wants to know is where the
  // world IS, and re-deriving that inside the rig would put a second copy of
  // `chunkSetBox`'s arithmetic behind a boundary. Same shape for `selectionBox`,
  // which collapsed the two reads `frameTargetBox` used to make (`selection` +
  // `selectionAabb`) into the one answer it wanted: the null cases are
  // indistinguishable to a framing verb. Since T3d Task 5 that composition lives
  // inside `field-selection.ts` and this dep is a plain ref, which is the rule
  // working as intended — the rig asked for a box and never learned what a
  // selection is.
  const cameraRig = createCameraRig({
    reaimMove: () => {
      machine.reaimMove();
    },
    gesture: () => machine.gesture(),
    // THE THREE `entities` DEPS ARE ALL PLAIN REFS NOW (T3d Task 5), and the
    // constraint the marker here carried for two tasks was honoured rather than
    // paid off: `createEntities` is assembled ~200 lines ABOVE this line, which
    // is what lets `footprints` stay a plain ref — and the two former thunks
    // became refs with it, since a module verb needs no wrapper. This record was
    // the one most exposed to Tasks 5–6; two `world` deps remain.
    gizmo: entities.gizmo,
    selectedEntityId: entities.selectedId,
    entityFootprints: entities.footprints,
    // ONE REF WHERE A COMPOSED ARROW WAS. It read `selection` and then called
    // `selectionAabb` on it; `field-selection.ts` publishes the BOX, because the
    // two nulls (nothing selected / selected but unbounded) are indistinguishable
    // to a framing verb. §2.7's argument-vs-dependency rule, and this dep is the
    // rule's worked example.
    selectionBox: selection.box,
    // THE MARKER'S PREDICTION HELD, AND IT COST ONE ARROW MORE THAN IT PROMISED.
    // It said `chunkSetBox` and `occupiedTopYOf` would "become refs onto
    // `world`'s seam and this arrow collapses to one" when that cluster left. The
    // COLLAPSE happened — `worldBox()` is `field-world.ts`'s own verb now, so this
    // file no longer spells the store read — but neither dep is a plain REF,
    // because `createWorld` is assembled 1,083 lines BELOW this line rather than
    // above it (its position is decided by an arrow count; see the dirty-set
    // block ~450 lines up). Both are forward thunks instead, which is this file's
    // standard mechanism and is why the rig's upper bound is one constraint
    // lighter than it was.
    worldBox: () => world.worldBox(),
    occupiedTopY: () => world.occupiedTopY(),
    reportToolError: tool.reportError,
  });

  // --- chunk snapshots + the stamp-preview snapshot ------------------------
  //
  // `snapshotChunks`, `chunkCopy` and `snapshotAllChunks` all sat here and all
  // three left with `field-world.ts` on 2026-08-08 (foundations T3d Task 6).
  // Their three consumers reach them across the boundary now, and each is a
  // one-line forward arrow on the assembly below: `createVoidCast` takes
  // `snapshotAllChunks` and `chunkOrigin`, `createAnalyzer` takes `chunkCopy`,
  // and `createFieldMachine` takes `snapshotChunks` and `chunkOrigin`.

  // --- void cast (D-F3-15) -------------------------------------------------

  // The X-ray's whole state and logic live in `field-voidcast.ts` — the cluster
  // `docs/reference/field-host-clusters.md` §7.4 picked as the first to leave
  // (zero mutation edges in either direction, zero `FieldHost` members), and the
  // first consumer of the substrate assembled at the top of this closure.
  //
  // What stays here is the wiring, and it is short because the cluster's DATA
  // was already substrate: the meshes `renderScene` draws ARE the module's, one
  // Map shared by identity, and the only fact anything else ever read off the
  // cluster is the in-flight generation `tick` turns into
  // `FieldStats.voidCastPending` — `voidcast.jobGen()` below.
  //
  // TWO OF THE FOUR NON-SUBSTRATE DEPS BECAME ARROWS AT T3d TASK 6.
  // `snapshotAllChunks` and `chunkOrigin` were plain refs to closure `const`s
  // declared just above this line; both are `field-world.ts`'s now and that
  // module is assembled 976 lines BELOW, so both reach forward. The other two
  // (`reportToolError`, `voidCastMaterial`) are still plain refs onto seams above.
  // The old argument for the refs — a `const` arrow this closure never reassigns
  // cannot fork under a value copy — is unchanged and now belongs to the module
  // that owns them.
  //
  // THE FORWARD-REFERENCE INVARIANT, stated here once because every later
  // extraction lands in this same region and inherits it.
  //
  // This binding is USED ABOVE where it is DECLARED: `field-world.ts`'s density
  // choke point calls `voidcast.invalidate()` through this record, and the world
  // module is assembled below. That is legal, and until T3d Task 6 it was also
  // FORCED — the caller was a closure function ~800 lines up and
  // `snapshotAllChunks` was declared just above, so the construction could move
  // in neither direction. Now that both ends are modules the constraint is one
  // arrow rather than a wall, but the invariant it rests on is the same one and
  // is what makes every arrow in this file safe:
  //
  // What makes it safe is a property of the whole closure, not of this line: the
  // body contains NO executed statements at closure level. Every top-level line
  // between `createFieldHost(`'s brace and `return {` is a `const`/`let`
  // declaration or a continuation of one — no bare calls, no `if`/`for`/`try`,
  // no `function` declarations (re-verified 2026-08-06 by the rule in
  // `docs/reference/field-host-clusters.md` §2). So nothing between the two
  // points can RUN during construction, and a forward reference from inside a
  // function body cannot be evaluated before its declaration executes. The one
  // near-miss worth naming: a `createViewChannel` snapshot thunk does not run at
  // construction either — `view-channel.ts` reads `opts.snapshot` inside
  // `subscribe`, never in the factory.
  //
  // THE TDZ HALF, stated here once for the same reason and NOT repeated at each
  // of the fourteen sites that rely on it (T3d Task 6 added this paragraph, when
  // `field-world.ts` became the second module assembled below most of its own
  // consumers). A forward reference is safe only from inside a body. The same
  // dep written as a VALUE — `chunkCopy: world.chunkCopy` rather than
  // `(d) => world.chunkCopy(d)` — is read EAGERLY by the object literal, and for
  // a binding declared below it that is a TDZ `ReferenceError` at construction,
  // so no host builds at all. `field-entities.ts`' header has this measured:
  // value-snapshotting `worldEpoch` reddened 260 tests across 24 files, and the
  // mechanism was the TDZ rather than the staleness THE LAW is usually justified
  // by. So THE LAW has two independent teeth on every forward dep, and only one
  // of them is subtle; every `() => world.*` arrow below this line has both.
  //
  // THE RULE THAT FOLLOWS: do not add an executed statement at closure level.
  // One bare call placed in this gap turns every forward reference here into a
  // `ReferenceError` at host construction — which no type check catches, and
  // which every test would catch at once.
  const voidcast = createVoidCast({
    substrate,
    reportToolError: tool.reportError,
    snapshotAllChunks: () => world.snapshotAllChunks(),
    chunkOrigin: (cx, cy, cz) => world.chunkOrigin(cx, cy, cz),
    voidCastMaterial: materials.voidCast,
  });

  // The layer flags + the slice plane (`field-view.ts`). Named `viewState`, not
  // `view`: three render functions take a `camera.Camera` parameter called
  // `view`, and one of them reads this binding fourteen times.
  //
  // The position is FORCED, and by an edge the closure map does not have. Both
  // deps are `voidcast`'s own verbs — `ret.setLayers` has always driven the
  // X-ray's on/off edge — so this line cannot rise above the assembly directly
  // over it. The map records `view`'s only outbound edge as `world.dirty`,
  // because a cross-cluster CALL is not a data edge (§2.1); making the two verbs
  // constructor deps is what turns the omission into something the compiler
  // enforces. The cluster's own state block, ~1,780 lines up, says where it went.
  //
  // What still READS this from ABOVE is a forward reference from inside a
  // function body — the arrow pair the `createTargeting` assembly hands
  // `field-targeting.ts`, and the `sliceY` dep the `createWorld` assembly below
  // hands the remesh, which was a direct read from `remeshOne` in this closure
  // until T3d Task 6 — which is safe for the reason spelled
  // out at the `createVoidCast` assembly above: nothing between this closure's
  // brace and its `return {` ever RUNS, so no function body can be evaluated
  // before this declaration executes. No hoist was needed, and none was taken.
  // Two modules read it from BELOW and so do not forward-reference at all:
  // `field-picking.ts`, whose assembly is deliberately under this line, and
  // `field-render.ts` since T3d Task 3 — which took `renderScene` and its
  // fourteen `layers` sites out of this file entirely, so the densest reader of
  // this binding is now a plain `layers: viewState.layers` on a deps record.
  const viewState = createView({
    substrate,
    discardVoidCast: voidcast.discard,
    requestVoidCast: voidcast.request,
  });

  // `worldEpoch` — the counter bumped by every world reset, which retires any
  // stage-2 verdict still in flight — is `field-world.ts`'s own state since
  // 2026-08-08 (foundations T3d Task 6). It was declared on this line, directly
  // above the assembly below, and the migration marker that
  // sat on it offered this task two forks: put the declaration back BELOW the
  // assembly, or move the epoch into `world`'s module and let both readers take
  // its getter. It took the second, so THE HOIST IS UNDONE BY DELETION — there is
  // no declaration left to place.
  //
  // The cycle the marker warned about is real and is open in the one direction
  // that works: `world.reset()` calls `advisor.retireWorld()` while the advisor
  // reads the counter back, and `createWorld` is assembled 825 lines BELOW
  // `createAnalyzer`, so the advisor's `worldEpoch` dep is the LAZY side. Both
  // extracted readers now spell it `() => world.epoch()` — this assembly's, and
  // `createEntities`' ~300 lines up. The substrate was never widened for it,
  // which is the other half of what both markers asked: `field-analyzer.ts`'s bar
  // note had this binding qualifying on reader count and refusing on ownership,
  // and ownership is exactly what Task 6 gave it.

  // --- walkability advisor (D-F4-9) — `field-analyzer.ts` ------------------
  //
  // The analyzer worker holds a MIRROR of this store: every density write is
  // copied across, and stage 1 re-runs over the chunks whose answer could have
  // changed. ADVISORY throughout (D-F4-1) — nothing it reports blocks a verb,
  // mutates the field, or fixes anything. It draws markers and fills a list.
  //
  // The whole cluster left on 2026-08-07 (foundations T3d): 18 of its 19 state
  // bindings, all 14 of its functions, the worker handle, the flags channel and
  // four module-scope constants. The nineteenth binding is `flagStore`, ~1,940
  // lines up, and the verdict recorded at its declaration is that it CANNOT
  // travel — it is a substrate value member, and the substrate is assembled above
  // every module that could own it.
  //
  // Named `advisor` and not `analyzer`: `analyzer` was the worker CLIENT's
  // binding for the whole of this cluster's life in this closure, and the module
  // is the walkability ADVISOR the prose here has always called it — the worker
  // is one thing it holds, now its own private state.
  //
  // ITS SEAM IS BIGGER THAN THE CLUSTER'S FUNCTION COUNT, which is the fact worth
  // carrying forward: 18 verbs against 14 functions and 6 facade members. The
  // extra ones are the closure map's 14 inbound MUTATION edges — bare assignments
  // into these flags from `world`, `lifecycle` and `props` — every one now a call
  // named for the ACT it performs, on `markPlacementsStale`'s precedent.
  // `picking` went the other way two tasks ago (4 functions, ONE verb). A row's
  // function count measures the cluster; what its neighbours WRITE into it
  // measures the seam.
  //
  // THE POSITION IS FORCED from above and constrains what sits below. Above:
  // `chunkCopy` is a dep and is declared ~210 lines up, so this cannot rise past
  // it — the `createVoidCast` shape exactly. Below: `createPicking` and
  // `createStatsMeter` both take verbs of this module as PLAIN refs, so neither
  // may be assembled above this line, and each says so at its own end.
  //
  // THIS LINE IS BECOMING THE CLOSURE'S ORDERING PIVOT, and the remaining tranche
  // tasks each add a constraint to it rather than relieving one. Stated once here
  // instead of discovered three more times:
  //
  //   - `field-render.ts` JOINED THE BELOW LIST on 2026-08-08 (T3d Task 3): it
  //     takes `advisor.markerMesh` and `advisor.selectionBatch` as plain refs, so
  //     three modules may not rise above this line.
  //   - `field-materials.ts` JOINED THE ABOVE LIST the same day, and it is the
  //     dep two lines below that says so: `flagMarkerMat: () => flagMarkerMat`
  //     became `materials.flagMarker`, which pins `createMaterials` above this
  //     assembly. It sat ~1,500 lines up already, so the constraint cost nothing
  //     — but it is now checked by the compiler rather than by luck.
  //   - Task 6 (`world`) was the one that was not merely an ordering fact, and it
  //     RESOLVED IN THIS DIRECTION: `world.reset()` calls into this module and
  //     this module reads `world`'s epoch, a cycle no ordering can break — only
  //     laziness on one side can. `createWorld` is assembled 825 lines BELOW
  //     this line, so the `worldEpoch` dep two lines down is that lazy side, and
  //     the counter itself left the closure with its owner. The note that used to
  //     sit at its declaration is now the block ~110 lines up, where the
  //     declaration was.
  //
  // A cluster with eight inbound callers and eight outbound deps ends up here by
  // arithmetic, not by accident. It is the argument for extracting it EARLY, which
  // is what this task did.
  //
  // What reads `advisor` from ABOVE is now ONE thing — the `createProps` seam's
  // `markPlacementsStale` arrow, ~570 lines up. The density choke point was the
  // other, and it left with `field-world.ts` at T3d Task 6, which reads this
  // module through its own deps record from BELOW instead. The arrow that remains
  // is a forward reference from inside a function body, which is safe for the
  // reason spelled out at the `createVoidCast` assembly: nothing between this
  // closure's brace and its `return {` ever RUNS.
  //
  // `frameCameraOn` and `selectionOutline` are the two deps that are not what
  // they look like. Each names an ACT of another cluster rather than a binding —
  // the camera's frame-on-a-box, and what "this is selected" is drawn as — so
  // `orbitState`, `aimCamera`, `applyOrbit`, `aabbEdgeBatch` and `SELECTED_COLOR`
  // all stayed with their own clusters rather than crossing into the advisor. The
  // module's header argues that trade; the short version is that the advisor knows
  // WHICH box, not how a camera frames one or what colour selected is.
  //
  // BOTH HALVES HAVE NOW COLLECTED, which is what the naming was for.
  // `frameCameraOn` became `cameraRig.frameOn` at Task 4 and `selectedBoxOutline`
  // became `selection.outline` at Task 5 — each found by grepping its own
  // cluster's names, each still a plain ref, and neither cost this module a line.
  // What the pair proves is the rule stated below: a dep named for an ACT survives
  // the act changing address.
  //
  // Both were PLAIN REFS to named closure functions, and that was deliberate
  // rather than incidental: each was the second caller of a function that already
  // had one (`frameSelection` and the entity footprint box), so the act each names
  // was greppable BY NAME from its owning cluster. Written inline as arrows here
  // they would have been two anonymous bodies a thousand lines from their twins.
  //
  // BOTH ARE MODULE REFS NOW and both PIN this assembly: `cameraRig.frameOn`
  // below `createCameraRig` (~290 lines up, 2026-08-08) and `selection.outline`
  // below `createSelection` (~590 up, T3d Task 5). That is two more constraints on
  // a line that already had four — and neither is the binding one: this line's
  // real floor is `createMaterials`, and every one of the six is slack.
  const advisor = createAnalyzer({
    substrate,
    spawnAnalyzer: deps?.spawnAnalyzer,
    reportToolError: tool.reportError,
    chunkCopy: (density) => world.chunkCopy(density),
    flagMarkerMat: materials.flagMarker,
    worldEpoch: () => world.epoch(),
    frameCameraOn: cameraRig.frameOn,
    selectionOutline: selection.outline,
  });

  // --- the pointer pick (`field-picking.ts`) -------------------------------
  //
  // Assembled HERE rather than where its four functions were ~600 lines up, and
  // the position is forced from both sides: SIX of its eleven deps come off
  // modules assembled between there and here — FOUR off `field-entities.ts`
  // (`entityFootprints`, `gizmoAxisAt`, `selectedEntityId`, `setSelectedEntity`),
  // `setSelectedFlag` off `field-analyzer.ts` and `sliceOpts` off `field-view.ts`
  // (whose `layers` is the seventh but was already above) — and the machine
  // directly below takes `press` as a plain ref. So the pair's one unavoidable
  // arrow pair points DOWN from here into the machine, which is the cheaper
  // direction — two members rather than six.
  //
  // `advisor` is the newest of those six and the one that pins this line hardest
  // (foundations T3d, 2026-08-07): `setSelectedFlag` is taken as a PLAIN ref off
  // an extracted module, so this assembly cannot rise above `createAnalyzer`. It
  // is also an edge the closure map never counted — a cross-cluster CALL is not a
  // data edge (§2.1's second correction), so the `analyzer` row's read-by list
  // does not name the viewport's marker click at all.
  //
  // The two arrows are the only entries that are not what they look like:
  // `beginMove` and `setPendingMove` name verbs of a module that does not exist
  // yet on this line. Everything else is a PLAIN REF — eight onto sibling module
  // seams and `capturePointer` onto a closure `const` arrow. **There is no thunk
  // over a host `let` left in this record**: the last two were `selectedEntityId`
  // and `entityFootprints`, and T3d Task 5 gave them an owner. `field-picking.ts`'
  // own header carries the same count.
  const picking = createPicking({
    substrate,
    layers: viewState.layers,
    sliceOpts: viewState.sliceOpts,
    cursorRay: targeting.cursorRay,
    entityFootprints: entities.footprints,
    gizmoAxisAt: entities.gizmoAxisAt,
    selectedEntityId: entities.selectedId,
    setSelectedEntity: entities.select,
    setSelectedFlag: advisor.setSelectedFlag,
    beginMove: (entityId, axis, grabbed, press) =>
      machine.beginMove(entityId, axis, grabbed, press),
    setPendingMove: (next) => {
      machine.setPendingMove(next);
    },
    capturePointer,
  });

  // --- the session + gesture machine (`field-machine.ts`) ------------------
  //
  // The stamp session, the reconfigure session, the move that rides one, the
  // armed-gesture slot, the pending-stamp arm and (since T3c) the pointer chain
  // that arbitrates between them, as **56 top-level declarations** inside
  // `createFieldMachine` — 12 mutable state slots, 2 view channels, 3 Esc rungs,
  // 1 preview coalescer and 38 functions. They used to thread this file from the
  // state block ~1,460 lines up to the pointer handlers ~400 lines down. The
  // assembly sits HERE, where the bulk of them were, on `createSegmentBrush`'s
  // precedent — a cluster's remaining footprint marks where the cluster was.
  //
  // (The composition is stated rather than the bare total because a bare total is
  // the same hand-maintained tally the Esc-stack comment above just stopped
  // keeping. This one is re-derivable in one command — the range is what makes it
  // honest, since a bare file-wide grep also catches the two module-scope helpers
  // above the factory:
  // `awk '/^  const { substrate } = deps;/,/^  return {/' field-machine.ts | grep -cE "^  (const|let) "`
  // , minus the `deps` destructure the range opens on.)
  //
  // §7.5 of the closure map called this the WORST available extraction and it was
  // right about why (13 partner clusters, 45 cross-cluster edges, a slot shared
  // three ways). What it also said is what made it affordable now: the substrate
  // and the capture STACK had to exist first, and they do. The 45 edges land as
  // one record plus 39 named deps — 22 for the sessions, 17 more for the pointer
  // chain, and that second group is a MEASUREMENT of what the seven-way
  // arbitration was reaching for rather than a cost the move added: those calls
  // were being made either way, from a handler ~390 lines below the state it was
  // reading. The 14 `cancelStampSession` call sites land as
  // `machine.cancelSession()` — the teardown edge §7.5 said had to be inverted
  // into a callback, inverted.
  //
  // THE FORWARD-REFERENCE INVARIANT applies to this line exactly as it does to
  // the `createVoidCast` assembly ~260 lines up, and this is the assembly that
  // leans on it hardest. THREE EXTRACTED modules assembled above reach down into
  // it through arrows in their own deps records — `field-picking.ts` with two,
  // `field-camera-rig.ts` since 2026-08-08 with `reaimMove` and `gesture`, and
  // `field-entities.ts` since T3d Task 5 with `gesture`, `session` and `moveDrag`.
  // NO closure function reaches in from above any more, which is new at Task 5:
  // `gizmoVisible` and `activeGizmoAxis` were the last two doing it directly from
  // inside their bodies, and the camera pair (`applyOrbit`, `orbitPivot`) was the
  // same story one task earlier. Safe either way
  // because nothing between this closure's brace and its `return {` ever RUNS —
  // see that comment for the whole argument,
  // and for the rule it implies (do not add an executed statement at closure
  // level).
  //
  // The object literal itself IS eager, which is what decides the position: every
  // plain function ref below has to be declared above this line, and the one that
  // is not — `stats.noteReconfigureMs`, constructed ~280 lines down — is the one
  // member wrapped in an arrow.
  const machine = createFieldMachine({
    substrate,
    router,
    archetypes: () => archetypes,
    // The two facts a stamp needs off the CURRENT selection, as one call. `null`
    // covers both "nothing selected" and "selected, but no bounds" — `startStamp`
    // arms region-draw for either, so one null says what two branches used to.
    // The composition moved INTO `field-selection.ts` at T3d Task 5 (it read the
    // slot and then called the AABB helper, and neither is surface now); this is
    // the second of that record's two composed arrows to collapse to a ref, after
    // the rig's `selectionBox`.
    selectionRegion: selection.region,
    reportToolError: tool.reportError,
    // THREE FORWARD ARROWS SINCE T3d TASK 6, all onto `field-world.ts`'s seam
    // (720 lines below) and all three plain refs to closure `const`s before it.
    markDirtyWithNeighbors: (changed) => world.markDirtyWithNeighbors(changed),
    snapshotChunks: (region) => world.snapshotChunks(region),
    chunkOrigin: (cx, cy, cz) => world.chunkOrigin(cx, cy, cz),
    stampGhostMaterial: materials.stampGhost,
    cursorRay: targeting.cursorRay,
    boxCorner: selection.boxCorner,
    setBoxAnchor: selection.setBoxAnchor,
    setSegmentAnchor: segment.setAnchor,
    entityRecord: entities.record,
    entityFootprints: entities.footprints,
    rebuildEntitySelectionBatch: entities.rebuildOverlay,
    revalidateEntitySelection: entities.revalidate,
    rebuildProps: props.rebuild,
    notifyEntities: entities.notify,
    // An ARROW, alone among the function members, because `field-stats.ts` is
    // constructed ~280 lines below this one and the literal is eager. Same shape
    // as the forward reference `applyReconfigureSession` made when it lived here.
    noteReconfigureMs: (ms) => stats.noteReconfigureMs(ms),
    // The report is `field-drift.ts`'s since T3d, so the apply gets that module's
    // two verbs rather than a write-thunk over a closure `let`. Still TWO, not
    // one, because the ordering is load-bearing: every piece of host state
    // settles, then the notifications go — the module's header argues it.
    setDrift: drift.set,
    notifyDrift: drift.notify,
    // The pointer chain's deps (T3c). Every one is a VERB the chain dispatches
    // to, or the liveness of a state whose overlay stays here — the arbitration
    // is the machine's, the actions are ours.
    //
    // Plain refs except for ONE, and the one is `strokeMinMs` — a module `const`
    // travelling as a value, which is the same rule the rest of this record obeys
    // read backwards. It was THREE until the clusters caught up: `looking` and
    // `boxAnchor` read host `let`s and had to be thunks so the machine could not
    // hold a copy of a fact that moves, and both are plain refs onto a module seam
    // now (`cameraRig.looking` at T3d Task 4, `selection.boxAnchor` at Task 5).
    strokeMinMs: STROKE_MIN_MS,
    capturePointer,
    releasePointer,
    looking: cameraRig.looking,
    beginLook: cameraRig.beginLook,
    lookDrag: cameraRig.lookDrag,
    endLook: cameraRig.endLook,
    eyedropper: tool.eyedropper,
    applyTool: tool.apply,
    armMaskDropReport: tool.armMaskDropReport,
    pointerPress: picking.press,
    selectionClick: selection.click,
    segmentClick: segment.click,
    segmentAnchor: segment.anchor,
    segmentUpdatePreview: segment.updatePreview,
    boxAnchor: selection.boxAnchor,
    updateBoxPreview: selection.updateBoxPreview,
  });

  // --- history ------------------------------------------------------------

  // ONE undo/redo step, shared by the canvas ⌘Z/⇧⌘Z binding and the public
  // undo()/redo(). Everything a step can move is refreshed here, not at the
  // call sites: the chunks it dirtied, the entity list (a commit, a reconfigure
  // splice and a freeze/bake record swap all ride these stacks — and the last
  // two dirty NOTHING, so a remesh cannot be the panel's signal), and the entity
  // selection (a reconfigure can have moved the footprint it outlines, and
  // undoing a commit removes the entity outright — the selection has to go with
  // it, notifying whoever holds it).
  //
  // THIS FUNCTION IS DECLARED FACADE-RESIDENT, and T3d Task 5 is where that
  // verdict was owed rather than assumed. `field-history-feed.ts` took the
  // cluster's channel, its change signature and two of its three functions in
  // 2026-08-06 and left this one; that module's header says why (it never NAMES
  // the history seam — its push arrives through the entity tick — and it calls
  // into five other clusters), and the closure map's `history` row calls it "a
  // lifecycle verb wearing a history name". Task 5 is the moment to settle it,
  // because after this task every one of those five clusters is a MODULE and the
  // "it belongs to none of it" argument could have been read the other way: a
  // function with no state of its own could just be moved.
  //
  // It stays, on three counts.
  //   - WHAT IT WOULD COST THE FEED. `createHistoryFeed`'s deps record is
  //     `{ substrate }` — the shortest in the tranche and the only one with
  //     nothing beside the substrate in it. Taking this body would give it six
  //     verbs of other modules' business (`markDirtyWithNeighbors`,
  //     `machine.cancelSession`, `entities.revalidate`, `props.rebuild`,
  //     `drift.standing`/`set`/`notify`, `entities.notify`) and make the thing
  //     that publishes a history signature also the thing that cancels sessions
  //     and rebuilds the prop layer.
  //   - WHAT IT IS. Six of its seven statements are calls into six different
  //     places and it owns no state at all. That is what a FACADE verb is — the
  //     `input` listeners are the other instance of the shape, and both are
  //     declared rather than left over.
  //   - WHO CALLS IT. All three callers are facade-resident and cannot move:
  //     `onKeyDown`'s ⌘Z/⇧⌘Z branch (the listener owns the canvas element) and
  //     the two public methods.
  // The only thing it touched that was NOT on the substrate was
  // `markDirtyWithNeighbors`, which is `world`'s and is a CALL rather than a read
  // — `store`, `log` and `table` are all substrate members, so an earlier draft of
  // this sentence claiming "one remaining read of host state" was true only under
  // a reading it did not state. T3d Task 6 TOOK THAT TARGET with `world`, which
  // was the first of the two forks this note offered, so this body is now exactly
  // what the verdict describes: a pure composition of SEVEN module calls over
  // substrate reads, owning nothing. Recorded in the map's `history` row.
  const stepHistory = (redo: boolean): void => {
    const dirtied = redo
      ? field.redo(store, log, table)
      : field.undo(store, log);
    world.markDirtyWithNeighbors(dirtied);
    // NO live session survives the log moving under it. Both halves are wrong and
    // the quiet one is worse: an undone COMMIT leaves the session naming an entity
    // that is gone and Apply fails outright with core's `unknown entity N`; an
    // undone RECONFIGURE leaves it naming an entity whose region the step just
    // replaced, and Apply then silently re-lands the placement the user undid.
    //
    // This was scoped to MOVES until T3c, on the reasoning that a `G` grab is the
    // one modal state where the canvas necessarily has focus, so ⌘Z-under-a-move
    // was the reachable case. The exposure was always wider — a reconfigure opened
    // from the Entities row leaves an enabled Apply on the session card, and the
    // card is not the canvas — and the blanket rule is the one this file already
    // applies twice over, at `resetWorld` and `setMaterialTable`: a session whose
    // inputs moved must not be left offering an Apply that would build something
    // its ghost never showed. A history step is the same class of event.
    machine.cancelSession();
    entities.revalidate();
    // A step can add or remove placement ops (a scatter commit, a reconfigure
    // splice) and dirties NO chunk for them — placements write no cells — so the
    // prop layer cannot ride the remesh drain the way chunk state does.
    props.rebuild();
    // A standing drift report describes the LAST reconfigure's replay against
    // a log this step just rewrote — stale in either direction (F3a gate
    // finding: ⌘Z left the list up). Cleared, never recomputed; the load-path
    // clear (loadWorld) shares the rationale. An already-null report is not
    // re-notified.
    if (drift.standing()) {
      drift.set(null);
      drift.notify();
    }
    entities.notify();
  };

  // --- render loop --------------------------------------------------------
  //
  // The brush's announce + momentary derive (`notifyTool`, `deriveMomentary`)
  // and the fly step (`applyFlyMove`) all stood here and all three left on
  // 2026-08-08 — the first two private inside `field-tool.ts`, the third as
  // `cameraRig.flyStep(dt)`, called from `tick` below. The fly step is the one
  // worth a line: it is RMB-GATED (D-10), which is what buys the editor its whole
  // bare-letter budget, and the gate reads the LOOK slot, so it could only ever
  // have gone where that slot went.

  // The frame, lifted out whole (`field-render.ts`): the light list, this frame's
  // ghost state, the ghost's lines, the cursor affordance and the draw-list build
  // itself, plus the reference grid's two batches and the ghost cube's two scratch
  // vectors. NOTHING of it stayed — like `field-stats.ts` and unlike the seven
  // extractions that left a container behind, this cluster shared no state with
  // the substrate, because nothing outside it ever read its own five bindings.
  //
  // FIVE FUNCTIONS OUT, ONE VERB ON THE SEAM, and a deps record of twenty-nine.
  // That is `field-picking.ts`'s shape at four times the width: the four helpers
  // each have exactly one caller — the fifth — and the fifth has exactly one, the
  // `tick` directly below. So the interface is `render.scene(c, cam)` and the
  // COST of this extraction is entirely in what the frame has to be handed.
  //
  // THE POSITION IS FORCED FROM ABOVE. The twenty-six module refs in the literal
  // below are drawn from TEN files — `selection` 5, `machine` 4, `entities` 3,
  // `segment` 3, `targeting` 3, `materials` 2, `advisor` 2, `tool` 2,
  // `cameraRig` 1, `viewState` 1 — and the LOWEST of those assemblies is
  // `createFieldMachine` ~210 lines up, so this line cannot rise past it.
  // `createAnalyzer`'s own block names this module as one of the three that may
  // not rise above the closure's ordering pivot; the machine is simply lower
  // still.
  //
  // The record's own SPLIT is stated once, at the end of this block, and
  // deliberately not here: this paragraph carried "18 refs + 7 thunks" forward
  // through T3d Task 5 while the paragraph twenty-five lines down said 26 / 0 and
  // `field-render.ts`'s header — which this block cites as the authority — had
  // been updated. A block whose opening words were "re-derived rather than carried
  // forward" was the one thing carried forward. Two statements of one arithmetic
  // is how that happens, so there is now one.
  //
  // "Nothing takes `render`, so nothing is pinned below it" is STILL TRUE and now
  // FULLY SETTLED. The two deps that were going to unsettle it were `cameraEye`
  // and `gizmoVisible`; T3d Task 4 collected on the first (`cameraRig.eye`) and
  // Task 5 on the second (`entities.gizmoVisible`). So this line now has two real
  // lower bounds instead of the machine's one — `createCameraRig` ~610 lines up
  // and `createEntities` ~810 up — and both are slack, because the machine sits
  // between them and this line.
  //
  // ZERO DEPS NAME STATE THAT LIVES IN THIS CLOSURE, and the prediction that got
  // it here is worth keeping. At Task 3 there were eleven; Task 4 spent three and
  // Task 5 the last eight. Each was a NARROW named thunk or plain ref rather than
  // a slice of a module record, and the claim made at Task 3 was that this would
  // cost one line HERE per dep and no change of SHAPE inside `field-render.ts`.
  // Measured across both tasks: that module's diff for Task 4 was six comment
  // sites and no code, and for Task 5 it is comment sites and no code again —
  // eleven deps re-pointed, zero signatures touched. **A deps record that names
  // what it READS survives its neighbours' extractions; one that names WHO it
  // reads from is rewritten every time somebody else moves.** The record's own
  // split is now 1 substrate + 26 module refs + 2 values = 29, and there is no
  // thunk-over-a-host-`let` left in it at all.
  const render = createRender({
    substrate,
    layers: viewState.layers,
    shading: materials.shading,
    ghostCube: materials.ghostCube,
    flagMarkerMesh: advisor.markerMesh,
    flagSelectionBatch: advisor.selectionBatch,
    gesture: machine.gesture,
    session: machine.session,
    pendingStamp: machine.pendingStamp,
    placementGhost: machine.placementGhost,
    segmentAnchor: segment.anchor,
    segmentAnchorBatch: segment.anchorBatch,
    segmentPreviewBatch: segment.previewBatch,
    pointer: targeting.pointer,
    computeTarget: targeting.computeTarget,
    selectionPoint: targeting.selectionPoint,
    digRadius: tool.digRadius,
    isKitFillTool: tool.isKitFill,
    cameraEye: cameraRig.eye,
    // THE `?.im ?? null` ARROW IS GONE, which was this dep's stated requirement
    // on Task 5 rather than a detail: `field-selection.ts` publishes a MESH-ONLY
    // accessor of its own (`advisor.markerMesh`'s precedent), so the chain
    // disappeared with the closure `let` instead of migrating into the module. The
    // geometry beside the mesh is the selection's to free and the frame never
    // wanted it.
    selectionCellMesh: selection.cellMesh,
    selectionBatch: selection.batch,
    anchorBatch: selection.anchorBatch,
    boxPreviewBatch: selection.previewBatch,
    boxAnchor: selection.boxAnchor,
    entitySelectionBatch: entities.selectionBatch,
    gizmoBatch: entities.gizmoBatch,
    gizmoVisible: entities.gizmoVisible,
    // Two module-scope constants passed by VALUE, on `field-segment.ts`'s
    // `anchorCrossHalfM` precedent — which is literally one of the two. Both are
    // read by `field-selection.ts` as well, and since T3d Task 5 by no function in
    // this file at all; the declaration block argues why they stay there anyway.
    selectionColor: SELECTION_COLOR,
    anchorCrossHalfM: ANCHOR_CROSS_HALF_M,
  });

  // The live stats readout, lifted out whole (`field-stats.ts`): its channel, its
  // reconfigure timing, its four cache bindings and `currentLogStats` all left,
  // and NOTHING of it stayed — unlike the three clusters before it, this one
  // shared no state with the substrate, because nothing outside it ever read its
  // state directly.
  //
  // The assembly sits where `currentLogStats` was, which is the only function
  // this cluster owned (`createSegmentBrush`'s precedent: a cluster's remaining
  // footprint marks where the cluster was) — and, conveniently, directly above
  // the `tick` that is now its one per-frame caller.
  //
  // Its work, though, did NOT live here: twenty lines inside `tick` built and
  // pushed the payload, which is why this cluster could not travel as a record of
  // functions and had to be given a verb (`publishIfWatched`) instead. See the
  // module header.
  //
  // TWO of the four payload deps now reach DOWN rather than up. `lastRemeshMs`
  // and `remeshVersion` were host `let`s riding as thunks until T3d Task 6; they
  // are `field-world.ts`'s state now and that module is assembled 433 lines
  // below, so the two thunks became forward arrows and the LAW's other tooth is
  // what makes them safe rather than merely correct (a value here would be a TDZ
  // read, not a fork). `voidcast.jobGen` and `advisor.pendingCount` are members of
  // `const` module records this closure never reassigns, so they pass by reference
  // and are read eagerly by this object literal — which is what makes their
  // declaration order matter at all, and since T3d (2026-08-07) `advisor` is the
  // reason this line may not rise: it was a closure `const` before and is now a
  // module verb.
  //
  // The one FORWARD reference runs the other way: `applyReconfigureSession`, now
  // `field-machine.ts`'s, calls `stats.noteReconfigureMs` through the arrow
  // above. That is safe for the reason spelled
  // out at the `createVoidCast` assembly above — nothing between this closure's
  // brace and its `return {` ever RUNS, so a function body cannot be evaluated
  // before the declaration it names. No hoist was needed.
  const stats = createStatsMeter({
    substrate,
    lastRemeshMs: () => world.lastRemeshMs(),
    remeshVersion: () => world.remeshVersion(),
    voidCastJobGen: voidcast.jobGen,
    analyzerPendingCount: advisor.pendingCount,
  });

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
  // THE ONE BINDING WHOSE ROW ASSIGNMENT IS ARGUABLE, said out loud because
  // nothing else in the closure is and a reader should not have to wonder.
  // `lastCursor` and `syncCursor` are filed under `input` in the cluster map,
  // and the map's reason — `input` owns the canvas element — is true of the
  // WRITE (`el.style.cursor`) and not of the trigger: this is a per-frame memo
  // driven ONLY from `tick`, by no DOM event at all. So it reads as `lifecycle`'s
  // by cadence and as `input`'s by target, and both rows are declared
  // facade-resident, which is why the choice costs nothing and was not revisited
  // at T3d Task 6. If either row is ever extracted, THIS is the binding that has
  // to be re-decided rather than carried.
  let lastCursor: ViewportCursor | null = null;
  const syncCursor = (): void => {
    const el = canvasEl;
    // Before the cache compare, not after: caching an answer that was never
    // written would leave a canvas attached later with no cursor at all.
    if (!el) return;
    // Bound to a local because the reader is a CALL now: the two arms below both
    // need the drag, and two calls could in principle answer differently (nothing
    // runs between them today, which is precisely why a second call would be a
    // reader's puzzle rather than a fact).
    const drag = machine.moveDrag();
    const next = viewportCursor({
      // `MoveDrag.grabbed` reads backwards from the word: it is TRUE for a
      // pointer DRAG (a button is down) and false for the free-hand `G` grab.
      // Its own TSDoc says so; this line is where believing the name would put
      // the two cursors the wrong way round.
      move: drag === null ? null : drag.grabbed === true ? "drag" : "grab",
      pendingStamp: machine.pendingStamp() !== null,
      session: machine.session() !== null,
      gesture: machine.gesture(),
    });
    if (next === lastCursor) return;
    lastCursor = next;
    el.style.cursor = next;
  };

  const tick = (now: number): void => {
    if (disposed) return;
    syncCursor();
    const c = ctx;
    // Bound to a local because the camera is a CALL now, and the frame needs the
    // same handle twice — the liveness guard and the draw. Two calls could in
    // principle answer differently; `syncCursor`'s `moveDrag` local above is the
    // same shape and states the same reason.
    const liveCam = cameraRig.cam();
    if (c && liveCam) {
      const dt =
        lastFrameT === 0
          ? 0
          : Math.min((now - lastFrameT) / 1000, MAX_FRAME_DT);
      lastFrameT = now;
      cameraRig.flyStep(dt);
      world.drainDirty();
      // The frame's whole involvement with the readout: it ASKS, and the meter
      // decides whether anyone is listening and what to say (`field-stats.ts`).
      // The twenty lines this replaced read four other clusters, which is why
      // they were never `tick`'s to own.
      stats.publishIfWatched();
      render.scene(c, liveCam);
    }
    raf = requestAnimationFrame(tick);
  };

  // --- input handlers -----------------------------------------------------
  //
  // The POINTER four are one line each: their bodies are the machine's pointer
  // chain (T3c), because MOST of what their branches test is that module's state
  // — a live move, a pending stamp arm, the armed gesture, a stroke in progress.
  // Three tests are not: a live look drag, a pending box corner and a pending
  // segment point are all still owned over here, and they travel back the other
  // way as liveness questions on the deps record (`looking`, `boxAnchor`,
  // `segmentAnchor`). A chain sits where most of what it decides on lives and
  // asks about the rest; `field-machine.ts`'s chain header argues it out.
  //
  // WHAT STAYS HERE IS THE ATTACHMENT AND THE DOM, AND EVERY BODY BELOW IS NOW A
  // DELEGATE. That is the whole of what T3d Task 4 did to this block: `keys`, the
  // banked scroll and the momentary flags were the last closure state a listener
  // wrote, and all three left on 2026-08-08 — so `onWheel`, `onKeyDown`,
  // `onKeyUp` and `onBlur` join the pointer four in owning no state at all.
  //
  // The listeners themselves do NOT move, this tranche or after it, and the
  // reason is the same one that kept the pointer four: `attachListeners` owns the
  // canvas element, and `input` IS the adapter that turns DOM events into calls.
  // What each handler keeps is the DECISION that is a fact about the EVENT rather
  // than about a cluster — which of the wheel's two bindings this scroll is,
  // which key this is, that ⌘Z must be claimed before anything else looks at it.
  // Everything downstream of that decision is somebody's verb.
  //
  // This comment used to say the momentary pins were "closure-private keydown
  // state with no route out of this file at all", which was true and is the exact
  // sentence the move had to answer. They are `field-tool.ts`'s now, reached
  // through three verbs named for the act (`noteModifierDown`, `noteModifierUp`,
  // `releaseModifiers`) — never through a `setMomentaryShift(v)`, which would have
  // handed this file back the assignment, the repeat guard and the derive-ordering
  // it just gave up. `tests/field-host-momentary.gpu.test.ts` still reaches all of
  // it through these handlers and through nothing else, and passes unmodified.
  //
  // The one statement that is not a delegation to the MACHINE is the pointer
  // note, and deliberately: it is not arbitration, and the chain never reads it.
  // A write-thunk dep for it would have handed the machine a boundary write made
  // purely on someone else's behalf, which is the one shape `MachineDeps` is
  // trying not to grow.
  //
  // It became a delegation of its own at T3d, to a different module and for the
  // opposite reason. The binding it used to assign went to `field-targeting.ts`
  // with the five cursor-to-world functions it is the cached ARGUMENT of, so the
  // line is now `targeting.notePointer(...)`. Nothing about the argument above
  // changed — the machine still must not own this write — and its three readers
  // ask `targeting.pointer()` for it: `ghostState` and `renderCursorAffordance`,
  // both `field-render.ts`'s since T3d Task 3, and the facade's `beginMove`,
  // which anchors a `G` grab at the last known cursor and is the one left here.

  // --- the `input` cluster: DECLARED FACADE-RESIDENT, foundations T3d Task 6 --
  //
  // The fourth and last row to carry that verdict, beside `catalogs` (~1,600
  // lines up), `history.stepHistory` and `lifecycle` (the block above
  // `return {`). It is recorded HERE, at the top of the handler block, so a later
  // sweep does not read the absence of a `field-input.ts` as the one cluster
  // nobody got to — and because §4 of the closure map carried this row as
  // PARTIALLY HOLLOWED for one tranche longer than the evidence warranted.
  //
  // The map predicted it from the start (§7.2: "a driver, not an owner — the
  // adapter that turns DOM events into calls"), and at head that is what it
  // MEASURES as rather than what it is argued to be:
  //
  //   - It reads ZERO other clusters' state. The ten reads that survived T3c were
  //     all `tool` or `camera` bindings, and every one went INSIDE the verb the
  //     listener now calls at T3d Task 4.
  //   - It owns two bindings nothing else wants: `canvasEl` (a `HostSubstrate`
  //     THUNK's backing) and `lastCursor` (the cursor cache, private).
  //   - All twelve of its standing mutation edges cross a module line **while
  //     every writer stayed exactly where the birth pass found it** — a
  //     disposition no other subsection of the register has, and the reason this
  //     is permanent rather than pending. `onKeyDown`, `onKeyUp`, `onBlur` and
  //     `onWheel` ARE DOM listeners and `attachListeners` owns the canvas
  //     element; none of them can live behind a boundary that does not have one.
  //
  // So `input` and `lifecycle` together are what a facade over framework + tools
  // legitimately owns: one adapts the DOM, the other owns the device and the
  // frame.
  const onPointerDown = (e: PointerEvent): void => {
    targeting.notePointer(e.clientX, e.clientY); // feeds the per-frame ghost
    machine.pointerDown(e);
  };

  const onPointerMove = (e: PointerEvent): void => {
    targeting.notePointer(e.clientX, e.clientY); // feeds the per-frame ghost
    machine.pointerMove(e);
  };

  // Wrapped rather than attached straight off the machine, though these two add
  // nothing: `attachListeners`/`detachListeners` pair by identity, and four
  // handlers spelled one way is one fewer thing to get right than two spelled
  // each way.
  const onPointerUp = (e: PointerEvent): void => {
    machine.pointerUp(e);
  };

  const onPointerCancel = (e: PointerEvent): void => {
    machine.pointerCancel(e);
  };

  // NOTE: no pointer-leave handler on purpose — the noted cursor position
  // survives the pointer leaving the canvas so the ghost previews panel-driven
  // size changes (see `lastPointer`'s declaration comment inside
  // `createTargeting`, which is the whole argument). A move drag does not need
  // one either: it takes pointer capture, so the events keep arriving.

  // The wheel is TWO bindings on one input, split by what LMB is armed to do.
  // Under `pointer` — which selects and moves rather than paints — there is no
  // brush to resize, so the scroll travels the camera instead; under everything
  // else (the brush, `segment`, the cell-selection gestures) it is the brush
  // radius it has always been. Away from the user = forward / bigger, in both.
  //
  // The two measure the scroll DIFFERENTLY, and the asymmetry is deliberate:
  // travel is ACCUMULATED and radius is stepped per event. Each half now argues
  // its own side at its own verb (`cameraRig.wheelDolly`, `tool.stepRadius`),
  // because the arithmetic went with the state it moves. What is left here is the
  // SPLIT, which is neither cluster's — it is a fact about this event.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (machine.gesture() === "pointer") {
      cameraRig.wheelDolly(e);
      return;
    }
    const notches = -Math.sign(e.deltaY);
    if (notches === 0) return; // a purely horizontal wheel means neither binding
    tool.stepRadius(notches);
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault(); // RMB drives look — suppress the browser menu
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
    // session's mode decides, and a live MOVE is dropped instead); Esc cancels the
    // most recent CAPTURE. Neither is a fly key, so returning here never starves
    // the keys set.
    //
    // Both are ALSO app-level actions (`frontend/lib/actions.ts`), which is what
    // makes them work after a click into a palette. The rule where two listeners
    // bind one key: the branch that ACTS claims the event with `stopPropagation`
    // so the window listener cannot run the same verb a second time, and a
    // branch that does NOT act lets the event through — with no session ⏎ is the
    // registry's to swallow, and an Esc with nothing captured is a no-op wherever
    // it lands.
    if (k === "enter") {
      if (machine.session() === null) return;
      e.preventDefault();
      e.stopPropagation();
      machine.confirmSession();
      return;
    }
    if (k === "escape") {
      // The stack's boolean IS the claim: it cancelled the top capture, or there
      // was nothing captured and the event travels on to whatever else wants it.
      if (!router.escape()) return;
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
      if (machine.session() !== null) {
        e.preventDefault();
        machine.nudgeStamp(arrowSteps);
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
      if (machine.session() !== null) {
        e.preventDefault();
        e.stopPropagation();
        machine.rotateStamp();
      }
      return;
    }
    if (k === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      cameraRig.frameSelection();
      return;
    }
    // [ / ] step the brush radius (literally the same verb as the wheel's brush
    // half, one notch at a time); key-repeat is the hold-to-resize behaviour.
    // Chord-guarded: ⌘[/⌘] (and ctrl+[/]) are the browser's back/forward — never
    // intercept those.
    if ((k === "[" || k === "]") && !e.metaKey && !e.ctrlKey) {
      tool.stepRadius(k === "]" ? 1 : -1);
      return;
    }
    // Momentary modifiers. The repeat guard is inside the verb now — a held key
    // auto-repeats keydown, and re-saving the DERIVED tool as the base is the
    // defect it exists to stop. Shift ALSO lands in the fly set below, for the
    // boost: the boost only applies while a move key is held and momentary smooth
    // only changes what LMB does, so the two never conflict — which is why both
    // clusters see this one keypress.
    if (k === "shift") tool.noteModifierDown("shift");
    if (k === "control") tool.noteModifierDown("ctrl");
    cameraRig.noteKeyDown(k);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    cameraRig.noteKeyUp(k);
    if (k === "shift") tool.noteModifierUp("shift");
    if (k === "control") tool.noteModifierUp("ctrl");
  };

  // Focus loss strands keydown state: a key released while focus is elsewhere
  // never keyups here, leaving fly movement running or a momentary tool stuck.
  // One verb per cluster: drop the fly set, then drop both momentary flags
  // (which re-derives, restoring the saved tool). That order matches `onKeyUp`'s,
  // NOT `onKeyDown`'s — the keydown does the modifiers first and the fly set
  // last. Nothing depends on it either way (the two clusters share no state), and
  // the statement order is frozen by this extraction's zero-change bar, so it is
  // recorded as what it is rather than given a reason it does not have.
  //
  // A move in flight is stranded the same way and is DISCARDED (D-9's blur
  // decision). A drag alt-tabbed away from never sees its pointerup, and a `G`
  // grab is a modal viewport state that clicking a panel control leaves.
  // Committing would land a splice nobody confirmed; leaving it live would strand
  // a ghost that answers to nothing. Cancelling costs the user only the drag —
  // the record is untouched until the drop.
  const onBlur = (): void => {
    machine.cancelMoveInFlight();
    cameraRig.releaseKeys();
    tool.releaseModifiers();
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

  // --- the world (`field-world.ts`), and the closure's last assembly --------
  //
  // The TWENTY-FIRST and last cluster out: three `let`s (`lastRemeshMs`,
  // `remeshVersion`, `worldEpoch`) and all fourteen functions, plus the bodies of
  // three of the five `FieldHost` members it owns — `newWorld`, `loadWorld` and
  // `exportArtifact` are delegates below. `resetWorld` and `compactLoadedLog`
  // were declared exactly here, which is why the assembly is.
  //
  // THE POSITION IS DECIDED BY AN ARROW COUNT, not by a constraint, and it is the
  // only assembly in this file for which that is the whole story. Every one of
  // the twenty-three deps below names a module declared ABOVE this line, so the
  // record holds no forward arrow at all. The mirror image was available —
  // assembling this where `markDirtyWithNeighbors` was, ~1,450 lines up, would
  // have let those consumers take plain refs — and it costs about twenty
  // arrows in THIS record against the NINE dep sites that changed shape here
  // (`createTool` 1, `createVoidCast` 2, `createAnalyzer` 1,
  // `createFieldMachine` 3, `createCameraRig` 2), of which EIGHT were plain refs
  // and one a composed arrow. Fourteen dep sites across seven modules name this
  // cluster at head; the other five did not change shape, being four thunks over
  // host `let`s that became thunks over a seam (`advisor`/`entities`'
  // `worldEpoch`, `stats`' two) and one that arrived with the entity verbs.
  // §2.10's `currentSelectionSpec` fork is the same
  // arithmetic one task earlier: one arrow there against four here.
  //
  // EVERY DEP POINTING AT THIS RECORD FROM ABOVE IS AN ARROW, and none of them
  // may be written as a value: this binding is declared below its consumers, so
  // an eager read is a TDZ `ReferenceError` rather than a stale snapshot. The
  // argument is at the `createVoidCast` assembly, which states the whole
  // forward-reference invariant once; `field-entities.ts`' header carries the
  // measurement (260 tests across 24 files).
  //
  // NOTHING PINS IT FROM BELOW. `tick` calls `drainDirty`, and the return
  // literal's `init`, `dispose`, `setMaterialTable`, `frameChunks`,
  // `occupiedTopY` and the three world verbs all call in — every one of them from
  // inside a function body, so none constrains this line at all.
  //
  // TWO OF THE DEPS ARE THE REGISTER'S LAST FOUR IN-CLOSURE EDGES, paid off from
  // the other side: `discardChunkRenders` and `redirtyAll` are on the SEAM rather
  // than in this record, and are what `init`/`dispose`/`setMaterialTable` call
  // instead of touching `chunkMeshes` and `dirty`. See the module's own note.
  const world = createWorld({
    substrate,
    bucketMat: materials.bucket,
    kitInstancedMat: materials.kitInstanced,
    sliceY: viewState.sliceY,
    invalidateVoidCast: voidcast.invalidate,
    discardVoidCast: voidcast.discard,
    noteDensityWritten: advisor.noteDensityWritten,
    retireAdvisorWorld: advisor.retireWorld,
    noteWorldLoaded: advisor.noteWorldLoaded,
    requestAnalyzerPass: advisor.requestPass,
    rebuildProps: props.rebuild,
    reportToolError: tool.reportError,
    // Three CLEARS rather than three setters, because the clear is all this
    // cluster ever asks for and the last of them would otherwise have made
    // `field-world.ts` import `PendingStamp` to name a parameter it only passes
    // `null`. Task 4's rule read from the caller's side.
    clearBoxAnchor: () => selection.setBoxAnchor(null),
    retireSelection: selection.retireWorld,
    clearSegmentAnchor: () => segment.setAnchor(null),
    clearPendingStamp: () => machine.setPendingStamp(null),
    cancelSession: machine.cancelSession,
    selectEntity: entities.select,
    notifyEntities: entities.notify,
    setDrift: drift.set,
    notifyDrift: drift.notify,
    cameraEye: cameraRig.eye,
    cameraYaw: () => cameraRig.pose().yaw,
  });

  // --- the LIFECYCLE cluster: DECLARED FACADE-RESIDENT, foundations T3d -----
  //
  // The third row to carry this marker after `catalogs` and `history.stepHistory`,
  // and the largest: five state bindings (`requestContext`, `ctx`, `disposed`,
  // `raf`, `lastFrameT`), one function (`tick`) and two `FieldHost` members
  // (`init`, `dispose`). It is recorded here, directly above the literal, so a
  // later sweep does not read the absence of a `field-lifecycle.ts` as the one
  // cluster nobody got to.
  //
  // THE PLAN ALLOWED "distribute the teardown to module-owned disposes where the
  // ordering permits, a facade-resident orchestrator where it does not", and
  // named the second an ALLOWED OUTCOME rather than a failure. This is the second,
  // and there are THREE reasons, of which the ordering is only the middle one.
  //
  //   - ITS STATE CANNOT LEAVE, which is decisive on its own. `requestContext` is
  //     a `HostSubstrate` VALUE member; `ctx` and `disposed` are the BACKING of
  //     two substrate THUNKS that seven extracted modules read through
  //     (`field-analyzer`, `field-machine`, `field-materials`, `field-props`,
  //     `field-selection`, `field-voidcast`, `field-world` — the list, not a
  //     count, because a count is what went wrong here twice). A module
  //     owning them would be handing the substrate its own contents from below —
  //     the record is assembled at the TOP of this closure precisely so that
  //     cannot happen. `raf` and `lastFrameT` are the rAF loop's, and the loop's
  //     first and last statements call `syncCursor` and `attachListeners` /
  //     `detachListeners`, which are `input`'s and own the canvas element.
  //   - THE TEARDOWN ORDER IS LOAD-BEARING ACROSS EIGHT MODULES and a context
  //     guard — `advisor`, `world`, `props`, `selection`, `machine`, `voidcast`,
  //     `materials`, `cameraRig`, which is every module this file assembles that
  //     owns anything to free: `disposed` first so every async continuation bails, the rAF
  //     cancelled, the listeners detached, both workers ended, then nine GPU frees
  //     inside `if (c)` ending at `gpu.dispose(c)`, then the three FORGETTING
  //     calls outside it because a host disposed before it ever initialized still
  //     has slots to clear and no context to free them with. Each module owns its
  //     own half — `materials.destroy`/`release`, `cameraRig.unbind`/`release`,
  //     `advisor.dispose`/`destroyMarkers`, `world.discardChunkRenders` — and what
  //     is left here is exactly the SEQUENCE, which belongs to whoever owns the
  //     device.
  //   - IT IS WHAT A FACADE OVER FRAMEWORK + TOOLS OWNS. Acquiring the device,
  //     attaching the DOM and running the frame is the same sentence that covers
  //     `input`, and both are declared for that reason rather than because a move
  //     was attempted and abandoned. A `field-lifecycle.ts` would take ~25 deps
  //     across every module in this file plus three facade-resident functions;
  //     naming that a module would make the roster read as complete while the
  //     thing it describes had not moved.
  return {
    async init(canvas, opts) {
      if (ctx) throw new Error("field-host: already initialized");
      disposed = false; // clear a prior dispose() so a re-init'd instance lives
      ctx = await requestContext(canvas, {
        sampleCount: opts?.sampleCount ?? 4,
      });
      // Three statements behind ONE verb since 2026-08-08
      // (`field-camera-rig.ts`): build the perspective camera, write the stored
      // orbit pose into it, bind it to the canvas for resize. The ORDER inside
      // matters (the pose is written before the bind) and is now the module's to
      // keep rather than this function's to remember.
      cameraRig.bind(ctx);
      await materials.init(ctx);
      // A world can be loaded BEFORE the GPU exists (the panel's Load races
      // init, and every headless caller never inits at all), and
      // `props.rebuild()` no-ops without a context — so build the layer once
      // here from whatever the log already holds. Same for the advisor's
      // markers: findings can arrive before the GPU does, and the counts they
      // settled are replayed into draws here.
      props.rebuild();
      advisor.rebuildMarkers();
      // The selection survives a dispose (it is CPU state), so its CELL display
      // has to be rebuilt here too or a re-init — the AA switch, which never
      // touches the selection — would come back with the outline and no cubes.
      selection.rebuildCells();
      // Re-mesh whatever the store already holds. At the FIRST init this is empty
      // and costs nothing; at a re-init (the AA switch) it is the whole world, and
      // without it the field never comes back — `dispose` destroys every chunk mesh
      // and `dirty` only ever holds chunks something EDITED. The paced drain
      // (`field-world.ts`'s `REMESH_PER_FRAME`) is what keeps the burst from
      // stalling the first frames.
      //
      // A CALL rather than the loop it was until T3d Task 6, and the change is
      // one of the register's last four in-closure mutation edges being paid off:
      // this function writes `world.dirty` and is never going to move — the frame
      // lifetime is the facade's — so the write became a verb in place, on the
      // same shape as Task 4's ten momentary writes.
      world.redirtyAll();
      // The X-ray's half of the same contract. `dispose` destroys the cast meshes
      // but the LAYER FLAG rides through, and `setLayers` only builds on the
      // false→true edge — so without this the box stays ticked over nothing, which
      // is the exact reading `field-voidcast.ts`'s `invalidateVoidCast` refuses to
      // ship ("a silently
      // vanishing X-ray beside a still-ticked checkbox would read as a bug").
      // Re-requesting rather than reporting: the user asked for the X-ray and
      // never withdrew it.
      if (viewState.layers().voidCast) voidcast.request();
      attachListeners(canvas);
      lastFrameT = 0;
      raf = requestAnimationFrame(tick);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      detachListeners();
      worker.dispose();
      // Terminate the advisor's worker and re-arm what a re-init has to re-send.
      // ONE call because it is one act: disposing the worker is what MAKES the
      // re-sync and the placement re-post owed, and the module's own verb carries
      // the whole of that argument (including which half of it is deliberately
      // uncovered by any test). The GPU half of the advisor's teardown is
      // separate and lives in the context block below — it needs a `Context` this
      // one does not, and it must run before `gpu.dispose`.
      advisor.dispose();
      const c = ctx;
      if (c) {
        // The other half of `ret.init`'s pay-off: two statements over
        // `world.chunkMeshes` behind one verb since T3d Task 6, and the private
        // `destroyChunkRender` they both called never crosses the boundary
        // (Task 4's rule — a private function's outside callers are the seam it
        // needs, and all three wanted the same group).
        world.discardChunkRenders(c);
        props.destroy(c);
        advisor.destroyMarkers(c);
        selection.destroyCells(c);
        machine.destroyGhosts();
        voidcast.discard();
        // Sixteen STATEMENTS in this exact order behind ONE verb since
        // 2026-08-08 (`field-materials.ts`) — fifteen of them guarded
        // `material.destroy` / `binding.destroy` / `mesh.destroy` /
        // `geometry.destroy` calls, and the sixteenth `destroyLitMaterials(c)`,
        // whose own cost is `2 × litCount` calls over the per-class cache. The
        // count that matters to the register is the fifteen BINDINGS, which is
        // what §5.1 lists. The GPU half of that module's
        // teardown, beside `props.destroy(c)` and `advisor.destroyMarkers(c)`
        // above and before `gpu.dispose` below; the FORGETTING half runs outside
        // this block, because a host disposed before it ever initialized still
        // has slots to clear and no context to free them with.
        materials.destroy(c);
        cameraRig.unbind();
        gpu.dispose(c); // LAST — a clean shutdown is the leak check.
      }
      // The closure map's biggest single mutation fan-out — fifteen bare
      // assignments from this one function into another cluster's state
      // (§5.1) — is ONE call since 2026-08-08. Unconditional, unlike the
      // `materials.destroy(c)` above it: a host disposed before `init` never
      // acquired a context and still has to read as uninitialized afterwards.
      materials.release();
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
      // as such (the `analyzerPlacementsStale` precedent, which lives in
      // `field-analyzer.ts`'s own `dispose` since T3d): `updateMove`
      // guards on `stamp === null` too, so a mapping stranded by a bare
      // `stamp = null` changes nothing while the host stays disposed — swapping
      // this line back fails no test. What it buys is the state AFTER a re-init:
      // `updateMove` RETURNS from the machine's `pointerMove` (this file's
      // `onPointerMove` is a two-line delegate since T3c), so a stranded mapping would
      // swallow every pointermove — box previews, segment previews and brush
      // strokes alike — until something else cleared it.
      machine.cancelSession();
      // The camera's FORGETTING half, outside the context block for
      // `materials.release()`'s reason directly above — a host disposed before it
      // ever initialized still has both slots to clear and no context to free
      // them with. `unbind()` is the other half and ran inside.
      cameraRig.release();
      ctx = null;
    },
    // The three world verbs with BODIES, now three delegates. Each was ~5, ~22
    // and ~7 lines of code in this literal and each is `field-world.ts`'s since
    // T3d Task 6 — with all of its prose, including `loadWorld`'s record of the
    // automatic camera frame that was tried and reverted. `loadWorld` is the only
    // headless route to a committed entity, so it is the seam every GPU fixture
    // installs through; the throw on a cellSize mismatch is the module's now and
    // its message is unchanged, `FieldHost.loadWorld:` prefix included.
    newWorld() {
      world.create();
    },
    loadWorld(data) {
      world.load(data);
    },
    setDigRadius(r) {
      tool.applyRadius(r);
    },
    setShading(mode) {
      materials.setShading(mode);
    },
    setTool(patch) {
      tool.set(patch);
    },
    subscribeTool(cb) {
      return tool.subscribe(cb);
    },
    subscribeToolError(cb) {
      return tool.subscribeError(cb);
    },
    setGesture(next) {
      machine.setGesture(next);
    },
    clearSelection() {
      selection.clear();
    },
    reselect() {
      selection.reselect();
    },
    subscribeSelection(cb) {
      return selection.subscribe(cb);
    },
    setLayers(next) {
      viewState.setLayers(next);
    },
    setSlice(y) {
      viewState.setSlice(y);
    },
    occupiedTopY() {
      return world.occupiedTopY();
    },
    // THE ONE `world` MEMBER THAT DID NOT TRAVEL, declared rather than left by
    // omission (T3d Task 6). The map files `getSmoothLimits` under `world`
    // because the limits are the field's, but the body reads no world state at
    // all — two `@furnace/core/field` constants and nothing else. Moving it would
    // put a verb on `field-world.ts`'s seam that answers without consulting its
    // own module, which is the definition of a pass-through; the facade keeps it
    // for the reason the facade keeps `listGenerators`' shape one member over.
    // The four members that DID travel are `newWorld`, `loadWorld`,
    // `exportArtifact` and `occupiedTopY`, all delegates.
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
      machine.cancelSession();
      table = next;
      const c = ctx;
      if (!c) return;
      // A table swap re-buckets every chunk. Drop all chunk renders first so
      // nothing references the outgoing per-class materials, rebuild the cache,
      // then re-mesh from scratch. Async (shader/material creation is async).
      void (async () => {
        try {
          // The last two of the register's four in-closure edges, and the pair
          // that makes this method's writer the third one that could not follow
          // its target: the catalog setter is `catalogs`', declared
          // facade-resident since T3d Task 1.
          world.discardChunkRenders(c);
          // ONE verb rather than the destroy/build pair it replaced: a swap that
          // freed the old per-class materials and did not build the new ones
          // would leave every chunk drawing from an empty cache. YIELDS —
          // dispose() may land inside it, which is what the guard below is for.
          await materials.rebuildForTable(c);
          if (disposed) return;
          world.redirtyAll();
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
      props.rebuild(); // the catalog decides proxy geometry + tint
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
      return props.instanceCounts();
    },
    startStamp(generator) {
      machine.startStamp(generator);
    },
    updateStamp(params, seed, policy) {
      machine.updateStamp(params, seed, policy);
    },
    nudgeStamp(dx, dy, dz) {
      machine.nudgeStamp([dx, dy, dz]); // no-ops without a session
    },
    rotateStamp() {
      machine.rotateStamp();
    },
    rerollStamp() {
      machine.rerollStamp();
    },
    commitStamp() {
      machine.commitStamp();
    },
    confirmSession() {
      machine.confirmSession();
    },
    cancelStamp() {
      machine.cancelSession();
    },
    escape() {
      router.escape();
    },
    undo() {
      stepHistory(false);
    },
    redo() {
      stepHistory(true);
    },
    subscribeStamp(cb) {
      return machine.subscribeStamp(cb);
    },
    subscribePendingStamp(cb) {
      return machine.subscribePendingStamp(cb);
    },
    openEntity(entityId) {
      machine.openEntity(entityId);
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
      //
      // COPIED at this boundary rather than handed on: `targeting.pointer()`
      // returns the stored object (see its TSDoc — the per-frame ghost reads it
      // and a defensive copy there would allocate every frame), so the one caller
      // that passes it into another module's keeping makes the copy itself.
      const last = targeting.pointer();
      machine.beginMove(
        entityId,
        null,
        false,
        last === null ? null : { x: last.x, y: last.y },
      );
    },
    applyReconfigure() {
      machine.applyReconfigure();
    },
    // THE FIVE ENTITY VERBS, now five delegates. Their bodies — 96 lines of
    // business logic over the op log, the last such block in this literal — are
    // `field-entities.ts`'s since T3d Task 6. Task 5 had left them here behind a
    // migration marker naming four blockers, and all four
    // dissolved in that task; the module's header carries the re-decision on the
    // merits (each had exactly ONE caller — the facade member directly beside it)
    // and states plainly that the bar was met without this move.
    setEntityFrozen(entityId, frozen) {
      entities.setFrozen(entityId, frozen);
    },
    bakeEntity(entityId) {
      entities.bake(entityId);
    },
    deleteEntity(entityId) {
      entities.remove(entityId);
    },
    duplicateEntity(entityId) {
      entities.duplicate(entityId);
    },
    subscribeDrift(cb) {
      return drift.subscribe(cb);
    },
    dismissDrift() {
      drift.set(null);
      drift.notify();
    },
    frameChunks(chunks) {
      // Through `field-world.ts`'s `chunkSetBox`, which the rig's `frameWorld`
      // also reaches (as `worldBox()`, over the store's own keys) — a re-centre
      // and a fit disagreeing about where a world IS would be two copies of this
      // arithmetic drifting apart, and this method held the second copy until the
      // F4.5 gate. `null` is the empty set, which was this method's own early
      // return.
      const box = world.chunkSetBox(chunks);
      if (box === null) return;
      // `centreOn`, not `frameOn`: this verb moves the PIVOT and keeps angle and
      // distance, which is the whole of what its docblock above distinguishes.
      // The box is `world`'s and the move is the camera's — the same split
      // `field-analyzer.ts`'s click-to-frame makes one dep over (§2.7's rule).
      cameraRig.centreOn(box);
    },
    frameSelection: cameraRig.frameSelection,
    frameWorld: cameraRig.frameWorld,
    cameraAimedByHand: cameraRig.aimedByHand,
    snapView: cameraRig.snapView,
    subscribeEntities(cb) {
      return entities.subscribe(cb);
    },
    subscribeHistory(cb) {
      return historyFeed.subscribe(cb);
    },
    listEntities() {
      return entities.list();
    },
    selectEntity(entityId) {
      entities.select(entityId);
    },
    subscribeEntitySelection(cb) {
      return entities.subscribeSelection(cb);
    },
    // The advisor's six members, each a straight delegate onto `field-analyzer.ts`
    // since T3d. TWO names moved on the way across, and both are the same
    // de-prefixing act: `setFlagFilters` is `advisor.setFilters` and
    // `flagMarkerCount` is `advisor.markerCount`, because on the seam the findings
    // are already the advisor's and the word "flag" would be saying it twice. The
    // facade keeps the longer spellings — out there the noun is load-bearing.
    setAgentProfile: advisor.setAgentProfile,
    subscribeFlags: advisor.subscribeFlags,
    setFlagFilters: advisor.setFilters,
    verifyFlag: advisor.verifyFlag,
    selectFlag: advisor.selectFlag,
    flagMarkerCount: advisor.markerCount,
    selectionCellCount() {
      return selection.cellCount();
    },
    // The bake. `field-world.ts`'s since T3d Task 6, and the two camera facts it
    // needs travel as deps on that record (`cameraEye`, `cameraYaw`) — the v0
    // spawn is the current camera position, which is a fact about the SAVE and
    // not about the rig.
    exportArtifact(name) {
      return world.exportArtifact(name);
    },
    subscribeStats(cb) {
      return stats.subscribe(cb);
    },
    isLooking: cameraRig.looking,
    subscribeCameraPose(cb) {
      return cameraRig.subscribePose(cb);
    },
    subscribeSegmentHud(cb) {
      return segment.subscribeHud(cb);
    },
  };
}
