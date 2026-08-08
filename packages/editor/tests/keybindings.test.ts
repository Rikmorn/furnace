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
import { matchBinding } from "../src/action-registry/index.ts";
import {
  ACTIONS,
  type ActionDef,
  byId,
  capOf,
  clickGate,
  controlVerdict,
  type GateEnv,
  gateAction,
  keyFacts,
  matchAction,
} from "../src/frontend/lib/actions.ts";
import { makeCtx } from "./_actions-fixture.ts";

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

/** A keypress with nothing standing in its way. The `key` arm of {@link GateEnv} — every
 *  case in this file is about the KEYBOARD, which is the caller class the three key gates
 *  belong to; the `named` class has its own case at the foot of the file. */
const LOOSE = {
  caller: "key",
  inTextInput: false,
  confirmOpen: false,
  looking: false,
} as const satisfies GateEnv;

/** Who claims this event — the 22 bindings read as data, through the ONE matcher. The
 *  `match` closures this replaces were per-action functions over a `KeyboardEvent`; there is
 *  now one `matchBinding` over four facts, and `keyFacts` is the only place an event is
 *  read. */
const claimants = (event: KeyboardEvent): string[] =>
  ACTIONS.filter(
    (a) => a.keys !== undefined && matchBinding(a.keys, keyFacts(event)),
  ).map((a) => a.id);

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
  // ⇧ is how a US layout produces `?`, so the event a real keyboard sends carries it.
  { id: "help.shortcuts", event: ev({ key: "?", shiftKey: true }) },
];

test("⌃K reaches the palette too — the pre-named Safari fallback is already live", () => {
  // ⌘K is marked provisional in the charter's binding table ("verify in Safari"). It does
  // not need a second BINDING if the browser gate finds it claimed: `mod` accepts Ctrl as
  // well as ⌘ throughout this table, so the fallback is a documentation change, not a
  // code one. This case is what makes that claim true rather than hopeful.
  expect(claimants(ev({ key: "k", ctrlKey: true }))).toEqual([
    "view.commandPalette",
  ]);
});

test("every binding reaches its action, and EXACTLY one action claims each event", () => {
  // Both halves in one assertion, so a duplicate claim reports which two collided
  // rather than only that the first one won.
  for (const { id, event } of BINDINGS)
    expect({ event: event.key, claimants: claimants(event) }).toEqual({
      event: event.key,
      claimants: [id],
    });
});

