// Task 8 sub-changes 1 + 7: InspectPanel information architecture —
//   • component sections OPEN by default, resource sections COLLAPSED by default;
//   • resources FILTERED to the selection's referenced ids (fall back to all when none);
//   • collapse open-state persisted via store.set("inspectorCollapse", …);
//   • the World/$settings selection shows the settings form; empty shows a quiet hint.
// Harness import MUST be first.
import {
  cleanup,
  fireEvent,
  fakeUiStore,
  renderWithEditor,
  makeEditorContext,
  screen,
} from "./_harness.tsx";
import { afterEach, expect, test } from "bun:test";
import { InspectPanel } from "../../src/frontend/components/InspectPanel.tsx";
import { SETTINGS_SELECTION } from "../../src/frontend/lib/selection.ts";
import type { EditorContextValue } from "../../src/frontend/components/editor-context.ts";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";

afterEach(cleanup);

const reflection = {
  components: {
    transform: {
      type: "object",
      properties: {
        position: { type: "array", furnace: { kind: "vec3" }, default: [0, 0, 0] },
      },
    } as JsonSchemaNode,
    meshRenderer: {
      type: "object",
      properties: {
        geometry: { type: "string", furnace: { kind: "resource", table: "geometries" } },
        material: { type: "string", furnace: { kind: "resource", table: "materials" } },
      },
    } as JsonSchemaNode,
  },
  resources: {
    geometries: { cube: { type: "object", properties: {} } as JsonSchemaNode },
    materials: {
      standard: {
        type: "object",
        properties: { intensity: { type: "number" } },
      } as JsonSchemaNode,
    },
  },
  settings: {
    type: "object",
    properties: { ambient: { type: "number" } },
  } as JsonSchemaNode,
};

const doc = {
  version: 1,
  settings: { ambient: 2 },
  resources: {
    geometries: { g_cube: { kind: "cube" } },
    materials: { m0: { intensity: 1 }, m1: { intensity: 5 } },
  },
  entities: [
    {
      id: "box",
      components: {
        transform: { position: [0, 0, 0] },
        meshRenderer: { geometry: "g_cube", material: "m1" },
      },
    },
  ],
};

function ctx(over: {
  selectedEntities?: string[];
  store?: EditorContextValue["store"];
}): EditorContextValue {
  // Boundary cast: the mock hostRef stands in for the full ViewportHost; only introspect()
  // is exercised here.
  const hostRef = {
    current: { introspect: () => reflection },
  } as unknown as EditorContextValue["hostRef"];
  return makeEditorContext({
    // Boundary cast: the test doc is a structural subset of SceneDocument.
    state: { doc: doc as never, selectedEntities: over.selectedEntities ?? [] },
    hostRef,
    store: over.store,
  });
}

const resTrigger = (re: RegExp) => screen.queryByRole("button", { name: re });

test("resource sections render COLLAPSED by default (content not mounted)", () => {
  renderWithEditor(<InspectPanel />, ctx({}));
  // All three resources show (nothing selected → fall back to all)…
  expect(resTrigger(/materials\/m0/)).toBeTruthy();
  expect(resTrigger(/materials\/m1/)).toBeTruthy();
  expect(resTrigger(/geometries\/g_cube/)).toBeTruthy();
  // …but collapsed, so no resource field body is mounted (no "intensity" field label).
  expect(screen.queryByText("Intensity")).toBeNull();
});

test("component sections are OPEN by default; resources FILTER to the selection", () => {
  renderWithEditor(<InspectPanel />, ctx({ selectedEntities: ["box"] }));
  // transform is open → its vec3 inputs (title x/y/z) are mounted.
  expect(screen.queryByTitle("x")).toBeTruthy();
  expect(screen.queryByTitle("z")).toBeTruthy();
  // Resources filtered to what "box" references: material m1 + geometry g_cube; NOT m0.
  expect(resTrigger(/materials\/m1/)).toBeTruthy();
  expect(resTrigger(/geometries\/g_cube/)).toBeTruthy();
  expect(resTrigger(/materials\/m0/)).toBeNull();
  // The referenced material section is still collapsed by default (no body).
  expect(screen.queryByText("Intensity")).toBeNull();
});

test("toggling a resource section opens it AND persists open-state to the store", () => {
  const store = fakeUiStore();
  renderWithEditor(<InspectPanel />, ctx({ selectedEntities: ["box"], store }));
  const trigger = resTrigger(/materials\/m1/);
  expect(trigger).toBeTruthy();
  if (!trigger) throw new Error("no m1 trigger");
  fireEvent.click(trigger);
  // Now the section body is mounted…
  expect(screen.queryByText("Intensity")).toBeTruthy();
  // …and the open state is persisted under the section key.
  const collapse = store.get("inspectorCollapse") as Record<string, boolean> | undefined;
  expect(collapse?.["resource:materials:m1"]).toBe(true);
});

test("a persisted open-state (from the store) is read on mount", () => {
  const store = fakeUiStore({ inspectorCollapse: { "resource:materials:m1": true } });
  renderWithEditor(<InspectPanel />, ctx({ selectedEntities: ["box"], store }));
  // m1 starts OPEN because the store says so → its body is mounted immediately.
  expect(screen.queryByText("Intensity")).toBeTruthy();
});

test("selecting World ($settings) shows the settings form, not the nothing-selected hint", () => {
  renderWithEditor(<InspectPanel />, ctx({ selectedEntities: [SETTINGS_SELECTION] }));
  // The settings section is open by default → the `ambient` field is present.
  expect(screen.queryByText("Ambient")).toBeTruthy();
  expect(screen.queryByText(/nothing selected/i)).toBeNull();
});

test("empty selection shows a quiet nothing-selected hint (no settings form)", () => {
  renderWithEditor(<InspectPanel />, ctx({ selectedEntities: [] }));
  expect(screen.queryByText(/nothing selected/i)).toBeTruthy();
  // Settings form is behind the World row now, so `ambient` is not shown here.
  expect(screen.queryByText("Ambient")).toBeNull();
});
