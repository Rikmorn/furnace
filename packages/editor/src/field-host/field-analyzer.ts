// The walkability advisor: the analyzer worker's mirror of the field, the
// findings it reports back, and the two layers that draw them. The twelfth
// cluster lifted out of `createFieldHost`, and the largest single one — 18 of its
// 19 state bindings and all 14 of its functions.
//
// ADVISORY THROUGHOUT (D-F4-1) — nothing here blocks a verb, mutates the field,
// or fixes anything. It draws markers and fills a list. That posture is what
// makes the cluster self-contained enough to leave in one piece: everything it
// OWNS is derived from what the rest of the host did, and it hands nothing back
// that another cluster's correctness depends on.
//
// Two cadences, and the split is the whole cost story. Per-edit passes analyse
// what was written; the CONNECTIVITY passes (reachability demotion, pit
// detection) are whole-world by nature and run on the idle tail — see
// ANALYZER_IDLE_MS.
//
// WHY THE SEAM IS BIGGER THAN THE CLUSTER'S FUNCTION COUNT. The closure map
// (`docs/reference/field-host-clusters.md` §6) counts 14 functions and 6 public
// members; this module exports 18 verbs. **Twelve** of them are therefore not a
// `FieldHost` member, and none is new behaviour — the arithmetic is worth doing
// here because the headline "14 mutation edges" does not by itself reach twelve:
//
//   - FIVE carry all **14 inbound MUTATION edges** between them
//     ({@link Analyzer.retireWorld} 5, {@link Analyzer.noteWorldLoaded} 3,
//     {@link Analyzer.dispose} 3, {@link Analyzer.markPlacementsStale} 2,
//     {@link Analyzer.noteDensityWritten} 1), which were bare assignments into
//     this cluster's flags from three other clusters' functions.
//   - THREE are calls the host already made into this cluster's functions and now
//     makes onto the seam ({@link Analyzer.requestPass},
//     {@link Analyzer.rebuildMarkers}, {@link Analyzer.destroyMarkers}); two of
//     those also absorb an inbound READ edge (`analyzePump`, `flagStore`).
//   - FOUR are what other clusters read or ask OFF the advisor
//     ({@link Analyzer.setSelectedFlag}, {@link Analyzer.markerMesh},
//     {@link Analyzer.selectionBatch}, {@link Analyzer.pendingCount}).
//
// §2.6 records the inverse shape for `picking` (4 functions, ONE verb) and
// draws the same conclusion from the other end: a row's function count measures
// the cluster, never the seam it will need. A cluster nobody writes into shrinks
// on the way out; a cluster everybody writes into grows.
//
// Every one of those verbs is named for the ACT rather than for the field, on
// `field-props.ts`'s `markPlacementsStale` precedent — which is also the one verb
// here that keeps its original name, because the host had already been forced to
// name that act when `props` left. The rule it demonstrates is why the others
// follow it: `markPlacementsStale` covers THREE lines (two flags plus the pump
// request) because those three lines were one act, and a module that set two
// flags and left the scheduling out could set them and have nothing happen. So
// {@link Analyzer.noteDensityWritten} carries the dirty keys AND the pass request
// AND the idle re-arm, and {@link Analyzer.retireWorld} carries the whole of what
// a world swap means to an advisor.
//
// WHY `flagStore` IS NOT IN THIS FILE, which is the one piece of this cluster
// that could not travel. It is a `HostSubstrate` VALUE member, and the substrate
// is assembled at the top of the closure — ~1,800 lines above where this module
// is constructed — so the handle has to exist before any module could own it.
// T3b1 had already hoisted its declaration out of the advisor block for exactly
// that reason. It also has a second extracted reader (`field-picking.ts`, through
// `substrate.flagStore`), so it is genuinely shared state rather than this
// cluster's private store. It therefore stays a closure `const` and a substrate
// value member — the `propMeshes` / `ghostMeshes` / `voidCastMeshes` disposition
// (`litByClass` joined them at T3d Task 3), which the map's §1 accounting
// classifies as a SUBSTRATE LEFTOVER rather than as cluster state. This module
// reads it through the record like any other member, and the verdict is written
// at its declaration in `field-host.ts`.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - `store`, `log` and `flagStore` are `const` in the host, mutated through the
//     identity it hands over, so they ride BY VALUE inside the substrate.
//   - `archetypeById()`, `ctx()` and `disposed()` are host `let`s and ride as
//     SUBSTRATE THUNKS. `disposed()` is the loudest of the three here: four
//     functions in this file are `if (disposed) return` guards over an async
//     settlement, and a snapshot would read `false` forever — every one of them
//     would wave a post-teardown callback through.
//   - `worldEpoch` is NOT in the record and rides as a FUNCTION DEP —
//     `() => world.epoch()` since 2026-08-08 (foundations T3d Task 6). It was a
//     host `let` with exactly one extracted reader when this was written
//     (`field-props.ts`'s `kitMat` precedent, the two-extracted-readers bar in its
//     active form); **T3d Task 5 added the second** (`field-entities.ts`, in the
//     footprint memo's log signature), so by the bar as stated above it QUALIFIED
//     for a `HostSubstrate` member, and the site that used to be the bar's live
//     example would have refuted it if the paragraph had stopped there.
//
//     It never became one, and the reason is the rule `field-host.ts` states
//     verbatim at `digRadius`' deleted declaration: **state that acquires an OWNER
//     rides on that owner's seam instead, and reader COUNT is the wrong question
//     once it has one** (`editor-architecture.md` §21.1; `view`'s `layers`/`sliceY`
//     are the precedent, five reader clusters between them). The substrate is for
//     state with NO owner to ride on. **T3d Task 6 gave this one an owner**: the
//     counter is `field-world.ts`'s private state now and both extracted readers
//     re-pointed onto its getter, which is the first of the two dispositions the
//     migration marker here offered. The substrate was never widened, and a
//     widening would have charged every future assembly for a member that was
//     about to move.
//
//     THE CYCLE THAT MADE THIS DELICATE IS OPEN IN ONE DIRECTION, and it is worth
//     naming because the ordering is what makes the dep legal: `world.reset()`
//     calls `retireWorld` in this module while this module reads `world`'s epoch
//     back, so the two are mutually dependent. `createWorld` is assembled 825
//     lines BELOW `createAnalyzer` in `field-host.ts`, which makes THIS side the
//     lazy one — the arrow at the assembly cannot be evaluated before the
//     declaration it names, for the reason the `createVoidCast` assembly states in
//     full.
//   - `flagMarkerMat` was the second of that pair until 2026-08-08 (foundations
//     T3d), when the material layer got an owner: the dep is now a plain ref onto
//     `field-materials.ts`'s seam, the substrate was never widened, and the
//     substrate-bar argument no longer applies to it at all. The CALL is
//     unchanged and so is its reason — the material is built at `init` and nulled
//     at `dispose`. `field-props.ts`'s header records the identical expiry for
//     `kitMat`, which was the same cluster on the same day. `worldEpoch` followed
//     the identical arc one task later — see its bullet above.
//   - `flagsChannel` is this module's own `ViewChannel`, held directly rather than
//     behind a `() => cb` thunk, because a channel is a `const` whose identity
//     never moves (map §2.2).
//
// AND TWO DEPS THAT ARE NEITHER, because they name an ACT in another cluster
// rather than a binding: {@link AnalyzerDeps.frameCameraOn} and
// {@link AnalyzerDeps.selectionOutline}. Both could have been spelled as the
// bindings they close over — `orbitState` + `aimCamera` + `applyOrbit` for the
// first, `aabbEdgeBatch` + `SELECTED_COLOR` for the second — and passing the
// bindings would have obeyed the law too (a thunk over `orbitState`, a plain ref
// to a `const` arrow). It would also have imported the camera's framing
// composition and the editor's selection accent into a module that has no
// business knowing either. What the advisor knows is WHICH box: the flag's cell.
// How a camera frames a box, and what colour "selected" is, stay with the
// clusters that own those answers — which is the same trade `markPlacementsStale`
// makes in the other direction.
//
// THE CAMERA HALF COLLECTED ON THAT ON 2026-08-08 (T3d Task 4), which is the
// check the argument was making. `camera` left for `field-camera-rig.ts` and took
// the THREE named above with it — `orbitState`, `aimCamera`, `applyOrbit`; the
// host's `frameCameraOn` is `cameraRig.frameOn` now, and THIS FILE did not change
// a line for it, only the assembly's dep line. Had those three been passed
// instead, that extraction would have had to rewrite this module's deps record,
// its header and its `selectFlagImpl`. `selectionOutline`'s two are the same bet
// still open, on `selection` at Task 5.
//
// NO UNIT TEST, by the house pattern nine extractions old: the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED across this move ARE this module's contract, and
// for this cluster they are unusually thorough — `tests/field-host-analyzer.test.ts`,
// `tests/field-host-analyzer.gpu.test.ts`, `tests/field-host-flag-select.test.ts`
// and `tests/analyzer-verify.test.ts` between them drive the pump, the mirror, the
// filters, the marker layer, the selection outline and both verify latches. The
// pure arithmetic underneath is already pinned without a host by
// `tests/field-host/field-flags.test.ts`.
//
// ONE COVERAGE ASYMMETRY, MEASURED AT THE EXTRACTION AND WORTH KNOWING BEFORE YOU
// TRUST A GREEN RUN. The three CPU suites above cover the profile gate, the world
// load/new sync, the filters, the seam, the selection and both verify latches —
// but NOT the density path. `noteDensityWritten` is the choke point every edit
// runs through, and deleting the host's call to it leaves all three of them
// passing (29/29). The five tests that go red are ALL in
// `tests/field-host-analyzer.gpu.test.ts` — "a dig syncs exactly the chunks it
// wrote and analyses them incrementally", "analyzerPending counts the pass in
// flight and the work queued behind it", "the whole-world pass runs on the idle
// TAIL of an edit burst, once", "the flag-and-fix loop: an edit raises a
// candidate, the fix retires it", "a whole-world request outlives an empty store".
// The reason is structural rather than an oversight: reaching this module from a
// DIG means digging, and digging means a device. So `bun test <the CPU files>`
// green says nothing about the mirror keeping step with the field, and anyone
// touching the density wire has to run the GPU lane.
import type * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import {
  type AnalyzeInput,
  AnalyzerWorkerClient,
  createAnalyzePump,
} from "./analyzer-client.ts";
import type { WorkerLike } from "./field-client.ts";
import {
  type FlagFilters,
  type FlagsSummary,
  flagCellBox,
  flagMarkerCenter,
  flagMarkerStyle,
} from "./field-flags.ts";
import type { ToolErrorSeverity } from "./field-host.ts";
import { FALLBACK_COLLISION, groupPlacements } from "./field-placements.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel } from "./view-channel.ts";

