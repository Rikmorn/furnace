// Fixtures for the action-registry tests, in a NON-test module so the two suites that
// need them (`tests/actions.test.ts` and `tests/keybindings.test.ts`) can share one copy
// without either importing the other's `test()` calls — the `_stub-host.ts` /
// `_harness.tsx` convention. Importing a `.test.ts` for its exports re-registers every
// case in it, which is why running the dispatch suite alone used to report the table
// suite's cases too.
import { mock } from "bun:test";
import type { ActionCtx } from "../src/frontend/lib/actions.ts";
import { ACTIONS } from "../src/frontend/lib/actions.ts";
import type { FieldHost } from "../src/viewport-host/index.ts";

export function makeHostSpy() {
  return {
    undo: mock(),
    redo: mock(),
    deleteEntity: mock(),
    duplicateEntity: mock(),
    beginMove: mock(),
    frameSelection: mock(),
    startStamp: mock(),
    commitSession: mock(),
    rotateStamp: mock(),
    escape: mock(),
    snapView: mock(),
    clearSelection: mock(),
    reselect: mock(),
    isLooking: mock(() => false),
  };
}

export function makeCtx(over: Partial<ActionCtx> = {}): ActionCtx {
  const host = makeHostSpy();
  return {
    host: host as unknown as FieldHost,
    gesture: "pointer",
    tool: {
      effect: "dig",
      materialId: 0,
      mask: { kind: "none" },
      smooth: { strength: 16, iterations: 1, mode: "both" },
      hollow: null,
    },
    session: null,
    selectedEntity: null,
    selection: null,
    stats: null,
    world: { name: null, dirty: false, busy: false },
    view: {
      shading: "studio",
      layers: {
        field: true,
        kit: true,
        props: true,
        ghost: true,
        selection: true,
        grid: true,
        flags: true,
        voidCast: false,
      },
      slice: { enabled: false, y: 8 },
      sampleCount: 4,
    },
    workspace: { hidden: false },
    generators: [
      { id: "hall", name: "Hall" },
      { id: "maze", name: "Maze" },
      { id: "cave", name: "Cave" },
      { id: "scatter", name: "Scatter" },
    ],
    stampCursor: null,
    pendingStamp: null,
    history: { undoLabel: null, redoLabel: null },
    run: {
      world: {
        save: mock(),
        saveAs: mock(),
        bake: mock(),
        open: mock(),
        reset: mock(),
        makeDefault: mock(),
        rename: mock(),
        duplicate: mock(),
        remove: mock(),
        openDrawer: mock(),
        closeDrawer: mock(),
      },
      view: {
        setShading: mock(),
        setLayers: mock(),
        setSlice: mock(),
        setSampleCount: mock(),
      },
      workspace: {
        move: mock(),
        setCollapsed: mock(),
        setOpen: mock(),
        setDrivenOpen: mock(),
        toggleHidden: mock(),
        setHidden: mock(),
        reset: mock(),
      },
      openConfirm: mock(),
      setGesture: mock(),
      armBrush: mock(),
      setStampCursor: mock(),
      summonPalette: mock(),
      openCommandPalette: mock(),
    },
    ...over,
  };
}

export const byId = (id: string) => {
  const def = ACTIONS.find((a) => a.id === id);
  if (def === undefined) throw new Error(`test: no action "${id}"`);
  return def;
};
