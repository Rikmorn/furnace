// Which EVENT reaches which action, and when the gate refuses it — the dispatch half of
// the registry. Its sibling `tests/actions.test.ts` owns the table's own shape (ids,
// labels, enabled, what running one calls).
//
// Pure — no DOM needed; `KeyboardEvent` is only a type here (erased), so this file
// deliberately does NOT import the happy-dom harness (doing so from a top-level tests/
// file poisons the daemon/bundle/GPU suites — see the header of
// tests/chrome/keybindings-dom.test.ts). `isTextInputTarget`, which needs a real
// HTMLElement, is covered there.
import { expect, test } from "bun:test";
import {
  ACTIONS,
  type ActionDef,
  type GateEnv,
  gateAction,
  matchAction,
} from "../src/frontend/lib/actions.ts";
import { byId, makeCtx } from "./_actions-fixture.ts";

/** A synthetic keydown. The four modifier flags are FILLED, never left undefined: a real
 *  `KeyboardEvent` always carries all four as booleans, and a matcher that compared
 *  `e.shiftKey === false` would pass against a real event and fail against a sloppy
 *  literal — a difference between the test and the browser, which is the one difference a
 *  binding test must not have. */
const ev = (o: Partial<KeyboardEvent> & { key: string }) =>
  ({
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...o,
  }) as KeyboardEvent;

const LOOSE: GateEnv = {
  inTextInput: false,
  confirmOpen: false,
  looking: false,
};

/** Every keyed action, with an event that should run it. The list is the BINDING TABLE
 *  in machine-readable form: adding a binding without a row here fails the completeness
 *  case below. */
const BINDINGS: { id: string; event: KeyboardEvent }[] = [
  { id: "world.save", event: ev({ key: "s", metaKey: true }) },
  {
    id: "world.saveAs",
    event: ev({ key: "S", metaKey: true, shiftKey: true }),
  },
  { id: "edit.undo", event: ev({ key: "z", metaKey: true }) },
  { id: "edit.redo", event: ev({ key: "z", metaKey: true, shiftKey: true }) },
  { id: "edit.duplicate", event: ev({ key: "j", metaKey: true }) },
  { id: "edit.delete", event: ev({ key: "Backspace" }) },
  { id: "edit.grab", event: ev({ key: "g" }) },
  { id: "tool.pointer", event: ev({ key: "v" }) },
  { id: "tool.brush", event: ev({ key: "b" }) },
  { id: "tool.brushCycle", event: ev({ key: "B", shiftKey: true }) },
  { id: "tool.select", event: ev({ key: "m" }) },
  { id: "tool.selectCycle", event: ev({ key: "M", shiftKey: true }) },
  { id: "tool.stamp", event: ev({ key: "s" }) },
  { id: "tool.stampCycle", event: ev({ key: "S", shiftKey: true }) },
  { id: "tool.swapEffect", event: ev({ key: "x" }) },
  { id: "session.confirm", event: ev({ key: "Enter" }) },
  { id: "session.rotate", event: ev({ key: "r" }) },
  { id: "session.escape", event: ev({ key: "Escape" }) },
  { id: "view.commandPalette", event: ev({ key: "k", metaKey: true }) },
  { id: "view.frame", event: ev({ key: "f" }) },
  { id: "view.togglePalettes", event: ev({ key: "\\", metaKey: true }) },
];

test("⌃K reaches the palette too — the pre-named Safari fallback is already live", () => {
  // ⌘K is marked provisional in the charter's binding table ("verify in Safari"). It does
  // not need a second BINDING if the browser gate finds it claimed: `mod` accepts Ctrl as
  // well as ⌘ throughout this table, so the fallback is a documentation change, not a
  // code one. This case is what makes that claim true rather than hopeful.
  const claimants = ACTIONS.filter(
    (a) => a.match?.(ev({ key: "k", ctrlKey: true })) === true,
  ).map((a) => a.id);
  expect(claimants).toEqual(["view.commandPalette"]);
});

