// The shared stub FieldHost for the chrome tests.
//
// Every mutator is a recording mock; each subscribe seam is a REAL `createViewChannel`,
// so a test can fire host-initiated pushes manually (wrap them in `act`). Eleven of the
// thirteen push their CURRENT state on subscribe — every one except toolError and
// stats — which is the production host's own split, seam for seam. Current, not empty:
// see `mirrorSeam` for why the difference started mattering.
//
// TWO mutators are more than recording mocks, and they are the two the tool seam answers
// for: `setTool` and `setDigRadius` PUBLISH, because the production host does (foundations
// T3b2). A stub that only recorded them would let the chrome read its own writes back from
// somewhere else and go green over a host that never announced them — which is the whole
// defect the publish closed.
//
// MULTICAST, exactly as all thirteen of the production host's are since T3a: N
// subscribers each get every push, an unsubscribe removes only its own callback and is
// idempotent, and a subscriber that throws is logged rather than severing its siblings.
// Every `fire.*` returns the DELIVERED COUNT at publish time, which is what lets a test
// tell a subscriber that leaks from one that cleans up: `0` is a seam nobody holds, `1`
// is one mirror of it, and anything above the expectation is a cleanup that did not run.
// It replaced a boolean that could only say "somebody is there" — and, when the seams
// were single slots, WHICH mount that was.
//
// The REAL helper rather than a hand-rolled imitation, deliberately: the stub then goes
// stale exactly when the production host would. Tests are not part of the chrome bundle,
// so a value import of the field host is allowed here.
//
// Shared because three suites now mount chrome that talks to a host: the field panel's
// own tests, the entities palette's, and the shell's (which renders both inside the
// shell layout). A second copy would go stale against the real FieldHost independently
// of this one.
import { mock } from "bun:test";
import { ACTION_OK } from "../../src/action-registry/index.ts";
import { withArchetypeOptions } from "../../src/field-host/field-placements.ts";
import type {
  CameraPose,
  FieldDriftReport,
  FieldEntityInfo,
  FieldGeneratorInfo,
  FieldHistory,
  FieldHost,
  FieldStats,
  FieldTool,
  FieldToolPush,
  FlagsSummary,
  PendingStamp,
  SegmentHud,
  SelectionInfo,
  StampSession,
  ToolErrorSeverity,
} from "../../src/field-host/index.ts";
import {
  createViewChannel,
  type ViewChannel,
} from "../../src/field-host/view-channel.ts";
// The chrome's half of the tool comparator, borrowed rather than re-spelled: the stub's
// no-op guard must agree with the production host's `sameTool` about WHICH fields count,
// and `toolsEqual` is that predicate with the destructure backstop already on it.
import {
  DEFAULT_RADIUS,
  DEFAULT_TOOL,
  toolsEqual,
} from "../../src/frontend/lib/field-host-mirrors.ts";
import type { EntityCatalog } from "../../src/shared/catalog.ts";
import {
  HOLLOW_MIN_M,
  RADIUS_MAX,
  RADIUS_MIN,
} from "../../src/shared/field-limits.ts";

/** The pose the stub reports on subscribe — a stand-in for the host's starting orbit
 *  (its exact numbers are the host's business; what matters is that one arrives). */
export const START_POSE: CameraPose = { yaw: 0.6, pitch: 0.5 };

/** A state-MIRROR seam: a channel that remembers what was last published through it and
 *  hands THAT to every later subscriber.
 *
 *  The production host's eleven mirror seams read live host state in their `snapshot` thunk
 *  (`stamp === null ? null : structuredClone(stamp)`, `flagStore.summary()`, …) — the
 *  (re)mount rule, so a surface arriving mid-session renders the session rather than a
 *  default. The stub's snapshots used to be frozen literals instead, which was invisible
 *  for as long as ONE long-lived provider held every subscription and mounted before any
 *  `fire.*`: nothing ever subscribed late. Per-consumer latches (T3b1 Task 7) subscribe
 *  whenever a surface mounts, so a card opened BY a push would subscribe after it and be
 *  handed the literal — reading "no session" beside a viewport drawing one, which is the
 *  exact failure the real snapshots exist to prevent. Remembering the last push is the
 *  smallest thing that makes the fixture model the seam it stands in for.
 *
 *  ONE deliberate infidelity, recorded so nobody builds on it: this hands every late
 *  subscriber the SAME object reference, where the real host clones per subscribe
 *  (`structuredClone(stamp)`, `{ ...pendingStamp }`). The stub is therefore more
 *  identity-stable than production, so a chrome guard that happened to work by reference
 *  equality would pass here and fail in the editor. Every guard the chrome actually has
 *  compares by VALUE for exactly that reason (`toolsEqual`, `sameEntities`, `statsEqual`),
 *  which is what makes the gap safe rather than merely known. */
