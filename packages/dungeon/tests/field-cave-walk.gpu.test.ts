// F3b Task 4 — P-F3-1 probe: the stepped-floor capsule fuzz-walk (a DELIVERABLE, not a
// blocker). Per D-F3-11, failures are CLASSIFIED and RECORDED, never repaired: there is no
// search / retry / repair loop anywhere here. Individual lane failures are DATA; only three
// things assert — (a) fixture validity, (b) the composite mouth→deepest lane walking on
// >= half the configs (the systemic-collapse tripwire), (c) the report file is written.
//
// The walk plumbing (bake -> stub fetch -> loadWorld -> runWalk against the per-chunk shell
// voxel colliders — the SAME collision the game uses) is lifted from field-world.gpu.test.ts;
// `runWalk` + `bakedFetchStub` are reused VERBATIM from tests/_helpers/walk-fixture.ts. Only
// the cave fixture build, the skeleton-derived lanes, and the classifier are new.
//
// DEVIATIONS from the plan's literal recipe (each justified in place below):
//   1. A lane is walked SEGMENT-BY-SEGMENT along its polyline (runWalk is single-direction);
//      a straight drive across a whole winding passage would cut the tube corners and read as
//      a spurious `blocked`. See `walkLane`.
//   2. Failures are classified via a loose-bounds `expectStop` RE-DRIVE (not by parsing bun's
//      assertion text, which is fragile across versions). See `classifyThrow`.

import { describe, expect, test } from "bun:test";
import {
  BUILTIN_TABLE,
  bakeFieldWorld,
  buildCaveSkeleton,
  type CaveChamber,
  type CaveMouth,
  type CavePassage,
  type CaveSkeleton,
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  generatorById,
  getDensity,
} from "@furnace/core/field";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { MaterialCache } from "../src/realize.ts";
import type { Vec3 } from "../src/region.ts";
import { STEP_HEIGHT } from "../src/walkability.ts";
import { loadWorld } from "../src/world-loader.ts";
import { at } from "./_helpers/expect.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";
import {
  along,
  bakedFetchStub,
  FRAME_STEP,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
} from "./_helpers/walk-fixture.ts";

await ensureBunWebGpu();

// ─── probe constants ───
/** The floor-height quantum the cave quantizes to — DEFAULT_CELL_SIZE by construction
 *  (`cave.ts`: RISER === CARVE_CELL === DEFAULT_CELL_SIZE), so a public import single-sources
 *  it without reaching into core's internal cave.ts. */
const RISER = DEFAULT_CELL_SIZE; // 0.25 m
/** The physics contact skin the capsule carries. The premise gate demands one riser fit UNDER
 *  the mover's step-up with this margin to spare (matches the deleted `STEP_MARGIN` 0.05 the
 *  walkability backlog records). */
const SKIN_MARGIN = 0.05;
/** Capsule centre height above the floor at spawn — grounded rest + a touch, so the first
 *  frame settles rather than teleports (the analyzer-probe / walk-fixture convention). */
const SPAWN_ABOVE_FLOOR = REST_OFFSET + SPAWN_RISE; // 1.0 m
/** Passage headroom the cave carves above a floor (`cave.ts` PASSAGE_HEIGHT) — sizes the
 *  per-lane ceiling guard so a legitimate stepped climb never reads as a launch. */
const PASSAGE_HEADROOM = 3.0;
/** `floorY` guard drop below a lane's lowest floor: a real fall-through still trips it, a
 *  legitimate one-riser descent (0.25 m) does not. */
const FALL_MARGIN = 1.0;
/** `ceilY` guard rise above a lane's highest floor + headroom. */
const CEIL_MARGIN = 1.0;
/** A segment "reached" its next waypoint when its along-advance is within this of the
 *  waypoint's projection (runWalk clean-breaks strictly PAST the target, so this is slack for
 *  the rare budget-exhausted short return). */
const REACH_MARGIN = 0.1;
/** Below one tread of along-progress ⇒ the geometry occluded the lane from the start. */
const BLOCKED_EPS = RISER; // 0.25 m
/** A drop past this (well beyond one riser + settle) is a genuine fall-through, not a step
 *  down. */
