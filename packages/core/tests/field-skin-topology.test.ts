import { expect, test } from "bun:test";
import type {
  FieldChunkMeshes,
  KitInstance,
  MaterialTable,
  OpLog,
} from "@furnace/core/field";
import {
  chunkKey,
  createFieldStore,
  createOpLog,
  extractFieldAprons,
  type FieldStore,
  logApply,
  meshChunkField,
  skinChunkKit,
} from "@furnace/core/field";

// Each test file owns its 3-class fixture copy (rock id0 organic, dirt id1
// organic, masonry id2 kit). Mirrors field-ops.test.ts's TABLE.
const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
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
};

/** Air room x 0..4, y 0.5..3.5, z 0..4; masonry wall x 2.0..2.5 (1 coarse
 *  thick), y 0.5..2.5 (4 tall), z 1..3 (4 wide) — standing on the room floor,
 *  fully inside chunk (0,0,0). Every kit face lands on the 0.5 m lattice. */
function wallFixture(): { s: FieldStore; log: OpLog } {
  const s = createFieldStore();
  const log = createOpLog();
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 1.5, 2] },
    },
    TABLE,
  );
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: { kind: "box", center: [2.25, 1.5, 2], halfExtents: [0.25, 1, 1] },
    },
    TABLE,
  );
  return { s, log };
}

const skin = (s: FieldStore, key: string): KitInstance[] =>
  skinChunkKit(extractFieldAprons(s, key), TABLE, s.cellSize, key);

test("P4-A: a snapped masonry wall skins panels on every exposed coarse face", () => {
  const { s } = wallFixture();
  const kit = skin(s, "0,0,0");
  const panels = kit.filter((k) => k.piece === "panel");
  // wall = 1×4×4 coarse cells; exposed vertical faces: ±x → 2 sides × (4×4)=32,
  // ±z ends → 2 × (1×4)=8   → 40 panels
  expect(panels.length).toBe(40);
  const tiles = kit.filter(
    (k) => k.piece === "floorTile" || k.piece === "ceilTile",
  );
  // top of the wall: +y exposed → 1×4 = 4 floorTile
  expect(tiles.length).toBe(4);
  expect(kit.filter((k) => k.piece === "post").length).toBeGreaterThan(0); // wall-end verticals
  // every panel's position snaps to the lattice ± the proud offset along its normal
  for (const p of panels) {
    const offAxes = [0, 1, 2].filter(
      (a) =>
        Math.abs(
          (p.position[a] as number) / 0.25 -
            Math.round((p.position[a] as number) / 0.25),
        ) > 1e-4,
    );
    expect(offAxes.length).toBe(1); // exactly the proud axis
  }
});

test("P4-A: backing quads cover every kit crossing (nothing unrendered)", () => {
  const { s } = wallFixture();
  const r = meshChunkField(
    extractFieldAprons(s, chunkKey(0, 0, 0)),
    TABLE,
    s.cellSize,
  );
  const backing = r.buckets.filter((b) => b.backing);
  expect(backing.length).toBe(1);
  expect(backing[0]?.classId).toBe(2);
  expect(backing[0]?.mesh.indices.length ?? 0).toBeGreaterThan(0);
  // partition invariant: organic + backing = all crossings (compare vs all-rock twin)
  const twin = (): FieldChunkMeshes => {
    const s2 = createFieldStore();
    const log2 = createOpLog();
    logApply(
      s2,
      log2,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 1.5, 2] },
      },
      TABLE,
    );
    // fill the SAME wall as ROCK (organic) to get the all-organic surface twin
    logApply(
      s2,
      log2,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 0,
        shape: {
          kind: "box",
          center: [2.25, 1.5, 2],
          halfExtents: [0.25, 1, 1],
        },
      },
      TABLE,
    );
    return meshChunkField(
      extractFieldAprons(s2, chunkKey(0, 0, 0)),
      TABLE,
      s2.cellSize,
    );
  };
  const total = (m: FieldChunkMeshes): number =>
    m.buckets.reduce((n, b) => n + b.mesh.indices.length, 0);
  expect(total(r)).toBe(total(twin()));
});

