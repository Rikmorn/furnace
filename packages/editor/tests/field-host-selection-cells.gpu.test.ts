// The cell-level selection display (F4.5b Task 13, f2b gate item 1), wired: a
// flood selection made through the real gesture, and the instanced layer the host
// then decides on.
//
// It needs a real (bun-webgpu) context for the same reason the camera GPU suite
// does — `init` is what ATTACHES the input handlers, and every cursor path
// resolves through `cursorRay` → `camera.screenToRay`, which has no camera until
// a context is up. There is no headless route to a selection: no public verb
// takes a spec, deliberately (the gestures are the API).
//
// What is asserted here is the WIRING — which selections get cubes, how many, and
// what the seam then says about it. The ORDERING rule (shell before interior) is
// pure and pinned in tests/viewport-host/field-selection-cells.test.ts at
// fixture-sized numbers; the CAP is exercised for real here, because the fixture
// is big enough to cross it.
//
// HERE and not in `tests/viewport-host/`: `bun test` runs a directory's own files
// before its subdirectories, and `tests/chrome/` registers happy-dom, which
// replaces `globalThis.navigator` — taking `navigator.gpu` with it.
import { expect, test } from "bun:test";
import type { ChunkKey, FieldManifest } from "@furnace/core/field";
import {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  SOLID,
} from "@furnace/core/field";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createFieldHost } from "../src/viewport-host/field-host.ts";
import { SELECTION_DISPLAY_CAP } from "../src/viewport-host/field-selection-cells.ts";
import type { SelectionInfo } from "../src/viewport-host/index.ts";
import { type HostListeners, makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameNoop } from "./_helpers/raf.ts";

await ensureBunWebGpu();

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** The canvas centre — where the starting camera (target `[0,1,0]`, distance 6)
 *  looks, so a click there lands on the blob with no arithmetic in the test. */
const CENTRE = 32;

/** A small SOLID blob centred on the orbit target, in SAMPLE coordinates
 *  (inclusive). 4³ = 64 cells at the default 0.25 m lattice — small enough that
 *  the whole of it fits the display budget, which is the point: it is the
 *  complete-display case against the world-sized flood's capped one. */
const BLOB = { min: [-2, 3, -2], max: [1, 6, 1] } as const;
const BLOB_CELLS = 4 * 4 * 4;

/** The allocated chunk box, in CHUNK coordinates (inclusive). Everything in it is
 *  AIR except the blob, which matters twice: the starting eye (≈ 3, 3.9, 4.3) is
 *  inside it, so the `void` gesture is not refused with "the eye is inside rock",
 *  and the air the flood then fills is ~196 000 cells — over the 65 536 display
 *  cap and under the 200 000 selection budget, so the cap fires while the
 *  SELECTION itself is untruncated. Those two signals are independent and this is
 *  what keeps the test from conflating them. */
const CHUNKS = { min: [-2, -1, -2], max: [1, 1, 1] } as const;

function airChunk(cx: number, cy: number, cz: number): Uint8Array {
  const density = new Int8Array(CHUNK_SAMPLES).fill(AIR);
  for (let z = BLOB.min[2]; z <= BLOB.max[2]; z++)
    for (let y = BLOB.min[1]; y <= BLOB.max[1]; y++)
      for (let x = BLOB.min[0]; x <= BLOB.max[0]; x++) {
        const lx = x - cx * CHUNK_DIM;
        const ly = y - cy * CHUNK_DIM;
        const lz = z - cz * CHUNK_DIM;
        if (lx < 0 || ly < 0 || lz < 0) continue;
        if (lx >= CHUNK_DIM || ly >= CHUNK_DIM || lz >= CHUNK_DIM) continue;
        density[lx + CHUNK_DIM * (ly + CHUNK_DIM * lz)] = SOLID;
      }
  return encodeChunkFile(density);
}

function worldChunks(): { key: ChunkKey; bytes: Uint8Array }[] {
  const out: { key: ChunkKey; bytes: Uint8Array }[] = [];
  for (let cz = CHUNKS.min[2]; cz <= CHUNKS.max[2]; cz++)
    for (let cy = CHUNKS.min[1]; cy <= CHUNKS.max[1]; cy++)
      for (let cx = CHUNKS.min[0]; cx <= CHUNKS.max[0]; cx++)
        out.push({ key: chunkKey(cx, cy, cz), bytes: airChunk(cx, cy, cz) });
  return out;
}

