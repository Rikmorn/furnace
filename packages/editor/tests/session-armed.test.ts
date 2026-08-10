// `SessionState.armed` — the ONE derived member, and the one the T4b gate walk paid for
// (foundations T4c, Task 5).
//
// HERE AND NOT IN `tests/chrome/session-state.test.tsx`, for two reasons that pull the same
// way. The projection is React-free by its own contract ("what an answer IS lives here, what
// it can SEE is assembled up there"), so the JOIN is testable with no shell at all. And the
// gesture slot is CHROME state with no seam behind it — a mounted shell can only move it by
// driving the tool rail, so a matrix over the six slot values would be six rail interactions
// standing in for one function call. What the shell file pins instead is the WIRING (the
// pending-stamp seam really reaches the payload, the session really shadows the slot); what
// is pinned here is the rule.
//
// `makeCtx`'s defaults ARE the misreading, which is why they are left alone: `gesture:
// "pointer"` beside `tool: {effect: "dig"}` is the exact pair the reviewing agent read as
// "dig armed" while the human saw nothing armed but the Select button.
import { expect, test } from "bun:test";
import type { FieldHistory, FieldHost } from "../src/field-host/index.ts";
import type { ActionCtx } from "../src/frontend/lib/actions.ts";
import { sessionState } from "../src/frontend/lib/session-answerers.ts";
import type { ArmedState, SessionState } from "../src/shared/wire.ts";
import { makeCtx } from "./_actions-fixture.ts";

/** An empty history — the projection copies its tail and reads its revision, and neither is
 *  what any case here is about. */
const HISTORY: FieldHistory = {
  undo: [],
  redo: [],
  undoDepth: 0,
  redoDepth: 0,
  revision: "rev-0",
};

/** The one host member the projection polls. `makeCtx`'s spy deliberately carries only the
 *  fourteen verbs the ACTION TABLE calls (its docblock refuses a spare mock), and
 *  `cameraPose` is not one of them — so the pose comes from a host supplied here.
 *
 *  Boundary cast: one member of a seventy-member facade, for a function that reaches exactly
 *  one. */
const POSED = {
  cameraPose: () => ({ yaw: 0, pitch: 0 }),
} as unknown as FieldHost;

const armedFor = (over: Partial<ActionCtx> = {}): ArmedState => {
  const state: SessionState = sessionState({
    ctx: makeCtx({ host: POSED, ...over }),
    history: HISTORY,
  });
  if (!state.ready) throw new Error("expected a READY session state");
  return state.armed;
};

test("the DORMANT brush does not read as armed — the misreading, pinned", () => {
  // The payload the T4b walk produced, and the answer it should have given. Both halves are
  // asserted together on purpose: the point is not that `armed` exists, it is that the brush
  // configuration is STILL there, unchanged and truthful, beside an arm that says the brush
  // is not what LMB does. A fix that answered this by hiding the brush (one of the three
  // candidate shapes — `tool: null` while the pointer is armed) would pass half of this case
  // and lose the setting an agent's own verbs manipulate.
  const state: SessionState = sessionState({
    ctx: makeCtx({ host: POSED }),
    history: HISTORY,
  });
  if (!state.ready) throw new Error("expected a READY session state");
  expect(state.armed).toEqual({ does: "selectEntity" });
  expect(state.brush.effect).toBe("dig");
});

test("every gesture the slot can hold has its own arm, and null is the brush", () => {
  // The map is EXHAUSTIVE over the host's `ViewportGesture` at compile time (a seventh member
  // stops the build), which is a claim only `bun run typecheck` can make. What this case adds
  // is that each row says the right thing at RUNTIME — including the two that are not
  // one-to-one: the three selection modes share an arm and carry their mode, and `null` is
  // not a member of the union at all but the slot being empty.
  expect(armedFor({ gesture: "pointer" })).toEqual({ does: "selectEntity" });
  expect(armedFor({ gesture: "box" })).toEqual({
    does: "selectCells",
    mode: "box",
  });
  expect(armedFor({ gesture: "material" })).toEqual({
    does: "selectCells",
    mode: "material",
  });
  expect(armedFor({ gesture: "void" })).toEqual({
    does: "selectCells",
    mode: "void",
  });
  expect(armedFor({ gesture: "segment" })).toEqual({ does: "segment" });
  expect(armedFor({ gesture: null })).toEqual({ does: "brush" });
});

test("a live SESSION shadows the slot, whatever the slot still says", () => {
  // The staged grammar owns the interaction (`lib/actions.ts`'s `idle`), and the slot is not
  // cleared while it does — it names what LMB goes back to. An `armed` that re-spelled the
  // slot alone would answer "select-by-click" over a ghost the human is steering, which is
  // the identical misreading one state along.
  const session = { generator: "hall", phase: "previewing" };
  expect(
    armedFor({
      gesture: "pointer",
      session: session as unknown as ActionCtx["session"],
    }),
  ).toEqual({ does: "session" });
});

test("a PENDING STAMP ARM shadows it too, and carries the generator id", () => {
  expect(
    armedFor({ gesture: "box", pendingStamp: { id: "maze", name: "Maze" } }),
  ).toEqual({ does: "stampRegion", generator: "maze" });
});

test("the arm is a FRESH record per answer, never the shared table entry", () => {
  // The lookup table is a MODULE constant, so an answer handing out its entry would let one
  // caller's mutation reach every later answer in the tab — a longer blast radius than the
  // aliasing rule `tests/chrome/session-state.test.tsx` pins for `world` and `mask`, which
  // reaches only the chrome's own state. `toEqual` stays green through a revert to handing
  // the entry over; `not.toBe` does not.
  const a = armedFor({ gesture: "box" });
  const b = armedFor({ gesture: "box" });
  expect(a).toEqual(b);
  expect(a).not.toBe(b);
});