const FALL_THRESHOLD = 1.5;
/** Extra frames beyond the nominal crossing for the classification re-drive budget. */
const REDRIVE_SLACK = 120;
/** Tiny epsilon for coincident-point / floor-height comparisons. */
const EPS = 1e-6;

// ─── matrix: 3 themes × 2 verticality × 2 seeds = 12 configs ───
const THEMES = ["mined", "organic", "mixed"] as const;
const VERTICALITIES = [0.25, 0.75] as const;
const SEEDS = [1, 7] as const;
const EXTENT: Vec3 = [20, 10, 20];
const REGION = { min: [0, 0, 0] as Vec3, max: EXTENT };
const CAVE = generatorById("cave");

/** Strict cave params from the schema defaults + overrides (evaluate is setup-loud). */
const fullParams = (o: Record<string, unknown>): Record<string, unknown> => ({
  ...CAVE.defaults,
  ...o,
});

type Cfg = {
  theme: string;
  verticality: number;
  seed: number;
  name: string;
  params: Record<string, unknown>;
};

const CONFIGS: Cfg[] = THEMES.flatMap((theme) =>
  VERTICALITIES.flatMap((verticality) =>
    SEEDS.map((seed) => ({
      theme,
      verticality,
      seed,
      name: `cave-probe-${theme}-v${verticality}-s${seed}`,
      params: fullParams({ theme, verticality }),
    })),
  ),
);

// ─── skeleton helpers ───
const chamberFloorY = (c: CaveChamber): number => c.center[1] - c.radii[1];

/** World-point density (nearest sample); region min is [0,0,0] so world == region-local. */
const dAt = (
  s: ReturnType<typeof createFieldStore>,
  wx: number,
  wy: number,
  wz: number,
): number =>
  getDensity(
    s,
    Math.round(wx / RISER),
    Math.round(wy / RISER),
    Math.round(wz / RISER),
  );

const coincident = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < EPS;

/** Unit XZ direction a→b as a `Vec3` `[x, 0, z]`; null for a coincident (no-horizontal) pair
 *  (the mover's step-up owns a pure vertical, so such a segment is skipped). */
function horizDirTo(a: Vec3, b: Vec3): Vec3 | null {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < EPS) return null;
  return [dx / len, 0, dz / len];
}

const deepestChamberIndex = (sk: CaveSkeleton): number => {
  let best = 0;
  let bestY = Number.POSITIVE_INFINITY;
  sk.chambers.forEach((c, i) => {
    const y = chamberFloorY(c);
    if (y < bestY) {
      bestY = y;
      best = i;
    }
  });
  return best;
};

/** The mouth passage (chamber→mouth terminal) whose far end lands on mouth `mouthIdx`. */
function mouthPassageIndex(sk: CaveSkeleton, mouthIdx: number): number {
  const at = sk.mouths[mouthIdx]?.at;
  if (at === undefined) return -1;
  return sk.passages.findIndex(
    (p) =>
      p.to === -1 &&
      coincident(p.waypoints[p.waypoints.length - 1] as Vec3, at),
  );
}

/** BFS a chamber-index path `src`→`dst` over chamber-chamber passages (mouth terminals
 *  excluded); `[]` if disconnected (connectivity is guaranteed, so only a degenerate skeleton
 *  hits that). */
function chamberPath(sk: CaveSkeleton, src: number, dst: number): number[] {
  if (src === dst) return [src];
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const p of sk.passages)
    if (p.from >= 0 && p.to >= 0) {
      link(p.from, p.to);
      link(p.to, p.from);
    }
  const prev = new Map<number, number>();
  const seen = new Set([src]);
  const queue = [src];
  while (queue.length > 0) {
    const u = queue.shift() as number;
    if (u === dst) break;
    for (const v of adj.get(u) ?? [])
      if (!seen.has(v)) {
        seen.add(v);
        prev.set(v, u);
        queue.push(v);
      }
  }
  if (!seen.has(dst)) return [];
  const path = [dst];
  let cur = dst;
  while (cur !== src) {
    cur = prev.get(cur) as number;
    path.push(cur);
  }
  return path.reverse();
}

