// Harness tests for the Generation panel (Epic 3 W1 world flow): the world knobs (World
// Name + two cave seeds), the run/bake button gating, and the Generate→runWorld call.
// Lives under tests/chrome/ (like tests/inspector/) so happy-dom registration stays scoped
// and never pollutes the daemon HTTP suites. Renders only the panel inside a mock
// EditorContext with a FAKE client (mockable runWorld/bakeWorld) — the real worker never
// spawns in bun test. A stub PreviewHost lets Generate reach the client (the mock never
// invokes onWorld, so previewWorld's GPU path is not exercised).
import { cleanup, fireEvent, render, screen } from "../inspector/_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import {
  EditorContext,
  type EditorContextValue,
} from "../../src/frontend/components/editor-context.ts";
import { GenerationPanel } from "../../src/frontend/components/GenerationPanel.tsx";
import type { GenerationWorkerClient } from "../../src/frontend/lib/generation-client.ts";
import {
  initialWorldSession,
  type WorldGenSession,
} from "../../src/frontend/lib/generation.ts";
import { initialState } from "../../src/frontend/lib/state.ts";

afterEach(cleanup);

// A structural DEFAULT_WORLD template (two caves through one tunnel), like the dungeon's.
const DEFAULT_WORLD = {
  name: "default",
  startRegion: "cave-a",
  regions: [
    { id: "cave-a", seed: "world-default:a", params: { mouths: 1 } },
    { id: "cave-b", seed: "world-default:b", params: { mouths: 1 } },
  ],
  connectors: [{ id: "tunnel-1", seed: "world-default:t1" }],
};

function makeCtx(overrides?: {
  session?: Partial<WorldGenSession>;
  worldName?: string;
}): {
  ctx: EditorContextValue;
  client: {
    runWorld: ReturnType<typeof mock>;
    bakeWorld: ReturnType<typeof mock>;
    cancel: ReturnType<typeof mock>;
  };
} {
  const client = { runWorld: mock(), bakeWorld: mock(), cancel: mock() };
  const session = { ...initialWorldSession(), ...overrides?.session };
  const ctx = {
    state: { ...initialState, status: "ready", generationActive: true },
    dispatch: () => {},
    hostRef: { current: undefined },
    // A stub host: Generate's synchronous path only needs it non-undefined (the mock
    // runWorld never calls onWorld, so previewWorld's methods are never reached).
    previewHostRef: { current: {} as unknown },
    extensions: {
      DEFAULT_WORLD,
      realizeRegion: () => Promise.resolve({}),
      MaterialCache: class {
        destroy(): void {}
      },
      worldDir: (name: string) => `worlds/${name}`,
    },
    actions: {},
    generation: {
      session,
      setSession: () => {},
      worldName: overrides?.worldName ?? "default",
      setWorldName: () => {},
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

test("renders the world knobs: World Name and the two cave seeds", () => {
  renderPanel();
  expect(screen.getByLabelText("World Name")).toBeTruthy();
  expect(screen.getByLabelText("Cave A seed")).toBeTruthy();
  expect(screen.getByLabelText("Cave B seed")).toBeTruthy();
});

test("Generate calls client.runWorld with a spec carrying the (template-default) seeds", () => {
  const { client } = renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(client.runWorld).toHaveBeenCalled();
  // Boundary: the mock records the exact spec the panel built.
  const spec = client.runWorld.mock.calls[0]?.[0] as {
    regions: { seed: string }[];
  };
  expect(spec.regions.map((r) => r.seed)).toEqual([
    "world-default:a",
    "world-default:b",
  ]);
});

test("Generate is disabled while generating", () => {
  renderPanel({ session: { status: { phase: "generating" } } });
  expect(
    (screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("Freeze & bake is disabled until a world is previewed", () => {
  renderPanel();
  expect(
    (
      screen.getByRole("button", {
        name: "Freeze & bake",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("Freeze & bake is enabled once previewing with a valid world name", () => {
  renderPanel({
    session: { status: { phase: "previewing", seeds: ["a", "b"] } },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Freeze & bake",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("Freeze & bake stays disabled when the world name is invalid, even while previewing", () => {
  renderPanel({
    session: { status: { phase: "previewing", seeds: ["a", "b"] } },
    worldName: "../escape",
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Freeze & bake",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