test("every keyed action has a row above — a binding cannot ship unpinned", () => {
  // THE HUMAN-AUTHORED HALF of the pin, and the reason `BINDINGS` above is still 22 literal
  // rows after the table became data. Deriving those rows from the descriptors would make
  // both cases vacuous — a derived expectation compared against the table it was derived
  // from asserts nothing at all — so the events stay hand-written and this is what makes
  // them exhaustive in the other direction.
  const keyed = ACTIONS.filter((a) => a.keys !== undefined).map((a) => a.id);
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

test("`?` is matched by the CHARACTER, not by ⇧ — the one binding whose keycap moves with the layout", () => {
  // ⇧/ on a US layout, ⇧ß on a German one, and ⇧, on a French one — the modifier is the
  // LAYOUT's business, so the matcher states the character and nothing else. Both are
  // asserted because pinning `shiftKey === true` (what every other ⇧ binding here does)
  // would kill this key on any layout that puts `?` unshifted, and pinning `false` would
  // kill it on the one this editor is developed against.
  for (const shiftKey of [true, false])
    expect({
      shiftKey,
      id: matchAction(ev({ key: "?", shiftKey }))?.id,
    }).toEqual({ shiftKey, id: "help.shortcuts" });
  // AltGr is the exception and it is deliberate: Windows reports it as ctrl+alt, which the
  // chord and the ⌥ exclusions both refuse, so a layout that needs AltGr for `?` cannot
  // reach this binding. Filed rather than papered over (docs/backlog).
  expect(matchAction(ev({ key: "?", ctrlKey: true, altKey: true }))).toBeNull();
  // And it is not a chord in disguise: ⌘? must not open the overlay.
  expect(matchAction(ev({ key: "?", metaKey: true }))).toBeNull();
  // THE KEYCAP AND THE MATCHER AGREE, checked rather than reviewed. Every other row in this
  // table spells its cap in the editor's keycap vocabulary (`⌘S`, `⇧B`) and the bridge to
  // its matcher is the human-maintained list at the top of this file; this one's cap IS the
  // character, so the event can be built FROM the cap. Without this, a cap edited to `⇧/`
  // would leave every case here green while the menu advertised a key nothing answers.
  const def = byId("help.shortcuts");
  expect(matchAction(ev({ key: capOf(def) ?? "", shiftKey: true }))?.id).toBe(
    "help.shortcuts",
  );
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

const verdict = (
  def: ActionDef,
  env: Partial<Extract<GateEnv, { caller: "key" }>>,
) => gateAction(def, makeCtx(), { ...LOOSE, ...env });

test("⌘-chords stay live inside a text input — the browser default they replace is worse", () => {
  expect(verdict(byId("world.save"), { inTextInput: true }).ok).toBe(true);
  expect(verdict(byId("edit.undo"), { inTextInput: true }).ok).toBe(true);
  expect(verdict(byId("view.togglePalettes"), { inTextInput: true }).ok).toBe(
    true,
  );
});

test("bare keys are refused in a text input — they are characters someone is typing", () => {
  // `help.shortcuts` is in the list because `?` is the sharpest case in it: it is a
  // character that appears in prose, and the world drawer's name field and every string
  // param in the inspector are places someone types one.
  for (const id of [
    "view.frame",
    "edit.grab",
    "tool.brush",
    "edit.delete",
    "help.shortcuts",
  ] as const)
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
  for (const id of ["tool.stamp", "tool.stampCycle"] as const)
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
  ] as const)
    expect({ id, ok: verdict(byId(id), looking).ok }).toEqual({ id, ok: true });
});

test("the fly-letter flag is declared only where the keycap actually collides", () => {
  // The membership IS the claim — a flag added to a key that is not w/a/s/d/q/e would
  // silently kill that binding for the duration of every look drag.
  const flyKeys = new Set(["w", "a", "s", "d", "q", "e"]);
  for (const a of ACTIONS) {
    if (a.flyLetter !== true) continue;
    const cap = (capOf(a) ?? "").replace("⇧", "").toLowerCase();
    expect({ id: a.id, collides: flyKeys.has(cap) }).toEqual({
      id: a.id,
      collides: true,
    });
  }
});

test("Esc and ⏎ are refused in a text input, and LIVE during a look drag", () => {
  // A field binds both itself (Escape reverts the edit, Enter commits it); running the
  // ladder on top would cancel the session behind the form the user is still in.
  for (const id of ["session.escape", "session.confirm"] as const) {
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
  for (const id of ["world.save", "view.frame", "session.escape"] as const)
    expect({ id, ok: verdict(byId(id), { confirmOpen: true }).ok }).toEqual({
      id,
      ok: false,
    });
});

test("every SILENT refusal STATES its reason — the class is quiet, not empty (T4a)", () => {
  // What `hint: null` used to mean was BOTH "say nothing" and "there is nothing to say", and
  // the second half was never true: each of these four has always had a reason, and the
  // absence was standing in for a display policy. A caller who cannot see the screen gets the
  // sentence now; `spoken` is what keeps the screen unchanged, and is pinned beside it here
  // so a reason cannot quietly become a toast.
  //
  // FOUR, and the plan for this task named three. The fourth is the menu-only backstop — a
  // key-only class, unreachable in practice (`matchAction` only matches rows that declare
  // `keys`, and `keys`/`gate` are declared together or not at all), which is exactly why it
  // needs a sentence: it is the class nobody would notice returning nothing.
  const cases = [
    {
      why: "a modal is open",
      got: verdict(byId("world.save"), { confirmOpen: true }),
      hint: "a confirm dialog is open — answer it first",
    },
    {
      why: "the verb has no keycap",
      got: verdict(byId("world.new"), {}),
      // "no KEY runs it", not "nothing runs it": the very next case in this file dispatches
      // the same verb by NAME and it runs. A sentence that overstated the refusal would be a
      // new small lie in the commit that removed one.
      hint: "no key runs this verb — name it instead",
    },
    {
      why: "the user is typing",
      got: verdict(byId("tool.brush"), { inTextInput: true }),
      hint: "a text field has the keyboard — this key is a character being typed",
    },
    {
      why: "the right button is down",
      got: verdict(byId("tool.stamp"), { looking: true }),
      hint: "the look drag owns this letter while the right button is held",
    },
  ];
  for (const { why, got, hint } of cases) {
    expect({ why, ok: got.ok }).toEqual({ why, ok: false });
    if (got.ok) continue;
    expect({ why, hint: got.hint, spoken: got.spoken }).toEqual({
      why,
      hint,
      spoken: false,
    });
  }
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
  ] as const) {
    const v = gateAction(byId(id), session, LOOSE);
    expect({ id, ok: v.ok }).toEqual({ id, ok: false });
    // The hint is the whole point: a key that looks dead teaches the user it is dead.
    expect({ id, hint: v.ok ? null : v.hint }).toEqual({
      id,
      hint: "finish the session first — ⏎ applies it, Esc discards it",
    });
  }
  // Esc, ⏎ and R stay live — they are how the session ENDS.
  for (const id of [
    "session.escape",
    "session.confirm",
    "session.rotate",
  ] as const)
    expect({ id, ok: gateAction(byId(id), session, LOOSE).ok }).toEqual({
      id,
      ok: true,
    });
});

test("a menu-only action can never be dispatched BY A KEY", () => {
  // It has no binding, so nothing reaches it — and the gate refuses it as a backstop, so
  // a binding added without a gate cannot slip through ungated.
  expect(gateAction(byId("world.new"), makeCtx(), LOOSE).ok).toBe(false);
  expect(gateAction(byId("edit.history"), makeCtx(), LOOSE).ok).toBe(false);
});

// --- the second caller class (T3b2 Task 4, S12) -------------------------------

test("the SAME menu-only action IS runnable when it is NAMED — the no-gate refusal is about keycaps", () => {
  // The burger has always run these straight from its items and the ⌘K palette renders the
  // whole table, half of which is menu-only. What used to express that was `clickGate`
  // branching around `gateAction` before it could refuse; it is now the `caller` class, so
  // the two paths are one function and the difference is stated rather than routed around.
  for (const id of ["world.new", "edit.history"] as const)
    expect({ id, ok: clickGate(byId(id), makeCtx()).ok }).toEqual({
      id,
      ok: true,
    });
});

test("the three KEY refusals do not bind a named call — but the session refusal does", () => {
  // S12's finding, as behaviour. `clickGate` used to assert `inTextInput: false` on an
  // argument ("the user typed to find it and then named it") that is untrue of an agent; the
  // fix is that the `typed` class, the fly-letter class and the no-gate class are all about
  // a KEY, so a named call is never asked. The ⌘K palette activates rows from inside a text
  // field, and every letter-keyed verb has to survive that.
  for (const id of ["view.frame", "tool.brush", "session.escape"] as const)
    expect({ id, ok: clickGate(byId(id), makeCtx()).ok }).toEqual({
      id,
      ok: true,
    });
  // `tool.stamp` is the fly-letter case: refused to a KEY while the right button is held,
  // and never to a rail button, which is a left-button press on a control.
  expect(clickGate(byId("tool.stamp"), makeCtx()).ok).toBe(true);
  // What DOES bind both callers is the state refusal — a button that arms what its own key
  // refuses is the two-surfaces-disagree defect, and the sentence has to be the same one.
  const session = makeCtx({ session: { generator: "hall" } as never });
  const v = clickGate(byId("tool.brush"), session);
  expect({ ok: v.ok, hint: v.ok ? null : v.hint }).toEqual({
    ok: false,
    hint: "finish the session first — ⏎ applies it, Esc discards it",
  });
});

test("the DISPLAY gate is MODAL-BLIND — a control renders on what a user could act on (T4a)", () => {
  // THE ONE CLAUSE `clickGate` AND THE DISPATCH GATE DIFFER ON, and it is a decision rather
  // than an oversight — `actions.ts`' `NAMED_RENDER` carries the three reasons. The short
  // one: a modal is an ENFORCEMENT fact, and this seam answers a RENDERING question. While a
  // confirm stands, `body { pointer-events: none }` puts every control in the chrome behind
  // an overlay, so dimming them all would say nothing anybody could act on — and a verdict
  // that read the modal would be a function of a value `ToolRail`'s `useMemo` deps cannot
  // track, which is how a rail gets stuck dimmed after the dialog closes.
  const modal = makeCtx({ isConfirmOpen: () => true });
  expect(clickGate(byId("view.frame"), modal).ok).toBe(true);
  // THE DISPLAY THREE-WAY IS THEREFORE UNMOVED from what it was before the env was computed
  // at all — the rail, the ⌘K rows and the status chip see exactly what they always saw.
  expect(controlVerdict(byId("view.frame"), modal)).toEqual({ runnable: true });
  // BLIND TO THE MODAL CLAUSE AND TO NOTHING ELSE, which is what stops this being a gutted
  // gate: the state refusal still binds the display path, in its own words, under the same
  // open modal.
  const both = makeCtx({
    session: { generator: "hall" } as never,
    isConfirmOpen: () => true,
  });
  const v = clickGate(byId("tool.brush"), both);
  expect({ ok: v.ok, hint: v.ok ? null : v.hint }).toEqual({
    ok: false,
    hint: "finish the session first — ⏎ applies it, Esc discards it",
  });
});
