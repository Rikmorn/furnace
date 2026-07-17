// Harness tests for the Field panel (F2b sweep — the Task 14 review
// commitment): mock EditorContext + a minimal stub FieldHost that records
// calls and exposes its subscribe callbacks for manual firing (the
// world-panel.test.tsx precedent). The GPU never initializes here — the
// panel's initWhenSized defers host.init until the canvas measures nonzero,
// and a happy-dom canvas never does — so every behaviour under test is pure
// chrome↔host protocol: the paint organic-clamp, the catalog Load gate, the
// subscribeTool echo guard, the entity-refresh triggers (commit push + the
// stats remeshVersion counter — the Safari performance.now() quantization
// fix), stamp commit gating, slice wiring, and the selection footer.
import {
  act,
  cleanup,
  fireEvent,
  makeEditorContext,
  renderWithEditor,
  screen,
  waitFor,
} from "../inspector/_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import type { GeneratorEntity } from "@furnace/core/field";
import { FieldPanel } from "../../src/frontend/components/FieldPanel.tsx";
import type {
  FieldGeneratorInfo,
  FieldHost,
  FieldStats,
  FieldTool,
  SelectionInfo,
  StampSession,
} from "../../src/viewport-host/index.ts";

afterEach(cleanup);

// --- fetch stub (the toolbar's run-once catalog GET) ------------------------

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace globalThis.fetch for one test (afterEach restores the real one). */
function stubFetch(fn: () => Promise<Response>): void {
  // Boundary cast: the stub only serves the toolbar's one catalog GET.
  globalThis.fetch = mock(fn) as unknown as typeof fetch;
}

const fetch404 = (): void =>
  stubFetch(() => Promise.resolve(new Response("", { status: 404 })));

/** A two-class catalog (rock organic + masonry kit) in the exact
 *  catalog/materials.json v1 shape parseMaterialsCatalog accepts. */
