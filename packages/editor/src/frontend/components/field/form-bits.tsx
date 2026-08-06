// The native-<select> class string, and nothing else since F4.5c Task 8 moved the tooltip
// trio to `components/ui/tips.tsx`. Two consumers (the session card's advanced section and
// the tool strip's params row). Stateless.
//
// The `field/` address is historical rather than descriptive: the panel's own pieces that
// used to be the callers (BrushInspector, StampInspector) were both deleted, and both
// surviving consumers are shell surfaces.
//
// THE FOUR SELECTS THESE STYLE STAY NATIVE, and D-24's ban allowlists them by name in
// `scripts/one-control-library.grit`. The reason is no longer the one this file used to
// give — "Radix's portaled listbox buys nothing at this size and costs the harness a mock"
// was measured FALSE at F4.5c Task 0: the listbox mounts under happy-dom, a plain click
// opens it, and a Radix select drives end to end with no mock. The condition on that, found
// at Task 12 and written up in `tests/inspector/enum-field.test.tsx`, is module-evaluation
// order rather than anything about the event or the DOM — Radix's `useLayoutEffect` shim
// captures `globalThis.document` at LOAD time, so a test file that wants a Radix portal has
// to register happy-dom first (a bare `import "…/_register.ts"`, the shell.test.tsx rule).
// The real reason these stay native is the KEY GATE, measured at Task 12 by migrating the
// merge-policy select and running the case:
//
//   with a live stamp session standing, opening the Radix listbox and pressing Esc to
//   dismiss it called `host.escape()` — the cancel ladder — and would have discarded the
//   session the user was configuring.
//
// The mechanism is not Radix's bug and not ours alone. `DismissableLayer` claims Escape on
// a CAPTURE-phase `document` listener and calls `preventDefault()` without
// `stopPropagation()` (@radix-ui/react-dismissable-layer 1.1.15), and `useGlobalKeybindings`
// never consults `defaultPrevented` — the same pairing `components/ui/tips.tsx` documents for
// an open tooltip. What keeps Esc off the ladder for these four is `isTextInputTarget`
// (`lib/keybindings.ts`), which recognises an `HTMLSelectElement` and cannot recognise the
// `<button>` a Radix trigger is.
//
// A SECOND hazard found in the same read, independent of Escape and not fixed by claiming
// it: Radix's `SelectTrigger` runs typeahead on any single-character keydown and opens on
// Enter/Space/Arrow (@radix-ui/react-select 2.3.3), also without stopping propagation — and
// Radix returns focus to the trigger after a commit. On the always-on tool strip that makes
// every bare tool key change the mask AND arm its tool. The native control's own
// `releaseAfterChange` blur (`shell/tool-params.tsx`) is what closes that today.
//
// Both are reachable: a `ui/select.tsx` that stopped propagation on `onEscapeKeyDown` (the
// command palette's line) plus a blur-on-close would do it. Neither was in Task 12's scope,
// and neither is free — so these four stay native, on evidence, until someone re-argues it.
//
// The evidence is EXECUTABLE as of the Task 12 review:
// `tests/chrome/native-select-key-gate.test.tsx` walks all four allowlisted sites and
// asserts Esc does not reach `host.escape()` at each. One correction it carries — the
// original write-up said the probe stood beside a LIVE SESSION, and three of the four
// cannot: a live session swaps the tool strip out, detaching them. The hazard needs no
// session; Esc runs the ladder against an ordinary selection just as well.

export const SELECT_CLASS =
	"h-8 rounded-md border border-input bg-transparent px-2";