test("every binding reaches its action, and EXACTLY one action claims each event", () => {
  for (const { id, event } of BINDINGS) {
    const claimants = ACTIONS.filter((a) => a.match?.(event) === true).map(
      (a) => a.id,
    );
    // Both halves in one assertion, so a duplicate claim reports which two collided
    // rather than only that the first one won.
    expect({ event: event.key, claimants }).toEqual({
      event: event.key,
      claimants: [id],
    });
  }
});

test("every keyed action has a row above — a binding cannot ship unpinned", () => {
  const keyed = ACTIONS.filter((a) => a.match !== undefined).map((a) => a.id);
  expect(new Set(keyed)).toEqual(new Set(BINDINGS.map((b) => b.id)));
});

test("Ctrl stands in for ⌘, and case is folded", () => {
  expect(matchAction(ev({ key: "z", ctrlKey: true }))?.id).toBe("edit.undo");
  expect(matchAction(ev({ key: "S", metaKey: true }))?.id).toBe("world.save");
  expect(matchAction(ev({ key: "\\", ctrlKey: true }))?.id).toBe(
    "view.togglePalettes",
  );
  expect(matchAction(ev({ key: "G" }))?.id).toBe("edit.grab");
});

test("⇧ means ONE thing across the table — every ⌘-chord states it", () => {
  // Two shift policies in one table is how ⇧⌘S came to do nothing at all (unclaimed, so
  // unprevented, so the browser's Save-Page dialog) while ⇧⌘\ toggled palettes. Every
  // ⌘-binding now goes through `chord`, which pins `shiftKey` either way.
  expect(matchAction(ev({ key: "s", metaKey: true, shiftKey: true }))?.id).toBe(
    "world.saveAs",
  );
  expect(
    matchAction(ev({ key: "\\", metaKey: true, shiftKey: true })),
  ).toBeNull();
  expect(
    matchAction(ev({ key: "j", metaKey: true, shiftKey: true })),
  ).toBeNull();
});

test("⌥ is not a modifier any binding uses — with it held, nothing classifies", () => {
  // It is the viewport's eyedropper modifier, and on macOS it rewrites `e.key` anyway.
  expect(matchAction(ev({ key: "s", metaKey: true, altKey: true }))).toBeNull();
  expect(matchAction(ev({ key: "f", altKey: true }))).toBeNull();
  expect(matchAction(ev({ key: "Escape", altKey: true }))).toBeNull();
});

test("the canvas keeps its own keys — the registry claims none of them", () => {
  // The fly set, the radius steppers, the arrow nudges and the momentary modifiers are
  // the viewport's (see the ownership rule in lib/actions.ts). If one of them ever
  // classifies here it is being handled twice.
  for (const key of ["w", "a", "d", "q", "e", "[", "]", "Shift", "Control"])
    expect({ key, id: matchAction(ev({ key }))?.id ?? null }).toEqual({
      key,
      id: null,
    });
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
    expect({ key, id: matchAction(ev({ key }))?.id ?? null }).toEqual({
      key,
      id: null,
    });
});

test("`s` is BOTH a fly key and the stamp family — the look gate is what separates them", () => {
  // Fly-backward and "open a stamp" are one keycap. What decides is whether the right
  // button is down, polled per keypress: while looking, the letters belong to the fly.
  const stamp = byId("tool.stamp");
  expect(matchAction(ev({ key: "s" }))?.id).toBe("tool.stamp");
  expect(gateAction(stamp, makeCtx(), LOOSE).ok).toBe(true);
  expect(gateAction(stamp, makeCtx(), { ...LOOSE, looking: true }).ok).toBe(
    false,
  );
});

// --- the gate ---------------------------------------------------------------

const verdict = (def: ActionDef, env: Partial<GateEnv>) =>
  gateAction(def, makeCtx(), { ...LOOSE, ...env });

test("⌘-chords stay live inside a text input — the browser default they replace is worse", () => {
  expect(verdict(byId("world.save"), { inTextInput: true }).ok).toBe(true);
  expect(verdict(byId("edit.undo"), { inTextInput: true }).ok).toBe(true);
  expect(verdict(byId("view.togglePalettes"), { inTextInput: true }).ok).toBe(
    true,
  );
});

test("bare keys are refused in a text input — they are characters someone is typing", () => {
  for (const id of ["view.frame", "edit.grab", "tool.brush", "edit.delete"])
    expect({ id, ok: verdict(byId(id), { inTextInput: true }).ok }).toEqual({
      id,
      ok: false,
    });
});

