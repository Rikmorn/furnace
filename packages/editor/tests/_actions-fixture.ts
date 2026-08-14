// Fixtures for the action-registry tests, in a NON-test module so the two suites that
// need them (`tests/actions.test.ts` and `tests/keybindings.test.ts`) can share one copy
// without either importing the other's `test()` calls — the `_stub-host.ts` /
// `_harness.tsx` convention. Importing a `.test.ts` for its exports re-registers every
// case in it, which is why running the dispatch suite alone used to report the table
// suite's cases too.
import { mock } from "bun:test";
import { ACTION_OK, type ActionResult } from "../src/action-registry/index.ts";
import type { FieldHost } from "../src/field-host/index.ts";
import type { ActionCtx } from "../src/frontend/lib/actions.ts";

/** The three world verbs that ANSWER (T3b2 Task 4 — `WorldActions`' own docblock says which
 *  three and why). A spy returning `undefined` here would be a lie the type system cannot
 *  see through a `mock()`, and the dispatch funnel reads what they return: a bare `mock()`
 *  made `world.save` resolve to `undefined` and `sayResult` throw on it. */
const wrote = () => mock(() => Promise.resolve(ACTION_OK));

/** `frameSelection`'s spy, and it is `wrote`'s reason one verb over — synchronously, since
 *  foundations T5. The host's framing verb ANSWERS its refusal rather than reporting it, and
 *  `view.frame` hands that verdict back as its own, so a bare `mock()` resolving to
 *  `undefined` is a lie the `as unknown as FieldHost` cast hides and the funnel then reads:
 *  `runAction` dereferenced `result.ok` and answered `failed` at five call sites.
 *
 *  IT FRAMES BY DEFAULT. A case that wants the empty-selection refusal sets it
 *  (`host.frameSelection.mockReturnValue(refused(…, "inert"))`), which is also the only thing
 *  a spy can pin here — WHETHER a real host refuses on a real empty selection is
 *  `tests/field-host-camera.test.ts`', against a host that has a selection to be empty. */
const framed = () => mock((): ActionResult => ACTION_OK);

/** The reader the ownership guard asks (undo-attribution slice), and the only member here
 *  that is not a verb: `edit.undo`/`edit.redo` ask whose the top history entry is before
 *  they step it, and an agent-originated dispatch is refused over anybody else's. Typed
 *  `string | undefined` rather than left to `mock()`'s inferred `undefined` so a case can
 *  `mockReturnValue` an origin at all — `undefined` IS one of the two answers under test
 *  (a human-authored top), so the default is the human case and every agent case says so.
 *  The parameter is declared though the body ignores it, for the other half: `mock.calls`
 *  is what pins that `edit.redo` asks about the REDO stack, and a nullary spy would record
 *  an empty tuple and agree with a guard that read the wrong one. */
const topOrigin = () =>
  mock((_stack: "undo" | "redo"): string | undefined => undefined);

/** The FOURTEEN host verbs the action table runs, plus `topEntryOrigin` (a READ, not a verb
 *  — see above) and `isLooking`, which no `run` calls — the window dispatcher polls it per
 *  keypress to build `GateEnv.looking`. Every one of them, and NOTHING else. Both halves are
 *  load-bearing, and foundations T3b2 found this list failing both.
 *
 *  DERIVED BY `grep -o "host\.[a-zA-Z]*(" packages/editor/src/frontend/lib/actions.ts |
 *  sort -u`, which returns these sixteen and is a REPLACEMENT: this line used to cite
 *  `grep -o 'ctx\.host?\.[a-zA-Z]*'`, and T4c is what retired it — the three host seams
 *  bind the host to a local `host` before calling it, so that pattern now matches only the
 *  two places `actions.ts` QUOTES the old shape in prose. A citation that returns the wrong
 *  answer is worse than none: it invites a reader to re-derive the list and get two names.
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
 *  _stub-host.ts` carried both at the time, correctly — it stubs the whole `FieldHost` facade,
 *  and `commitSession` was a member of it — and two chrome suites were still caught reaching
 *  for the wrong one of its two and passing vacuously
 *  (`chrome/native-select-key-gate.test.tsx`, `chrome/shell.test.tsx`). This list is not a
 *  facade stub and has no such excuse: what is here is what the table calls, so the wrong
 *  mock is not reachable to begin with. */
export function makeHostSpy() {
  return {
    undo: mock(),
    redo: mock(),
    topEntryOrigin: topOrigin(),
    deleteEntity: mock(),
    duplicateEntity: mock(),
    beginMove: mock(),
    frameSelection: framed(),
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
    // No modal, and a CALL rather than a field because that is what the ctx declares: a case
    // that wants one open passes its own closure (`makeCtx({ isConfirmOpen: () => open })`),
    // which is also how the polled-at-dispatch claim is testable at all.
    isConfirmOpen: () => false,
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