// UNEXPORTED on purpose, though both appear in the exported signatures below.
// That is this directory's settled pattern rather than an oversight —
// `field-segment.ts`, `field-machine.ts` and `field-drift.ts` each declare the
// same aliases privately and use them in their own seams, because a name is not
// part of a structural type's identity and exporting a fifth spelling of
// `{ vertices, colors }` would add surface without adding a contract. A `Box3`
// alias was written here and DELETED for the same reason: the box is spelled
// `{ min: Vec3T; max: Vec3T }` inline below, which is exactly how the host's
// `aabbEdgeBatch` spells its own parameter. Consolidating the four across the
// directory is a prune-tranche job, not this one's.
type Vec3T = [number, number, number];
type LineBatch = { vertices: Float32Array; colors: Float32Array };
type FlagMarkers = { im: mesh.InstancedMesh; g: geometry.Geometry };

/** The project's runtime-built engine bundle, which is where stage 2's mover
 *  lives. The daemon serves it at this path; the analyzer worker imports it. */
const ANALYZER_ENGINE_URL = "/engine.js";
/** Wall-clock ceiling for ONE stage-2 verify. The mover is real and the lanes
 *  are budgeted, so the verb has to be able to give up: past this the verdict
 *  comes back `inconclusive` with reason `budget`, which the panel paints as no
 *  answer rather than as a third one. */