test("P4-B: digging through the wall suppresses panels and rings the hole with collar", () => {
  const { s, log } = wallFixture();
  // punch a hole: sphere r=0.6 at the wall mid-plane (x=2.25) — flips the
  // centre samples of the middle coarse cells → suppressed-kit
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [2.25, 1.5, 2], radius: 0.6 },
    },
    TABLE,
  );
  const kit = skin(s, "0,0,0");
  const panels = kit.filter((k) => k.piece === "panel");
  expect(panels.length).toBeLessThan(40); // fixture A count
  const collar = kit.filter(
    (k) => k.piece === "rimPostV" || k.piece === "rimEdgeH",
  );
  expect(collar.length).toBeGreaterThan(0);
  // collar pieces sit within one cell of the hole
  for (const c of collar) {
    expect(
      Math.hypot(
        (c.position[0] as number) - 2,
        (c.position[1] as number) - 1.5,
        (c.position[2] as number) - 2,
      ),
    ).toBeLessThan(1.5);
  }
});

test("P4-C: a wall spanning a chunk boundary neither duplicates nor gaps pieces", () => {
  const s = createFieldStore();
  const log = createOpLog();
  // room + wall straddling x = 4 m (the 0,0,0 / 1,0,0 chunk boundary)
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [4, 2, 2], halfExtents: [3, 1.5, 2] },
    },
    TABLE,
  );
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: {
        kind: "box",
        center: [4, 1.5, 2.25],
        halfExtents: [1.5, 1, 0.25],
      },
    },
    TABLE,
  );
  const a = skin(s, "0,0,0");
  const b = skin(s, "1,0,0");
  const world = (k: KitInstance, key: string): string => {
    const [cx, cy, cz] = key.split(",").map(Number) as [number, number, number];
    return `${k.piece}:${(k.position[0] as number) + cx * 4},${(k.position[1] as number) + cy * 4},${(k.position[2] as number) + cz * 4}:${k.yaw.toFixed(3)}`;
  };
  const all = [
    ...a.map((k) => world(k, "0,0,0")),
    ...b.map((k) => world(k, "1,0,0")),
  ];
  expect(new Set(all).size).toBe(all.length); // no duplicates
  // no gap: total panel count matches the analytic count for a 6-coarse-wide wall
  const panels = [...a, ...b].filter((k) => k.piece === "panel").length;
  // wall: x 2.5..5.5 (6 coarse), y 0.5..2.5 (4), z 2.0..2.5 (1)
  // exposed: ±z 2×(6×4)=48, ±x ends 2×(4×1)=8 → 56
  expect(panels).toBe(56);
});

test("P4-D: a hole through a seam-straddling wall rings collar with no cross-chunk duplicates", () => {
  const s = createFieldStore();
  const log = createOpLog();
  // fixture C's seam-straddling wall (x = 4 m is the 0,0,0 / 1,0,0 boundary)
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [4, 2, 2], halfExtents: [3, 1.5, 2] },
    },
    TABLE,
  );
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: {
        kind: "box",
        center: [4, 1.5, 2.25],
        halfExtents: [1.5, 1, 0.25],
      },
    },
    TABLE,
  );
  // punch a hole centred ON the seam (x=4) so suppressed-kit cells land in BOTH
  // chunk 0 (world coarse I=7) and chunk 1 (world coarse I=8) — the boundary
  // condition the collar pass depends on, which fixtures A/B/C never exercise
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [4, 1.5, 2.25], radius: 0.6 },
    },
    TABLE,
  );
  const a = skin(s, "0,0,0");
  const b = skin(s, "1,0,0");
  const isCollar = (k: KitInstance): boolean =>
    k.piece === "rimPostV" || k.piece === "rimEdgeH";
  // both chunks must own collar → the hole suppressed cells on BOTH sides of the
  // seam, and each side's chunk emitted its own collar (can't pass on zero)
  expect(a.filter(isCollar).length).toBeGreaterThan(0);
  expect(b.filter(isCollar).length).toBeGreaterThan(0);
  const world = (k: KitInstance, key: string): string => {
    const [cx, cy, cz] = key.split(",").map(Number) as [number, number, number];
    return `${k.piece}:${(k.position[0] as number) + cx * 4},${(k.position[1] as number) + cy * 4},${(k.position[2] as number) + cz * 4}:${k.yaw.toFixed(3)}`;
  };
  const all = [
    ...a.map((k) => world(k, "0,0,0")),
    ...b.map((k) => world(k, "1,0,0")),
  ];
  // no world-space duplicate over ALL pieces (incl. collar): each seam piece is
  // owned by exactly one chunk — no double-emission, no gap
  expect(new Set(all).size).toBe(all.length);
});

