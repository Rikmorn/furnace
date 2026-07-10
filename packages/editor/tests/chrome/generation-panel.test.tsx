// Harness tests for the Generation panel (Slice 3.2.3): the measured reliability line,
// the envelope clamp-at-commit note, and the run/cancel button gating. Lives under
// tests/chrome/ (like tests/inspector/) so happy-dom registration stays scoped and never
// pollutes the daemon HTTP suites. Renders only the panel inside a mock EditorContext with
// a FAKE client (mockable run/bake/cancel) — the real worker never spawns in bun test.
import { cleanup, fireEvent, render, screen } from "../inspector/_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import {
  EditorContext,
  type EditorContextValue,
} from "../../src/frontend/components/editor-context.ts";
import { GenerationPanel } from "../../src/frontend/components/GenerationPanel.tsx";
import type { GenerationWorkerClient } from "../../src/frontend/lib/generation-client.ts";
import { initialSession } from "../../src/frontend/lib/generation.ts";
import { initialState } from "../../src/frontend/lib/state.ts";

afterEach(cleanup);

const ENVELOPE = [
  { rooms: 2, singleShot: 0.9, attempts: 4, projected: 0.9999 },
  { rooms: 3, singleShot: 0.8, attempts: 4, projected: 0.9984 },
  { rooms: 4, singleShot: 0.6, attempts: 5, projected: 0.9898 },
  { rooms: 5, singleShot: 0.4, attempts: 6, projected: 0.9533 },
  { rooms: 6, singleShot: 0.3, attempts: 9, projected: 0.9596 },
];

function makeCtx(overrides?: {
  session?: Partial<ReturnType<typeof initialSession>>;
}): {
  ctx: EditorContextValue;
  client: {
    run: ReturnType<typeof mock>;
    bake: ReturnType<typeof mock>;
    cancel: ReturnType<typeof mock>;
  };
} {
  const client = { run: mock(), bake: mock(), cancel: mock() };
  const session = { ...initialSession(), ...overrides?.session };
  const ctx = {
    state: { ...initialState, status: "ready", generationActive: true },
    dispatch: () => {},
    hostRef: { current: undefined },
    previewHostRef: { current: undefined },
    extensions: {
      COCKPIT_ENVELOPE: ENVELOPE,
      COCKPIT_CONFIG: {},
      COCKPIT_BUDGET: {},
    },
    actions: {},
    generation: {
      session,
      setSession: () => {},
      wingName: "generated-wing",
      setWingName: () => {},
      client: client as unknown as GenerationWorkerClient,
    },
    viewFlags: {},
    setViewFlag: () => {},
    store: undefined,
  } as unknown as EditorContextValue;
  return { ctx, client };
}

function renderPanel(overrides?: Parameters<typeof makeCtx>[0]) {
  const { ctx, client } = makeCtx(overrides);
  render(
    <EditorContext.Provider value={ctx}>
      <GenerationPanel />
    </EditorContext.Provider>,
  );
  return { client };
}

test("shows the measured reliability line for the current rooms value", () => {
  renderPanel();
  expect(
    screen.getByText("6 rooms: ~96% within 9 attempts (measured)"),
  ).toBeTruthy();
});

test("an out-of-envelope typed rooms value is clamped at commit with a note", () => {
  renderPanel();
  const rooms = screen.getByLabelText("Rooms") as HTMLInputElement;
  fireEvent.change(rooms, { target: { value: "15" } });
  fireEvent.blur(rooms);
  expect(
    screen.getByText(
      /rooms 15 is outside the measured envelope — clamped to 6/,
    ),
  ).toBeTruthy();
});

test("Generate is disabled while running; Cancel enabled and terminates the run", () => {
  const { client } = renderPanel({
    session: { status: { phase: "running", attempt: 2, totalAttempts: 9 } },
  });
  expect(
    (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const cancel = screen.getByRole("button", {
    name: "Cancel",
  }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  fireEvent.click(cancel);
  expect(client.cancel).toHaveBeenCalled();
});
