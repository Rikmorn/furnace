// Fixtures for the action-registry tests, in a NON-test module so the two suites that
// need them (`tests/actions.test.ts` and `tests/keybindings.test.ts`) can share one copy
// without either importing the other's `test()` calls — the `_stub-host.ts` /
// `_harness.tsx` convention. Importing a `.test.ts` for its exports re-registers every
// case in it, which is why running the dispatch suite alone used to report the table
// suite's cases too.
import { mock } from "bun:test";
import { ACTION_OK } from "../src/action-registry/index.ts";
import type { FieldHost } from "../src/field-host/index.ts";
import type { ActionCtx } from "../src/frontend/lib/actions.ts";

/** The three world verbs that ANSWER (T3b2 Task 4 — `WorldActions`' own docblock says which
 *  three and why). A spy returning `undefined` here would be a lie the type system cannot
 *  see through a `mock()`, and the dispatch funnel reads what they return: a bare `mock()`
 *  made `world.save` resolve to `undefined` and `sayResult` throw on it. */
const wrote = () => mock(() => Promise.resolve(ACTION_OK));

/** The FOURTEEN host verbs the action table runs (`grep -o 'ctx\.host?\.[a-zA-Z]*'
 *  src/frontend/lib/actions.ts | sort -u`), plus `isLooking`, which no `run` calls — the
 *  window dispatcher polls it per keypress to build `GateEnv.looking`. Every one of them,
 *  and NOTHING else. Both halves are load-bearing, and foundations T3b2 found this list
 *  failing both.
 *
 *  A MISSING verb makes its action untestable through `run`: the spy is cast to `FieldHost`,
 *  so an absent key is `undefined` at the call and `ctx.host?.frameWorld()` throws instead of
 *  recording. `confirmSession` and `frameWorld` were both absent, so neither `session.confirm`
 *  nor `view.frameWorld` could be run directly off the table. Neither was uncovered, and both
 *  were uncovered in the same PLACE — the routing. `session.confirm` was already reached
 *  END-TO-END through the window dispatcher (`chrome/native-select-key-gate.test.tsx`);
 *  `view.frameWorld` had only its View-submenu row pinned (`chrome/shell.test.tsx`), which
 *  says the row exists, not where it goes. Nothing ran either def.
 *
 *  A SPARE verb is worse than dead weight — it is a mock that reads like coverage. This list
 *  carried `commitSession`, which no action has ever called; `session.confirm` routes through
 *  the move-aware `confirmSession` (`actions.ts`' own comment says so). `tests/chrome/
 *  _stub-host.ts` carries both, correctly — it stubs the whole `FieldHost` facade, and
 *  `commitSession` is a member of it — and two chrome suites were still caught reaching for
 *  the wrong one of its two and passing vacuously
 *  (`chrome/native-select-key-gate.test.tsx`, `chrome/shell.test.tsx`). This list is not a
 *  facade stub and has no such excuse: what is here is what the table calls, so the wrong
 *  mock is not reachable to begin with. */
export function makeHostSpy() {
  return {
    undo: mock(),
    redo: mock(),
    deleteEntity: mock(),
    duplicateEntity: mock(),
    beginMove: mock(),
    frameSelection: mock(),
    frameWorld: mock(),
    startStamp: mock(),
    confirmSession: mock(),
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
        save: wrote(),
        saveAs: wrote(),
        bake: wrote(),
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
        nudge: mock(),
        resize: mock(),
        grow: mock(),
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
      openShortcuts: mock(),
    },
    ...over,
  };
}