/** The waypoints of the passage joining chambers `u`,`v`, oriented `u`→`v`. */
function orientedWaypoints(sk: CaveSkeleton, u: number, v: number): Vec3[] {
  const p = sk.passages.find(
    (q) => (q.from === u && q.to === v) || (q.from === v && q.to === u),
  ) as CavePassage;
  const wps = p.waypoints.map((w) => [...w] as Vec3);
  return p.from === u ? wps : wps.reverse();
}

/** The composite mouth→deepest-chamber polyline: the reversed mouth passage (mouth→its
 *  nearest chamber) then the chamber-graph path to the deepest chamber, junction points
 *  de-duplicated. Null when the skeleton has no chambers/mouths or no path. */
function buildCompositePoly(sk: CaveSkeleton): Vec3[] | null {
  if (sk.chambers.length === 0 || sk.mouths.length === 0) return null;
  const mi = mouthPassageIndex(sk, 0);
  if (mi < 0) return null;
  const mp = sk.passages[mi] as CavePassage;
  const path = chamberPath(sk, mp.from, deepestChamberIndex(sk));
  if (path.length === 0) return null;
  const poly: Vec3[] = mp.waypoints.map((w) => [...w] as Vec3).reverse();
  for (let k = 0; k + 1 < path.length; k++) {
    const seg = orientedWaypoints(sk, path[k] as number, path[k + 1] as number);
    for (const w of seg) {
      const last = poly[poly.length - 1];
      if (last && coincident(last, w)) continue;
      poly.push(w);
    }
  }
  return poly;
}

// ─── classification (D-F3-11: record, never repair) ───
type FailClass =
  | "wedge"
  | "ghost-launch"
  | "fall-through"
  | "blocked"
  | "too-steep";
type LaneOutcome =
  | { walked: true }
  | { walked: false; failClass: FailClass; segment: number };

type SegCtx = { startAlong: number; startY: number; ascending: boolean };

/** A stall-family outcome (no throw): occluded-from-start vs couldn't-climb vs level-catch. */
function classifyStall(advanced: number, seg: SegCtx): FailClass {
  const progress = advanced - seg.startAlong;
  if (progress < BLOCKED_EPS) return "blocked";
  if (seg.ascending) return "too-steep";
  return "wedge";
}

/** Disambiguate a per-frame guard throw WITHOUT parsing bun's assertion text: re-drive the
 *  failing segment in `expectStop` mode (stall assert + stopAlong disabled) with loosened
 *  floor/ceil, so the ONLY hard asserts left are the hardcoded rise/horiz FLING guards. A
 *  throw there ⇒ ghost-launch; otherwise the returned trajectory tells fall-through from the
 *  stall family. */
function classifyThrow(
  ctx: gpu.Context,
  world: physics.World,
  start: Vec3,
  dir: Vec3,
  stopAlong: number,
  seg: SegCtx,
): FailClass {
  const budget =
    Math.ceil((stopAlong - seg.startAlong) / FRAME_STEP) + REDRIVE_SLACK;
  try {
    const res = runWalk(ctx, world, {
      start,
      dir,
      floorY: -1e6,
      ceilY: 1e6,
      expectStop: true,
      maxIters: budget,
    });
    if (seg.startY - res.minY > FALL_THRESHOLD) return "fall-through";
    return classifyStall(res.advanced, seg);
  } catch {
    return "ghost-launch"; // single-frame rise > 0.55 m or horiz > 0.3 m — a KCC fling
  }
}

/** Walk one polyline lane segment-by-segment, chaining the mover's position and re-aiming at
 *  each next waypoint (runWalk is single-direction). Reused VERBATIM per segment; the whole
 *  lane is wrapped so a per-frame guard throw becomes a RECORDED class, never a test failure. */
