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
  computeBrushCenter,
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
import { boxEdges } from "./box-edges.ts";
import {
  flyLook,
  flyMove,
  type OrbitState,
  toEyeTarget,
} from "./camera-control.ts";
import {
  createFlagStore,
  type FlagFilters,
  type FlagRow,
  type FlagsSummary,
  flagTint,
  INFO_TINT,
} from "./field-flags.ts";
import {
  boxCorners,
  GHOST_COLOR,
  generatorFootprint,
  segmentGhostSegments,
  sphereGhostSegments,
} from "./field-ghost.ts";
import {
  FALLBACK_COLLISION,
  FALLBACK_TINT,
  groupPlacements,
  type PlacedArchetype,
  PROXY_PRIMITIVE,
  placementGhostBatch,
  placementsByEntity,
  placesProps,
  proxyRecords,
  seedArchetypeParams,
  withArchetypeOptions,
} from "./field-placements.ts";
import {
  createPreviewCoalescer,
  previewIsEmpty,
  type StampSession,
  startReconfigureSession,
  startSession,
  toPreviewing,
  withParams,
  withPreviewError,
  withPreviewResult,
  withRegion,
} from "./field-stamp.ts";
import { arrowNudgeSteps } from "./input-map.ts";
import { buildGridLines, segmentsToBatch } from "./reference-grid.ts";

/** Shading toggle: `flat` = unlit normal-colour (structure legibility); `headlamp` =
 *  the game-parity lit material under a camera-carried point light (mood preview). */
export type FieldHostShading = "flat" | "headlamp";

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
  effect: "dig" | "fill" | "paint" | "smooth";
  materialId: number;
  mask: FieldMaskChoice;
  smooth: {
    strength: number;
    iterations: number;
    mode: "both" | "erode" | "fill";
  };
  hollow: number | null;
};

/** Which selection gesture LMB performs while a selection mode is armed:
 *  `box` = two clicks spanning a lattice-snapped region; `material` = flood
 *  the same-class solid from the hit voxel; `void` = flood the air pocket the
 *  cursor ray crosses just before its hit. */
export type SelectionMode = "box" | "material" | "void";

/** What an LMB click DOES in the viewport — ONE slot, so arming any of these
 *  disarms the others: a {@link SelectionMode} gesture, the two-click
 *  `segment` brush (D-F3-14: anchor, then commit ONE swept-capsule op with the
 *  active tool's effect/material — dig carves a tunnel, fill raises a
 *  rampart), or `null` for a plain brush stroke.
 *
 *  `segment` is a BRUSH gesture, not a selection: it makes no selection, and
 *  the brush parameters (radius = the capsule radius, effect, material, mask)
 *  stay live under it — which is why the panel keeps the brush inspector open
 *  for `segment` and hides it for the three selection modes. */
