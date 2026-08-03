// Stage 2 of the walkability advisor: `analyzerVerify` drives the SHIPPED CharacterMover at a
// stage-1 flag and reports what the real mover does there. Plain `bun test` — no GPU fixture:
// Task 4's `createHeadlessPhysicsContext` decoupled physics from the rendering context, and this
// file is the proof that the whole verify path (store → chunk colliders → Rapier → mover) runs
// with no device behind it.
//
// The two load-bearing cases are (a) and (b), and they are load-bearing in OPPOSITE directions:
// (a) proves the probe still catches a real trap, (b) proves it does not cry wolf on ground the
// mover walks. A stage-2 filter that fails (b) is worthless; one that fails (a) is dangerous.
import { describe, expect, test } from "bun:test";
import * as field from "@furnace/core/field";
import * as physics from "@furnace/core/physics";
import { expectDefined } from "../../tests/_helpers/expect.ts";
import { analyzerVerify } from "./walk-probe.ts";
import { AGENT } from "./walkability.ts";

const CELL = field.DEFAULT_CELL_SIZE; // 0.25 m
/** Generous ceiling for the fixtures — a verify of a 4-lane flag runs in ~100 ms. */
const AMPLE_BUDGET_MS = 20_000;

/** Inclusive cell box. Writing SOLID allocates the chunk (solid-filled) without changing what it
 *  means, which is what gives the carved room its shell collider: `chunkColliders` only emits
 *  voxels for solid samples inside ALLOCATED chunks, so a room carved with no solid margin around
 *  it would have air where the physics world needs walls. */
function fillSolid(
  store: field.FieldStore,
  box: readonly [number, number, number, number, number, number],
): void {
  const [x0, x1, y0, y1, z0, z1] = box;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        field.setDensity(store, x, y, z, field.SOLID);
}

function carveAir(
  store: field.FieldStore,
  box: readonly [number, number, number, number, number, number],
): void {
  const [x0, x1, y0, y1, z0, z1] = box;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        field.setDensity(store, x, y, z, field.AIR);
}

/** Every flag the whole-store pass produces, flattened. */
function allFlags(store: field.FieldStore): field.FieldFlag[] {
  return [...field.analyzeWorld(store, AGENT).values()].flat();
}

/** The one flag of `kind` anchored on cell `cell`, or a loud failure naming what was there. */
function flagAt(
  flags: readonly field.FieldFlag[],
  kind: field.FlagKind,
  cell: readonly [number, number, number],
): field.FieldFlag {
  const found = flags.find(
    (f) =>
      f.kind === kind &&
      f.cell[0] === cell[0] &&
      f.cell[1] === cell[1] &&
      f.cell[2] === cell[2],
  );
  return expectDefined(found, `${kind} flag at ${cell.join(",")}`);
}

// ─── fixtures ───

/** A 6 x 6 m room whose floor is at 1.0 m, with a 3 x 3 m pit down to 0 m cut in the middle: the
 *  tall-rim class. A capsule on the pit floor cannot climb the 1.0 m rim (F0 measured the mover's
 *  real ceiling at ~0.7 m), so it is stuck down there. */
function pitRoom(): field.FieldStore {
  const store = field.createFieldStore(CELL);
  fillSolid(store, [-2, 25, -2, 17, -2, 25]);
  carveAir(store, [0, 23, 4, 15, 0, 23]); // the upper floor, at y = 1.0 m
  carveAir(store, [6, 17, 0, 15, 6, 17]); // the pit, floor at y = 0
  return store;
}

/** A 10 x 3 m corridor with a single 0.5 m step up half way along: the benign class. 0.5 m is
 *  above `stepHeight` (0.4) but within the mover's measured climb ceiling (0.7), which is exactly
 *  the band stage 1 marks `info` — and exactly the band a stage-2 filter has to be able to clear,
 *  or it filters nothing. */
function steppedCorridor(): field.FieldStore {
  const store = field.createFieldStore(CELL);
  fillSolid(store, [-2, 41, -2, 17, -2, 13]);
  carveAir(store, [0, 19, 0, 15, 0, 11]); // the low half, floor at y = 0
  carveAir(store, [20, 39, 2, 15, 0, 11]); // the high half, floor at y = 0.5 m
  return store;
}

/** A 0.5 m-wide, 4 m-long slot in solid rock. Stage 1 calls its floor walkable (a floor cell with
 *  headroom) and flags it `narrow` — but a 0.6 m-wide capsule has no legal pose anywhere in it, so
 *  there is no approach to drive and no verdict to give. */
function subCapsuleSlot(): field.FieldStore {
  const store = field.createFieldStore(CELL);
  fillSolid(store, [7, 14, -2, 13, 1, 22]);
  carveAir(store, [10, 11, 0, 11, 4, 19]);
  return store;
}

/** The F3b default cave at seed 1 — 108 allocated chunks, the realistic large scene. */
function defaultCave(): field.FieldStore {
  const store = field.createFieldStore(CELL);
  const cave = expectDefined(field.generatorById("cave"), "cave generator");
  field.commitGenerator(store, field.createOpLog(), cave, {
    params: cave.defaults,
    seed: 1,
    region: { min: [0, 0, 0], max: [20, 10, 20] },
    policy: "replace",
    table: field.BUILTIN_TABLE,
  });
  return store;
}

