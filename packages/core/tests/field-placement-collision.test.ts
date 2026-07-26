// Placement-collider rasterization (F4, D-F4-5): the producer half of the
// `AnalyzeOptions.extraSolid` contract. These tests DECODE the emitted buffers
// with the documented layout (one byte per sample, `localIndex` order) rather
// than reading them through the analyzer, so a wrong encoding fails here with a
// cell-set diff instead of surfacing downstream as a plausible flag subset.
import { describe, expect, test } from "bun:test";
import type { ChunkKey, PlacementRecord } from "@furnace/core/field";
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  collisionExtentY,
  DEFAULT_CELL_SIZE,
  type PlacementCollision,
  parseChunkKey,
  voxelizePlacements,
} from "@furnace/core/field";
import { at } from "./_helpers/expect.ts";

const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];
const UNIT: [number, number, number] = [1, 1, 1];

/** Yaw quaternion about +Y, the rotation scatter's `randomYaw` emits. */
const yawQuat = (deg: number): [number, number, number, number] => {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
};

const record = (
  position: [number, number, number],
  quat: [number, number, number, number] = IDENTITY,
  scale: [number, number, number] = UNIT,
): PlacementRecord => ({
  archetypeId: "rock",
  position,
  quat,
  scale,
  variantIndex: 0,
});

/** Decode the emitted buffers back to a global-cell set, using the encoding the
 *  analyzer assumes: one byte per sample, `lx + 16·(ly + 16·lz)`, non-zero =
 *  solid. Asserts every buffer's length on the way through. */
function markedCells(out: ReadonlyMap<ChunkKey, Uint8Array>): Set<string> {
  const cells = new Set<string>();
  for (const [key, bits] of out) {
    expect(bits.length).toBe(CHUNK_SAMPLES);
    const [cx, cy, cz] = parseChunkKey(key);
    for (let i = 0; i < bits.length; i++) {
      if (at(bits, i) === 0) continue;
      const lx = i % CHUNK_DIM;
      const ly = Math.floor(i / CHUNK_DIM) % CHUNK_DIM;
      const lz = Math.floor(i / (CHUNK_DIM * CHUNK_DIM));
      cells.add(
        `${cx * CHUNK_DIM + lx},${cy * CHUNK_DIM + ly},${cz * CHUNK_DIM + lz}`,
      );
    }
  }
  return cells;
}

/** The inclusive cell box `[x0..x1] × [y0..y1] × [z0..z1]`, as `markedCells` keys. */
function cellBox(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): Set<string> {
  const cells = new Set<string>();
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) cells.add(`${x},${y},${z}`);
  return cells;
}

const sorted = (s: ReadonlySet<string>): string[] => [...s].sort();

describe("collisionExtentY", () => {
  test("is the collider's half-extent along its OWN Y axis, per primitive", () => {
    expect(
      collisionExtentY({ kind: "box", halfExtents: [0.4, 0.35, 0.4] }, UNIT),
    ).toBeCloseTo(0.35);
    expect(collisionExtentY({ kind: "sphere", radius: 0.5 }, UNIT)).toBeCloseTo(
      0.5,
    );
    // A capsule's Y half-extent includes its cap: halfHeight + radius.
    expect(
      collisionExtentY(
        { kind: "capsule", halfHeight: 0.5, radius: 0.22 },
        UNIT,
      ),
    ).toBeCloseTo(0.72);
  });

  test("matches the runtime collider's scale rule", () => {
    // `field-world.ts`'s `placementCollider`: a box scales PER AXIS, a
    // sphere/capsule has no per-axis form so it takes the MAX scale axis. The
    // lift must use the same rule or a base-anchored body's bottom misses the
    // record position. The runtime half of the pair is pinned by the dungeon's
    // own `field-placements.gpu.test.ts` — these numbers are this side only.
    expect(
      collisionExtentY(
        { kind: "box", halfExtents: [0.4, 0.35, 0.4] },
        [3, 2, 5],
      ),
    ).toBeCloseTo(0.7);
    expect(
      collisionExtentY({ kind: "sphere", radius: 0.5 }, [1, 1, 3]),
    ).toBeCloseTo(1.5);
    expect(
      collisionExtentY(
        { kind: "capsule", halfHeight: 0.5, radius: 0.22 },
        [2, 1, 1],
      ),
    ).toBeCloseTo(1.44);
  });

  test("returns a MAGNITUDE under negative scale — mirroring cannot flip an extent", () => {
    // A negative scale axis is a mirror: it moves no surface, so no extent may
    // go negative. Unreachable from any in-repo producer today (scatter emits
    // uniform, schema-pinned-positive scale); pinned because the runtime
    // derivation takes magnitudes too, and a silent split between the two is
    // what D-F4-5 exists to prevent.
    expect(
      collisionExtentY(
        { kind: "box", halfExtents: [0.4, 0.35, 0.4] },
        [-1, -1, -1],
      ),
    ).toBeCloseTo(0.35);
    expect(
      collisionExtentY({ kind: "sphere", radius: 0.5 }, [-2, 1, 1]),
    ).toBeCloseTo(1.0);
  });
});