export type ViewportGesture = SelectionMode | "segment";

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
   *  point); `undoDepth` = the history that compaction requires empty.
   *  Recomputed only when the log changed (an O(ops) scan is not a per-frame
   *  cost) — see the tick's log-signature gate. */
  totalOps: number;
  liveGenerators: number;
  compactableOps: number;
  undoDepth: number;
  /** Wall-clock of the last LANDED {@link FieldHost.applyReconfigure}, ms
   *  (0 = none has run this session; a reconfigure core REJECTED does not update
   *  it). The reconfigure stall grows with the LOG, so this is the meter's
   *  honest read on how heavy the recipe has become. */
  lastReconfigureMs: number;
  /** Walkability-advisor passes the host is still owed an answer for: 1 for a
   *  posted-and-unanswered pass, plus 1 for edits queued behind it. 0 means the
   *  flag markers describe the field as it stands. Never above 2 — the analyze
   *  pump is a latest-wins latch, so at most one pass is in flight and everything
   *  behind it collapses into one re-fire. Stays 0 with no agent profile
   *  installed, where nothing is ever posted (see
   *  {@link FieldHost.setAgentProfile}). */
  analyzerPending: number;
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
   *  Shift/Ctrl enter/leave) so the panel can mirror them. NOT fired for a
   *  plain panel setTool — EXCEPT when the panel's setTool lands while a
   *  momentary modifier is held: that re-derives the effective tool and DOES
   *  fire, carrying the DERIVED tool (not what the panel set), so the panel
   *  must value-compare against its own state before re-pushing (echo guard).
   *  Single subscriber (the panel); returns an unsubscribe. */
  subscribeTool(cb: (tool: FieldTool) => void): () => void;
  /** Subscribes to user-facing tool problems: swallowed stroke failures (kit
   *  fill off the lattice, unknown material class — F2a buried these in
   *  console.warn; the console trail stays) and the selection-mask-without-a-
   *  selection drop (reported once per pointer-down stroke, re-armed on the
   *  next stroke, so a drag can't spam at stroke rate). Single subscriber
   *  (the shell's host-state provider, which posts each message as a toast);
   *  returns an unsubscribe. */
  subscribeToolError(cb: (msg: string) => void): () => void;
  /** Arms what an LMB click does ({@link ViewportGesture}): a selection
   *  gesture (`box`/`material`/`void`), the two-click `segment` brush, or
   *  `null` for a plain brush stroke. ONE slot — arming any gesture disarms
   *  the one before it. A selection gesture governs only the GESTURE: an
   *  existing selection persists across changes (it keeps masking ops until
   *  cleared). Any pending box OR segment anchor is dropped on a change.
   *  Esc cancels a pending SEGMENT anchor (only when no stamp session owns the
   *  key); the selection gestures deliberately have no keyboard shortcuts —
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
   *  pushes the CURRENT state on subscribe, so a panel that (re)mounts while
   *  a selection exists never shows "no selection" beside a visible overlay.
   *  Single subscriber (the panel); returns an unsubscribe. */
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
  /** The registry's staged generators (id/name/param schema/defaults) for the
   *  panel's palette + stamp form — surfaced through the host because the
   *  chrome cannot value-import core's FIELD_GENERATORS. Schema/defaults are
   *  CLONED per call (plain-data records), so the panel never holds registry
   *  state.
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
   *  the first ghost preview. No selection → subscribeToolError ("select a
   *  region first"), no session. A truncated-flood selection carries
   *  `truncatedSelection` into the session so the stamp UI can surface that
   *  the region under-covers the flood. Replaces any existing session (its
   *  ghost is destroyed; in-flight previews are dropped).
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
   *  in `arrowNudgeSteps`; the inspector's buttons call this same seam.
   *
   *  Supersedes any in-flight preview (its response is dropped — the run
   *  bumps like a params change). No-op without a session. */
  nudgeStamp(dx: number, dy: number, dz: number): void;
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
   *  reconfigure. Enter in the viewport is this; a panel commit button should
   *  be this too, so the mode→verb mapping lives in ONE place instead of being
   *  re-derived from the session the panel mirrors. Ready-phase only (both
   *  verbs are); no-op without a session. */
  commitSession(): void;
  /** Discards the session + its ghost (Esc). No-op without a session. */
  cancelStamp(): void;
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
   *  `docs/backlog/editor-and-tooling/field-f2b-gate-ux-findings.md` #6). A
   *  panel affordance is the fix, and it calls this.
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
   *  rationale); sessions are CLONED — the panel never holds host state.
   *  Single subscriber (the panel); returns an unsubscribe. */
  subscribeStamp(cb: (s: StampSession | null) => void): () => void;
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
   *  `docs/backlog/editor-and-tooling/field-reconfigure-ghost-exactness.md`.
   *
   *  Runtime-quiet on everything it can refuse: an unknown id, a FROZEN or
   *  BAKED entity, and an entity whose recorded generator has left the registry
   *  all report through {@link subscribeToolError} and open no session. */
  openEntity(entityId: number): void;
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
  /** Subscribes to the latest reconfigure drift report: the downstream ops the
   *  last {@link applyReconfigure} replayed whose outcome moved (`drifted`) or
   *  vanished (`orphaned`). Pushed on every apply that LANDS — null when that
   *  apply found nothing, so a clean reconfigure clears the previous report —
   *  and null on world reset/load (a report names op ids the new log does not
   *  have). An apply core REJECTS pushes nothing at all: it changed no op, so
   *  the standing report still describes the log as it is, and clearing it
   *  would destroy findings on behalf of an edit that never happened.
   *  Reports are CLONED and the CURRENT one is pushed immediately on subscribe
   *  (the {@link subscribeStamp} remount rationale). Dismissal is a HOST verb
   *  ({@link dismissDrift}) that nulls the report and notifies, not the UI's own
   *  state — so a panel remount after a dismiss re-subscribes to null rather
   *  than resurrecting a cleared report. NOT cleared by ⌘Z: undoing a
   *  reconfigure leaves its findings standing, still addressed by op id and
   *  chunk, describing an edit that is no longer applied. Single subscriber (the
   *  panel); returns an unsubscribe. */
  subscribeDrift(cb: (report: field.DriftFinding[] | null) => void): () => void;
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
  /** Subscribes to "the entity list may have changed" — a bare TICK, not a
   *  value: the subscriber re-reads {@link listEntities} itself (the records are
   *  clones; pushing them would clone on every fire whether or not anything
   *  moved). Fires on commit, apply, freeze/unfreeze, bake, ⌘Z/⇧⌘Z, world
   *  new/load, and ONCE immediately on subscribe (a panel that mounts after the
   *  world loaded must not render an empty list). Freeze and bake dirty NO
   *  chunk, so this is the only signal that carries them — the remesh counter
   *  never moves. Single subscriber (the panel); returns an unsubscribe. */
  subscribeEntities(cb: () => void): () => void;
  /** The committed generator entities, in log order (CLONES — read from the
   *  op log's entity ops, so undo/redo and world loads stay accurate), each
   *  carrying the {@link FieldEntityInfo.placed} summary of its own span's
   *  placement records. */
  listEntities(): FieldEntityInfo[];
  /** Shows the amber-dim box of one committed entity's stamped FOOTPRINT —
   *  the union of its span's op bounds, falling back to the recorded
   *  selection region only when the span holds no field-writing ops (null =
   *  hide; unknown ids hide too — runtime-quiet). Display-only, under the
   *  `selection` layer gate. */
  highlightEntity(entityId: number | null): void;
  /** Installs the project's agent profile (`catalog/agent.json`) — the capsule,
   *  step and clearance the walkability advisor is parameterized on (D-F4-4).
   *
   *  A GATE, like the material table is for a kit fill: with no profile the
   *  advisor posts nothing at all, and the first edit that would have analysed
   *  says so ONCE through {@link subscribeToolError} rather than repeating at
   *  stroke rate. Nothing else is refused — every verb still works, because the
   *  advisor never blocks one (D-F4-1).
   *
   *  Installing catches the world up in full: the mirror re-syncs and the next
   *  pass is whole-world, so the first findings describe the field as it stands
   *  rather than only what has been edited since. */
  setAgentProfile(profile: field.AgentProfile): void;
  /** Subscribes to the advisor's findings, pushed after every analyzer response
   *  and after every {@link setFlagFilters}. Immediately pushes the CURRENT
   *  summary on subscribe (the {@link subscribeSelection} remount rationale).
   *  Single subscriber (the panel); returns an unsubscribe.
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
  /** How many flag markers the LAST rebuild decided to draw — the
   *  {@link propInstanceCounts} twin, and for the same reason: the marker layer
   *  is otherwise write-only GPU state, so this is what a caller (and a test) can
   *  hold the rebuild to. Equals the visible-flag count, including before GPU
   *  init and after {@link dispose}, where the number is decided but no draw
   *  exists. */
  flagMarkerCount(): number;
  /** Bakes the current field to the artifact file set (pure, for upload). */
  exportArtifact(name: string): field.BakedFile[];
  /** Subscribes to the live stats readout ({@link FieldStats}), pushed every
   *  rAF. Single subscriber (the panel); returns an unsubscribe. */
  subscribeStats(cb: (s: FieldStats) => void): () => void;
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
const STROKE_MIN_MS = 40; // stroke throttle (pointermove-while-digging)
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
 *  RESTATED in `ToolPalette`'s Segment tooltip — the chrome cannot value-import
 *  anything under `viewport-host/`, so the two agree by review (the FlagsSection
 *  tint-palette precedent). */
