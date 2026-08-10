// Shared component-test harness for the inspector pins.
//
// DOM-registration ordering gotcha (VERIFIED under bun 1.3.14, this session):
// @testing-library's `screen` binds to `document.body` at the moment its module is
// EVALUATED, so the DOM must exist first. The spike proved a STATIC
// `import ... from "@testing-library/react"` is unreliable here: bun evaluates the
// testing-library module (and binds `screen`) BEFORE a relative side-effect module
// like `_register.ts` runs its body — even when `_register.ts` is the first import.
// So the plan's "put registration in its own module, import it first" idea does NOT
// work under bun's loader; `screen` still binds before the DOM exists.
//
// The reliable pattern is the spike's: register synchronously, THEN pull in
// testing-library via a DYNAMIC import (top-level await) so its evaluation is
// deferred until after the DOM exists. Registration stays scoped to files that
// import this harness (NOT a bun `--preload`) so `document`/`window` never leak into
// the daemon/server/GPU test runs.
import "./_register.ts";

import type { ReactElement } from "react";
import {
	EditorContext,
	type EditorContextValue,
} from "../../src/frontend/components/editor-context.ts";
import type { UiStore } from "../../src/frontend/lib/persist.ts";
import {
	type EditorState,
	initialState,
} from "../../src/frontend/lib/state.ts";

const { render, screen, fireEvent, cleanup, within, waitFor, act } =
	await import("@testing-library/react");

export { act, cleanup, fireEvent, render, screen, waitFor, within };

// biome-ignore lint/suspicious/noEmptyBlockStatements: shared inert test no-op
const noop = () => {};

type EditorContextOverrides = {
	state?: Partial<EditorState>;
	fieldHostRef?: EditorContextValue["fieldHostRef"];
	worldsVersion?: number;
	openConfirm?: EditorContextValue["openConfirm"];
	confirmRef?: EditorContextValue["confirmRef"];
	bakeBusyRef?: EditorContextValue["bakeBusyRef"];
	setAuthoredWorld?: EditorContextValue["setAuthoredWorld"];
	claimLostRef?: EditorContextValue["claimLostRef"];
	sessionStateRef?: EditorContextValue["sessionStateRef"];
	viewportFocusRef?: EditorContextValue["viewportFocusRef"];
	store?: UiStore;
};

/** A Map-backed fake UiStore for tests: reads/writes an in-memory record so a test can
 *  seed persisted UI state and assert what the chrome wrote back. */
export function fakeUiStore(initial: Record<string, unknown> = {}): UiStore {
	const data: Record<string, unknown> = { ...initial };
	return {
		// Boundary cast: the fake is a permissive Map over the UiState keys; tests only
		// exercise a subset, so we widen get/set to the generic contract here.
		get: ((key: string) => data[key]) as UiStore["get"],
		set: ((key: string, value: unknown) => {
			data[key] = value;
		}) as UiStore["set"],
	};
}

/** Build a mock EditorContextValue with no-op defaults; override any slice. */
export function makeEditorContext(
	overrides: EditorContextOverrides = {},
): EditorContextValue {
	return {
		state: { ...initialState, status: "ready", ...overrides.state },
		fieldHostRef: overrides.fieldHostRef ?? { current: undefined },
		// The backchannel's DISPATCH seam (T4c). Not overridable like `sessionStateRef`
		// below, because no inspector test drives an action through it — it is here because
		// the context type requires it, and `null` is the honest empty value (it is what
		// App creates it with, and what an unmounted shell leaves behind).
		dispatchRef: { current: null },
		worldsVersion: overrides.worldsVersion ?? 0,
		openConfirm: overrides.openConfirm ?? noop,
		// No prompt pending: the shell's keydown listener reads this to decide whether a
		// binding is suppressed, so the default has to be "nothing open".
		confirmRef: overrides.confirmRef ?? { current: null },
		// No write in flight. A test that wants to assert the SSE reload guard passes its
		// own ref and reads it after a save.
		bakeBusyRef: overrides.bakeBusyRef ?? { current: false },
		// Nobody is listening for a world switch. `App` fills this from `useSessionClaim`,
		// which re-keys its claim; a case that renders a panel alone has no claim to re-key,
		// and one that wants to see the call passes its own.
		setAuthoredWorld: overrides.setAuthoredWorld ?? noop,
		// The claim is held. A case that wants the claim-lost cover's keyboard suppression
		// passes its own ref — see tests/chrome/keybindings-dom.test.ts.
		claimLostRef: overrides.claimLostRef ?? { current: false },
		// Nobody reads the session yet. `ActionContextProvider` fills this on its first
		// commit, so a case that renders the Shell gets the real reader and one that renders
		// a panel alone gets `null` — which the answerer reports as `{ ready: false }`.
		sessionStateRef: overrides.sessionStateRef ?? { current: null },
		// No viewport. `CanvasHost` fills this on mount, so a case that renders the Shell
		// gets the real seam and one that renders a panel alone gets `null` — which every
		// reader treats as "there is no canvas to hand focus back to".
		viewportFocusRef: overrides.viewportFocusRef ?? { current: null },
		store: overrides.store,
	};
}

/** Render `ui` inside a mock EditorContext.Provider (for panels that read the context). */
export function renderWithEditor(
	ui: ReactElement,
	ctx: EditorContextValue,
): ReturnType<typeof render> {
	return render(
		<EditorContext.Provider value={ctx}>{ui}</EditorContext.Provider>,
	);
}
