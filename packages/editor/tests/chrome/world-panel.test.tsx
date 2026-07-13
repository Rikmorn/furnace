// Harness tests for the World panel (W3): empty-draft CTA, Generate wiring through
// draftToSpec, busy gating, freeze snapshot gating, the make-default checkbox.
// Same harness posture as the old generation-panel tests: mock EditorContext, fake
// client, stub PreviewHost; the real worker never spawns in bun test. The stub host only
// has to be non-undefined — the fake client never invokes onWorld, so previewWorld's GPU
// path is never reached.
import {
  cleanup,
  fireEvent,
  makeEditorContext,
  renderWithEditor,
  screen,
} from "../inspector/_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import type { PreviewHost } from "../../src/viewport-host/index.ts";
import { WorldPanel } from "../../src/frontend/components/WorldPanel.tsx";
import type { GenerationWorkerClient } from "../../src/frontend/lib/generation-client.ts";
import {
  initialWorldSession,
  type WorldGenSession,
} from "../../src/frontend/lib/generation.ts";
import {
  addRegion,
  type WorldDraft,
} from "../../src/frontend/lib/world-draft.ts";

afterEach(cleanup);

/** A one-cave draft (a cave anchor is a valid single-region world — mouths are portals). */
function caveDraft(): WorldDraft {
  return addRegion(
    { name: "w1", regions: [], startRegionId: "" },
    { id: "cave-1", algorithm: "cave", knobs: { mouths: 1 }, seed: "cave-1" },
  );
}

function renderPanel(overrides?: { session?: Partial<WorldGenSession> }) {
  const client = { runWorld: mock(), bakeWorld: mock(), cancel: mock() };
  const ctx = makeEditorContext({
    state: { generationActive: true },
    previewHostRef: { current: {} as PreviewHost },
    extensions: {
      realizeRegion: () => Promise.resolve({}),
      MaterialCache: class {
        destroy(): void {}
      },
      worldDir: (name: string) => `worlds/${name}`,
    },
    generation: {
      session: { ...initialWorldSession(), ...overrides?.session },
      client: client as unknown as GenerationWorkerClient,
    },
  });
  renderWithEditor(<WorldPanel />, ctx);
  return { client };
}

const button = (name: string): HTMLButtonElement =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

test("empty draft: name field + Add region form render; Generate is disabled", () => {
  renderPanel();
  expect(screen.getByLabelText("World Name")).toBeTruthy();
  expect(button("Add region")).toBeTruthy();
  expect(button("Generate").disabled).toBe(true);
});

test("Generate compiles the draft through draftToSpec and hands it to runWorld", () => {
  const { client } = renderPanel({ session: { draft: caveDraft() } });
  fireEvent.click(button("Generate"));
  expect(client.runWorld).toHaveBeenCalled();
  // Boundary: the mock records the exact spec the panel built.
  const spec = client.runWorld.mock.calls[0]?.[0] as {
    regions: { id: string; class: string }[];
    startRegion: string;
  };
  expect(spec.regions.map((r) => r.id)).toEqual(["cave-1"]);
  expect(spec.regions[0]?.class).toBe("field-organic");
  expect(spec.startRegion).toBe("cave-1");
});

test("Generate is disabled while generating", () => {
  renderPanel({
    session: { draft: caveDraft(), status: { phase: "generating" } },
  });
  expect(button("Generate").disabled).toBe(true);
});

test("Freeze & bake gates on the previewing snapshot + a valid name", () => {
  renderPanel({ session: { draft: caveDraft() } });
  expect(button("Freeze & bake").disabled).toBe(true);
  cleanup();

  const previewing = {
    phase: "previewing" as const,
    spec: { name: "w1", regions: [], connectors: [], startRegion: "cave-1" },
  };
  renderPanel({ session: { draft: caveDraft(), status: previewing } });
  expect(button("Freeze & bake").disabled).toBe(false);
  cleanup();

  const bad = { ...caveDraft(), name: "../escape" };
  renderPanel({ session: { draft: bad, status: previewing } });
  expect(button("Freeze & bake").disabled).toBe(true);
});

test("the make-default checkbox renders checked by default (D-W3-9)", () => {
  renderPanel({ session: { draft: caveDraft() } });
  const box = screen.getByLabelText(
    "Make this the game's world",
  ) as HTMLInputElement;
  expect(box.checked).toBe(true);
});

test("Freeze passes the SNAPSHOT spec to bakeWorld with the draft name", () => {
  const spec = { name: "w1", regions: [], connectors: [], startRegion: "cave-1" };
  const { client } = renderPanel({
    session: { draft: caveDraft(), status: { phase: "previewing", spec } },
  });
  fireEvent.click(button("Freeze & bake"));
  expect(client.bakeWorld).toHaveBeenCalled();
  expect(client.bakeWorld.mock.calls[0]?.[0]).toBe(spec);
  expect(client.bakeWorld.mock.calls[0]?.[1]).toBe("w1");
});

test("a grid child under a cave parent has no legal connector — Add is disabled", () => {
  // legalKinds() is EMPTY for cave -> grid (a grid child can never hang off a cave), so
  // the form refuses the pair UP FRONT. The panel's error line under Add is the backstop
  // for anything the gating misses — addRegion's throw is never swallowed.
  renderPanel({ session: { draft: caveDraft() } });
  // The form opens on "hall" — under the cave anchor that pair has no connector.
  expect(button("Add region").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("algorithm"), {
    target: { value: "cave" },
  });
  expect(button("Add region").disabled).toBe(false); // cave -> cave: organic-tunnel
});