const CATALOG_JSON = JSON.stringify({
  version: 1,
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    {
      id: 1,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
});

// --- stub host --------------------------------------------------------------

const HALL_GEN: FieldGeneratorInfo = {
  id: "hall",
  name: "Hall",
  paramSchema: { type: "object", properties: { width: { type: "number" } } },
  defaults: { width: 4 },
};

function makeSession(overrides: Partial<StampSession> = {}): StampSession {
  return {
    generator: "hall",
    params: { width: 4 },
    seed: 7,
    policy: "replace",
    region: { min: [0, 0, 0], max: [4, 4, 4] },
    phase: "configuring",
    run: 0,
    opCount: null,
    error: null,
    truncatedSelection: false,
    ...overrides,
  };
}

const ENTITY: GeneratorEntity = {
  entityId: 1,
  type: "generator",
  generator: "hall",
  params: { width: 4 },
  seed: 7,
  region: { min: [0, 0, 0], max: [4, 4, 4] },
  opSpan: [2, 4], // 3 ops
};

/** A minimal FieldHost stub: every mutator is a recording mock; the subscribe
 *  seams latch their callback so a test can fire host-initiated pushes
 *  manually (wrap in act). subscribeSelection/subscribeStamp push the current
 *  (empty) state on subscribe, like the real host. */
function makeStubHost(opts: { generators?: FieldGeneratorInfo[] } = {}) {
  let entities: GeneratorEntity[] = [];
  const cbs: {
    tool: ((t: FieldTool) => void) | null;
    stamp: ((s: StampSession | null) => void) | null;
    stats: ((s: FieldStats) => void) | null;
    selection: ((i: SelectionInfo | null) => void) | null;
    toolError: ((msg: string) => void) | null;
  } = { tool: null, stamp: null, stats: null, selection: null, toolError: null };
  const calls = {
    setTool: mock(),
    setSlice: mock(),
    setLayers: mock(),
    setSelectionMode: mock(),
    setDigRadius: mock(),
    setShading: mock(),
    setMaterialTable: mock(),
    highlightEntity: mock(),
    startStamp: mock(),
    updateStamp: mock(),
    rerollStamp: mock(),
    commitStamp: mock(),
    cancelStamp: mock(),
    clearSelection: mock(),
    reselect: mock(),
    newWorld: mock(),
  };
  const host: FieldHost = {
    init: () => Promise.resolve(),
    dispose: () => {},
    newWorld: calls.newWorld,
    loadWorld: () => {},
    setDigRadius: calls.setDigRadius,
    setShading: calls.setShading,
    setTool: calls.setTool,
    subscribeTool: (cb) => {
      cbs.tool = cb;
      return () => {};
    },
    subscribeToolError: (cb) => {
      cbs.toolError = cb;
      return () => {};
    },
    setSelectionMode: calls.setSelectionMode,
    clearSelection: calls.clearSelection,
    reselect: calls.reselect,
    subscribeSelection: (cb) => {
      cbs.selection = cb;
      cb(null);
      return () => {};
    },
    setLayers: calls.setLayers,
    setSlice: calls.setSlice,
    getSmoothLimits: () => ({ maxStrength: 32, maxIterations: 4 }),
    setMaterialTable: calls.setMaterialTable,
    listGenerators: () => opts.generators ?? [],
    startStamp: calls.startStamp,
    updateStamp: calls.updateStamp,
    rerollStamp: calls.rerollStamp,
    commitStamp: calls.commitStamp,
    cancelStamp: calls.cancelStamp,
    subscribeStamp: (cb) => {
      cbs.stamp = cb;
      cb(null);
      return () => {};
    },
    listEntities: () => entities.map((e) => structuredClone(e)),
    highlightEntity: calls.highlightEntity,
    exportArtifact: () => [],
    subscribeStats: (cb) => {
      cbs.stats = cb;
      return () => {};
    },
  };
  return {
    host,
    calls,
    /** Fire a latched host→panel push (callers wrap in act). */
    fire: {
      tool: (t: FieldTool) => cbs.tool?.(t),
      stamp: (s: StampSession | null) => cbs.stamp?.(s),
      stats: (s: FieldStats) => cbs.stats?.(s),
      selection: (i: SelectionInfo | null) => cbs.selection?.(i),
    },
    setEntities: (next: GeneratorEntity[]) => {
      entities = next;
    },
  };
}

/** Render the panel and flush the toolbar's catalog fetch inside act — its
 *  settle (status + Load-gate setState) otherwise lands between assertions as
 *  an un-act'ed update. Test (b) renders directly instead: its fetch stays
 *  deliberately pending. */
async function renderPanel(stub: ReturnType<typeof makeStubHost>) {
  const result = renderWithEditor(
    <FieldPanel />,
    makeEditorContext({ fieldHostRef: { current: stub.host } }),
  );
  await act(async () => {
    // Two microtask turns: the catalog path awaits fetch() then res.text().
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

const button = (name: string): HTMLButtonElement =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

// --- (a) paint organic-clamp ------------------------------------------------

test("picking Paint while a kit class is active clamps the material to the first organic class", async () => {
  stubFetch(() => Promise.resolve(new Response(CATALOG_JSON, { status: 200 })));
  const stub = makeStubHost();
  await renderPanel(stub);
  // The swatch strip appears once the catalog lands (2 classes > 1).
  await waitFor(() => screen.getByLabelText("material masonry"));
  fireEvent.click(screen.getByLabelText("material masonry"));
  expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
    effect: "dig",
    materialId: 1,
  });
  fireEvent.click(button("Paint"));
  // Kit masonry (id 1) is unpaintable — the brush pick clamps to rock (id 0).
  expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
    effect: "paint",
    materialId: 0,
  });
});

// --- (b) catalog-gated Load -------------------------------------------------

test("Load stays disabled until the catalog fetch settles", async () => {
  let settle!: (r: Response) => void;
  stubFetch(
    () =>
      new Promise<Response>((res) => {
        settle = res;
      }),
  );
  const stub = makeStubHost();
  renderWithEditor(
    <FieldPanel />,
    makeEditorContext({ fieldHostRef: { current: stub.host } }),
  );
  fireEvent.change(screen.getByLabelText("world name"), {
    target: { value: "cavern" },
  });
  // Valid name, but the catalog is still in flight — the gate holds.
  expect(button("Load").disabled).toBe(true);
  await act(async () => {
    settle(new Response("", { status: 404 }));
  });
  await waitFor(() => expect(button("Load").disabled).toBe(false));
});

// --- (c) the subscribeTool echo guard ---------------------------------------

test("a host-initiated tool push is adopted without re-pushing to host.setTool", async () => {
  fetch404();
  const stub = makeStubHost();
  await renderPanel(stub);
  const fill: FieldTool = {
    effect: "fill",
    materialId: 0,
    mask: { kind: "none" },
    smooth: { strength: 16, iterations: 1, mode: "both" },
    hollow: null,
  };
  act(() => {
    stub.fire.tool(fill);
  });
  // The panel MIRRORED the change (Fill highlights)…
  expect(button("Fill").getAttribute("aria-pressed")).toBe("true");
  // …without echoing it back (re-pushing would re-derive → re-fire → loop).
  expect(stub.calls.setTool).not.toHaveBeenCalled();
});