describe("voxelizePlacements", () => {
  test("emits one byte per sample in localIndex order, covering the collider AABB", () => {
    // AABB x/z [0.7, 1.3] → cells 2..5; y [0.4, 1.6] → cells 1..6.
    const out = voxelizePlacements(
      [
        {
          collision: { kind: "box", halfExtents: [0.3, 0.6, 0.3] },
          records: [record([1, 1, 1])],
        },
      ],
      DEFAULT_CELL_SIZE,
    );
    expect(sorted(markedCells(out))).toEqual(sorted(cellBox(2, 5, 1, 6, 2, 5)));
  });

  test('anchor "base" lifts the collider by its own Y extent; "center" does not', () => {
    const collision: PlacementCollision = {
      kind: "box",
      halfExtents: [0.3, 0.6, 0.3],
    };
    const centered = markedCells(
      voxelizePlacements(
        [{ collision, records: [record([1, 1, 1])] }],
        DEFAULT_CELL_SIZE,
      ),
    );
    const based = markedCells(
      voxelizePlacements(
        [
          {
            collision: { ...collision, anchor: "base" },
            records: [record([1, 1, 1])],
          },
        ],
        DEFAULT_CELL_SIZE,
      ),
    );
    // Base-anchored: the collider's BOTTOM sits at y = 1, so the centre lifts to
    // 1.6 and the AABB becomes [1.0, 2.2] → cells 4..8. XZ is untouched.
    expect(sorted(centered)).toEqual(sorted(cellBox(2, 5, 1, 6, 2, 5)));
    expect(sorted(based)).toEqual(sorted(cellBox(2, 5, 4, 8, 2, 5)));
    // Omitting `anchor` is centre-anchored (the catalog's pre-F4 shape).
    expect(
      sorted(
        markedCells(
          voxelizePlacements(
            [
              {
                collision: { ...collision, anchor: "center" },
                records: [record([1, 1, 1])],
              },
            ],
            DEFAULT_CELL_SIZE,
          ),
        ),
      ),
    ).toEqual(sorted(centered));
  });

  test("a rotated collider covers its ROTATED world AABB (conservative, never smaller)", () => {
    const collision: PlacementCollision = {
      kind: "box",
      halfExtents: [0.5, 0.1, 0.1],
    };
    const flat = markedCells(
      voxelizePlacements(
        [{ collision, records: [record([1, 1, 1])] }],
        DEFAULT_CELL_SIZE,
      ),
    );
    const turned = markedCells(
      voxelizePlacements(
        [{ collision, records: [record([1, 1, 1], yawQuat(45))] }],
        DEFAULT_CELL_SIZE,
      ),
    );
    // A 45° yaw swings the long axis into Z: the covered set grows in Z and
    // shrinks in neither. Over-solid is the miss-safe direction for trapping.
    const zSpan = (cells: ReadonlySet<string>): number =>
      new Set([...cells].map((c) => c.split(",")[2])).size;
    expect(zSpan(turned)).toBeGreaterThan(zSpan(flat));
    expect(turned.size).toBeGreaterThan(flat.size);
  });

  test("a collider straddling a chunk border marks BOTH chunks", () => {
    // Cell 15 is the last of chunk 0; cell 16 the first of chunk 1.
    const out = voxelizePlacements(
      [
        {
          collision: { kind: "box", halfExtents: [0.3, 0.1, 0.1] },
          records: [record([4, 1, 1])],
        },
      ],
      DEFAULT_CELL_SIZE,
    );
    expect([...out.keys()].sort()).toEqual([
      chunkKey(0, 0, 0),
      chunkKey(1, 0, 0),
    ]);
    expect(markedCells(out).has("15,4,4")).toBe(true);
    expect(markedCells(out).has("16,4,4")).toBe(true);
  });

  test("sphere and capsule rasterize their own AABBs", () => {
    // Sphere r=0.3 at (1,1,1) → [0.7, 1.3] on every axis → cells 2..5.
    expect(
      sorted(
        markedCells(
          voxelizePlacements(
            [
              {
                collision: { kind: "sphere", radius: 0.3 },
                records: [record([1, 1, 1])],
              },
            ],
            DEFAULT_CELL_SIZE,
          ),
        ),
      ),
    ).toEqual(sorted(cellBox(2, 5, 2, 5, 2, 5)));
    // Capsule halfHeight 0.5 + radius 0.1 → Y half-extent 0.6, XZ 0.1.
    expect(
      sorted(
        markedCells(
          voxelizePlacements(
            [
              {
                collision: { kind: "capsule", halfHeight: 0.5, radius: 0.1 },
                records: [record([1, 1, 1])],
              },
            ],
            DEFAULT_CELL_SIZE,
          ),
        ),
      ),
    ).toEqual(sorted(cellBox(3, 4, 1, 6, 3, 4)));
  });

  test("a MIRRORED record covers the same cells as its unmirrored twin", () => {
    // An extent is a distance. Signed arithmetic would invert the cell range and
    // rasterize the record to nothing — a solid prop going silent.
    const collision: PlacementCollision = {
      kind: "box",
      halfExtents: [0.3, 0.6, 0.3],
    };
    const plain = markedCells(
      voxelizePlacements(
        [{ collision, records: [record([1, 1, 1])] }],
        DEFAULT_CELL_SIZE,
      ),
    );
    const mirrored = markedCells(
      voxelizePlacements(
        [{ collision, records: [record([1, 1, 1], IDENTITY, [-1, 1, -1])] }],
        DEFAULT_CELL_SIZE,
      ),
    );
    expect(sorted(mirrored)).toEqual(sorted(plain));
  });

  test("no groups, and groups with no records, yield an empty map", () => {
    expect(voxelizePlacements([], DEFAULT_CELL_SIZE).size).toBe(0);
    expect(
      voxelizePlacements(
        [{ collision: { kind: "sphere", radius: 0.3 }, records: [] }],
        DEFAULT_CELL_SIZE,
      ).size,
    ).toBe(0);
    // ...but a broken primitive is still bad input, records or no records.
    expect(() =>
      voxelizePlacements(
        [{ collision: { kind: "sphere", radius: -1 }, records: [] }],
        DEFAULT_CELL_SIZE,
      ),
    ).toThrow(/positive finite/);
  });

  test("rejects a malformed collision primitive or cell size (setup-loud)", () => {
    const rec = [record([1, 1, 1])];
    expect(() =>
      voxelizePlacements(
        [{ collision: { kind: "sphere", radius: 0 }, records: rec }],
        DEFAULT_CELL_SIZE,
      ),
    ).toThrow(/positive finite/);
    expect(() =>
      voxelizePlacements(
        [
          {
            collision: { kind: "box", halfExtents: [0.3, Number.NaN, 0.3] },
            records: rec,
          },
        ],
        DEFAULT_CELL_SIZE,
      ),
    ).toThrow(/positive finite/);
    expect(() =>
      voxelizePlacements(
        [{ collision: { kind: "sphere", radius: 0.3 }, records: rec }],
        0,
      ),
    ).toThrow(/cellSize/);
  });

  test("rejects a record whose pose is not finite (silent no-mark otherwise)", () => {
    // A NaN centre makes the cell range empty, so the record would rasterize to
    // NOTHING without a throw — a false negative arriving as silence.
    expect(() =>
      voxelizePlacements(
        [
          {
            collision: { kind: "sphere", radius: 0.3 },
            records: [record([Number.NaN, 1, 1])],
          },
        ],
        DEFAULT_CELL_SIZE,
      ),
    ).toThrow(/finite/);
  });

  test("rejects a non-unit quaternion — it would rotate partially and UNDER-cover", () => {
    // quatMatrix on a quat of norm n yields I + n²(R − I): a PARTIAL rotation
    // whose AABB is SMALLER than the true one. Under-covering is the one
    // direction this module promises never to go, so it throws like every other
    // way of covering less. Half-length quat = |q|² of 0.25, far past tolerance.
    const half = yawQuat(45).map((v) => v * 0.5) as [
      number,
      number,
      number,
      number,
    ];
    expect(() =>
      voxelizePlacements(
        [
          {
            collision: { kind: "box", halfExtents: [0.5, 0.1, 0.1] },
            records: [record([1, 1, 1], half)],
          },
        ],
        DEFAULT_CELL_SIZE,
      ),
    ).toThrow(/unit-length/);
    // The artifact path's own tolerance still passes: float drift is not a bug.
    const drifted: [number, number, number, number] = [0, 0, 0, 1 - 1e-5];
    expect(() =>
      voxelizePlacements(
        [
          {
            collision: { kind: "box", halfExtents: [0.5, 0.1, 0.1] },
            records: [record([1, 1, 1], drifted)],
          },
        ],
        DEFAULT_CELL_SIZE,
      ),
    ).not.toThrow();
  });

  test("refuses a record whose AABB exceeds the per-record cell budget", () => {
    // Budgets are day-one semantics: a 100 m collider is garbage data, and
    // rasterizing it would stall the analyzer for tens of millions of cells.
    expect(() =>
      voxelizePlacements(
        [
          {
            collision: { kind: "box", halfExtents: [50, 50, 50] },
            records: [record([0, 0, 0])],
          },
        ],
        DEFAULT_CELL_SIZE,
      ),
    ).toThrow(/budget/);
  });
});