test("only the FLY LETTERS stand down during a look drag — R and F are not fly keys", () => {
  // The look refusal is not a property of being bare, and treating it as one cost
  // something real: `R` was dead in BOTH listeners while the right button was held, so
  // turning a ghost while orbiting round it — a natural gesture that worked before the
  // registry — stopped working. `readFlyMove` reads w/a/s/d/q/e and nothing else.
  const looking = { looking: true };
  for (const id of ["tool.stamp", "tool.stampCycle"])
    expect({ id, ok: verdict(byId(id), looking).ok }).toEqual({
      id,
      ok: false,
    });
  for (const id of [
    "session.rotate",
    "view.frame",
    "tool.pointer",
    "tool.brush",
    "edit.grab",
    "edit.delete",
  ])
    expect({ id, ok: verdict(byId(id), looking).ok }).toEqual({ id, ok: true });
});

test("the fly-letter flag is declared only where the keycap actually collides", () => {
  // The membership IS the claim — a flag added to a key that is not w/a/s/d/q/e would
  // silently kill that binding for the duration of every look drag.
  const flyKeys = new Set(["w", "a", "s", "d", "q", "e"]);
  for (const a of ACTIONS) {
    if (a.flyLetter !== true) continue;
    const cap = (a.keys ?? "").replace("⇧", "").toLowerCase();
    expect({ id: a.id, collides: flyKeys.has(cap) }).toEqual({
      id: a.id,
      collides: true,
    });
  }
});

test("Esc and ⏎ are refused in a text input, and LIVE during a look drag", () => {
  // A field binds both itself (Escape reverts the edit, Enter commits it); running the
  // ladder on top would cancel the session behind the form the user is still in.
  for (const id of ["session.escape", "session.confirm"]) {
    expect({ id, ok: verdict(byId(id), { inTextInput: true }).ok }).toEqual({
      id,
      ok: false,
    });
    // …but cancelling and confirming must never depend on which button is down.
    expect({ id, ok: verdict(byId(id), { looking: true }).ok }).toEqual({
      id,
      ok: true,
    });
  }
});

test("a modal confirm suppresses EVERY class, chords included", () => {
  for (const id of ["world.save", "view.frame", "session.escape"])
    expect({ id, ok: verdict(byId(id), { confirmOpen: true }).ok }).toEqual({
      id,
      ok: false,
    });
});

test("a key that re-arms LMB is refused while a session owns the interaction, WITH a hint", () => {
  const session = makeCtx({ session: { generator: "hall" } as never });
  for (const id of [
    "tool.pointer",
    "tool.brush",
    "tool.brushCycle",
    "tool.select",
    "tool.selectCycle",
    "tool.stamp",
    "tool.stampCycle",
    // X joined the set in F4.5b Task 9: the brush it swaps is SUSPENDED while a
    // session stands (D-F4.5-7 — `onPointerDown` swallows the stroke), so a swap
    // there changes only what a click that cannot happen would have done.
    "tool.swapEffect",
  ]) {
    const v = gateAction(byId(id), session, LOOSE);
    expect({ id, ok: v.ok }).toEqual({ id, ok: false });
    // The hint is the whole point: a key that looks dead teaches the user it is dead.
    expect({ id, hint: v.ok ? null : v.hint }).toEqual({
      id,
      hint: "finish the session first — ⏎ applies it, Esc discards it",
    });
  }
  // Esc, ⏎ and R stay live — they are how the session ENDS.
  for (const id of ["session.escape", "session.confirm", "session.rotate"])
    expect({ id, ok: gateAction(byId(id), session, LOOSE).ok }).toEqual({
      id,
      ok: true,
    });
});

test("a menu-only action can never be dispatched", () => {
  // It has no `match`, so nothing reaches it — and the gate refuses it as a backstop, so
  // a matcher added without a gate cannot slip through ungated.
  expect(gateAction(byId("world.new"), makeCtx(), LOOSE).ok).toBe(false);
  expect(gateAction(byId("edit.history"), makeCtx(), LOOSE).ok).toBe(false);
});