const MAX_SEGMENT_M = 2 * DIG_RANGE_M;
/** The project's runtime-built engine bundle, which is where stage 2's mover
 *  lives. The daemon serves it at this path; the analyzer worker imports it. */
const ANALYZER_ENGINE_URL = "/engine.js";
/** Wall-clock ceiling for ONE stage-2 verify. The mover is real and the lanes
 *  are budgeted, so the verb has to be able to give up: past this the verdict
 *  comes back `inconclusive` with reason `budget`, which the panel paints as no
 *  answer rather than as a third one. */
const VERIFY_BUDGET_MS = 8000;
const EDITOR_FOV_Y = Math.PI / 3;
const FLY_SPEED = 6; // m/s
const FLY_BOOST = 3; // shift-held multiplier
const MAX_FRAME_DT = 0.1; // clamp dt so a stall can't lurch the camera
const LOOK_SPEED = 0.005; // rad per pixel of RMB drag
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 4;
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
// Entity-highlight box colour: the selection amber DIMMED, so a highlighted
// entity region reads as related to but distinct from the live selection.
const ENTITY_HIGHLIGHT_COLOR: [number, number, number, number] = [
  0.55, 0.41, 0.17, 1,
];
// Box-select anchor cross: half-length of each of the three axis strokes (m).
const ANCHOR_CROSS_HALF_M = 0.25;

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
 */