// ─── (a) the tall-rim class: stage 1 flags it, the mover confirms it ───

describe("analyzerVerify — a 1.0 m pit rim", () => {
  test("stage 1 flags the pit floor `ledge` info, `detectPits` calls it a trap, and the mover agrees", async () => {
    // The severity is `info` and that is the POINT (D-F4-18): the 1.0 m rim on its own
    // is a rise like any other, and rises past the climb ceiling were measured to be what
    // vertical terrain is made of. What makes THIS one a trap is that there is no way back
    // out — a connectivity property, which `detectPits` reports and the mover confirms
    // below. This test is the three of them agreeing on one fixture.
    const store = pitRoom();
    const flag = flagAt(allFlags(store), "ledge", [6, 0, 11]);
    expect(flag.severity).toBe("info");

    const pits = field.detectPits(store, AGENT, [[0.625, 1.125, 0.625]]);
    expect(pits.length).toBe(1);
    const pit = expectDefined(pits[0], "the pit region");
    expect(pit.severity).toBe("candidate");
    expect(pit.cells).toBe(144); // the 12 x 12 cells of the 3 x 3 m pit floor
    expect(pit.cell[1]).toBe(0); // anchored on the pit floor, not the rim

    const verdict = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs: AMPLE_BUDGET_MS,
    });

    expect(verdict.outcome).toBe("trapped");
    expect(verdict.reason).toBeUndefined();
    expect(verdict.lanes.some((l) => l.outcome === "trap")).toBe(true);
  });

  test("the trap survives a lane that clears — trap-precedence, not lane agreement", async () => {
    // The -x lane spawns in the pit and stalls at the rim; the +x lane spawns ON the rim and
    // walks OFF it, clearing the flag's centre on the way down. The donor documents exactly this
    // pair (`sweep.ts` CLEAR_AT_FLAG_CENTRE), and it is why `verdictOf` checks `trap` FIRST. If
    // this fixture ever stops producing both, the trap-precedence sabotage below proves nothing.
    const store = pitRoom();
    const flag = flagAt(allFlags(store), "ledge", [6, 0, 11]);
    const verdict = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs: AMPLE_BUDGET_MS,
    });

    expect(verdict.lanes.some((l) => l.outcome === "trap")).toBe(true);
    expect(verdict.lanes.some((l) => l.outcome === "clear")).toBe(true);
    expect(verdict.outcome).toBe("trapped");
  });
});

// ─── (b) the false-positive control: the filter has to be able to say "clear" ───

describe("analyzerVerify — a 0.5 m walkable step", () => {
  test("stage 1 flags the step `ledge` info and the mover walks it clear", async () => {
    const store = steppedCorridor();
    const flag = flagAt(allFlags(store), "ledge", [19, 0, 5]);
    expect(flag.severity).toBe("info");

    const verdict = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs: AMPLE_BUDGET_MS,
    });

    expect(verdict.outcome).toBe("clear");
    expect(verdict.lanes.some((l) => l.outcome === "clear")).toBe(true);
    expect(verdict.lanes.some((l) => l.outcome === "trap")).toBe(false);
  });
});

// ─── (c) the budget is a hard wall-clock ceiling, not a suggestion ───

describe("analyzerVerify — budget", () => {
  test("a scene too large to build inside the budget returns inconclusive/budget with no lanes", async () => {
    const store = defaultCave();
    const flag = expectDefined(
      allFlags(store).find((f) => f.severity === "candidate"),
      "a candidate flag in the default cave",
    );

    const budgetMs = 1;
    const verdict = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs,
    });

    expect(verdict.outcome).toBe("inconclusive");
    expect(verdict.reason).toBe("budget");
    expect(verdict.lanes).toEqual([]);
    expect(verdict.ms).toBeGreaterThanOrEqual(budgetMs);
  });

  test("the same flag and scene reach a verdict when the budget is ample", async () => {
    // The vacuity guard for the test above: without it, a verify that ALWAYS returned
    // inconclusive/budget would pass, and the budget assertion would be measuring nothing.
    const store = defaultCave();
    const flag = expectDefined(
      allFlags(store).find((f) => f.severity === "candidate"),
      "a candidate flag in the default cave",
    );

    const verdict = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs: AMPLE_BUDGET_MS,
    });

    expect(verdict.reason).not.toBe("budget");
    expect(verdict.lanes.length).toBe(4);
  });
});

// ─── (d) no legal approach is silence, never a manufactured trap ───