const VERIFY_BUDGET_MS = 8000;
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

/** What the walkability advisor needs from the rest of the host.
 *
 *  Six entries beside the substrate. Two name verbs of other extracted modules
 *  (`reportToolError`, `chunkCopy` — `field-tool.ts`'s and `field-world.ts`'s),
 *  one names a counter that module owns and this one must read live
 *  (`worldEpoch`), one names another module's material (`flagMarkerMat`,
 *  `field-materials.ts`'s since T3d), and two name an ACT in another cluster
 *  (`frameCameraOn`, `selectionOutline`) — this module's header says why those
 *  last two are not spelled as the four bindings they close over. */
export type AnalyzerDeps = {
  /** The host's shared state. Six members are read: `store` (the field the
   *  mirror is a copy of and every marker is positioned against), `log` (the
   *  placement ops the collider set is derived from), `flagStore` (the findings —
   *  a substrate member rather than this module's own; see the header),
   *  `archetypeById()` (each placement's collision primitive), `ctx()` (the GPU
   *  guard) and `disposed()` (the guard on every async settlement). */
  substrate: HostSubstrate;
  /** How the analyzer worker is created. `undefined` takes the real
   *  `/analyzer-worker.js`; tests inject the protocol handler directly, because a
   *  Worker spawned from that URL never settles under `bun test`. Passed through
   *  from `createFieldHost`'s own `deps`. */
  spawnAnalyzer?: () => WorkerLike;
  /** Report something the user should see (console + the panel's message
   *  channel). An advisor failure is a TOOL problem, not a background hiccup, and
   *  is reported as `error`; exactly one caller in the whole host passes `warn`,
   *  and it is the advisor-idle notice below. */
  reportToolError(msg: string, severity?: ToolErrorSeverity): void;
  /** One chunk's density as a buffer another realm may own. The host's, shared
   *  with the void cast's snapshot — the two differ in WHY they copy, not in how,
   *  and a second spelling here would be a second boundary cast making the same
   *  claim. */
  chunkCopy(density: Int8Array): ArrayBuffer;
  /** The marker layer's material, or `null` before the first `init` and after
   *  `dispose`. The GPU guard: {@link Analyzer.rebuildMarkers} settles its count
   *  and then refuses to upload without it. A call because `field-materials.ts`
   *  builds the handle at `init` and nulls it at `dispose`, so a value copy would
   *  be `null` forever or would outlive the device. */
  flagMarkerMat(): material.Material | null;
  /** The world generation, bumped by every world reset. A verify is seconds long
   *  and a reset clears the findings, so a verdict landing after one has to be
   *  dropped — this module records the epoch at post time and compares at
   *  arrival. A call because `field-world.ts`'s reset bumps it AND because that
   *  module is assembled below this one: a snapshot would compare a live counter
   *  against a frozen one and drop every verdict after the first reset — and,
   *  taken eagerly, would not even construct. */
  worldEpoch(): number;
  /** Put the camera on a world box, as one act. `selectFlag` frames the finding
   *  it just adopted; the composition (`aimCamera` over `frameBox` over the
   *  current orbit, then `applyOrbit`) is the camera cluster's — the host's
   *  `frameCameraOn` until 2026-08-08, `field-camera-rig.ts`'s `frameOn` since,
   *  and this line is the whole difference the move made here. */
  frameCameraOn(box: { min: Vec3T; max: Vec3T }): void;
  /** The 12-edge line batch that says "this is what is selected", for one world
   *  box. The batch builder and the accent colour are both the host's — this
   *  module knows which box, not what selected LOOKS like.
   *
   *  ONE FUNCTION, TWO CALLERS: the host passes `field-selection.ts`' `outline`
   *  (its own `selectedBoxOutline` until T3d Task 5), which
   *  the selected ENTITY's footprint box is also built from. That is what keeps
   *  the two overlays one colour — a shared function rather than two call sites
   *  agreeing about a constant, which is the arrangement this sentence used to
   *  claim it had and did not. */
  selectionOutline(box: { min: Vec3T; max: Vec3T }): LineBatch;
};