test("P4: the derived-view skin is deterministic (replay-stable)", () => {
  const { s, log } = wallFixture();
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [2.25, 1.5, 2], radius: 0.6 },
    },
    TABLE,
  );
  expect(skin(s, "0,0,0")).toEqual(skin(s, "0,0,0"));
});

// F2b hollow fill through the DERIVED COARSE VIEW: the kit-lattice rule for
// `hollow` ("the shell's INNER faces land on lattice planes") is cashed out
// here — a 0.5 m shell is exactly one coarse cell thick, so the skinner's
// center-sample classification (cell (I,J,K) ← fine (2I+1,2J+1,2K+1)) must see
// a clean masonry shell around an air cavity. Geometry at cellSize 0.25:
// masonry box faces 1..3 m (coarse 2..5 per axis); coarse center samples sit
// at (2I+1)·0.25 m, so their box sdf = 1 − max axis-offset with offsets 0.25
// (I∈{3,4}), 0.75 (I∈{2,5}), ≥1.25 (outside). Shell band (0 < sdf ≤ 0.5) =
// max offset 0.75; cavity (sdf 0.75 > hollow, SKIPPED) = coarse {3,4}³, whose
// material stays ROCK — the non-destructive semantic at the derived view.
test("F2b: a hollow kit fill skins panels on the shell's OUTER and INNER faces", () => {
  const s = createFieldStore();
  const log = createOpLog();
  // open air across the whole chunk, then a hollow masonry shell inside it
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 2, 2] },
    },
    TABLE,
  );
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      hollow: 0.5,
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [1, 1, 1] },
    },
    TABLE,
  );
  const kit = skin(s, "0,0,0");
  // recover a panel's 0.5 m lattice plane along its proud axis — the one axis
  // pushed off the 0.25 m fine grid by panelProud/2 (the fixture-A idiom)
  const proudPlane = (p: KitInstance): number => {
    const axis = [0, 1, 2].find(
      (a) =>
        Math.abs(
          (p.position[a] as number) / 0.25 -
            Math.round((p.position[a] as number) / 0.25),
        ) > 1e-4,
    ) as number;
    return Math.round((p.position[axis] as number) * 2) / 2;
  };
  const panels = kit.filter((k) => k.piece === "panel");
  const outer = panels.filter((p) => [1, 3].includes(proudPlane(p)));
  const inner = panels.filter((p) => [1.5, 2.5].includes(proudPlane(p)));
  // OUTER vertical faces (box planes x/z = 1, 3 m): 4 faces × (4×4) = 64
  expect(outer.length).toBe(64);
  // INNER cavity faces (planes x/z = 1.5, 2.5 m): 4 faces × (2×2) = 16 — the
  // 0.5 m hollow put the shell's inner faces ON lattice planes, so the coarse
  // view classifies them as clean kept-kit faces
  expect(inner.length).toBe(16);
  expect(panels.length).toBe(80); // outer + inner partition ALL panels
  // ±y exposures: outer top/bottom 4×4 each + cavity floor/ceiling 2×2 each
  expect(kit.filter((k) => k.piece === "floorTile").length).toBe(20);
  expect(kit.filter((k) => k.piece === "ceilTile").length).toBe(20);
  // corner posts: the 4 OUTER vertical edge columns × 4 cells tall (no cavity
  // cell exposes an x-face and a z-face from the same shell cell)
  expect(kit.filter((k) => k.piece === "post").length).toBe(16);
  // NON-destructive proof at the derived view: the skipped cavity kept its
  // ROCK material, so no suppressed-kit cells exist and no collar is emitted —
  // a destructive fill-then-carve would leave kit-material air → collar
  expect(
    kit.filter((k) => k.piece === "rimPostV" || k.piece === "rimEdgeH").length,
  ).toBe(0);
});