// --- (d) commit lands the entity row ----------------------------------------

test("a stamp commit (session → null push) surfaces the new entity row", async () => {
  fetch404();
  const stub = makeStubHost({ generators: [HALL_GEN] });
  await renderPanel(stub);
  expect(screen.getByText("Entities (0)")).toBeTruthy();
  act(() => {
    stub.fire.stamp(makeSession({ phase: "ready", opCount: 3 }));
  });
  // The commit appends the entity op and ends the session with a null push.
  stub.setEntities([ENTITY]);
  act(() => {
    stub.fire.stamp(null);
  });
  expect(screen.getByText("Entities (1)")).toBeTruthy();
  fireEvent.click(screen.getByText("Entities (1)"));
  expect(screen.getByText("hall · seed 7 · 3 ops")).toBeTruthy();
});

// --- (e) ⌘Z-equivalent: the stats counter drives the refresh ----------------

test("an undone commit disappears on a remeshVersion bump even when lastRemeshMs quantizes identically", async () => {
  fetch404();
  const stub = makeStubHost({ generators: [HALL_GEN] });
  await renderPanel(stub);
  // A first remesh readout (Safari-style whole-ms clock value).
  act(() => {
    stub.fire.stats({ chunks: 4, lastRemeshMs: 1, remeshVersion: 1 });
  });
  // Commit an entity (the (d) flow).
  act(() => {
    stub.fire.stamp(makeSession({ phase: "ready", opCount: 3 }));
  });
  stub.setEntities([ENTITY]);
  act(() => {
    stub.fire.stamp(null);
  });
  expect(screen.getByText("Entities (1)")).toBeTruthy();
  // ⌘Z: the entity op is undone (listEntities shrinks) and the redig's remesh
  // completes with an IDENTICAL clock read — chunks and lastRemeshMs match the
  // previous push exactly (Safari clamps performance.now() to ~1 ms). Only
  // the monotonic counter differs; it alone must drive the refresh.
  stub.setEntities([]);
  act(() => {
    stub.fire.stats({ chunks: 4, lastRemeshMs: 1, remeshVersion: 2 });
  });
  expect(screen.getByText("Entities (0)")).toBeTruthy();
});

// --- (f) Commit ready-gating ------------------------------------------------

test("Commit is disabled until the stamp session reaches ready", async () => {
  fetch404();
  const stub = makeStubHost({ generators: [HALL_GEN] });
  await renderPanel(stub);
  act(() => {
    stub.fire.stamp(makeSession({ phase: "configuring" }));
  });
  expect(button("Commit").disabled).toBe(true);
  act(() => {
    stub.fire.stamp(makeSession({ phase: "ready", opCount: 3 }));
  });
  expect(button("Commit").disabled).toBe(false);
  fireEvent.click(button("Commit"));
  expect(stub.calls.commitStamp).toHaveBeenCalledTimes(1);
});

// --- (g) slice wiring -------------------------------------------------------

test("the slice checkbox and slider drive host.setSlice(y | null)", async () => {
  fetch404();
  const stub = makeStubHost();
  await renderPanel(stub);
  fireEvent.click(screen.getByLabelText("slice view"));
  expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(8); // parked default
  fireEvent.change(screen.getByLabelText("slice y"), {
    target: { value: "4" },
  });
  expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(4);
  fireEvent.click(screen.getByLabelText("slice view"));
  expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(null); // off
});

// --- (h) selection footer ---------------------------------------------------

test("the footer shows the selection count + the truncation warning; Clear reaches the host", async () => {
  fetch404();
  const stub = makeStubHost();
  await renderPanel(stub);
  act(() => {
    stub.fire.selection({
      spec: { kind: "flood-void", seed: [0, 0, 0], budget: 200_000 },
      count: 1234,
      truncated: true,
      aabb: null,
    });
  });
  expect(screen.getByText(/1234 selected/)).toBeTruthy();
  expect(screen.getByText(/flood truncated at 1234/)).toBeTruthy();
  fireEvent.click(button("Clear"));
  expect(stub.calls.clearSelection).toHaveBeenCalledTimes(1);
});