function walkLane(
  ctx: gpu.Context,
  world: physics.World,
  poly: Vec3[],
): LaneOutcome {
  const floors = poly.map((w) => w[1]);
  const floorGuard = Math.min(...floors) - FALL_MARGIN;
  const ceilGuard = Math.max(...floors) + PASSAGE_HEADROOM + CEIL_MARGIN;
  const start = at(poly, 0);
  let pos: Vec3 = [start[0], start[1] + SPAWN_ABOVE_FLOOR, start[2]];
  for (let i = 0; i + 1 < poly.length; i++) {
    const next = poly[i + 1] as Vec3;
    const dir = horizDirTo(pos, next);
    if (dir === null) continue; // pure-vertical hop — the step-up owns it
    const stopAlong = along(next, dir);
    const seg: SegCtx = {
      startAlong: along(pos, dir),
      startY: pos[1],
      ascending: (poly[i + 1] as Vec3)[1] > (poly[i] as Vec3)[1] + EPS,
    };
    try {
      const res = runWalk(ctx, world, {
        start: pos,
        dir,
        stopAlong,
        floorY: floorGuard,
        ceilY: ceilGuard,
      });
      if (res.advanced >= stopAlong - REACH_MARGIN) {
        pos = res.pos;
        continue;
      }
      // Returned without reaching and without throwing ⇒ a stall family (no fall/launch).
      return {
        walked: false,
        failClass: classifyStall(res.advanced, seg),
        segment: i,
      };
    } catch {
      return {
        walked: false,
        failClass: classifyThrow(ctx, world, pos, dir, stopAlong, seg),
        segment: i,
      };
    }
  }
  return { walked: true };
}

// ─── per-config bake -> load -> walk (mirrors field-world.gpu.test.ts) ───
type LaneRec = {
  cfg: Cfg;
  kind: "passage" | "composite";
  index: number;
  outcome: LaneOutcome;
};

/** Bake a config's cave, load it through the REAL `loadWorld` (per-chunk shell voxel
 *  colliders), and run `body` against the loaded world + skeleton — restoring fetch and
 *  tearing down the GPU/physics resources afterwards. */
async function withLoadedCave<T>(
  cfg: Cfg,
  body: (ctx: gpu.Context, world: physics.World, sk: CaveSkeleton) => T,
): Promise<T> {
  const store = createFieldStore();
  const log = createOpLog();
  commitGenerator(store, log, CAVE, {
    params: cfg.params,
    seed: cfg.seed,
    region: REGION,
    policy: "replace",
    table: BUILTIN_TABLE,
  });
  const sk = buildCaveSkeleton(cfg.params, cfg.seed, EXTENT);
  const c0 = sk.chambers[0] as CaveChamber;
  const files = bakeFieldWorld(store, log, BUILTIN_TABLE, {
    name: cfg.name,
    playerStart: [c0.center[0], chamberFloorY(c0) + REST_OFFSET, c0.center[2]],
    playerYaw: 0,
  });

  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const matCache = new MaterialCache(ctx);
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = bakedFetchStub(files, cfg.name);
    const loaded = await loadWorld(ctx, world, matCache);
    globalThis.fetch = orig; // walks cast against the world; no more fetches
    try {
      return body(ctx, world, sk);
    } finally {
      loaded.destroy();
    }
  } finally {
    globalThis.fetch = orig;
    matCache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  }
}

const walkConfig = (cfg: Cfg): Promise<LaneRec[]> =>
  withLoadedCave(cfg, (ctx, world, sk) => {
    const composite = buildCompositePoly(sk);
    const records: LaneRec[] = sk.passages.map((p, index) => ({
      cfg,
      kind: "passage",
      index,
      outcome: walkLane(
        ctx,
        world,
        p.waypoints.map((w) => [...w] as Vec3),
      ),
    }));
    if (composite !== null && composite.length >= 2)
      records.push({
        cfg,
        kind: "composite",
        index: 0,
        outcome: walkLane(ctx, world, composite),
      });
    return records;
  });

// ─── report rendering (the committed deliverable — F4's analyzer corpus) ───
const REPORT_PATH = new URL(
  "../../../docs/research/2026-07-23-f3b-p-f3-1-stepped-floor-probe.md",
  import.meta.url,
).pathname;

const FAIL_CLASSES: FailClass[] = [
  "wedge",
  "ghost-launch",
  "fall-through",
  "blocked",
  "too-steep",
];

