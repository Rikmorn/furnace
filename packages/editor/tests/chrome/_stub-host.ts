// The shared stub FieldHost for the chrome tests.
//
// Every mutator is a recording mock; each subscribe seam LATCHES its callback so a
// test can fire host-initiated pushes manually (wrap them in `act`).
// subscribeSelection/subscribeStamp/subscribeDrift/subscribeFlags/subscribeEntities
// push the current (empty) state on subscribe, like the real host does.
//
// Shared because two suites now mount chrome that talks to a host: the field panel's
// own tests and the shell's (which renders the panel inside the shell layout). A
// second copy would go stale against the real FieldHost independently of this one.
// Tests are NOT part of the chrome bundle, so a value import of the viewport host is
// allowed here — and using the REAL helper is the point: the stub then goes stale
// exactly when the production host would.
import { mock } from "bun:test";
import type { DriftFinding } from "@furnace/core/field";
import type { EntityCatalog } from "../../src/frontend/lib/catalog.ts";
import { withArchetypeOptions } from "../../src/viewport-host/field-placements.ts";
import type {
  CameraPose,
  FieldEntityInfo,
  FieldGeneratorInfo,
  FieldHost,
  FieldStats,
  FieldTool,
  FlagsSummary,
  SelectionInfo,
  StampSession,
} from "../../src/viewport-host/index.ts";

/** The pose the stub reports on subscribe — a stand-in for the host's starting orbit
 *  (its exact numbers are the host's business; what matters is that one arrives). */
export const START_POSE: CameraPose = { yaw: 0.6, pitch: 0.5 };

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
    lastReconfigureMs: 0,
    analyzerPending: 0,
    ...overrides,
  };
}

/** A minimal FieldHost stub: every mutator is a recording mock; the subscribe
 *  seams latch their callback so a test can fire host-initiated pushes
 *  manually (wrap in act). subscribeSelection/subscribeStamp push the current
 *  (empty) state on subscribe, like the real host. */