describe("analyzerVerify — spawn validation", () => {
  test("a `narrow` flag in a sub-capsule slot yields all no-lane and inconclusive, never trapped", async () => {
    const store = subCapsuleSlot();
    const flag = flagAt(allFlags(store), "narrow", [10, 0, 11]);
    expect(flag.severity).toBe("candidate");

    const verdict = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs: AMPLE_BUDGET_MS,
    });

    expect(verdict.lanes.length).toBe(4);
    expect(verdict.lanes.every((l) => l.outcome === "no-lane")).toBe(true);
    expect(verdict.outcome).toBe("inconclusive");
    expect(verdict.reason).toBe("no-lanes");
  });

  test("a spawn column outside the built neighbourhood is refused, not started in mid-air", async () => {
    // The third spawn condition (ground within the mover's own snap reach) is the one that fires
    // here. The store says that column is walkable — it IS, in the field — but at
    // `neighborhoodChunks: 0` no collider was built for it, so a capsule placed there would begin
    // the lane falling. `no-lane` (no legal approach) is the honest answer; `fell` would blame the
    // flag's geometry for the probe's own truncated scene.
    const store = steppedCorridor();
    const flag = flagAt(allFlags(store), "ledge", [19, 0, 5]);

    const verdict = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs: AMPLE_BUDGET_MS,
      neighborhoodChunks: 0,
    });

    const approach = expectDefined(
      verdict.lanes.find((l) => l.dir[0] === 1 && l.dir[1] === 0),
      "the +x lane",
    );
    expect(approach.outcome).toBe("no-lane");
    // Vacuity guard: the same lane walks the same flag clear once its chunk is in the scene, so
    // the refusal above is the missing GROUND talking, not a lane that never works.
    const whole = await analyzerVerify({
      store,
      flag,
      profile: AGENT,
      budgetMs: AMPLE_BUDGET_MS,
    });
    expect(
      expectDefined(
        whole.lanes.find((l) => l.dir[0] === 1 && l.dir[1] === 0),
        "the +x lane at the default radius",
      ).outcome,
    ).toBe("clear");
  });
});

// ─── setup-loud contracts ───

describe("analyzerVerify — setup validation", () => {
  test("a profile that does not describe the shipped mover is refused", async () => {
    const store = steppedCorridor();
    const flag = flagAt(allFlags(store), "ledge", [19, 0, 5]);

    await expect(
      analyzerVerify({
        store,
        flag,
        profile: { ...AGENT, stepHeight: AGENT.stepHeight + 0.1 },
        budgetMs: AMPLE_BUDGET_MS,
      }),
    ).rejects.toThrow(/does not describe the shipped mover/);
  });

  test("a lattice too coarse for the clear bar to mean anything is refused", async () => {
    // half a cell (0.35) >= the capsule radius (0.3): a capsule blocked at the flag's far face
    // would stop PAST the flag's centre and read as CLEAR.
    const store = field.createFieldStore(0.7);
    const flag: field.FieldFlag = {
      kind: "ledge",
      severity: "candidate",
      cell: [0, 0, 0],
      world: [0, 0, 0],
      chunk: field.chunkKey(0, 0, 0),
    };

    await expect(
      analyzerVerify({
        store,
        flag,
        profile: AGENT,
        budgetMs: AMPLE_BUDGET_MS,
      }),
    ).rejects.toThrow(/lattice too coarse/);
  });

  test("a non-positive budget is refused rather than silently running unbounded", async () => {
    const store = steppedCorridor();
    const flag = flagAt(allFlags(store), "ledge", [19, 0, 5]);

    await expect(
      analyzerVerify({ store, flag, profile: AGENT, budgetMs: 0 }),
    ).rejects.toThrow(/budgetMs must be a positive finite number/);
  });
});

// ─── the penetration detector this probe's spawn gate rests on ───

describe("castShape as a penetration detector", () => {
  test("a probe-length sweep reports toi 0 from a penetrating pose, while maxDistance 0 misses it", async () => {
    // The F4 plan's Task 7 spec proposed a zero-offset `castShape` with `maxDistance: 0` as the
    // penetration detector ("must NOT return toi === 0"). MEASURED on
    // @dimforge/rapier3d-compat as vendored here: maxDistance 0 returns `null` for a DEEPLY
    // penetrating pose, a shallow one, and a free one alike — the check can never reject
    // anything, so shipping it would have been a guard in name only. Any positive distance,
    // down to 1e-12, reports toi 0 on penetration in every direction (stopAtPenetration), which
    // is what `poseIsFree` already does and what the spawn gate therefore uses instead.
    const ctx = physics.createHeadlessPhysicsContext();
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    try {
      physics.createBody(ctx, world, {
        type: "static",
        shape: { cuboid: [2, 2, 2] },
        position: [0, 0, 0],
      });
      physics.step(ctx, world, 1 / 60);
      const shape = { capsule: AGENT.capsule };
      const buried: [number, number, number] = [0, 0, 0];
      const free: [number, number, number] = [0, 8, 0];

      const probe = (position: [number, number, number], maxDistance: number) =>
        physics.castShape(ctx, world, {
          shape,
          position,
          dir: [1, 0, 0],
          maxDistance,
        });

      expect(expectDefined(probe(buried, 1e-3), "buried probe hit").toi).toBe(
        0,
      );
      expect(probe(free, 1e-3)).toBeNull();
      // The reason the spec's formulation was not implemented as written.
      expect(probe(buried, 0)).toBeNull();
    } finally {
      physics.destroyWorld(ctx, world);
    }
  });
});