const DISPOSITIONS: Record<FailClass, string> = {
  wedge:
    "manual massage (widen the pinch) OR F4 traversal verbs — a mid-passage horizontal catch, not a floor-grade problem.",
  "ghost-launch":
    "collider-bake edge classification (the internal-edge ghost class, explicitly outside the analyzer per the walkability-analyzer entry) — NOT a Task-3 default.",
  "fall-through":
    "manual massage / F4 spawn+reachability validation — a void the capsule dropped into, not a grade the risers failed to carry.",
  blocked:
    "F4 traversal verbs / manual massage — geometry occludes the straight spine; a winding sub-tube the KCC will not thread.",
  "too-steep":
    "Task-3 DEFAULT tuning candidate (MAX_GRADE / verticality profile) — the risers were too steep for the mover at this config. Report to the controller; do NOT tune here.",
};

function renderReport(records: LaneRec[]): string {
  const counts: Record<FailClass, number> = {
    wedge: 0,
    "ghost-launch": 0,
    "fall-through": 0,
    blocked: 0,
    "too-steep": 0,
  };
  const firstRepro: Partial<Record<FailClass, LaneRec>> = {};
  for (const r of records)
    if (!r.outcome.walked) {
      counts[r.outcome.failClass]++;
      firstRepro[r.outcome.failClass] ??= r;
    }

  const passageLanes = records.filter((r) => r.kind === "passage");
  const passageWalked = passageLanes.filter((r) => r.outcome.walked).length;
  const composites = records.filter((r) => r.kind === "composite");
  const compositeWalked = composites.filter((r) => r.outcome.walked).length;

  const matrixRows = CONFIGS.map((cfg) => {
    const mine = records.filter((r) => r.cfg.name === cfg.name);
    const p = mine.filter((r) => r.kind === "passage");
    const pw = p.filter((r) => r.outcome.walked).length;
    const comp = mine.find((r) => r.kind === "composite");
    const compTxt = comp
      ? comp.outcome.walked
        ? "yes"
        : `no (${(comp.outcome as { failClass: FailClass }).failClass})`
      : "n/a";
    return `| ${cfg.theme} | ${cfg.verticality} | ${cfg.seed} | ${pw}/${p.length} | ${compTxt} |`;
  }).join("\n");

  const classRows = FAIL_CLASSES.map((k) => {
    const repro = firstRepro[k];
    const reproTxt = repro
      ? `seed ${repro.cfg.seed}, ${repro.cfg.theme}, v${repro.cfg.verticality}, ${repro.kind} lane ${repro.index}, segment ${(repro.outcome as { segment: number }).segment}`
      : "—";
    return `| \`${k}\` | ${counts[k]} | ${reproTxt} |`;
  }).join("\n");

  const present = FAIL_CLASSES.filter((k) => counts[k] > 0);
  const envelope =
    `SN-skinned 0.25 m risers carry the capsule in ${passageWalked}/${passageLanes.length} ` +
    `per-passage lanes and ${compositeWalked}/${composites.length} composite mouth→deepest ` +
    `lanes across the ${CONFIGS.length}-config matrix. ` +
    (present.length === 0
      ? "Every lane walked cleanly — the strong-envelope outcome: the stepped-floor premise (P-F3-1) holds unconditionally on this matrix."
      : `Failure classes present: ${present.map((k) => `\`${k}\``).join(", ")}.`);

  const dispositionRows = present.length
    ? present
        .map((k) => `- **\`${k}\`** (${counts[k]}): ${DISPOSITIONS[k]}`)
        .join("\n")
    : "- None — no lane failed, so nothing is routed. The premise holds.";

  return `# F3b P-F3-1 probe — the stepped-floor capsule fuzz-walk

*Generated by \`packages/dungeon/tests/field-cave-walk.gpu.test.ts\` (F3b Task 4). A COMMITTED
deliverable feeding F4's analyzer corpus. Per D-F3-11 this probe RECORDS failure classes — it
does not repair them; there is no search / retry / repair loop.*

## What this measures (P-F3-1)

Do the cave generator's SN-skinned, quantized **0.25 m stepped floors carry the walk capsule**
(\`{halfHeight:0.6, radius:0.3}\`)? Each config is carved into a field store, baked (v2 field
artifact), loaded through the REAL \`loadWorld\` (per-chunk shell voxel colliders — the same
collision the game uses), and walked with the real \`CharacterMover\` via \`runWalk\`. Lanes are
derived from the skeleton: one per passage (walked waypoint-to-waypoint) plus one composite
mouth→deepest-chamber lane per config. The mover's built-in step-up is the riser test;
\`MAX_FRAME_RISE\` 0.55 m is the ghost-launch guard.

**Premise gate:** \`STEP_HEIGHT\` = ${STEP_HEIGHT} m ≥ one riser (${RISER} m) + skin margin
(${SKIN_MARGIN} m) = ${(RISER + SKIN_MARGIN).toFixed(2)} m. The stepped-floor premise is
TESTABLE (a single riser fits under the mover's step-up).

## Config matrix

Fixed: extent ${EXTENT.join("×")} m, 3 chambers, radius 5 m, 1 extra loop, north mouth.

**Topology note (F4: do NOT over-count diversity).** \`theme\` selects only the SN carve SKIN —
it never reaches \`buildCaveSkeleton\`, so these 12 configs are **4 distinct passage LAYOUTS**
(2 verticality × 2 seeds) × 3 carve skins. For a given (verticality, seed) the walk LANES are
identical across themes; only the carved collider surface differs. So the 48 passage walks
cover 4 topologies, not 12 — the theme axis probes skin-vs-collision, not layout.

| theme | verticality | seed | passages walked | composite walked |
|---|---|---|---|---|
${matrixRows}

## Per-class failure counts (all ${records.length} lanes)

| class | count | first reproduction (seed · theme · verticality · lane · segment) |
|---|---|---|
${classRows}

## Envelope statement

${envelope}

## Systemic-collapse tripwire

Composite mouth→deepest lanes walked on **${compositeWalked} of ${composites.length}** configs
(threshold: ≥ ${Math.ceil(CONFIGS.length / 2)} = half). ${
    compositeWalked >= Math.ceil(CONFIGS.length / 2)
      ? "Above the tripwire — no systemic collapse; the stepped floors carry the through-lane."
      : "**BELOW the tripwire — SYSTEMIC COLLAPSE.** Per D-F3-11 the only permitted response is to tune Task 3's MAX_GRADE / verticality profile DEFAULTS (the controller's call), never to add repair/search here."
  }

## Dispositions (D-F3-11)

Failure classes are routed, never repaired in this task:

${dispositionRows}

## Reproduction

\`bun test packages/dungeon/tests/field-cave-walk.gpu.test.ts\` regenerates this report from the
actual run (the cave is Pr-2-deterministic and the walk is deterministic, so the numbers are
stable). Each row's reproduction recipe names the seed, theme, verticality, lane, and segment
that first exhibits the class.
`;
}