export function createFieldHost(deps?: {
  spawnWorker?: () => WorkerLike;
  spawnAnalyzer?: () => WorkerLike;
}): FieldHost {
  let ctx: Context | null = null;
  let cam: camera.Camera | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let unbindCamera: (() => void) | null = null;

  const store = field.createFieldStore();
  const log = field.createOpLog();
  const dirty = new Set<string>();
  const worker = new FieldWorkerClient(deps?.spawnWorker);
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
  // Filled kit-fill ghost: ONE unit cube + ONE translucent hologram-blue
  // material, positioned + scaled to the snapped box per frame (mesh.setScale
  // exists — no per-size rebuild needed) and pushed into the render list only
  // while a kit-fill ghost is live.
  let ghostMat: material.Material | null = null;
  let ghostBind: binding.Binding | null = null;
  let ghostCube: mesh.Mesh | null = null;
  let ghostCubeGeo: geometry.Geometry | null = null;
  let shading: FieldHostShading = "flat";

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
  let toolCb: ((t: FieldTool) => void) | null = null;
  // User-facing tool-problem channel (the chrome's toast stack + message log).
  let toolErrorCb: ((msg: string) => void) | null = null;
  // Once-per-GESTURE guard for the "selection mask but no selection" report.
  // The gesture whose repeats need suppressing is the drag: a stroke re-arms
  // this at pointer-down, so one 40ms-throttled drag reports once. The segment
  // brush re-arms per COMMIT instead — its unit is the two-click pair, not a
  // drag, so sharing the stroke's re-arm point would silence every segment
  // after the first.
  let maskDropReported = false;

  // --- gesture + selection state (armed slot, current + Reselect, overlay) --
  // What LMB does: one slot for the three selection gestures AND the segment
  // brush (see ViewportGesture) — they all bind the same click, so they cannot
  // be armed independently.
  let gesture: ViewportGesture | null = null;
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
  // Panel mirror for stamp-session changes (Task 15).
  let stampCb: ((s: StampSession | null) => void) | null = null;
  // The last reconfigure's drift report (null = the last apply was clean, or
  // none has run) + its panel subscriber.
  let drift: field.DriftFinding[] | null = null;
  let driftCb: ((report: field.DriftFinding[] | null) => void) | null = null;
  // Entity-list change tick (freeze/bake dirty no chunk, so the remesh counter
  // cannot carry them — see subscribeEntities).
  let entitiesCb: (() => void) | null = null;
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
  // Entity-highlight overlay (highlightEntity): prebuilt on the call, drawn
  // under the selection layer gate. CPU-only line batch.
  //
  // The ID is tracked BESIDE the batch because a committed region is no longer
  // immutable: F3a's reconfigure can move it (the card offers nudge), and undo
  // can move it back — so the batch has to be rebuildable from the id rather
  // than only from the call that first drew it. Before F3a the box could not go
  // stale, which is why the id was not kept.
  let highlightedEntityId: number | null = null;
  let entityHighlightBatch: LineBatch | null = null;

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
    // litInstanced material — a marker that dims when the headlamp looks away is
    // a marker that stops doing its job in the shading mode meant for mood.
    const markerShd = await shader.unlitInstanced(c);
    flagMarkerBind = binding.create(c, markerShd);
    binding.set(c, flagMarkerBind, { color: [1, 1, 1, 1] });
    flagMarkerMat = await material.create(c, {
      shader: markerShd,
      binding: flagMarkerBind,
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

  // Report a user-facing tool problem: console (developer trail, the F2a
  // behaviour kept) + the panel subscriber.
  const reportToolError = (msg: string): void => {
    console.warn(`field-host: ${msg}`);
    toolErrorCb?.(msg);
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

  const selectionInfo = (s: SelectionState): SelectionInfo => ({
    spec: cloneSelectionSpec(s.spec),
    count:
      s.materialized.kind === "cells"
        ? s.materialized.count
        : regionSampleCount(
            s.materialized.min,
            s.materialized.max,
            store.cellSize,
          ),
    truncated: s.materialized.kind === "cells" && s.materialized.truncated,
    aabb: selectionAabb(s),
  });

  const notifySelection = (): void => {
    selectionCb?.(selection === null ? null : selectionInfo(selection));
  };

  // The 12-edge line batch of a metre AABB — the selection overlay and the
  // entity highlight share it.
  const aabbEdgeBatch = (
    aabb: { min: Vec3T; max: Vec3T },
    color: [number, number, number, number],
  ): LineBatch => {
    const center: Vec3T = [
      (aabb.min[0] + aabb.max[0]) / 2,
      (aabb.min[1] + aabb.max[1]) / 2,
      (aabb.min[2] + aabb.max[2]) / 2,
    ];
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

  const setBoxAnchor = (p: Vec3T | null): void => {
    boxAnchor = p;
    if (p === null) {
      anchorBatch = null;
      boxPreviewBatch = null; // the pending-region preview dies with its anchor
      return;
    }
    const [x, y, z] = p;
    const r = ANCHOR_CROSS_HALF_M;
    anchorBatch = segmentsToBatch(
      [
        [
          [x - r, y, z],
          [x + r, y, z],
        ],
        [
          [x, y - r, z],
          [x, y + r, z],
        ],
        [
          [x, y, z - r],
          [x, y, z + r],
        ],
      ],
      SELECTION_COLOR,
    );
  };

  // Install a new current selection (null = clear): park the displaced one in
  // the Reselect slot, rebuild the overlay, notify the panel.
  const setSelection = (next: SelectionState | null): void => {
    if (selection !== null) lastSelection = selection;
    selection = next;
    rebuildSelectionBatch();
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

  // The pending segment start (null = none), plus its hologram-blue cross. The
  // preview capsule dies with the anchor: without a start point there is no
  // second endpoint to sweep to.
  const setSegmentAnchor = (p: Vec3T | null): void => {
    segmentAnchor = p;
    if (p === null) {
      segmentAnchorBatch = null;
      segmentPreviewBatch = null;
      return;
    }
    const [x, y, z] = p;
    const r = ANCHOR_CROSS_HALF_M;
    segmentAnchorBatch = segmentsToBatch(
      [
        [
          [x - r, y, z],
          [x + r, y, z],
        ],
        [
          [x, y - r, z],
          [x, y + r, z],
        ],
        [
          [x, y, z - r],
          [x, y, z + r],
        ],
      ],
      GHOST_COLOR,
    );
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
  // Rebuilt on MOVE means exactly that: a radius change (wheel, [ / ]) with the
  // cursor still does not re-fatten the pending capsule until the next
  // pointermove. The sphere ghost, which IS rebuilt per frame, does not have
  // that gap. Accepted rather than moved into the frame path — a pending anchor
  // is a momentary state, and per-frame rebuilds are the cost the batches are
  // stored to avoid. Filed as item 9 of
  // `docs/backlog/editor-and-tooling/field-f2b-gate-ux-findings.md` (F4).
  const updateSegmentPreview = (clientX: number, clientY: number): void => {
    if (segmentAnchor === null) return;
    const p = selectionPoint(clientX, clientY);
    if (!p) return;
    segmentPreviewBatch = segmentsToBatch(
      segmentGhostSegments(segmentAnchor, p, digRadius),
      GHOST_COLOR,
    );
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
    const dx = p[0] - a[0];
    const dy = p[1] - a[1];
    const dz = p[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  const selectionClick = (
    selectionMode: SelectionMode,
    clientX: number,
    clientY: number,
  ): void => {
    if (selectionMode === "box") {
      const p = selectionPoint(clientX, clientY);
      if (!p) return;
      if (boxAnchor === null) {
        setBoxAnchor(p); // first corner — the amber cross previews it
        return;
      }
      const spec = boxRegionSpec(boxAnchor, p);
      setBoxAnchor(null);
      commitSelectionSpec(spec);
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

  // The entity-list tick. Fired by every path that can add, remove or rewrite
  // an entity RECORD — including the two (freeze, bake) that dirty no chunk and
  // would otherwise reach the panel through nothing at all.
  const notifyEntities = (): void => {
    entitiesCb?.();
  };

  // Cloned like the session: a drift report is plain data the panel keeps.
  const notifyDrift = (): void => {
    driftCb?.(drift === null ? null : structuredClone(drift));
  };

  // The LIVE entity record for an id (not a clone — callers that hand it on
  // clone at their own boundary), or null when no entity op carries it. The one
  // lookup behind the highlight box, the reconfigure session and the verbs.
  const entityRecord = (entityId: number): field.GeneratorEntity | null => {
    const hit = log.ops.find(
      (op): op is field.EntityOp =>
        op.kind === "entity" && op.entity.entityId === entityId,
    );
    return hit === undefined ? null : hit.entity;
  };

  // Re-derive the highlight box from the CURRENT record. Every path that can
  // move or remove a committed region calls this: a reconfigure apply (the
  // region is an editable field of the session) and undo/redo (which restores
  // the previous record). An entity that left the log clears the box and the
  // id, so an undone commit cannot leave an amber ghost floating over nothing.
  // The box outlines the stamped FOOTPRINT (union of the span's op bounds),
  // not the recorded selection region — an oversized region boxed mostly-empty
  // space (F3a gate finding); the region is only the no-span fallback.
  const rebuildEntityHighlight = (): void => {
    if (highlightedEntityId === null) return;
    const record = entityRecord(highlightedEntityId);
    if (record === null) {
      highlightedEntityId = null;
      entityHighlightBatch = null;
      return;
    }
    const footprint = generatorFootprint(log.ops, record, store.cellSize);
    entityHighlightBatch = aabbEdgeBatch(
      footprint ?? record.region,
      ENTITY_HIGHLIGHT_COLOR,
    );
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
    // Quiet: layer flags survive a dispose, so a re-init'd host must not fire a
    // job it has nowhere to put — the user re-toggles.
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
  // Once-EVER report for the missing profile (the maskDropReported discipline):
  // an edit loop would otherwise repeat it at stroke rate. Never re-armed,
  // because a profile can only be installed, never removed.
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
      if (!profileMissingReported) {
        profileMissingReported = true;
        reportToolError(
          "walkability advisor idle — this project installs no agent profile",
        );
      }
      // Every pending flag stays set, so an install later catches up in full.
      return undefined;
    }
    postMirrorSync();
    if (analyzerPlacementsStale) {
      analyzerPlacementsStale = false;
      void analyzer
        .placements(analyzerPlacementGroups())
        .catch(reportAnalyzerFailure);
    }
    // A whole-world request analyses the STORE, so an empty `dirty` here means
    // an empty store — nothing any pass could find. It is DEFERRED rather than
    // consumed: dropping it would be harmless today (every path that later fills
    // the store re-requests it, and the idle tail would catch the rest), but only
    // by a coupling a reader has to re-derive, and the flag surviving is free.
    // The first pass that has something to analyse then honours it, instead of
    // downgrading to incremental and making the user wait out the idle tail.
    const dirty = analyzerWholeWorld
      ? [...store.chunks.keys()]
      : [...analyzerDirty];
    if (dirty.length === 0) return undefined;
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
    flagsCb?.(summary);
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

  // Advisor passes still owed an answer — see FieldStats.analyzerPending. With
  // no profile the pending flags DO accumulate (they are the catch-up an install
  // would run), but nothing is posted and nothing will be until one arrives: the
  // advisor is off, not busy, and a meter stuck at 1 forever would say otherwise.
  const analyzerPendingCount = (): number => {
    if (agentProfile === null) return 0;
    const queued =
      analyzerDirty.size > 0 || analyzerWholeWorld || analyzerResync;
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
    // there is nothing to rotate).
    const matrices = new Float32Array(16 * summary.visible.length);
    const lift = store.cellSize / 2;
    let i = 0;
    for (const row of summary.visible) {
      const o = i * 16;
      matrices[o] = FLAG_MARKER_SIZE_M;
      matrices[o + 5] = FLAG_MARKER_SIZE_M;
      matrices[o + 10] = FLAG_MARKER_SIZE_M;
      matrices[o + 12] = row.flag.world[0];
      matrices[o + 13] = row.flag.world[1] + lift;
      matrices[o + 14] = row.flag.world[2];
      matrices[o + 15] = 1;
      mesh.setInstanceTint(c, im, i, flagTint(row));
      i++;
    }
    mesh.setInstanceMatrices(c, im, matrices);
    flagMarkers = { im, g };
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
              stamp = next;
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
  // Known v0 divergence window (F2b Task 15 disposition): a ⌘Z or a brush
  // stroke DURING a live session mutates the store this preview snapshotted,
  // so a keep-existing-air ghost can differ from what commit later builds
  // (commit re-evaluates against the then-current field). Contrived today —
  // the session flow invites Enter/Esc before more digging — so it is
  // documented here rather than fixed with cancel-on-undo. See also
  // commitStampSession.
  const previewStamp = (): void => {
    if (stamp === null) return;
    stamp = toPreviewing(stamp);
    previewCoalescer.request();
    notifyStamp();
  };

  // Move the session's placement region by whole lattice steps and re-preview
  // — the ONE path behind both the arrow keys and the inspector's buttons.
  // Region changes supersede like params changes (withRegion bumps the run),
  // so an in-flight ghost for the old placement is dropped on arrival, and
  // sendPreviewJob re-snapshots chunks off the NEW region by itself.
  const nudgeStampRegion = (steps: Vec3T): void => {
    if (stamp === null) return;
    stamp = withRegion(stamp, nudgeRegion(stamp.region, steps));
    previewStamp();
  };

  const cancelStampSession = (): void => {
    if (stamp === null) return;
    stamp = null;
    destroyStampGhosts();
    notifyStamp();
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
  // inherits the divergence window `previewStamp` documents: a ⌘Z or a brush
  // stroke during a live session moves the store the preview snapshotted. Dig a
  // floor under a scatter that previewed empty and Enter still refuses, with
  // advice that is no longer true. Cheap to escape (any param change, re-roll or
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
  const openEntitySession = (entityId: number): void => {
    const record = entityRecord(entityId);
    if (record === null) {
      reportToolError(`entity ${entityId} is no longer in the log`);
      return;
    }
    // ONE rule, shared with the row's Open button (field-entity.ts): a state
    // the UI disables for and a state the host refuses can never drift apart.
    const blocked = openBlockedReason(record);
    if (blocked !== null) {
      reportToolError(`entity ${entityId} is ${blocked}`);
      return;
    }
    try {
      field.generatorById(record.generator); // setup-loud on a retired id
    } catch (err) {
      // Fail HERE rather than opening a session whose every preview errors and
      // whose Apply can never land (startStamp's precedent).
      const message = err instanceof Error ? err.message : String(err);
      reportToolError(message);
      return;
    }
    cancelStampSession(); // a live session (+ ghost) never survives a re-open
    stampGen++;
    stamp = startReconfigureSession({
      entityId,
      generator: record.generator,
      // Clone at the boundary: the session must never alias the log's record.
      params: structuredClone(record.params),
      seed: record.seed,
      region: structuredClone(record.region),
      // Not provenance — see the openEntity contract.
      policy: "replace",
    });
    previewStamp();
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
    // the highlight box this entity may be wearing can be stale as of now.
    rebuildEntityHighlight();
    // A clean apply CLEARS the previous report: leaving it up would attribute
    // stale findings to the edit the user just made.
    drift = result.drift.length === 0 ? null : result.drift;
    stamp = null;
    destroyStampGhosts();
    // A re-cooked scatter replaces its own placement op's records, and any
    // reconfigure re-splices the log the prop layer is derived from.
    rebuildProps();
    // The three notifications LAST, once every piece of host state the apply
    // moved has settled: a subscriber may read the host back synchronously from
    // inside any of them (the panel does — subscribeEntities' callback calls
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

  // --- history ------------------------------------------------------------

  // ONE undo/redo step, shared by the canvas ⌘Z/⇧⌘Z binding and the public
  // undo()/redo(). Everything a step can move is refreshed here, not at the
  // call sites: the chunks it dirtied, the entity list (a commit, a reconfigure
  // splice and a freeze/bake record swap all ride these stacks — and the last
  // two dirty NOTHING, so a remesh cannot be the panel's signal), and the
  // highlight box (a reconfigure can have moved the region it outlines).
  const stepHistory = (redo: boolean): void => {
    const dirtied = redo
      ? field.redo(store, log, table)
      : field.undo(store, log);
    markDirtyWithNeighbors(dirtied);
    rebuildEntityHighlight();
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

  // Mirror a host-initiated tool change to the panel (cloned — the panel must
  // never hold a reference into host state).
  const notifyTool = (): void => {
    toolCb?.(cloneTool(tool));
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
    // Two independent ghost gates: the LAYER flag is user intent; the
    // gesture suppression is mode coherence — while ANY gesture is armed LMB
    // doesn't stroke, so a sphere/box brush preview would promise an action
    // that won't happen. The segment brush is included: its click anchors or
    // sweeps a capsule, never stamps the sphere this ghost draws. Its own
    // preview only appears once a point IS anchored, so an armed-but-unanchored
    // segment shows no brush affordance at all — the box gesture's precedent.
    // Filed as item 10 of
    // `docs/backlog/editor-and-tooling/field-f2b-gate-ux-findings.md` (F4).
    const ghost = layers.ghost && gesture === null ? ghostState() : null;
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
    // Selection overlay: amber AABB + pending box-select anchor cross + the
    // pending-region preview, all occlude:false so a selection reads through
    // rock. Batches are prebuilt on selection change (the box preview on pointer
    // move) — nothing is materialized per frame. Hiding the layer hides the
    // DISPLAY only: the selection itself stays live (it keeps masking ops and
    // the panel keeps its info).
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
      if (entityHighlightBatch)
        frame.drawLines(c, {
          vertices: entityHighlightBatch.vertices,
          colors: entityHighlightBatch.colors,
          camera: view,
          occlude: false,
        });
    }
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
      const ls = currentLogStats();
      statsCb?.({
        chunks: store.chunks.size,
        lastRemeshMs,
        remeshVersion,
        totalOps: ls.totalOps,
        liveGenerators: ls.liveGenerators,
        compactableOps: ls.compactableOps,
        undoDepth: ls.undoDepth,
        lastReconfigureMs,
        analyzerPending: analyzerPendingCount(),
      });
      renderScene(c, cam);
    }
    raf = requestAnimationFrame(tick);
  };

  // --- input handlers -----------------------------------------------------

  const onPointerDown = (e: PointerEvent): void => {
    lastPointer = { x: e.clientX, y: e.clientY }; // feeds the per-frame ghost
    if (e.button === 0 && e.altKey) {
      // Alt-click samples a material — never strokes, so it stays live in
      // selection mode too (a brush affordance the gestures don't collide with).
      eyedropper(e.clientX, e.clientY);
      return;
    }
    if (e.button === 0 && gesture !== null) {
      // Armed gestures BYPASS applyTool entirely: no stroke, no digging flag,
      // no pointer capture (single clicks, nothing drags). RMB look below
      // stays live under every gesture.
      if (gesture === "segment") segmentClick(e.clientX, e.clientY);
      else selectionClick(gesture, e.clientX, e.clientY);
      return;
    }
    if (e.button === 0) {
      digging = true;
      maskDropReported = false; // re-arm the once-per-stroke mask-drop report
      applyTool(e.clientX, e.clientY);
      canvasEl?.setPointerCapture(e.pointerId);
    } else if (e.button === 2) {
      look = { lastX: e.clientX, lastY: e.clientY };
      canvasEl?.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    lastPointer = { x: e.clientX, y: e.clientY }; // feeds the per-frame ghost
    if (look) {
      const dx = e.clientX - look.lastX;
      const dy = e.clientY - look.lastY;
      look.lastX = e.clientX;
      look.lastY = e.clientY;
      orbitState = flyLook(orbitState, -dx * LOOK_SPEED, -dy * LOOK_SPEED);
      applyOrbit();
      return;
    }
    // Box-select live preview: while a box anchor is pending, keep the amber
    // region the second click would commit updated as the cursor moves.
    if (gesture === "box" && boxAnchor !== null) {
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

  const onPointerUp = (e: PointerEvent): void => {
    digging = false;
    look = null;
    canvasEl?.releasePointerCapture(e.pointerId);
  };

  // NOTE: no pointer-leave handler on purpose — lastPointer survives the
  // pointer leaving the canvas so the ghost previews panel-driven size changes
  // (see the lastPointer declaration comment).

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
    // ⌘Z/⇧⌘Z (and ctrl+z) guard FIRST — the shortcut branches below must
    // never swallow undo/redo. (On non-mac, holding Ctrl for ctrl+z briefly
    // engages the momentary invert via its own "control" keydown; the tool
    // restores on release — accepted, undo itself is untouched.)
    if ((e.metaKey || e.ctrlKey) && k === "z") {
      e.preventDefault();
      // stopPropagation, not just preventDefault: the editor ALSO binds ⌘Z on
      // `window` (useGlobalKeybindings), and that listener's only target guard
      // is isTextInputTarget — which matches INPUT/TEXTAREA/contentEditable and
      // NOT a focusable <canvas>. Extending that guard would not help either:
      // matchBinding classifies a ⌘-chord BEFORE consulting it, deliberately
      // (pinned in keybindings.test.ts). So a ⌘Z over the field canvas reaches
      // the window listener too, and this line is what keeps the chord from
      // being handled twice.
      //
      // The window handler is LIVE now (useGlobalKeybindings routes ⌘Z/⇧⌘Z to
      // FieldHost.undo/redo — the field's op log is the editor's ONE history),
      // so this line is what it prevents: without it a ⌘Z over the focused
      // canvas would run stepHistory here AND again from the window listener,
      // stepping the log twice for one chord.
      //
      // Scoped to THIS branch on purpose: the canvas owns the ⌘Z chord and
      // nothing else the global listener binds. ⌘S should still reach the window
      // while the field has focus, so blanket-stopping would change a second
      // behaviour to fix one. (The bare keys F and ⌫ are unbound app-side and
      // unhandled here, so they propagate to nothing either way.)
      e.stopPropagation();
      stepHistory(e.shiftKey);
      return;
    }
    // Stamp session keys (after the undo guard, before every fallthrough):
    // Enter commits the READY ghost (or applies a reconfigure — same key, the
    // session's mode decides), Esc discards the session. Neither is a fly key,
    // so returning here never starves the keys set; without a session both are
    // swallowed unused (no preventDefault).
    if (k === "enter" || k === "escape") {
      if (stamp !== null) {
        e.preventDefault();
        if (k === "escape") cancelStampSession();
        else commitActiveSession(); // ready-phase only — else a no-op
        return;
      }
      // With no session owning the key, Esc drops a pending SEGMENT anchor —
      // the way out of a half-drawn capsule without committing one. Scoped to
      // the segment gesture on purpose: the box anchor's Esc is the same
      // one-liner but a separate UX change, filed rather than folded in
      // (backlog `field-f2b-gate-ux-findings`).
      if (k === "escape" && segmentAnchor !== null) {
        e.preventDefault();
        setSegmentAnchor(null);
      }
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
    // [ / ] step the brush radius (same clamp as the wheel); key-repeat is the
    // hold-to-resize behaviour. Chord-guarded: ⌘[/⌘] (and ctrl+[/]) are the
    // browser's back/forward — never intercept those.
    if ((k === "[" || k === "]") && !e.metaKey && !e.ctrlKey) {
      const step = k === "]" ? RADIUS_WHEEL_STEP : -RADIUS_WHEEL_STEP;
      digRadius = clampRadius(digRadius + step);
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
  const onBlur = (): void => {
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
    canvas.addEventListener("pointercancel", onPointerUp);
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
    canvasEl.removeEventListener("pointercancel", onPointerUp);
    canvasEl.removeEventListener("wheel", onWheel);
    canvasEl.removeEventListener("contextmenu", onContextMenu);
    canvasEl.removeEventListener("keydown", onKeyDown);
    canvasEl.removeEventListener("keyup", onKeyUp);
    canvasEl.removeEventListener("blur", onBlur);
    canvasEl = null;
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
    selection = null;
    lastSelection = null;
    selectionBatch = null;
    notifySelection(); // null — the panel must not show a stale selection
    // A different world invalidates the stamp session (its region + snapshot
    // describe the old field), any entity highlight (log entity ids reset) and
    // any drift report (its findings name op ids the new log does not have).
    cancelStampSession();
    highlightedEntityId = null;
    entityHighlightBatch = null;
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
      // A world can be loaded BEFORE the GPU exists (the panel's Load races
      // init, and every headless caller never inits at all), and rebuildProps
      // no-ops without a context — so build the layer once here from whatever
      // the log already holds. Same for the advisor's markers: findings can
      // arrive before the GPU does, and the counts they settled are replayed
      // into draws here.
      rebuildProps();
      rebuildFlagMarkers(flagStore.summary());
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
      // `setAgentProfile`, and all of those set this flag themselves — so
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
        destroyStampGhosts();
        discardVoidCast();
        if (flatMat) material.destroy(c, flatMat);
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
        unbindCamera?.();
        gpu.dispose(c); // LAST — a clean shutdown is the leak check.
      }
      flatMat = null;
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
      // Unlike the selection (CPU-only, survives dispose), the stamp session
      // dies with its GPU ghost: a "ready" session with no ghost after a
      // re-init would promise a commit the user can no longer see. Silent (no
      // notify) — a remounting panel gets null pushed on re-subscribe.
      stamp = null;
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
      // v0: manifest.playerStart/playerYaw are the dungeon runtime spawn — the
      // editor keeps its current fly pose on load (not applied to the camera
      // here). `playerStart` IS read, as the walkability advisor's seed: it is
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
      if (next === gesture) return; // re-arming the same gesture must not drop a pending anchor
      gesture = next;
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
      rebuildSelectionBatch();
      notifySelection();
    },
    subscribeSelection(cb) {
      selectionCb = cb;
      // Initial push: a panel (re)mounting while a selection exists must not
      // render "no selection" next to a visible amber overlay.
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
      }));
    },
    propInstanceCounts() {
      return new Map(propCounts);
    },
    startStamp(generator) {
      const sel = selection;
      const aabb = sel === null ? null : selectionAabb(sel);
      if (sel === null || aabb === null) {
        reportToolError("select a region first");
        return;
      }
      let def: field.GeneratorDef;
      try {
        def = field.generatorById(generator); // setup-loud on unknown ids
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reportToolError(message);
        return;
      }
      // The selection's AABB snapped OUTWARD to the 0.5 m lattice — the same
      // snap box-select regions get (a region selection is already snapped;
      // flood AABBs land on the voxel grid and widen out).
      const [x0, x1] = snapSpan(aabb.min[0], aabb.max[0]);
      const [y0, y1] = snapSpan(aabb.min[1], aabb.max[1]);
      const [z0, z1] = snapSpan(aabb.min[2], aabb.max[2]);
      // Seed the size params from the selection extent (spec D-F3-13): the
      // region already fits, and the generator's size knobs default to fill it
      // (clamped to their schema range). A sensible default the user overrides
      // with any subsequent updateStamp edit.
      const sizes = deriveSizeDefaults(
        generator,
        [spanCells(x0, x1), spanCells(y0, y1), spanCells(z0, z1)],
        generatorSchemaProperties(def),
        field.MAZE_PITCH_CELLS,
      );
      cancelStampSession(); // a live session (+ ghost) never survives a restart
      stampGen++;
      // Layering, outermost last: schema defaults → the archetype's authored
      // scatter hints (catalog seeding) → the selection-fit sizes. The two never
      // collide today (no generator has both an archetypeId and a size param),
      // and if one ever does, the SELECTION the user drew should win over a
      // catalog default.
      stamp = startSession(
        generator,
        {
          ...seedArchetypeParams(structuredClone(def.defaults), archetypes),
          ...sizes,
        },
        { min: [x0, y0, z0], max: [x1, y1, z1] },
        randomStampSeed(),
        sel.materialized.kind === "cells" && sel.materialized.truncated,
      );
      previewStamp();
    },
    updateStamp(params, seed, policy) {
      if (stamp === null) return;
      // Clone at the boundary — session params must never alias panel state.
      stamp = withParams(stamp, structuredClone(params), seed, policy);
      previewStamp();
    },
    nudgeStamp(dx, dy, dz) {
      nudgeStampRegion([dx, dy, dz]); // no-ops without a session
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
    cancelStamp() {
      cancelStampSession();
    },
    undo() {
      stepHistory(false);
    },
    redo() {
      stepHistory(true);
    },
    subscribeStamp(cb) {
      stampCb = cb;
      // Initial push: a panel (re)mounting mid-session must not render "no
      // stamp" beside a visible ghost (the subscribeSelection rationale).
      cb(stamp === null ? null : structuredClone(stamp));
      return () => {
        if (stampCb === cb) stampCb = null;
      };
    },
    openEntity(entityId) {
      openEntitySession(entityId);
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
    subscribeDrift(cb) {
      driftCb = cb;
      // Initial push (the subscribeStamp/subscribeSelection remount rationale):
      // a panel remounting after a reconfigure must not drop its report.
      cb(drift === null ? null : structuredClone(drift));
      return () => {
        if (driftCb === cb) driftCb = null;
      };
    },
    dismissDrift() {
      drift = null;
      notifyDrift();
    },
    frameChunks(chunks) {
      if (chunks.length === 0) return;
      const dim = field.CHUNK_DIM * store.cellSize;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const key of chunks) {
        const [cx, cy, cz] = field.parseChunkKey(key);
        minX = Math.min(minX, cx * dim);
        maxX = Math.max(maxX, (cx + 1) * dim);
        minY = Math.min(minY, cy * dim);
        maxY = Math.max(maxY, (cy + 1) * dim);
        minZ = Math.min(minZ, cz * dim);
        maxZ = Math.max(maxZ, (cz + 1) * dim);
      }
      orbitState = {
        ...orbitState,
        target: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      };
      applyOrbit(); // no-op before init (guards on cam); target still moved
    },
    subscribeEntities(cb) {
      entitiesCb = cb;
      cb(); // initial catch-up: the world may already hold entities
      return () => {
        if (entitiesCb === cb) entitiesCb = null;
      };
    },
    listEntities() {
      // One attribution pass for the whole list, not one scan per row: the
      // helper walks the log once and hands back every entity's placements.
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
    highlightEntity(entityId) {
      if (entityId === null) {
        highlightedEntityId = null;
        entityHighlightBatch = null;
        return;
      }
      // Unknown id (undone, stale panel row): rebuild clears both, runtime-quiet.
      highlightedEntityId = entityId;
      rebuildEntityHighlight();
    },
    setAgentProfile(profile) {
      agentProfile = profile;
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
      // Initial push (the subscribeSelection remount rationale): a panel
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
    flagMarkerCount() {
      return markerCount;
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