/**
 * The walkability advisor's seam.
 *
 * Read as three groups of six, four and eight.
 *
 * The first six are FIVE of the `FieldHost` members this cluster backs, plus
 * {@link Analyzer.setSelectedFlag} — the RAW selection write, which is on the seam
 * because the viewport's own marker click (`field-picking.ts`) goes straight to
 * it, past the public verb's refusal and framing. The next four are FACTS read off
 * the advisor: two layers for `renderScene`, one meter for the stats push, and
 * {@link Analyzer.markerCount} — which is the SIXTH facade member, sitting here
 * rather than above because what it publishes is a fact and not a verb. The last
 * eight are the map's inbound mutation edges as verbs — every one named for the
 * act, and every one covering all of what that act meant where it used to be
 * written inline.
 */
export type Analyzer = {
  /** Install (or clear) the project's agent capsule. NOTHING is posted without
   *  one: the analyzer is parameterized on the agent, and a guessed capsule would
   *  be the advisor inventing its own premise. A profile catches the world up; a
   *  `null` answers the QUESTION and nothing more. */
  setAgentProfile(profile: field.AgentProfile | null): void;
  /** Subscribe to the findings, pushed after every response, every filter change
   *  and every world reset. Immediately pushes the current summary. */
  subscribeFlags(cb: (summary: FlagsSummary) => void): () => void;
  /** Replace the view filters and republish. A view preference: filters survive a
   *  world reset, and changing them posts nothing to the worker. */
  setFilters(filters: FlagFilters): void;
  /** Run stage 2 on one finding: the project's real mover, driven at it under a
   *  time budget. Refuses four ways — a verify already running, no profile, a key
   *  no visible row answers to, and a region-level (pit) finding. */
  verifyFlag(key: string): void;
  /** The public selection verb: refuses an unknown key, then adopts and FRAMES.
   *  `null` clears. */
  selectFlag(key: string | null): void;
  /** Adopt a selection and republish, with no validation and no camera. The
   *  viewport's marker click uses this deliberately — the user is looking at what
   *  they just clicked, so a frame there would be the camera jumping on every
   *  press. */
  setSelectedFlag(key: string | null): void;
  /** The marker layer's instanced mesh, or `null` when nothing is visible or
   *  before GPU init. `renderScene` pushes it under the `flags` layer gate.
   *
   *  The MESH and not the `{ im, g }` pair it is half of: the geometry exists only
   *  so this module can free it, and `renderScene` never had a use for it.
   *  `VoidCast.jobGen` states the ethic — the seam publishes the fact rather than
   *  a second derivation of it — and a pair here would be a second handle on GPU
   *  state whose whole lifecycle is {@link Analyzer.destroyMarkers}'s. */
  markerMesh(): mesh.InstancedMesh | null;
  /** The selected finding's cell outline, or `null` when nothing resolves.
   *  `renderScene` draws it under the same gate. */
  selectionBatch(): LineBatch | null;
  /** How many markers the last rebuild DECIDED on — settled before the GPU guard,
   *  so it is honest on a host that has never initialized. Backs
   *  `FieldHost.flagMarkerCount`. */
  markerCount(): number;
  /** Advisor passes still owed an answer, for `FieldStats.analyzerPending`. */
  pendingCount(): number;
  /** THE density choke point's second consumer: these chunk keys were written, so
   *  the mirror is behind. Carries the pass request and the whole-world re-arm
   *  with it, because the three lines were one act — the mirror learning what
   *  changed with nothing scheduled to send it would be a set that only grows. */
  noteDensityWritten(changed: ReadonlySet<string>): void;
  /** The placement colliders moved, and the next pass is the whole-world one.
   *  `field-props.ts`'s one boundary mutation, arriving here under the name the
   *  host had already given it. */
  markPlacementsStale(): void;
  /** This world is going: list the mirror's keys as removals, drop the pending
   *  write set, force a full re-sync, forget the seeds, and clear the findings.
   *  Must run BEFORE the store is emptied — the outgoing keys are read off it. */
  retireWorld(): void;
  /** A world was just decoded straight into the store: here is the agent's start,
   *  and the mirror knows nothing about any of it. */
  noteWorldLoaded(seed: Vec3T): void;
  /** Ask for a pass. Explicit at the two world verbs, where the analyzer work
   *  must not depend on the prop layer happening to rebuild on the same path. */
  requestPass(): void;
  /** Replay the marker layer from the standing findings. `init`'s: findings can
   *  arrive before the GPU does, and the counts they settled are uploaded here. */
  rebuildMarkers(): void;
  /** Free the marker layer. Takes the context rather than reading it, because its
   *  one external caller (`dispose`) has already proved it non-null for the whole
   *  teardown block. */
  destroyMarkers(c: Context): void;
  /** Terminate the worker and re-arm what a re-init will have to re-send. NOT the
   *  GPU teardown — {@link Analyzer.destroyMarkers} is that, and it is separate
   *  because it needs a context this one does not. */
  dispose(): void;
};