// ─── the probe ───
describe("field cave walk — P-F3-1 stepped-floor probe", () => {
  test("premise gate: STEP_HEIGHT clears one riser + skin margin", () => {
    // If this fails the stepped-floor premise is UNTESTABLE (one riser won't fit under the
    // step-up) — that is a finding to report, not something to fudge. It holds: 0.4 ≥ 0.30.
    expect(STEP_HEIGHT).toBeGreaterThanOrEqual(RISER + SKIN_MARGIN);
  });

  test("fixture validity: a default cave carves air chambers inside rock", () => {
    // The F0 lesson — a probe over a broken fixture reports garbage. Re-run Task 3's carved-
    // output shape (air at chamber centres, rock present) against THIS fixture build.
    const store = createFieldStore();
    const log = createOpLog();
    const params = fullParams({});
    commitGenerator(store, log, CAVE, {
      params,
      seed: 1,
      region: REGION,
      policy: "replace",
      table: BUILTIN_TABLE,
    });
    const sk = buildCaveSkeleton(params, 1, EXTENT);
    for (const c of sk.chambers) {
      const fy = chamberFloorY(c);
      expect(dAt(store, c.center[0], fy + 1.0, c.center[2])).toBeGreaterThan(0);
    }
    // Sample bounds are the region in SAMPLES (world / RISER), derived so they track EXTENT.
    const [nx, ny, nz] = EXTENT.map((e) => Math.round(e / RISER)) as [
      number,
      number,
      number,
    ];
    const SCAN_STRIDE = 8; // coarse subsample — an air/rock census, not an exhaustive scan
    let rock = 0;
    let total = 0;
    for (let sx = 1; sx < nx; sx += SCAN_STRIDE)
      for (let sy = 1; sy < ny; sy += SCAN_STRIDE)
        for (let sz = 1; sz < nz; sz += SCAN_STRIDE) {
          total++;
          if (getDensity(store, sx, sy, sz) < 0) rock++;
        }
    expect(rock).toBeGreaterThan(0); // rock exists (teeth: an empty store trips this)
    expect(rock).toBeLessThan(total); // and air exists — a real cave, not a solid block
  });

  test.skipIf(!bunWebGpuAvailable())(
    "classifier teeth + no-leak invariant: an into-rock lane is RECORDED walked:false, and a clean lane on the SAME world still walks",
    async () => {
      // Proves two things the clean matrix never exercises: (1) the catch→classifyThrow→bucket
      // path actually runs (an unwalkable lane is recorded, not silently passed), and (2)
      // `runWalk` does NOT leak its capsule on throw — a leaked phantom would block the clean
      // lane driven next on the SAME world. Sabotage-verified: reverting runWalk's finally
      // turns the clean-lane assertion RED (the phantom blocks the mouth spawn).
      const cfg: Cfg = {
        theme: "mined",
        verticality: 0.75,
        seed: 1,
        name: "cave-probe-teeth",
        params: fullParams({ theme: "mined", verticality: 0.75 }),
      };
      await withLoadedCave(cfg, (ctx, world, sk) => {
        const composite = buildCompositePoly(sk);
        expect(composite).not.toBeNull();

        // Throwing lane: from the mouth, straight OUTWARD (away from the region centre) into
        // the boundary rock — the mover cannot advance, so a per-frame guard throws and the
        // classifier buckets it. This leaves a phantom AT the mouth without the finally.
        const mouth = (sk.mouths[0] as CaveMouth).at;
        const ox = mouth[0] - EXTENT[0] / 2;
        const oz = mouth[2] - EXTENT[2] / 2;
        const olen = Math.sqrt(ox * ox + oz * oz) || 1;
        const outward: Vec3 = [
          mouth[0] + (ox / olen) * 5,
          mouth[1],
          mouth[2] + (oz / olen) * 5,
        ];
        const thrown = walkLane(ctx, world, [mouth, outward]);
        expect(thrown.walked).toBe(false);
        if (!thrown.walked) expect(FAIL_CLASSES).toContain(thrown.failClass);

        // Clean lane on the SAME world: the composite (spawns at the mouth). It walks with the
        // finally in place; it is BLOCKED by the leaked phantom without it — this assertion is
        // the leak guard.
        const clean = walkLane(ctx, world, composite as Vec3[]);
        expect(clean.walked).toBe(true);
      });
    },
    60_000,
  );

  test.skipIf(!bunWebGpuAvailable())(
    "stepped-floor capsule fuzz-walk matrix (deliverable, not blocker)",
    async () => {
      const records: LaneRec[] = [];
      for (const cfg of CONFIGS) records.push(...(await walkConfig(cfg)));

      // Write the committed report FIRST — it must exist even if the tripwire fires below.
      const report = renderReport(records);
      await Bun.write(REPORT_PATH, report);

      // (c) the report file is written.
      expect(await Bun.file(REPORT_PATH).exists()).toBe(true);

      // (b) THE TRIPWIRE — the composite mouth→deepest lane walks on >= half the configs.
      // Below half is systemic collapse: the ONLY response is the controller tuning Task 3's
      // profile/grade DEFAULTS (never repair/search here). Individual lane failures above are
      // DATA, recorded in the report, deliberately NOT asserted.
      const composites = records.filter((r) => r.kind === "composite");
      const compositeWalked = composites.filter((r) => r.outcome.walked).length;
      expect(compositeWalked).toBeGreaterThanOrEqual(
        Math.ceil(CONFIGS.length / 2),
      );
    },
    300_000, // the 12-config × ~260-lane matrix runs the real mover headlessly — well over 5 s
  );
});
