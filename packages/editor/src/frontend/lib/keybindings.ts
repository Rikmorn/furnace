// The one DOM question the key gate asks that `lib/actions.ts` cannot: is the event's
// target a place where the user is TYPING? It lives here rather than beside the registry
// so that module stays DOM-free and unit-testable without a happy-dom harness — this
// predicate needs a real `HTMLElement` to narrow against, and its test lives with the
// other DOM cases (`tests/chrome/keybindings-dom.test.ts`).
//
// A focusable `<canvas>` is deliberately NOT a text input: the viewport is where the bare
// keys are meant to work.

export function isTextInputTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}