/** Build the walkability advisor over one host's dependencies. One per host; it
 *  holds that host's analyzer worker, its pending-work flags and its marker layer
 *  for the host's lifetime. */
export function createAnalyzer(deps: AnalyzerDeps): Analyzer {
  const { substrate } = deps;

  const analyzer = new AnalyzerWorkerClient(deps.spawnAnalyzer);

  // Snapshot (the selection seam's remount rationale): a subscriber arriving
  // while markers are on screen must not render an empty list.
  const flagsChannel = createViewChannel<[FlagsSummary]>({
    snapshot: () => [substrate.flagStore.summary()],
  });
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
  // Chunks whose density the host has written since the last mirror sync —
  // what it WROTE, never widened. The worker owns the widening (`reanalysisKeys`
  // spreads to the neighbourhood AND down the cardinal columns, because the
  // column pass's upward scans are uncapped); a host that pre-widened would be
  // second-guessing a rule it does not hold.
  const analyzerDirty = new Set<field.ChunkKey>();
  // Keys the mirror may still hold that the store no longer does. The protocol
  // has no reset verb on purpose, so a world swap lists the outgoing keys as
  // removals; `retireWorld` fills this and the next sync drains it.
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
  let analyzerSeeds: Vec3T[] = [];
  // True while a pass is posted and unanswered. A flag and not a count: the pump
  // is a latest-wins latch, so exactly one pass can ever be in flight.
  let analyzerBusy = false;
  let analyzerIdle: ReturnType<typeof setTimeout> | null = null;

  // An advisor failure is a TOOL problem, not a background hiccup (the void
  // cast's posture): the user is looking at markers that have stopped updating.
  const reportAnalyzerFailure = (err: unknown): void => {
    if (substrate.disposed()) return; // dispose rejects every pending job — expected, swallow
    const message = err instanceof Error ? err.message : String(err);
    deps.reportToolError(`walkability analyzer: ${message}`);
  };

  // The placement colliders as core's rasterizer takes them: one group per
  // archetype, its primitive the catalog's — or FALLBACK_COLLISION, which is
  // exactly what the viewport already DRAWS for an uncatalogued archetype, so
  // the analysis and the picture agree either way.
  const analyzerPlacementGroups = (): field.PlacementCollisionGroup[] =>
    [...groupPlacements(substrate.log.ops)].map(([archetypeId, records]) => ({
      collision:
        substrate.archetypeById().get(archetypeId)?.collision ??
        FALLBACK_COLLISION,
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
    analyzerWholeWorld
      ? substrate.store.chunks.size > 0
      : analyzerDirty.size > 0;

  // Bring the mirror level with the store. Buffers are COPIES, and NOT because
  // the wire needs them to be: the client structured-clones rather than
  // transferring, so a real Worker would copy the store's own buffers safely.
  // The copy is for the case where the handler runs IN THIS REALM — the tests
  // wire it directly, and its `handleSync` says so — where the mirror would
  // otherwise install a view onto the very array the next stroke writes into.
  const postMirrorSync = (): void => {
    const store = substrate.store;
    const keys = analyzerResync ? [...store.chunks.keys()] : [...analyzerDirty];
    analyzerResync = false;
    const upserts: { key: field.ChunkKey; density: ArrayBuffer }[] = [];
    for (const key of keys) {
      const density = store.chunks.get(key);
      if (density !== undefined)
        upserts.push({ key, density: deps.chunkCopy(density) });
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
    if (substrate.disposed()) return undefined;
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
        deps.reportToolError(
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
      ? [...substrate.store.chunks.keys()]
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
    const summary = substrate.flagStore.summary();
    rebuildFlagMarkers(summary);
    rebuildFlagSelection(summary);
    flagsChannel.publish(summary);
  };

  // Adopt a selected finding and republish. The RAW write, with no validation and
  // no camera: `selectFlag` refuses first and frames after, and the viewport's own
  // marker click deliberately does neither — the user is looking at what they just
  // clicked, so a frame there would be the camera jumping on every press.
  const setSelectedFlag = (key: string | null): void => {
    substrate.flagStore.setSelected(key);
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
    const row = substrate.flagStore.rowByKey(key);
    if (row === undefined) {
      deps.reportToolError("that flag was re-analyzed away");
      return;
    }
    setSelectedFlag(key);
    // The flag's CELL, not its chunk: `flagCellBox` is the same box the pointer
    // pick clicks and the outline draws, so the camera lands on exactly what the
    // user selected. (The chunk-sized frame this replaces is the F4 gate's first
    // finding — 4 m of world round a 0.18 m pin.)
    deps.frameCameraOn(flagCellBox(row.flag.world, substrate.store.cellSize));
  };

  const analyzePump = createAnalyzePump(analyzer, {
    next: analyzerFire,
    onFlags: (res) => {
      analyzerBusy = false;
      if (substrate.disposed()) return;
      substrate.flagStore.applyFlags(res.chunks, res.pits);
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

  const verifyFlagImpl = (key: string): void => {
    if (verifyInFlight) {
      deps.reportToolError("a verify is already running");
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
      deps.reportToolError(
        "verify needs the project's agent profile — none is installed",
      );
      return;
    }
    // The store owns key→row: `flagKey` is private to field-flags.ts, so a
    // lookup written here would be re-spelling a format it cannot see.
    const row = substrate.flagStore.rowByKey(key);
    if (row === undefined) {
      deps.reportToolError("that flag was re-analyzed away");
      return;
    }
    // A pit is refused HERE and not only in the panel, which disables the button
    // with the same reason. Defence in depth on a verb whose cost is real: stage
    // 2 drives directed lanes at ONE anchor cell and a pit is a whole region, so
    // an anchor's lanes would prove nothing about it. The two spellings of the
    // reason agree by REVIEW — the chrome cannot value-import anything under
    // `field-host/` (the FlagsSection tint-palette precedent).
    if (row.flag.kind === "pit") {
      deps.reportToolError("that finding is region-level — walk it");
      return;
    }
    verifyInFlight = true;
    // The world's counter, read live (see {@link AnalyzerDeps.worldEpoch}) — the
    // world can be swapped while this promise is out.
    const epoch = deps.worldEpoch();
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
        if (substrate.disposed() || deps.worldEpoch() !== epoch) return;
        substrate.flagStore.setVerdict(row.flag, res.verdict);
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

  // The advisor's marker layer: ONE instanced unit cube for every VISIBLE
  // finding, its per-instance tint the severity/verdict colour. Null when nothing
  // is visible or before GPU init. `markerCount` is the twin of `field-props.ts`'s
  // private prop counts — decided by every rebuild, uploaded only when a context
  // exists.
  let flagMarkers: FlagMarkers | null = null;
  let markerCount = 0;

  const destroyFlagMarkers = (c: Context): void => {
    if (!flagMarkers) return;
    mesh.destroyInstanced(c, flagMarkers.im);
    geometry.destroy(c, flagMarkers.g);
    flagMarkers = null;
  };

  // Rebuild the marker layer from a settled summary: ONE instanced unit cube,
  // scaled to FLAG_MARKER_SIZE_M, at each visible finding's floor surface raised
  // half a cell (so the marker sits in the AIR cell the flag anchors on, not
  // sunk into the floor under it). Whole-layer teardown-and-rebuild, like the
  // prop layer (`field-props.ts`): instance counts are fixed at creation and a
  // response replaces whole chunks at a time, so there is no partial update to
  // make. Silent no-op before GPU init — init() rebuilds once the materials
  // exist.
  //
  // The SELECTED finding's instance is drawn bigger (flagMarkerStyle) and keeps
  // its own colour; the `--primary` half of D-F4.5-15's emphasis is the cell
  // outline `rebuildFlagSelection` builds beside this.
  const rebuildFlagMarkers = (summary: FlagsSummary): void => {
    // The count settles FIRST and unconditionally: it is what the layer IS
    // (the prop layer's rule, `field-props.ts`), and a host with no context has
    // still decided it.
    markerCount = summary.visible.length;
    const c = substrate.ctx();
    // Bound to a local because narrowing does not survive a call boundary — the
    // guard and the `mesh.createInstanced` argument are two reads of one host
    // `let`. See `substrate.ts`'s doc header.
    const mat = deps.flagMarkerMat();
    if (!c || !mat) return;
    destroyFlagMarkers(c);
    if (summary.visible.length === 0) return;
    const cellSize = substrate.store.cellSize;
    const g = geometry.cube(c, { size: 1 });
    const im = mesh.createInstanced(c, {
      geometry: g,
      material: mat,
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
      const [cx, cy, cz] = flagMarkerCenter(row.flag.world, cellSize);
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

  // The SELECTED finding's cell outline (D-F4.5-15), rebuilt with every flags
  // push — one cell of `--primary` wireframe round the marker, drawn under the
  // flags layer gate. Built from `summary.selected` rather than from a key held
  // here, so it can only ever outline a row the same push says is visible; the
  // key itself lives in the flag store, beside the findings it names, so
  // `summary()` can answer "is that row still visible?" without a second copy
  // that every filter change, every response and every world reset would have to
  // invalidate. Null when nothing is selected, and equally when the selected key
  // no longer resolves.
  //
  // DISCLOSED AS UNPINNED, the `gizmoVisible` rider: this batch has no seam and
  // nothing reads instance data back, so no test observes that the outline (or the
  // marker's size pop) is actually drawn. What IS pinned is everything either can be
  // derived from — `flagCellBox` and `flagMarkerStyle` are pure and covered in
  // tests/field-host/field-flags.test.ts, and `summary.selected`'s own resolution
  // is covered there and in tests/field-host-flag-select.test.ts. An accessor added
  // for one assertion is not worth the surface; the gate is the eyeball check. The
  // third of the three is the cell layer's `selection` gate — see renderScene.
  let flagSelectionBatch: LineBatch | null = null;

  const rebuildFlagSelection = (summary: FlagsSummary): void => {
    const row =
      summary.selected === null
        ? undefined
        : summary.visible.find((r) => r.key === summary.selected);
    flagSelectionBatch =
      row === undefined
        ? null
        : deps.selectionOutline(
            flagCellBox(row.flag.world, substrate.store.cellSize),
          );
  };

  return {
    setAgentProfile: (profile) => {
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
    subscribeFlags: (cb) => flagsChannel.subscribe(cb),
    setFilters: (filters) => {
      substrate.flagStore.setFilters(filters);
      publishFlags();
    },
    verifyFlag: verifyFlagImpl,
    selectFlag: selectFlagImpl,
    setSelectedFlag,
    markerMesh: () => flagMarkers?.im ?? null,
    selectionBatch: () => flagSelectionBatch,
    markerCount: () => markerCount,
    pendingCount: analyzerPendingCount,
    noteDensityWritten: (changed) => {
      // Only what was WRITTEN goes in — the worker widens to the chunks whose
      // answer could have changed, and the host's apron neighbours are a
      // MESH-seam rule, not that one.
      for (const k of changed) analyzerDirty.add(k);
      analyzePump.request();
      scheduleWholeWorldPass();
    },
    markPlacementsStale: () => {
      analyzerPlacementsStale = true;
      analyzerWholeWorld = true;
      analyzePump.request();
    },
    retireWorld: () => {
      // The outgoing keys are read off the LIVE store, so this runs before the
      // caller empties it: the mirror has no reset verb, so a world swap lists
      // them as removals on the next sync.
      for (const key of substrate.store.chunks.keys()) analyzerStale.add(key);
      analyzerDirty.clear();
      analyzerResync = true;
      analyzerSeeds = [];
      // The findings describe a field that is about to be gone. The publish is
      // part of the act, not a separate one — the marker layer and the panel are
      // showing those findings right now.
      substrate.flagStore.clear();
      publishFlags();
    },
    noteWorldLoaded: (seed) => {
      analyzerSeeds = [seed];
      // The mirror holds the OLD world (`retireWorld` listed its keys as
      // removals); the incoming chunks were written straight into the store, so
      // nothing marked them dirty. Whole-world too: every chunk is new here.
      analyzerResync = true;
      analyzerWholeWorld = true;
    },
    requestPass: () => {
      analyzePump.request();
    },
    rebuildMarkers: () => {
      rebuildFlagMarkers(substrate.flagStore.summary());
    },
    destroyMarkers: destroyFlagMarkers,
    dispose: () => {
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
      // `props.rebuild()` (via `init`, `loadWorld` or `newWorld`) or through
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
    },
  };
}
