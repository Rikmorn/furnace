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
  type EditorActions,
  type EditorContextValue,
} from "../../src/frontend/components/editor-context.ts";
import { initialState, type EditorState } from "../../src/frontend/lib/state.ts";

const {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
  act,
} = await import("@testing-library/react");

export { render, screen, fireEvent, cleanup, within, waitFor, act };

type EditorContextOverrides = {
  state?: Partial<EditorState>;
  dispatch?: EditorContextValue["dispatch"];
  hostRef?: EditorContextValue["hostRef"];
  previewHostRef?: EditorContextValue["previewHostRef"];
  extensions?: Record<string, unknown>;
  actions?: Partial<EditorActions>;
};

/** Build a mock EditorContextValue with no-op defaults; override any slice. */
export function makeEditorContext(
  overrides: EditorContextOverrides = {},
): EditorContextValue {
  const actions: EditorActions = {
    previewEntity: () => {},
    previewSettings: () => {},
    revertEntity: () => {},
    commitComponents: async () => {},
    commitResource: async () => {},
    commitSettings: async () => {},
    save: async () => {},
    undo: async () => {},
    redo: async () => {},
    deleteSelection: async () => {},
    frameSelection: () => {},
    ...overrides.actions,
  };
  return {
    state: { ...initialState, status: "ready", ...overrides.state },
    dispatch: overrides.dispatch ?? (() => {}),
    hostRef: overrides.hostRef ?? { current: undefined },
    previewHostRef: overrides.previewHostRef ?? { current: undefined },
    extensions: overrides.extensions ?? {},
    actions,
  };
}

/** Render `ui` inside a mock EditorContext.Provider (for panels that read the context). */
export function renderWithEditor(
  ui: ReactElement,
  ctx: EditorContextValue,
): ReturnType<typeof render> {
  return render(<EditorContext.Provider value={ctx}>{ui}</EditorContext.Provider>);
}
