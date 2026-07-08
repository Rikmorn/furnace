// Harness tests for the document-control surface (Task 5): isTextInputTarget, the
// MenuBar enable/disable split, and the Toolbar Save/Undo/Redo cluster.
//
// Lives in a subdirectory (like tests/inspector/, tests/viewport-host/) ON PURPOSE:
// a happy-dom-registering test placed directly in tests/ pollutes the shared global
// fetch and breaks the daemon HTTP suites that run later in the same bun process —
// every DOM test in this package sits under a subdir for exactly this reason.
//
// These render only small components — never the full <App/> (which, like
// mock.module-ing frontend api.ts, also trips the fetch pollution). The window-keydown
// listener (⌘S preventDefault, the undo/redo gate) is covered by the pure
// keybindings.test.ts classifier + the browser gate.
import { cleanup, fireEvent, render, screen } from "../inspector/_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import { MenuBar } from "../../src/frontend/components/MenuBar.tsx";
import { Toolbar } from "../../src/frontend/components/Toolbar.tsx";
import { isTextInputTarget } from "../../src/frontend/lib/keybindings.ts";
import { type EditorState, initialState } from "../../src/frontend/lib/state.ts";

afterEach(cleanup);

const st = (over: Partial<EditorState> = {}): EditorState => ({
  ...initialState,
  status: "ready",
  selectedScene: "a.scene.json",
  revision: 0,
  ...over,
});

const noop = () => {};
const menuBarProps = { onSave: noop, onUndo: noop, onRedo: noop, onDelete: noop };

function openMenu(label: string) {
  const trigger = screen.getByText(label);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

const menuItem = (name: RegExp): HTMLElement =>
  screen.getByRole("menuitem", { name });

// --- isTextInputTarget (needs a real HTMLElement) ---

test("isTextInputTarget recognises inputs, textareas and contentEditable", () => {
  const input = document.createElement("input");
  const textarea = document.createElement("textarea");
  const div = document.createElement("div");
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  expect(isTextInputTarget(input)).toBe(true);
  expect(isTextInputTarget(textarea)).toBe(true);
  expect(isTextInputTarget(editable)).toBe(true);
  expect(isTextInputTarget(div)).toBe(false);
  expect(isTextInputTarget(null)).toBe(false);
});

// --- MenuBar enable/disable ---

test("MenuBar renders the File/Edit/View/Help menus", () => {
  render(<MenuBar state={st()} {...menuBarProps} />);
  expect(screen.getByText("File")).toBeTruthy();
  expect(screen.getByText("Edit")).toBeTruthy();
  expect(screen.getByText("View")).toBeTruthy();
  expect(screen.getByText("Help")).toBeTruthy();
});

test("Edit▸Undo/Redo are disabled when the session cannot undo/redo", () => {
  render(<MenuBar state={st({ canUndo: false, canRedo: false })} {...menuBarProps} />);
  openMenu("Edit");
  expect(menuItem(/Undo/).hasAttribute("data-disabled")).toBe(true);
  expect(menuItem(/Redo/).hasAttribute("data-disabled")).toBe(true);
});

test("Edit▸Undo enabled fires onUndo on select", () => {
  const onUndo = mock(noop);
  render(<MenuBar state={st({ canUndo: true })} {...menuBarProps} onUndo={onUndo} />);
  openMenu("Edit");
  const undo = menuItem(/Undo/);
  expect(undo.hasAttribute("data-disabled")).toBe(false);
  fireEvent.click(undo);
  expect(onUndo).toHaveBeenCalledTimes(1);
});

test("Edit▸Delete is disabled when nothing is selected", () => {
  render(<MenuBar state={st({ selectedEntities: [] })} {...menuBarProps} />);
  openMenu("Edit");
  expect(menuItem(/Delete/).hasAttribute("data-disabled")).toBe(true);
});

test("File▸Save is disabled when the document is not dirty", () => {
  render(<MenuBar state={st({ dirty: false })} {...menuBarProps} />);
  openMenu("File");
  expect(menuItem(/Save/).hasAttribute("data-disabled")).toBe(true);
});

// --- Toolbar cluster (always-in-DOM, no overlay) ---

function renderToolbar(state: EditorState, onSave = noop) {
  render(
    <Toolbar
      state={state}
      onSelectScene={noop}
      onSave={onSave}
      onUndo={noop}
      onRedo={noop}
      onDelete={noop}
    />,
  );
}

test("toolbar Save/Undo/Redo buttons reflect session availability", () => {
  renderToolbar(st({ dirty: false, canUndo: true, canRedo: false }));
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
  const redo = screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true); // not dirty → save disabled
  expect(undo.disabled).toBe(false); // canUndo → enabled
  expect(redo.disabled).toBe(true); // !canRedo → disabled
});

test("toolbar Save button fires onSave when dirty", () => {
  const onSave = mock(noop);
  renderToolbar(st({ dirty: true }), onSave);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledTimes(1);
});
