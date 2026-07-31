// The shared stub FieldHost for the chrome tests.
//
// Every mutator is a recording mock; each subscribe seam LATCHES its callback so a
// test can fire host-initiated pushes manually (wrap them in `act`).
// subscribeSelection/subscribeStamp/subscribeDrift/subscribeFlags/subscribeEntities
// push the current (empty) state on subscribe, like the real host does.
//
// Every unsubscribe is REAL (frees the slot, identity-guarded like the production
// host's) and every `fire.*` reports whether the push was DELIVERED. That pair is what
// lets a test tell a subscriber that leaks from one that cleans up — and, on a
// single-slot seam, WHICH mount is holding it.
//
// Shared because three suites now mount chrome that talks to a host: the field panel's
// own tests, the entities palette's, and the shell's (which renders both inside the
// shell layout). A second copy would go stale against the real FieldHost independently
// of this one.
// Tests are NOT part of the chrome bundle, so a value import of the viewport host is
// allowed here — and using the REAL helper is the point: the stub then goes stale
// exactly when the production host would.
import { mock } from "bun:test";
import type { EntityCatalog } from "../../src/frontend/lib/catalog.ts";
import { withArchetypeOptions } from "../../src/viewport-host/field-placements.ts";
import type {
  CameraPose,
  FieldDriftReport,
  FieldEntityInfo,
  FieldGeneratorInfo,
  FieldHost,
  FieldStats,
  FieldTool,
  FlagsSummary,
  PendingStamp,
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
    redoDepth: 0,
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
  /** The real host's `look !== null`. A mutable flag rather than a mock return,
   *  because the app-level key gate POLLS it on every keypress: a test has to be
   *  able to put the right button down between two presses, which is exactly the
   *  thing a snapshot could not express. */
  let looking = false;
  const cbs: {
    tool: ((t: FieldTool) => void) | null;
    cameraPose: ((p: CameraPose) => void) | null;
    stamp: ((s: StampSession | null) => void) | null;
    stats: ((s: FieldStats) => void) | null;
    selection: ((i: SelectionInfo | null) => void) | null;
    toolError: ((msg: string) => void) | null;
    entities: (() => void) | null;
    drift: ((r: FieldDriftReport | null) => void) | null;
    flags: ((s: FlagsSummary) => void) | null;
    entitySelection: ((entityId: number | null) => void) | null;
    pendingStamp: ((p: PendingStamp | null) => void) | null;
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
    entitySelection: null,
    pendingStamp: null,
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
    selectEntity: mock(),
    startStamp: mock(),
    updateStamp: mock(),
    nudgeStamp: mock(),
    rotateStamp: mock(),
    rerollStamp: mock(),
    commitStamp: mock(),
    commitSession: mock(),
    confirmSession: mock(),
    cancelStamp: mock(),
    escape: mock(),
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
    frameSelection: mock(),
    snapView: mock(),
    setAgentProfile: mock(),
    setFlagFilters: mock(),
    verifyFlag: mock(),
    // Every subscribe seam records its call, so a test can assert the slot was claimed
    // EXACTLY ONCE across a whole mounted arrangement — the single-slot rule's only
    // machine-checkable form. ALL ELEVEN belong to the shell's host-state provider —
    // `subscribeEntitySelection` got its chrome owner in F4.5b Task 4 and
    // `subscribePendingStamp` arrived owned in Task 9 — which is why the ownership
    // cases enumerate eleven.
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
      calls.subscribeTool(cb);
      cbs.tool = cb;
      // A REAL unsubscribe, for the subscribeStats reason: this is a single slot the
      // shell's provider owns now, and an inert release could not tell a subscriber
      // that leaks from one that cleans up.
      return () => {
        if (cbs.tool === cb) cbs.tool = null;
      };
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
      calls.subscribeSelection(cb);
      cbs.selection = cb;
      cb(null);
      // A REAL unsubscribe (the subscribeStats reason — single slot, and a leak has to
      // be distinguishable from a clean release).
      return () => {
        if (cbs.selection === cb) cbs.selection = null;
      };
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
    commitSession: calls.commitSession,
    confirmSession: calls.confirmSession,
    cancelStamp: calls.cancelStamp,
    escape: calls.escape,
    isLooking: () => looking,
    undo: calls.undo,
    redo: calls.redo,
    subscribeStamp: (cb) => {
      calls.subscribeStamp(cb);
      cbs.stamp = cb;
      cb(null);
      // A REAL unsubscribe (the subscribeStats reason — single slot, and a leak has to
      // be distinguishable from a clean release).
      return () => {
        if (cbs.stamp === cb) cbs.stamp = null;
      };
    },
    subscribePendingStamp: (cb) => {
      calls.subscribePendingStamp(cb);
      cbs.pendingStamp = cb;
      cb(null); // the real host pushes the CURRENT arm on subscribe
      // A REAL unsubscribe (the subscribeStats reason — single slot, and a leak has to
      // be distinguishable from a clean release).
      return () => {
        if (cbs.pendingStamp === cb) cbs.pendingStamp = null;
      };
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
      cbs.drift = cb;
      cb(null);
      // A REAL unsubscribe, for the subscribeStats reason: this is a single slot the
      // shell's provider owns now, and an inert release could not tell a subscriber
      // that leaks from one that cleans up.
      return () => {
        cbs.drift = null;
      };
    },
    dismissDrift: calls.dismissDrift,
    frameChunks: calls.frameChunks,
    frameSelection: calls.frameSelection,
    snapView: calls.snapView,
    subscribeEntities: (cb) => {
      calls.subscribeEntities(cb);
      cbs.entities = cb;
      cb(); // the real host's initial catch-up tick
      // A REAL unsubscribe (the subscribeStats reason — single slot, and a leak has to
      // be distinguishable from a clean release).
      return () => {
        cbs.entities = null;
      };
    },
    listEntities: () => entities.map((e) => structuredClone(e)),
    selectEntity: calls.selectEntity,
    subscribeEntitySelection: (cb) => {
      calls.subscribeEntitySelection(cb);
      cbs.entitySelection = cb;
      cb(null); // the real host pushes the CURRENT id on subscribe
      // A REAL unsubscribe (the subscribeStats reason — single slot, and a leak has to
      // be distinguishable from a clean release).
      return () => {
        if (cbs.entitySelection === cb) cbs.entitySelection = null;
      };
    },
    setAgentProfile: calls.setAgentProfile,
    subscribeFlags: (cb) => {
      calls.subscribeFlags(cb);
      cbs.flags = cb;
      cb({ total: 0, byKindSeverity: [], visible: [] });
      // A REAL unsubscribe (the subscribeStats reason — single slot, and a leak has to
      // be distinguishable from a clean release).
      return () => {
        if (cbs.flags === cb) cbs.flags = null;
      };
    },
    setFlagFilters: calls.setFlagFilters,
    verifyFlag: (key) => {
      calls.verifyFlag(key);
      if (opts.verifyRefusal !== undefined) cbs.toolError?.(opts.verifyRefusal);
    },
    flagMarkerCount: () => 0,
    exportArtifact: () => [],
    subscribeCameraPose: (cb) => {
      calls.subscribeCameraPose(cb);
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
    /** Fire a latched host→chrome push (callers wrap in act). EVERY fire reports whether
     *  the push was DELIVERED — false once the slot is free again, which is how a test
     *  tells a real unsubscribe from an inert one, and how it tells which MOUNT is
     *  holding a single-slot seam. */
    fire: {
      tool: (t: FieldTool): boolean => {
        if (cbs.tool === null) return false;
        cbs.tool(t);
        return true;
      },
      stamp: (s: StampSession | null): boolean => {
        if (cbs.stamp === null) return false;
        cbs.stamp(s);
        return true;
      },
      stats: (s: FieldStats): boolean => {
        if (cbs.stats === null) return false;
        cbs.stats(s);
        return true;
      },
      selection: (i: SelectionInfo | null): boolean => {
        if (cbs.selection === null) return false;
        cbs.selection(i);
        return true;
      },
      /** A camera move, as the host publishes one from `applyOrbit`. */
      cameraPose: (p: CameraPose): boolean => {
        if (cbs.cameraPose === null) return false;
        cbs.cameraPose(p);
        return true;
      },
      /** The entity-list change TICK (the real host's only entity signal). */
      entities: (): boolean => {
        if (cbs.entities === null) return false;
        cbs.entities();
        return true;
      },
      /** A drift report push. The host derives `entityIds` (which rows wear a
       *  badge) at push time from the footprints, so a test states it directly —
       *  the intersection itself is the HOST's and is pinned host-side. */
      drift: (r: FieldDriftReport | null): boolean => {
        if (cbs.drift === null) return false;
        cbs.drift(r);
        return true;
      },
      toolError: (msg: string): boolean => {
        if (cbs.toolError === null) return false;
        cbs.toolError(msg);
        return true;
      },
      flags: (s: FlagsSummary): boolean => {
        if (cbs.flags === null) return false;
        cbs.flags(s);
        return true;
      },
      /** A pending stamp ARM (or its clearing), as `startStamp` with no selection
       *  publishes one (D-F4.5-7). */
      pendingStamp: (p: PendingStamp | null): boolean => {
        if (cbs.pendingStamp === null) return false;
        cbs.pendingStamp(p);
        return true;
      },
      /** An entity-selection change, as a pointer click or `selectEntity` publishes one. */
      entitySelection: (entityId: number | null): boolean => {
        if (cbs.entitySelection === null) return false;
        cbs.entitySelection(entityId);
        return true;
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
