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
  FieldEntityInfo,
  FieldGeneratorInfo,
  FieldHost,
  FieldStats,
  FieldTool,
  FlagsSummary,
  SelectionInfo,
  StampSession,
} from "../../src/viewport-host/index.ts";

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
  } = {},
) {
  let entities: FieldEntityInfo[] = [];
  // The stub models the REAL host's snapshot semantics: setEntityCatalog stores
  // the catalog, and listGenerators() reads it AT CALL TIME through the same
  // pure helper field-host.ts uses. Without this the ordering bug (B1) is
  // invisible from the chrome — a static generator list can never go stale.
  let installedCatalog: EntityCatalog | null = null;
  // Call-order trace for the two seams whose ORDER is the contract under test.
  const order: string[] = [];
  const cbs: {
    tool: ((t: FieldTool) => void) | null;
    stamp: ((s: StampSession | null) => void) | null;
    stats: ((s: FieldStats) => void) | null;
    selection: ((i: SelectionInfo | null) => void) | null;
    toolError: ((msg: string) => void) | null;
    entities: (() => void) | null;
    drift: ((r: DriftFinding[] | null) => void) | null;
    flags: ((s: FlagsSummary) => void) | null;
  } = {
    tool: null,
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
  };
  const host: FieldHost = {
    init: (canvas) => {
      calls.init(canvas);
      return Promise.resolve();
    },
    dispose: calls.dispose,
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
      cbs.toolError = cb;
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
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
    subscribeStats: (cb) => {
      calls.subscribeStats(cb);
      cbs.stats = cb;
      // biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
      return () => {};
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
      stats: (s: FieldStats) => cbs.stats?.(s),
      selection: (i: SelectionInfo | null) => cbs.selection?.(i),
      /** The entity-list change TICK (the real host's only entity signal). */
      entities: () => cbs.entities?.(),
      drift: (r: DriftFinding[] | null) => cbs.drift?.(r),
      toolError: (msg: string) => cbs.toolError?.(msg),
      flags: (s: FlagsSummary) => cbs.flags?.(s),
    },
    setEntities: (next: FieldEntityInfo[]) => {
      entities = next;
    },
  };
}
