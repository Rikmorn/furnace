// Pins CURRENT ColorField commit/preview event wiring (regression armor for the
// shadcn control swap in Task 4). This is the "Safari saga" class of bug (commits
// 4e22f4f / 9f8bb41): a native <input type="color"> only blurs when focus moves to
// a focusable element, so a blur-commit silently failed to land in Safari. The fix
// commits on the native `change` event instead of blur. These pins lock that in:
// the ORDERING of preview (React onChange = native `input`) vs commit (native
// `change`) is load-bearing and is exactly what the control swap could break.
//
// Behavior verified by reading src/frontend/inspector/fields/ColorField.tsx and by
// these tests passing against current code.
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import { ColorField } from "../../src/frontend/inspector/fields/ColorField.tsx";

afterEach(cleanup);

/** Render a single-target ColorField and return the input + spies. */
function renderColorField(rgba: number[] = [0, 0, 0, 1]) {
  const onPreview = mock((_next: unknown[]) => {});
  const onCommit = mock((_next: unknown[]) => {});
  render(
    <ColorField
      schema={{}}
      values={[rgba]}
      onPreview={onPreview}
      onCommit={onCommit}
      onCancel={() => {}}
      path="color"
    />,
  );
  const input = screen.getByDisplayValue(/^#/) as HTMLInputElement;
  return { input, onPreview, onCommit };
}

test("React onChange (native `input`) previews live and does NOT commit", () => {
  const { input, onPreview, onCommit } = renderColorField();
  fireEvent.input(input, { target: { value: "#ff0000" } });
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(onPreview).toHaveBeenLastCalledWith([[1, 0, 0, 1]]);
  expect(onCommit).not.toHaveBeenCalled();
});

test("commit fires on the native `change` event, preserving the existing alpha", () => {
  const { input, onCommit } = renderColorField([0.2, 0.4, 0.6, 0.5]);
  fireEvent.change(input, { target: { value: "#ff0000" } });
  expect(onCommit).toHaveBeenCalledTimes(1);
  // Alpha (0.5) is carried through parseHex; RGB comes from the picked hex.
  expect(onCommit).toHaveBeenLastCalledWith([[1, 0, 0, 0.5]]);
});

test("blur alone NEVER commits (the Safari-saga guarantee)", () => {
  const { input, onCommit } = renderColorField();
  input.focus();
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
});

test("commit does not wait for blur — `change` without any blur commits", () => {
  const { input, onCommit } = renderColorField();
  // No blur is ever dispatched; the change event alone must commit.
  fireEvent.change(input, { target: { value: "#00ff00" } });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenLastCalledWith([[0, 1, 0, 1]]);
});

test("ordering: live preview (input) precedes commit (change); blur adds nothing", () => {
  const events: string[] = [];
  render(
    <ColorField
      schema={{}}
      values={[[0, 0, 0, 1]]}
      onPreview={() => events.push("preview")}
      onCommit={() => events.push("commit")}
      onCancel={() => {}}
      path="color"
    />,
  );
  const input = screen.getByDisplayValue(/^#/) as HTMLInputElement;
  // Drag (continuous input → preview), then dismiss (change → commit), then blur.
  fireEvent.input(input, { target: { value: "#ff0000" } });
  fireEvent.change(input, { target: { value: "#ff0000" } });
  const commitsBeforeBlur = events.filter((e) => e === "commit").length;
  input.focus();
  fireEvent.blur(input);

  // The first observable event is a preview, and it comes before the first commit.
  expect(events[0]).toBe("preview");
  expect(events.indexOf("preview")).toBeLessThan(events.indexOf("commit"));
  // Commit already happened at the `change`; blur produces no further commit.
  expect(events.filter((e) => e === "commit").length).toBe(commitsBeforeBlur);
});