async function fixture() {
  const restoreRo = installMockResizeObserver();
  const restoreRaf = stubAnimationFrameNoop();
  const listeners: HostListeners = new Map();
  const host = createFieldHost();
  host.loadWorld({ manifest: MANIFEST, chunks: worldChunks(), oplog: null });
  await host.init(await makeHostCanvas(listeners));

  const selections: (SelectionInfo | null)[] = [];
  host.subscribeSelection((s) => selections.push(s));

  const fire = (type: string, e: Record<string, unknown>): void => {
    const fn = listeners.get(type);
    if (fn === undefined) throw new Error(`test: no ${type} listener`);
    fn(e);
  };
  const click = (x: number, y: number): void => {
    fire("pointerdown", {
      button: 0,
      altKey: false,
      shiftKey: false,
      clientX: x,
      clientY: y,
      pointerId: 1,
    });
    fire("pointerup", { button: 0, pointerId: 1 });
  };
  return {
    host,
    selections,
    click,
    teardown: () => {
      host.dispose();
      restoreRaf();
      restoreRo();
    },
  };
}

const lastSelection = (
  selections: readonly (SelectionInfo | null)[],
): SelectionInfo => {
  const s = selections.at(-1);
  if (s === undefined || s === null)
    throw new Error("test: no selection was made");
  return s;
};

test.skipIf(!bunWebGpuAvailable())(
  "a flood that FITS the budget draws one cube per selected cell",
  async () => {
    const f = await fixture();
    try {
      // Nothing selected: nothing drawn. Stated first so the assertions below
      // cannot be satisfied by a counter that was already non-zero.
      expect(f.host.selectionCellCount()).toBe(0);

      // The wand on the blob: 64 rock cells, well inside the budget.
      f.host.setGesture("material");
      f.click(CENTRE, CENTRE);

      const info = lastSelection(f.selections);
      expect(info.spec.kind).toBe("flood-material");
      expect(info.count).toBe(BLOB_CELLS);
      // ONE cube per selected cell — the layer is a display of the SELECTION, not
      // of its bounding box, which is the whole of f2b item 1.
      expect(f.host.selectionCellCount()).toBe(info.count);
      // Complete, so the seam says nothing about truncation: `displayed` is the
      // "you are not seeing all of this" signal and must be absent when you are.
      expect(info.displayed).toBeUndefined();
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a flood over the cap draws the cap and SAYS how much it is showing",
  async () => {
    const f = await fixture();
    try {
      // The void flood fills the whole allocated air volume — ~196 000 cells,
      // three times the display cap. This is the case the cap exists for: every
      // one of those cubes is a blended, depth-write-free instance.
      f.host.setGesture("void");
      f.click(CENTRE, CENTRE);

      const info = lastSelection(f.selections);
      expect(info.spec.kind).toBe("flood-void");
      expect(info.count).toBeGreaterThan(SELECTION_DISPLAY_CAP);
      expect(f.host.selectionCellCount()).toBe(SELECTION_DISPLAY_CAP);
      expect(info.displayed).toBe(SELECTION_DISPLAY_CAP);
      // The two limits are INDEPENDENT and the fixture keeps them apart: the
      // selection itself is under the 200 000 flood budget, so a display that is
      // partial does not mean the selection was.
      expect(info.truncated).toBe(false);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "clearing the selection takes the cell layer with it",
  async () => {
    const f = await fixture();
    try {
      f.host.setGesture("material");
      f.click(CENTRE, CENTRE);
      expect(f.host.selectionCellCount()).toBe(BLOB_CELLS);

      f.host.clearSelection();

      expect(f.host.selectionCellCount()).toBe(0);
      // …and Reselect brings it back, which is what makes the clear a display
      // change rather than a teardown the user cannot undo.
      f.host.reselect();
      expect(f.host.selectionCellCount()).toBe(BLOB_CELLS);
    } finally {
      f.teardown();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a REGION selection keeps its honest box and draws no cells",
  async () => {
    const f = await fixture();
    try {
      // Two clicks under `box` span a region. A region IS its AABB, so filling it
      // with cubes would draw the same information 65 000× over — the display is
      // for the case where the box is a LIE about the shape, which a region's
      // never is.
      f.host.setGesture("box");
      f.click(CENTRE - 8, CENTRE - 8);
      f.click(CENTRE + 8, CENTRE + 8);

      const info = lastSelection(f.selections);
      expect(info.spec.kind).toBe("region");
      // Non-vacuous: there IS a selection with cells in it — the layer is empty
      // by rule, not because nothing was selected.
      expect(info.count).toBeGreaterThan(0);
      expect(f.host.selectionCellCount()).toBe(0);
      // …and no truncation claim, because a region's display is never partial.
      expect(info.displayed).toBeUndefined();
    } finally {
      f.teardown();
    }
  },
);