export function makeStubHost(
  opts: {
    generators?: FieldGeneratorInfo[];
    /** Make `verifyFlag` refuse SYNCHRONOUSLY on the tool-error seam, exactly
     *  as the real host's busy / no-profile / stale-key / pit guards do — they
     *  are decided and reported before the call returns. */
    verifyRefusal?: string;
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
  const cbs: {
    tool: ((t: FieldTool) => void) | null;
    cameraPose: ((p: CameraPose) => void) | null;
    stamp: ((s: StampSession | null) => void) | null;
    stats: ((s: FieldStats) => void) | null;
    selection: ((i: SelectionInfo | null) => void) | null;
    toolError: ((msg: string) => void) | null;
    entities: (() => void) | null;
    drift: ((r: DriftFinding[] | null) => void) | null;
    flags: ((s: FlagsSummary) => void) | null;
  } = {
    tool: null,
    cameraPose: null,
    stamp: null,
    stats: null,
    selection: null,
    toolError: null,
    entities: null,
    drift: null,
    flags: null,
  };
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
    highlightEntity: mock(),
    startStamp: mock(),
    updateStamp: mock(),
    nudgeStamp: mock(),
    rerollStamp: mock(),
    commitStamp: mock(),
    commitSession: mock(),
    cancelStamp: mock(),
    undo: mock(),
    redo: mock(),
    clearSelection: mock(),
    reselect: mock(),
    newWorld: mock(),
    openEntity: mock(),
    applyReconfigure: mock(),
    setEntityFrozen: mock(),
    bakeEntity: mock(),
    dismissDrift: mock(),
    frameChunks: mock(),
    setAgentProfile: mock(),
    setFlagFilters: mock(),
    verifyFlag: mock(),
    subscribeStats: mock(),
    subscribeToolError: mock(),
  };
  const host: FieldHost = {
    // Modelled on the real host's lifecycle, both halves of it. It REFUSES a second
    // init while a context is up ("one host, one live canvas") and it SETTLES
    // ASYNCHRONOUSLY, because the real one awaits a device — and those two together are
    // what make an unordered dispose→init (the AA switch's hazard) visible here instead
    // of only in a browser.
    init: (canvas, initOpts) => {
      calls.init(canvas, initOpts);
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
    setDigRadius: calls.setDigRadius,
    setShading: calls.setShading,
    setTool: calls.setTool,
    subscribeTool: (cb) => {
      cbs.tool = cb;
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
    },
    subscribeToolError: (cb) => {
      calls.subscribeToolError(cb);
      cbs.toolError = cb;
      // A REAL unsubscribe, for the subscribeStats reason: this is a single slot too
      // (the shell's provider owns it now), and an inert release could not tell a
      // subscriber that leaks from one that cleans up.
      return () => {
        cbs.toolError = null;
      };
    },
    setGesture: calls.setGesture,
    clearSelection: calls.clearSelection,
    reselect: calls.reselect,
    subscribeSelection: (cb) => {
      cbs.selection = cb;
      cb(null);
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
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
    rerollStamp: calls.rerollStamp,
    commitStamp: calls.commitStamp,
    commitSession: calls.commitSession,
    cancelStamp: calls.cancelStamp,
    undo: calls.undo,
    redo: calls.redo,
    subscribeStamp: (cb) => {
      cbs.stamp = cb;
      cb(null);
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
    },
    openEntity: calls.openEntity,
    applyReconfigure: calls.applyReconfigure,
    setEntityFrozen: calls.setEntityFrozen,
    bakeEntity: calls.bakeEntity,
    subscribeDrift: (cb) => {
      cbs.drift = cb;
      cb(null);
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
    },
    dismissDrift: calls.dismissDrift,
    frameChunks: calls.frameChunks,
    subscribeEntities: (cb) => {
      cbs.entities = cb;
      cb(); // the real host's initial catch-up tick
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
    },
    listEntities: () => entities.map((e) => structuredClone(e)),
    highlightEntity: calls.highlightEntity,
    setAgentProfile: calls.setAgentProfile,
    subscribeFlags: (cb) => {
      cbs.flags = cb;
      cb({ total: 0, byKindSeverity: [], visible: [] });
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
    },
    setFlagFilters: calls.setFlagFilters,
    verifyFlag: (key) => {
      calls.verifyFlag(key);
      if (opts.verifyRefusal !== undefined) cbs.toolError?.(opts.verifyRefusal);
    },
    flagMarkerCount: () => 0,
    exportArtifact: () => [],
    subscribeCameraPose: (cb) => {
      cbs.cameraPose = cb;
      // The real host pushes the CURRENT pose on subscribe (its own starting orbit);
      // a stub that pushed nothing would let a consumer depending on that go green.
      cb(START_POSE);
      return () => {
        if (cbs.cameraPose === cb) cbs.cameraPose = null;
      };
    },
    subscribeStats: (cb) => {
      calls.subscribeStats(cb);
      cbs.stats = cb;
      // A REAL unsubscribe: the production host nulls `statsCb`, and the slot being
      // freed is the whole point of a single-slot seam. An inert unsubscribe here
      // could not tell a subscriber that leaks from one that cleans up.
      return () => {
        cbs.stats = null;
      };
    },
  };
  return {
    host,
    calls,
    /** Seam-call trace, in order — the B1 ordering contract's witness. */
    order,
    /** Fire a latched host→panel push (callers wrap in act). */
    fire: {
      tool: (t: FieldTool) => cbs.tool?.(t),
      stamp: (s: StampSession | null) => cbs.stamp?.(s),
      /** Returns whether the push was DELIVERED — false once the slot is free again,
       *  which is how a test tells a real unsubscribe from an inert one. */
      stats: (s: FieldStats): boolean => {
        if (cbs.stats === null) return false;
        cbs.stats(s);
        return true;
      },
      selection: (i: SelectionInfo | null) => cbs.selection?.(i),
      /** A camera move, as the host publishes one from `applyOrbit`. */
      cameraPose: (p: CameraPose) => cbs.cameraPose?.(p),
      /** The entity-list change TICK (the real host's only entity signal). */
      entities: () => cbs.entities?.(),
      drift: (r: DriftFinding[] | null) => cbs.drift?.(r),
      /** Returns whether the push was DELIVERED — false once the slot is free again
       *  (the subscribeStats precedent: it is how a test tells a real unsubscribe from
       *  an inert one). */
      toolError: (msg: string): boolean => {
        if (cbs.toolError === null) return false;
        cbs.toolError(msg);
        return true;
      },
      flags: (s: FlagsSummary) => cbs.flags?.(s),
    },
    setEntities: (next: FieldEntityInfo[]) => {
      entities = next;
    },
  };
}