function mirrorSeam<T>(initial: T): ViewChannel<[T]> {
  let last = initial;
  const channel = createViewChannel<[T]>({ snapshot: () => [last] });
  return {
    subscribe: channel.subscribe,
    publish: (value) => {
      last = value;
      channel.publish(value);
    },
    size: channel.size,
  };
}

/** An EMPTY history — what the stub reports on subscribe, exactly as the real host does
 *  over a world nobody has edited yet. */
export const NO_HISTORY: FieldHistory = {
  undo: [],
  redo: [],
  undoDepth: 0,
  redoDepth: 0,
  // The opaque change token a real host composes from its log (T4b). A literal here
  // rather than the host's five-number spelling, for `makeHistory`'s reason: the chrome
  // may only COMPARE it, so what a fixture owes is a value that differs when the history
  // does — which is what `fire.history` supplies per push.
  revision: "rev-0",
};

/** A {@link FieldHistory} from its two label lists, newest-LAST, with the depths
 *  defaulting to the list lengths — i.e. "nothing is being truncated". Pass `depths` to
 *  model a history longer than its tail, which is the case the palette's "older steps"
 *  line exists for. */
export function makeHistory(
  undo: readonly string[],
  redo: readonly string[] = [],
  depths?: { undoDepth?: number; redoDepth?: number },
  revision?: string,
): FieldHistory {
  return {
    undo,
    redo,
    undoDepth: depths?.undoDepth ?? undo.length,
    redoDepth: depths?.redoDepth ?? redo.length,
    // DERIVED from the labels by default, so two different histories built by this
    // helper get different tokens without every caller inventing one — which is the
    // property the chrome actually depends on. A caller that is ABOUT the token passes
    // its own.
    revision: revision ?? `rev-${undo.join(",")}|${redo.join(",")}`,
  };
}

/** The host's `clampTool`, modelled at the ONE bound a chrome control can actually reach.
 *
 *  Hollow is the editor's only free-text tool field, so it is the only one where a user can
 *  hand the host a value outside its range: the radius is a `min`/`max` range input, smooth
 *  strength is another, and iterations and mode are `<select>`s over exactly the legal set.
 *  The smooth ceilings therefore have no chrome path to this clamp and stay pinned host-side
 *  (`tests/field-host-headless.test.ts`), where the real `clampTool` is.
 *
 *  The FLOOR is imported, never restated — `shared/field-limits.ts` is the same module the
 *  control reads its `min` off, so the fixture cannot drift from the number the strip shows. */
const clampStubTool = (t: FieldTool): FieldTool => ({
  ...t,
  hollow: t.hollow === null ? null : Math.max(HOLLOW_MIN_M, t.hollow),
});

/** A zeroed FieldStats with `overrides` applied — the host's idle readout. */
export function makeStats(overrides: Partial<FieldStats> = {}): FieldStats {
  return {
    chunks: 0,
    lastRemeshMs: 0,
    remeshVersion: 0,
    totalOps: 0,
    liveGenerators: 0,
    compactableOps: 0,
    undoDepth: 0,
    redoDepth: 0,
    lastReconfigureMs: 0,
    analyzerPending: 0,
    voidCastPending: false,
    ...overrides,
  };
}

