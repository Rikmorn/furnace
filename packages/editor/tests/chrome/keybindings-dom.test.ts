// Registered FIRST — the shell.test.tsx rule, and uniform across this directory as of the
// F4.5c Task 12 review. This file's own graph does not reach Radix, so its late
// registration was harmless rather than wrong; it is hoisted anyway because "every chrome
// test opens with this line" is a rule a scan can hold
// (`tests/register-first.test.ts`), and "every chrome test except the one that
// happens not to need it" is not.
import "../inspector/_register.ts";

// The DOM half of the key gate: `isTextInputTarget` needs a real HTMLElement to narrow
// against, so it cannot live beside the pure matcher/gate cases in tests/keybindings.ts.
//
// Lives under tests/chrome/ ON PURPOSE, and this is load-bearing rather than tidiness:
// registering happy-dom from a test file directly in tests/ replaces the global `fetch`
// with happy-dom's same-origin-policy one BEFORE the daemon HTTP, bundle, and GPU suites
// run, and 29 of them fail (measured this session, moving this case up from the deleted
// tests/chrome/menubar.test.tsx). Every DOM test in this package sits under a subdir for
// exactly that reason.
//
// TWO SUBJECTS, and they are both here because both need a real DOM and neither needs
// anything else. `isTextInputTarget` is the first. The second is `preventDefault`, added in
// T3b2 Task 4 — a claim about a real `KeyboardEvent`'s `defaultPrevented` flag, which no
// synthetic literal can carry. It is what pulled testing-library into this file (the second
// subject mounts the dispatcher hook; the first still touches `document.createElement` and
// nothing else).
import { afterEach, expect, test } from "bun:test";
import { createElement, useRef } from "react";
import type { ConfirmRequest } from "../../src/frontend/components/ConfirmDialog.tsx";
import { useGlobalKeybindings } from "../../src/frontend/hooks/useGlobalKeybindings.ts";
import type { ActionCtx } from "../../src/frontend/lib/actions.ts";
import { isTextInputTarget } from "../../src/frontend/lib/keybindings.ts";
import { makeCtx } from "../_actions-fixture.ts";
import { cleanup, render } from "../inspector/_harness.tsx";

afterEach(cleanup);

/** An `<input>` of `type`. Built through the attribute rather than the property so the
 *  fixture goes through the same normalisation the DOM applies to real markup. */
const inputOf = (type: string): HTMLInputElement => {
  const el = document.createElement("input");
  if (type !== "") el.setAttribute("type", type);
  return el;
};

test("isTextInputTarget: typed text ENTRY — a textarea, a select, a text field", () => {
  const textarea = document.createElement("textarea");
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  expect(isTextInputTarget(textarea)).toBe(true);
  expect(isTextInputTarget(editable)).toBe(true);
  // An <input> with no type attribute IS a text field — the empty-string case.
  expect(isTextInputTarget(inputOf(""))).toBe(true);
  for (const type of [
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
  ])
    expect({ type, matched: isTextInputTarget(inputOf(type)) }).toEqual({
      type,
      matched: true,
    });
});

test("isTextInputTarget: a <select> counts — Esc and ⏎ belong to its popup", () => {
  // The direction that loses WORK. These panels use native selects (form-bits.tsx says
  // why), one of them the merge-policy select rendered DURING a live stamp session:
  // Esc there is the conventional dismiss for the dropdown, and an unclaimed Esc runs
  // the cancel ladder and discards the session being configured.
  expect(isTextInputTarget(document.createElement("select"))).toBe(true);
});

test("isTextInputTarget: a control you OPERATE is not typed text", () => {
  // The direction that loses BINDINGS. `range` is the sharp one — the brush-radius
  // slider is dragged while looking at the field, so matching it would make V/B/F dead
  // exactly there (the "touch a panel and the keys stop working" defect, relocated).
  for (const type of ["range", "checkbox", "radio", "color", "file", "button"])
    expect({ type, matched: isTextInputTarget(inputOf(type)) }).toEqual({
      type,
      matched: false,
    });
  expect(isTextInputTarget(document.createElement("div"))).toBe(false);
  expect(isTextInputTarget(document.createElement("canvas"))).toBe(false);
  expect(isTextInputTarget(document.createElement("button"))).toBe(false);
  expect(isTextInputTarget(null)).toBe(false);
});

// --- preventDefault is SYNCHRONOUS (T3b2 Task 4) ------------------------------
//
// THE RISK THIS TASK CREATED. `useGlobalKeybindings` used to run four statements inline;
// it now calls an `async` funnel and depends on `onClaim?.()` landing before the first
// `await` in it. Nothing else in the repo asserts `defaultPrevented`, and the failure is
// silent: insert one `await` above `onClaim?.()` — which lives in `refuseOrClaim`, the
// sequence `runAction` shares with `runMember` since T4a Task 2, and which `runAction`
// calls before its own first `await` — and every other case in
// this package stays green while ⌘S starts opening Safari's save sheet — the claim is
// about a MICROTASK boundary, and a test that awaits between dispatch and assertion cannot
// see one. So: a real event, `cancelable`, and NO await before the expectation.