/** A minimal FieldHost stub: every mutator is a recording mock; the subscribe
 *  seams are real multicast channels so a test can fire host-initiated pushes
 *  manually (wrap in act) and read the delivered count back. Eleven of the thirteen
 *  push their current state on subscribe, like the real host — and the two tool
 *  mutators clamp and value-guard, also like the real host. */
export function makeStubHost(
  opts: {
    generators?: FieldGeneratorInfo[];
    /** Make `verifyFlag` refuse SYNCHRONOUSLY on the tool-error seam, exactly
     *  as the real host's busy / no-profile / stale-key / pit guards do — they
     *  are decided and reported before the call returns. */
    verifyRefusal?: string;
    /** Make `selectFlag` refuse SYNCHRONOUSLY on the tool-error seam, as the real
     *  host does for a key no VISIBLE row answers to. */
    selectFlagRefusal?: string;
    /** Make `init` REJECT with this message — the GPU-failure path (no adapter, a
     *  context request refused), which the chrome must survive rather than blank on. */
    initRejection?: string;
  } = {},
) {
  let entities: FieldEntityInfo[] = [];
  // The stub models the REAL host's snapshot semantics: setEntityCatalog stores
  // the catalog, and listGenerators() reads it AT CALL TIME through the same
  // pure helper field-host.ts uses. Without this the ordering bug (B1) is
  // invisible from the chrome — a static generator list can never go stale.
  let installedCatalog: EntityCatalog | null = null;
  // Call-order trace for the seams whose ORDER is the contract under test.
  const order: string[] = [];
  /** Whether a context is up — the real host's `ctx`, which is what its
   *  "already initialized" guard reads. */
  let live = false;
  /** The real host's `look !== null`. A mutable flag rather than a mock return,
   *  because the app-level key gate POLLS it on every keypress: a test has to be
   *  able to put the right button down between two presses, which is exactly the
   *  thing a snapshot could not express. */
  let looking = false;
  /** The armed brush and its radius — what the tool seam's snapshot reads, and what
   *  `setTool` / `setDigRadius` move. Held as state rather than remembered by the channel
   *  (`mirrorSeam`) because the two mutators publish HALF a push each: a `setTool` carries
   *  the radius the host is already holding, and a `setDigRadius` carries the armed tool.
   *  A fresh host's own defaults, taken from the chrome literals that mirror them rather
   *  than hand-copied a fourth time — and those literals are themselves checked against a
   *  real host's subscribe snapshot in `tests/field-host-mirrors.test.ts`, so this fixture
   *  is now two links from the source of truth instead of a restatement of it. CLONED
   *  because `armed` is replaced wholesale but the literal is shared process-wide. */
  let armed: FieldToolPush = {
    tool: structuredClone(DEFAULT_TOOL),
    radius: DEFAULT_RADIUS,
  };
  /** The thirteen seams, one real {@link createViewChannel} each — the SAME helper
   *  the production host's are built from, so a change to delivery, isolation or
   *  push-on-subscribe reaches the chrome suite without anyone remembering to
   *  mirror it here.
   *
   *  Which ones carry a `snapshot` is the production host's split, seam for seam:
   *  the eleven state MIRRORS push their current value to each arriving subscriber, and
   *  the two EVENT seams (toolError, stats) push nothing until a `fire.*`. A stub that
   *  pushed on all thirteen would let a consumer depending on an initial toast go green
   *  against a host that never sends one. */
  const seams = {
    // Its own snapshot rather than `mirrorSeam`'s remembered last push, for the reason
    // `armed` above states — and closer to the production host for it: the real snapshot
    // reads live host state too. It shares `mirrorSeam`'s ONE infidelity (see there): every
    // subscriber is handed the same object, where the real host clones per push.
    tool: createViewChannel<[FieldToolPush]>({ snapshot: () => [armed] }),
    toolError: createViewChannel<[string, ToolErrorSeverity]>(),
    stats: createViewChannel<[FieldStats]>(),
    // The real host pushes the CURRENT pose on subscribe (its own starting orbit);
    // a stub that pushed nothing would let a consumer depending on that go green.
    cameraPose: mirrorSeam<CameraPose>(START_POSE),
    stamp: mirrorSeam<StampSession | null>(null),
    selection: mirrorSeam<SelectionInfo | null>(null),
    // The real host's initial catch-up tick — no payload, the subscriber re-reads
    // `listEntities` itself, which the stub really does hold.
    entities: createViewChannel<[]>({ snapshot: () => [] }),
    drift: mirrorSeam<FieldDriftReport | null>(null),
    flags: mirrorSeam<FlagsSummary>({
      total: 0,
      byKindSeverity: [],
      visible: [],
      selected: null,
    }),
    entitySelection: mirrorSeam<number | null>(null),
    pendingStamp: mirrorSeam<PendingStamp | null>(null),
    history: mirrorSeam<FieldHistory>(NO_HISTORY),
    // `null` on a fresh host, which is what a status bar mounting with no gesture
    // in flight must read rather than nothing at all.
    segmentHud: mirrorSeam<SegmentHud | null>(null),
  };
  /** Move the armed pair and announce it — the stub's `notifyTool`. Answers the DELIVERED
   *  count so `fire.tool` can report it the way every other `fire.*` does. */
  const publishTool = (next: FieldToolPush): number => {
    armed = next;
    seams.tool.publish(next);
    return seams.tool.size();
  };
  // What `occupiedTopY` answers. Mutable so a case can put content in the world
  // without a GPU: the seed decision is chrome-side arithmetic over this one number,
  // and a stub that could only ever say `null` would make the seeded branch unreachable.
  let occupiedTop: number | null = null;
  /** What `escape()` answers — whether the Esc stack had anything to cancel. `true` by
   *  default: the real host opens with the entity-selection rung standing, and a stub whose
   *  Esc always reported "nothing there" would make the interrupt verb's SUCCESS path
   *  unreachable. `setEscapeCancels(false)` is how a case reaches the other branch. */
  let escapeCancels = true;
  /** What `cameraAimedByHand()` answers. `false` is the honest default for a stub
   *  nobody has dragged; `setCameraAimed` below is for the cases that need the other
   *  branch of the chrome Open's automatic frame (`hooks/useWorld.tsx` — NOT
   *  `loadWorld`, which frames nothing). */
  let cameraAimed = false;
  /** What `cameraPose()` answers — the pose the seam last published, so the poll and
   *  the subscription cannot disagree about where the camera is (the real host reads
   *  one orbit for both). */
  let lastPose: CameraPose = START_POSE;
  const calls = {
    init: mock(),
    dispose: mock(),
    setTool: mock(),
    setSlice: mock(),
    setLayers: mock(),
    setGesture: mock(),
    setDigRadius: mock(),
    setShading: mock(),
    setMaterialTable: mock(),
    setEntityCatalog: mock(),
    selectEntity: mock(),
    startStamp: mock(),
    updateStamp: mock(),
    nudgeStamp: mock(),
    rotateStamp: mock(),
    rerollStamp: mock(),
    commitStamp: mock(),
    confirmSession: mock(),
    cancelStamp: mock(),
    escape: mock(() => escapeCancels),
    undo: mock(),
    redo: mock(),
    clearSelection: mock(),
    reselect: mock(),
    newWorld: mock(),
    openEntity: mock(),
    beginMove: mock(),
    applyReconfigure: mock(),
    setEntityFrozen: mock(),
    bakeEntity: mock(),
    deleteEntity: mock(),
    duplicateEntity: mock(),
    dismissDrift: mock(),
    frameChunks: mock(),
    // ANSWERS, since foundations T5 — `FieldHost.frameSelection` returns an `ActionResult`
    // and `view.frame` hands it back as its own verdict, so a bare `mock()` would make every
    // palette/menu dispatch of that verb answer `failed` under the cast.
    frameSelection: mock(() => ACTION_OK),
    frameWorld: mock(),
    snapView: mock(),
    // The capture verb answers a FIXED 2×1 red-then-blue PNG-shaped payload — the
    // bytes are not a PNG and are not meant to be. What a chrome-side caller has
    // to get right is the base64 encoding and the passthrough of `width`/`height`/
    // `view`, and asymmetric bytes are what makes an encoding that reverses or
    // truncates them visible. The real encoder is `field-capture.ts`'s and is
    // pinned (as far as it can be headlessly) in `tests/field-capture.gpu.test.ts`.
    captureScene: mock(() =>
      Promise.resolve({
        png: new Uint8Array([1, 2, 3, 250]),
        width: 2,
        height: 1,
        view: "user" as const,
      }),
    ),
    // The mutation pair answers OK and a fixed committed record. Both are the
    // SHAPE a chrome-side caller has to relay, not the behaviour — the refusals,
    // the indexed locator, the region default and the session guard are the real
    // seam's and are pinned against a real store in `tests/field-host/mutation`.
    // What a stub can prove is that the answerer passes the payload through
    // without reshaping it, so the record here is deliberately not the defaults
    // anything else would produce.
    applyOps: mock(() => ({ ok: true }) as const),
    generate: mock(() => ({
      ok: true as const,
      entityId: 7,
      generator: "hall",
      seed: 4242,
      region: {
        min: [0, 0, 0] as [number, number, number],
        max: [4, 3, 4] as [number, number, number],
      },
      params: { width: 3 },
      dirtyChunks: 2,
    })),
    // The spatial read answers a fixed EMPTY world, for the mutation pair's reason: what a
    // chrome-side caller has to get right is that the request reaches the host unreshaped and
    // the answer comes back untouched. Every measurement in a real answer — the contact rule,
    // the overlap sweep, the caps — needs a real store and log, and is pinned against one in
    // `tests/field-host/query.test.ts`.
    query: mock(() => ({
      about: "entities" as const,
      entities: [],
      props: {
        total: 0,
        scanned: 0,
        floating: [],
        overlapping: [],
        truncated: false,
      },
    })),
    setAgentProfile: mock(),
    setFlagFilters: mock(),
    verifyFlag: mock(),
    selectFlag: mock(),
    // Every subscribe seam records its call, so a test can assert WHO claimed it and how
    // many times — the one-claimant rule's only machine-checkable form, and since the seams
    // went multicast the only form full stop: a second claimant no longer announces itself
    // by breaking the first.
    //
    // The split the ownership cases enumerate (T3b1 Task 7): TEN are latched by the surface
    // that reads them, so nobody claims them until one mounts and everybody must release on
    // unmount; THREE — tool, toolError, flags — stay the shell provider's, because each
    // feeds chrome-owned state that has to outlive any one surface.
    subscribeStats: mock(),
    subscribeToolError: mock(),
    subscribeEntities: mock(),
    subscribeDrift: mock(),
    subscribeCameraPose: mock(),
    subscribeTool: mock(),
    subscribeSelection: mock(),
    subscribeStamp: mock(),
    subscribePendingStamp: mock(),
    subscribeFlags: mock(),
    subscribeEntitySelection: mock(),
    subscribeHistory: mock(),
    subscribeSegmentHud: mock(),
  };
  const host: FieldHost = {
    // Modelled on the real host's lifecycle, both halves of it. It REFUSES a second
    // init while a context is up ("one host, one live canvas") and it SETTLES
    // ASYNCHRONOUSLY, because the real one awaits a device — and those two together are
    // what would make an unordered dispose→init visible here instead of only in a browser.
    // Nothing in the chrome performs one on demand since MSAA left the editor (T4c); the
    // fidelity is kept because `CanvasHost`'s teardown chain is still the thing that would
    // have to be right the day one is reachable again.
    init: (canvas) => {
      calls.init(canvas);
      order.push("init");
      if (opts.initRejection !== undefined)
        return Promise.reject(new Error(opts.initRejection));
      if (live)
        return Promise.reject(new Error("field-host: already initialized"));
      live = true;
      return Promise.resolve();
    },
    dispose: () => {
      order.push("dispose");
      live = false;
      calls.dispose();
    },
    newWorld: calls.newWorld,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
    loadWorld: () => {},
    // The two publishing mutators (see this file's header), each modelling the production
    // funnel it stands for: clamp, then publish only if something MOVED.
    //
    // An earlier cut modelled neither and argued that "the chrome cannot tell the
    // difference: its latch drops an equal push by value anyway". That is true of the
    // LATCH and false of the chrome: a control holding a local text buffer reconciles it
    // only when a render happens, so "no push" and "an equal push" are indeed
    // indistinguishable — but an UNCLAMPED push is a third thing that is neither, and it
    // manufactured a render the real host does not. It hid a live defect in
    // `HollowThickness` for exactly one commit.
    setDigRadius: (r) => {
      calls.setDigRadius(r);
      // `clampRadius`'s own spelling, argument order included: the constants were already
      // imported, and re-deriving the ARITHMETIC is the other half of not drifting.
      const clamped = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r));
      if (clamped !== armed.radius)
        publishTool({ tool: armed.tool, radius: clamped });
    },
    setShading: calls.setShading,
    // A PATCH over the held tool, mirroring the real seam. `calls.setTool` records
    // the patch AS SENT — what the control actually spoke about — so a suite can
    // still assert that a slider named its param and nothing else. The momentary
    // base the real host also maintains has no stub counterpart: the flags live
    // behind the host's own key listeners, which is why that half is pinned in
    // `field-host-momentary.gpu.test.ts` against a real host instead.
    setTool: (patch) => {
      calls.setTool(patch);
      const clamped = clampStubTool({ ...armed.tool, ...patch });
      if (!toolsEqual(clamped, armed.tool))
        publishTool({ tool: clamped, radius: armed.radius });
    },
    // Every seam below has the SAME two lines: record the claim, then hand back the
    // channel's own unsubscribe. Real, per-subscriber and idempotent, because an inert
    // release could not tell a subscriber that leaks from one that cleans up — and the
    // delivered count `fire.*` returns is what a test reads that from.
    subscribeTool: (cb) => {
      calls.subscribeTool(cb);
      return seams.tool.subscribe(cb);
    },
    subscribeToolError: (cb) => {
      calls.subscribeToolError(cb);
      return seams.toolError.subscribe(cb);
    },
    setGesture: calls.setGesture,
    clearSelection: calls.clearSelection,
    reselect: calls.reselect,
    subscribeSelection: (cb) => {
      calls.subscribeSelection(cb);
      return seams.selection.subscribe(cb);
    },
    setLayers: calls.setLayers,
    setSlice: calls.setSlice,
    getSmoothLimits: () => ({ maxStrength: 32, maxIterations: 4 }),
    setMaterialTable: calls.setMaterialTable,
    setEntityCatalog: (catalog) => {
      order.push("setEntityCatalog");
      installedCatalog = catalog;
      calls.setEntityCatalog(catalog);
    },
    listGenerators: () => {
      order.push("listGenerators");
      return (opts.generators ?? []).map((g) => ({
        ...g,
        paramSchema: withArchetypeOptions(
          structuredClone(g.paramSchema),
          (installedCatalog?.archetypes ?? []).map((a) => a.id),
        ),
      }));
    },
    propInstanceCounts: () => new Map<string, number>(),
    startStamp: calls.startStamp,
    updateStamp: calls.updateStamp,
    nudgeStamp: calls.nudgeStamp,
    rotateStamp: calls.rotateStamp,
    rerollStamp: calls.rerollStamp,
    commitStamp: calls.commitStamp,
    confirmSession: calls.confirmSession,
    cancelStamp: calls.cancelStamp,
    escape: calls.escape,
    isLooking: () => looking,
    undo: calls.undo,
    redo: calls.redo,
    subscribeStamp: (cb) => {
      calls.subscribeStamp(cb);
      return seams.stamp.subscribe(cb);
    },
    subscribePendingStamp: (cb) => {
      calls.subscribePendingStamp(cb);
      return seams.pendingStamp.subscribe(cb);
    },
    openEntity: calls.openEntity,
    beginMove: calls.beginMove,
    applyReconfigure: calls.applyReconfigure,
    setEntityFrozen: calls.setEntityFrozen,
    bakeEntity: calls.bakeEntity,
    deleteEntity: calls.deleteEntity,
    duplicateEntity: calls.duplicateEntity,
    subscribeDrift: (cb) => {
      calls.subscribeDrift(cb);
      return seams.drift.subscribe(cb);
    },
    dismissDrift: calls.dismissDrift,
    frameChunks: calls.frameChunks,
    frameSelection: calls.frameSelection,
    frameWorld: calls.frameWorld,
    // Never aimed: a stub host has had no gesture on it. A case that needs the
    // other answer sets it through `setCameraAimed` below.
    cameraAimedByHand: () => cameraAimed,
    snapView: calls.snapView,
    applyOps: calls.applyOps,
    generate: calls.generate,
    captureScene: calls.captureScene,
    query: calls.query,
    subscribeEntities: (cb) => {
      calls.subscribeEntities(cb);
      return seams.entities.subscribe(cb);
    },
    subscribeHistory: (cb) => {
      calls.subscribeHistory(cb);
      return seams.history.subscribe(cb);
    },
    listEntities: () => entities.map((e) => structuredClone(e)),
    selectEntity: calls.selectEntity,
    subscribeEntitySelection: (cb) => {
      calls.subscribeEntitySelection(cb);
      return seams.entitySelection.subscribe(cb);
    },
    setAgentProfile: calls.setAgentProfile,
    subscribeFlags: (cb) => {
      calls.subscribeFlags(cb);
      return seams.flags.subscribe(cb);
    },
    setFlagFilters: calls.setFlagFilters,
    verifyFlag: (key) => {
      calls.verifyFlag(key);
      if (opts.verifyRefusal !== undefined)
        seams.toolError.publish(opts.verifyRefusal, "error");
    },
    selectFlag: (key) => {
      calls.selectFlag(key);
      // The real host REFUSES a key no visible row answers to, on the tool-error
      // seam and synchronously — the shape a palette row click can hit for real
      // (a click racing a re-analysis). Modelled here for the same reason
      // `verifyRefusal` is: the chrome path that reacts to it is otherwise
      // untestable from a stub that always succeeds.
      if (key !== null && opts.selectFlagRefusal !== undefined)
        seams.toolError.publish(opts.selectFlagRefusal, "error");
    },
    flagMarkerCount: () => 0,
    selectionCellCount: () => 0,
    // `null` by default — the honest answer for an untouched world, and the one that
    // makes the chrome's fallback the DEFAULT path in every test that does not opt in.
    occupiedTopY: () => occupiedTop,
    exportArtifact: () => [],
    subscribeCameraPose: (cb) => {
      calls.subscribeCameraPose(cb);
      return seams.cameraPose.subscribe(cb);
    },
    // The POLL beside the seam, and it reads the same value the seam last published —
    // which is what makes `fire.cameraPose` move both, as one camera move does on the real
    // host. A stub whose poll answered a frozen literal would let a consumer that polls go
    // green over a camera that has been flown across the world.
    cameraPose: () => lastPose,
    subscribeSegmentHud: (cb) => {
      calls.subscribeSegmentHud(cb);
      return seams.segmentHud.subscribe(cb);
    },
    subscribeStats: (cb) => {
      calls.subscribeStats(cb);
      return seams.stats.subscribe(cb);
    },
  };
  return {
    host,
    calls,
    /** Seam-call trace, in order — the B1 ordering contract's witness. */
    order,
    /** Set what `host.occupiedTopY()` will answer. `null` = nothing authored. */
    setOccupiedTopY: (y: number | null): void => {
      occupiedTop = y;
    },
    /** Set what `host.escape()` will answer — i.e. whether the Esc capture stack has
     *  anything standing. */
    setEscapeCancels: (cancels: boolean): void => {
      escapeCancels = cancels;
    },
    /** Set what `host.cameraAimedByHand()` will answer — the guard on the chrome
     *  Open's automatic frame, so this is how a case reaches the "the user has arranged
     *  this camera, leave it alone" branch. */
    setCameraAimed: (aimed: boolean): void => {
      cameraAimed = aimed;
    },
    /** Fire a host→chrome push (callers wrap in act). EVERY fire returns the DELIVERED
     *  COUNT — the seam's live subscriber count read AFTER the publish returns. `0` is a
     *  seam nobody holds (the release was real), `1` is the provider holding it alone,
     *  and a count above what a case expects is a cleanup that did not run. It is the
     *  leak detector a single slot used to give for free by failing loudly.
     *
     *  Read after rather than before deliberately — it is the count a test asserts
     *  against, and the two readings differ only for a subscriber that (un)subscribes
     *  from inside its own delivery. No case does that today; one that did would be
     *  asserting about the membership it just changed, which is the honest number. */
    fire: {
      /** The tool seam carries the RADIUS too (F4.5 gate, W-2). Radius defaults to the
       *  host's own initial default so the three existing callers that only care about the
       *  tool (`shell.test.tsx`, `tool-strip.test.tsx`, `host-seams-and-catalogs.test.tsx`)
       *  keep working unchanged and do not assert a radius they never chose.
       *
       *  It moves the ARMED pair, not just the wire: this is the host changing its own
       *  tool (an eyedrop, a momentary ⇧/⌃), so a surface mounting after it must read the
       *  pushed value off the snapshot rather than the value from before. */
      tool: (t: FieldTool, radius = DEFAULT_RADIUS): number =>
        publishTool({ tool: t, radius }),
      stamp: (s: StampSession | null): number => {
        seams.stamp.publish(s);
        return seams.stamp.size();
      },
      stats: (s: FieldStats): number => {
        seams.stats.publish(s);
        return seams.stats.size();
      },
      selection: (i: SelectionInfo | null): number => {
        seams.selection.publish(i);
        return seams.selection.size();
      },
      /** A camera move, as the host publishes one from `applyOrbit` — which moves the
       *  ORBIT as well as the wire, so the poll answers the new pose too. */
      cameraPose: (p: CameraPose): number => {
        lastPose = p;
        seams.cameraPose.publish(p);
        return seams.cameraPose.size();
      },
      /** The entity-list change TICK (the real host's only entity signal). */
      entities: (): number => {
        seams.entities.publish();
        return seams.entities.size();
      },
      /** A drift report push. The host derives `entityIds` (which rows wear a
       *  badge) at push time from the footprints, so a test states it directly —
       *  the intersection itself is the HOST's and is pinned host-side. */
      drift: (r: FieldDriftReport | null): number => {
        seams.drift.publish(r);
        return seams.drift.size();
      },
      /** A tool-seam message at the severity the host would send it with. `error` by
       *  default because every refusal is one — `warn` is the advisor-idle report,
       *  the one message on this seam that is not a refusal. */
      toolError: (
        msg: string,
        severity: ToolErrorSeverity = "error",
      ): number => {
        seams.toolError.publish(msg, severity);
        return seams.toolError.size();
      },
      flags: (s: FlagsSummary): number => {
        seams.flags.publish(s);
        return seams.flags.size();
      },
      /** A pending stamp ARM (or its clearing), as `startStamp` with no selection
       *  publishes one (D-F4.5-7). */
      pendingStamp: (p: PendingStamp | null): number => {
        seams.pendingStamp.publish(p);
        return seams.pendingStamp.size();
      },
      /** A named-history push, as any log mutation publishes one (F4.5b Task 12). */
      history: (h: FieldHistory): number => {
        seams.history.publish(h);
        return seams.history.size();
      },
      /** The pending segment's length against its cap, as the host publishes one from
       *  both anchor edges and (throttled) from the moves between them — `null` for no
       *  point down (D-25). */
      segmentHud: (h: SegmentHud | null): number => {
        seams.segmentHud.publish(h);
        return seams.segmentHud.size();
      },
      /** An entity-selection change, as a pointer click or `selectEntity` publishes one. */
      entitySelection: (entityId: number | null): number => {
        seams.entitySelection.publish(entityId);
        return seams.entitySelection.size();
      },
    },
    setEntities: (next: FieldEntityInfo[]) => {
      entities = next;
    },
    /** Put the right button down (or up) — what `isLooking()` then answers. */
    setLooking: (next: boolean) => {
      looking = next;
    },
  };
}