/** Mount the one window listener, over a ctx the fixture supplies and a confirm slot the
 *  case controls. `createElement` rather than JSX so this file stays `.ts` beside the
 *  `isTextInputTarget` cases it shares a DOM with. */
function Dispatcher({
  confirm,
  claimLost = false,
  ctx,
}: {
  confirm: ConfirmRequest | null;
  claimLost?: boolean;
  /** The ctx the listener dispatches into, when a case wants to read its spies back. */
  ctx?: ActionCtx;
}) {
  const ctxRef = useRef<ActionCtx>(ctx ?? makeCtx());
  const confirmRef = useRef<ConfirmRequest | null>(confirm);
  confirmRef.current = confirm;
  const claimLostRef = useRef(claimLost);
  claimLostRef.current = claimLost;
  useGlobalKeybindings(ctxRef, confirmRef, claimLostRef);
  return null;
}

/** Press it for real. `cancelable` is load-bearing: `preventDefault()` on a
 *  non-cancelable event is a no-op and `defaultPrevented` stays false, so a fixture that
 *  omitted it would report the bug this case exists to catch, always. */
const press = (init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
};

test("a claimed key is prevented SYNCHRONOUSLY — no microtask between the press and the claim", () => {
  render(createElement(Dispatcher, { confirm: null }));
  // ⌘S. Read on the very next line, with nothing awaited: the browser decides whether to
  // open its save sheet when the listener returns, not when a promise settles.
  expect(press({ key: "s", metaKey: true }).defaultPrevented).toBe(true);
});

test("a DISABLED action still claims its key — the reason `onClaim` sits before `enabled`", () => {
  render(createElement(Dispatcher, { confirm: null }));
  // ⌘Z with an empty undo stack (the fixture's `stats` is null, so `undoDepth` reads 0).
  // The verb does nothing and the key is still spent: an unprevented ⌘Z reaches the text
  // field's own undo stack, and an unprevented ⌫ over the canvas navigates back.
  expect(press({ key: "z", metaKey: true }).defaultPrevented).toBe(true);
  expect(press({ key: "Backspace" }).defaultPrevented).toBe(true);
});

test("a REFUSED action prevents NOTHING — the character the user is typing survives", () => {
  // The other direction, and the one that would make an over-eager claim look correct. A
  // modal confirm refuses every class, and a refusal must leave the press alone.
  render(
    createElement(Dispatcher, {
      confirm: {
        title: "t",
        message: "m",
        confirmLabel: "ok",
        onConfirm: () => undefined,
      },
    }),
  );
  expect(press({ key: "s", metaKey: true }).defaultPrevented).toBe(false);
  // …and a key nothing claims at all is untouched, so the case is not passing by refusing
  // everything.
  expect(press({ key: "w" }).defaultPrevented).toBe(false);
});

// --- the claim-lost cover suppresses the keyboard (T4b) -----------------------

test("a tab that LOST its claim dispatches nothing — the cover is terminal, not decorative", () => {
  // The cover (`ClaimLostOverlay`) stops a pointer by being a full-viewport layer and
  // stops nothing else: this listener is on the WINDOW. Without the guard, ⌘S saves,
  // ⌘Z undoes and ⌘K opens a palette ABOVE the cover, in a tab the daemon has already
  // handed to somebody else — and true read-only mode is not built, so this line is the
  // whole enforcement of that narrowing.
  const ctx = makeCtx();
  render(createElement(Dispatcher, { confirm: null, claimLost: true, ctx }));

  // ⌘S and `v` — a chord and a bare key, because they enter the funnel by the same door
  // but a guard written one branch too low could pass one and not the other. BOTH must be
  // keys something actually binds: an earlier draft pressed `2`, which no descriptor
  // claims, so `matchAction` returned null with or without the guard and the bare half of
  // this case asserted nothing at all. `v` is `tool.pointer` → `ctx.run.setGesture`.
  expect(press({ key: "s", metaKey: true }).defaultPrevented).toBe(false);
  press({ key: "v" });
  expect(ctx.run.world.save).not.toHaveBeenCalled();
  expect(ctx.run.setGesture).not.toHaveBeenCalled();

  // NOT prevented, deliberately: a refused key already leaves the press alone (the case
  // above), and a dead tab is not a reason to start swallowing the browser's own chords.
  // The assertion that matters is the verb, which is why the spy is read as well.
});

test("…and the very same press dispatches once the claim is held", () => {
  // The control. Without it the case above passes on a fixture that dispatches nothing.
  const ctx = makeCtx();
  render(createElement(Dispatcher, { confirm: null, claimLost: false, ctx }));
  expect(press({ key: "s", metaKey: true }).defaultPrevented).toBe(true);
  expect(ctx.run.world.save).toHaveBeenCalled();
  press({ key: "v" });
  expect(ctx.run.setGesture).toHaveBeenCalled();
});
