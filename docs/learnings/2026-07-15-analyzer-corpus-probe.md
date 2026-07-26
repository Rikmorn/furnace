# F0 — hybrid walkability analyzer corpus probe (2026-07-15)

Charter premise P1. Design under test: column flags (stage 1) + real-mover swept
probes (stage 2), per the analyzer requirements — then a `docs/backlog/` entry, absorbed
at F4 into `docs/reference/dungeon-architecture.md` §3 "The walkability analyzer".
Code lives in `packages/dungeon/scripts/analyzer-probe/{occupancy,column-pass,fixtures,sweep}.ts`,
gated by `packages/dungeon/tests/analyzer-probe.{test,gpu.test}.ts`. Known-bad corpus
sealed at commit `8fd0694`; known-good `DEFAULT_WORLD` run at `35c5437`.

## Verdict

On the **strict miss-rate gate — false negatives — the hybrid PASSES: zero misses on
the known-bad corpus.** Every fixture that provably traps the real `CharacterMover` was
flagged by stage 1 and confirmed a trap by stage 2, and the one blind spot found
mid-probe (the `stepCells + 2` ledge cap) was closed. That is the P1 stop condition, and
it is met on the corpus.

**But the PASS does not carry the weight the charter needs, for two independent reasons.**

1. **The corpus is materially weaker than the requirements list.** Two of the four
   specified trap classes do not reproduce against the *current* mover — including the
   sub-step-height two-contact wedge that was the precedent research's entire
   justification for stage 2 existing. The corpus substituted geometry that does trap, so
   "zero misses" is a statement about a corpus that no longer covers the class stage 2 was
   built to catch.

2. **On the shipped, hand-walked `DEFAULT_WORLD` the false-positive load is severe and the
   specified gate does not hold.** Stage 1 raises **540 flags**; stage 2 confirms **32
   traps** raw (10 residual after a reachability filter); **246** flags stay inconclusive.
   Every one of the 32 is a harness artifact — zero genuine latent traps, independently
   walked — but the brief's gate `expect(confirmedTraps).toEqual([])` was **reframed to
   miss-safe characterization assertions, not passed**, and no miss-safe automatic filter
   drives the residual to zero without risking a real-trap miss.

**Net engineering verdict: the analyzer as specified is NOT ready to gate F4 on its own.**
The miss-rate is good; the affordability and self-certification are not. Per the backlog's
fallback ladder, the miss does not point *down* to the offline exhaustive flood-fill or a
physics-engine upgrade — those rungs sit below the problem. It points *up*: F4 must add
**capsule-aware navigability semantics — fall-aware reachability, spawn validation, and
seam adjacency across body boundaries — before the hybrid can self-certify a world.** The
authoritative "is this world walkable" instrument remains `world-traversal.gpu.test.ts`;
the hybrid is, today, a false-positive-heavy advisor, not a gate.

## Known-bad corpus (fixture validity first: every fixture traps the real mover)

A fixture only counts as known-bad because the real mover demonstrably fails there
(Walk-Monster fidelity: test the code, not the data). Each is walked twice in
`analyzer-probe.gpu.test.ts` — a CONTROL walk (hazard removed, must reach `clearAlong`
with the no-stall assert armed) and a HAZARD walk (must not pass `hazardAlong`) — so a
"trap" is a genuine stall, not a short room, a bad spawn, or an exhausted budget.

Final tuned geometry constants (`fixtures.ts`):
`RIM_H=0.75, RIM_W=5.5 (=CORRIDOR_HX), POCKET_W=2.0, POCKET_D=0.75, GAP=0.5,
HEADROOM=1.5, RISE=0.25`. Collider lattice `FIXTURE_VOXEL_SIZE=[0.5, 0.25, 0.5]` (the
production cave voxel size). Flag kinds are `lip-near-wall | ledge | low-clearance |
narrow`.

Stage-1 flags by kind → stage-2 outcomes (trap / clear / inconclusive; levitating lanes):

| Fixture (class) | Primary flag | Flags (by kind) | trap | clear | inconcl | levit lanes |
|---|---|---|---|---|---|---|
| carved-rim (carved-rim-wedge) | `ledge` | 14 (ledge 8, narrow 6) | 10 | 0 | 4 | 0 |
| floor-pocket (sub-capsule-pocket) | `ledge` (pit floor) | 24 (ledge 16, narrow 8) | 20 | 0 | 4 | 4 |
| slab-pinch (tight-corner) | `narrow` | 10 (narrow 10) | 2 | 0 | 8 | 0 |
| low-portal (lintel-clip) | `low-clearance` | 18 (narrow 8, lip-near-wall 6, low-clearance 4) | 4 | 6 | 8 | 0 |

Regression fixtures (added after the blind-spot fix — see below), each `ledge`-driven and
each 0.25 m taller/deeper than its corpus sibling, so each is strictly HARDER for the mover:

| Fixture | Flags | trap | Before the ledge-cap fix |
|---|---|---|---|
| tall-rim 1.0 m | 14 (ledge 8, narrow 6) | 10 | **0 ledge flags** (blind spot) |
| deep-pit 1.0 m | 24 (ledge 16, narrow 8) | 20 | **0 ledge flags** (blind spot) |

Stage-2 controls (not hazards — they exercise stage 2 itself, which the corpus cannot):

| Control | Flags | Outcome | Why it exists |
|---|---|---|---|
| walkable-ledge 0.5 m (false-positive control) | 12 (ledge 8, narrow 4) | **0 trap, 8 clear** ✅ | stage 2 correctly CLEARS a flag the real mover walks straight up |
| low-headroom 2.0 m (levitation control) | 10 | 0 trap, 0 clear, 10 inconcl, **10 levit lanes** | the shipped rest-sweep bug fires on every lane; the guard refuses to bless any of them |

**Miss count on the corpus: zero.** Every fixture that traps the mover raised at least one
flag and had at least one flag confirmed a trap by stage 2. No false CLEAR was issued
anywhere in the corpus.

## The two non-reproducible classes (the corpus is weaker than the requirements list)

The requirements list four capsule-trap classes. Measuring the *current* mover
(`char-move.ts`) against each, two of them **cannot be reproduced**, and the corpus quietly
substitutes different geometry that does trap:

- **Sub-step-height two-contact wedge — GONE.** The F0 plan's original carved-rim-wedge,
  and the five-lane precedent sweep's headline justification for stage 2 existing at all,
  was "a lip below `STEP_HEIGHT` (0.4) beside a vertical wall." Measured this session, this
  is **always climbed**: `resolve`'s step-up raises the capsule by exactly `STEP_HEIGHT` on
  a stalled slide and re-slides over the lip. Verified at the production lattice and at
  finer lattices, axis-aligned and diagonal, including a 0.25 m lip in a pinched 1.0 m slot
  where the hemisphere can two-contact both lip and jamb (the capsule walked the full length,
  `advanced` 5.12, resting on the lip). **The corpus's `carved-rim` instead implements the
  *backlog's* definition — a lip STRICTLY ABOVE step height — which does trap.** So stage 2's
  original detector role has no surviving target; its demonstrated value is now purely as a
  *filter* (next section).

- **Sub-capsule pocket — GONE.** The backlog's "voids the capsule enters but cannot leave"
  (r 0.3, half-height 0.6) no longer traps: slice 2.2.1's `applyGravity` shapecast-ground
  fix rests the capsule on the highest support under its footprint, bridging any pocket
  narrower than the capsule. Measured: pits up to **1.5 m** wide are crossed (the capsule
  drifts far enough downrange while falling to re-catch the far rim); **2.0 m** is the first
  width that commits to the pit. So `POCKET_W=2.0` is **not a sub-capsule pocket at all** —
  it is a supra-capsule pit, and `POCKET_D=0.75` must exceed `STEP_HEIGHT` for the step-up
  not to climb straight back out.

**What this does to stage 2's justification.** Stage 2 was chartered as a detector of a
class stage 1 structurally cannot see. That class does not exist against this mover. Stage 2
earns its keep here only as a *false-positive filter* — and the single piece of evidence that
it does earn it is the walkable-ledge control (below). If that control regressed, stage 2
would be dead weight on this corpus.

## The ~0.7 m climb ceiling and the false-positive band

The mover's real climb ceiling is **~0.7 m, not `STEP_HEIGHT` 0.4.** Measured cutoff on the
0.25 m Y lattice: 0.60 m and 0.65 m rims are climbed; **0.70 m and above stall.** Mechanism:
`slideHorizontal` reassigns `move` from `clipVelocity`, and against a rim's top *edge* that
normal is diagonal, so the raised capsule slides UP and over the edge — but only while the
edge sits below the raised capsule's bottom-sphere centre (`pos.y + STEP_HEIGHT −
halfHeight` = 0.7 m). At or above 0.7 m the contact is the rim's flat front FACE, the normal
is `(−1,0,0)`, no Y leaks in, and the capsule stalls. `RIM_H` is 0.75 (first lattice value
clearing that bar), not 0.5, for exactly this reason.

**Consequence: stage 1's `ledge` flag over-flags every rise in the 0.4–0.7 m band** — those
are FALSE POSITIVES (stage 1's threshold is `STEP_HEIGHT`, deliberately tighter than the
controller, but here it is *too* tight). This is why the false-positive control matters: with
stage 2's original detector class gone, the 0.5 m walkable-ledge is the only evidence stage 2
earns its cost. **Stage 2 passed it: all 8 `ledge` flags on the 0.5 m rise were actively
CLEARED** (not merely "not confirmed" — an inconclusive verdict would keep the flag and leave
stage 1's false positive standing). The real mover walks the 0.5 m rise straight up, asserted
independently through the same walk harness the corpus uses.

## The stage-1 ledge blind spot (found + fixed mid-probe)

A **stage-1 MISS class was found and fixed during the probe.** The `ledge` scan originally
capped its neighbour-rise search at `stepCells + 2` (3 cells = 0.75 m). So a rise TALLER than
0.75 m — strictly harder for the mover, which stalls dead at a 1.0 m or 1.5 m rim — matched
nothing and emitted **zero flags**. The corpus's `RIM_H` and `POCKET_D` had both landed
exactly on 0.75 m, so "no misses" was true only by tuning to the last value the cap could see;
one cell more and the analyzer saw nothing. That is precisely the false-negative class this
probe exists to rule out.

**Fix:** bound the rise scan by the air-volume's own **ceiling** (`ceilingAbove`), not by an
arbitrary step multiple — a rise only concerns us if it stands in the air volume the capsule
is standing in; anything above that ceiling is a different volume or rock. The regression
fixtures (`tall-rim 1.0 m`, `deep-pit 1.0 m`) fail against the capped scan and pass against
the fix, which is the only reason they are worth keeping.

**The naive uncapped fix was WRONG and was rejected.** `voxelsFromField` is `shellOnly`:
enclosed rock is dropped, so in this occupancy a wall is HOLLOW — solid exactly where it
borders air, then nothing above. An uncapped scan reads a wall's shell top ("solid below, air
above") as reachable-looking floor metres up and flags a `ledge` on every wall-adjacent cell.
Measured this session: the naive scan produced **182 phantom flags**. The ceiling-bounded scan
excludes them because the shell ends exactly where the air volume does (covered by the
`analyzer-probe.test.ts` "HOLLOW wall is not a ledge" unit test).

## Known-good (DEFAULT_WORLD, runtime colliders captured at load)

The known-good run asks the complementary question on the world people actually walk: does the
hybrid INVENT a trap? Colliders are captured via `spyOn(physics, "createBody")` call-throughs,
so the occupancy analysed is byte-for-byte the collider the runtime built (the 3.1 lesson:
re-derived parity passes while the real thing differs). Six voxel bodies: `hall-a`, `maze-1`,
`hall-b`, `cave-c`, `corridor-1`, `bore-1`.

**Stage-1 flags: 540 total.**

| Kind | Count |
|---|---|
| lip-near-wall | 332 |
| ledge | 116 |
| narrow | 85 |
| low-clearance | 7 |
| **total** | **540** |

Per body: `hall-a` 32, `maze-1` 71, `hall-b` 16, `cave-c` 241, `corridor-1` 44, `bore-1` 136
(sums to 540).

**Stage-2 confirmed traps: 32 raw.** A reachability filter (`reachableWalkable`: floor-connected
flood-fill, `REACH_CLIMB_M=0.75`, `REACH_SEED_BAND_M=1.0`) removes **22** provably-unreachable
phantom shell-top perches → **10 residual**. Reachability-filtered stage 2 also reports **61
clears, 246 inconclusive, 200 levitating lanes.**

**The specified gate does not hold — and was reframed, not faked.** The brief's
`expect(confirmedTraps).toEqual([])` would FAIL here (32 raw, 10 residual). The committed test
consciously replaces it with miss-safe characterization assertions — `flags > 0`, `clears > 0`,
`reachTraps < rawTraps` — and prints the full raw breakdown. **State this plainly: the
zero-confirmed-traps known-good gate was reframed, not passed.** The authoritative "world is
walkable" gate remains `world-traversal.gpu.test.ts`, which passes; this run measures the
analyzer's false-positive load against it.

**All 10 residual confirmed traps are harness artifacts — ZERO genuine latent traps.**
Independently verified this session against full-world real-mover ground truth (spawn on
reachable floor, drive the real `CharacterMover`, observe). By the committed test's THE FINDING
breakdown:

- **`cave-c` ×2, `bore-1` ×1 — drop-off ledges.** Ground truth walks PAST the flag by
  2.8–3.4 m; the sweep picked a bad nudged spawn, one lane stalled, and trap-precedence
  elevated it to a trap verdict.
- **`hall-a` ×4 — a sub-capsule niche** (0.5 m slot < 0.6 m capsule diameter). The real mover
  walking up STALLS 0.48 m *outside* — it cannot enter, so it cannot be trapped; `findSpawn`
  planted the capsule INSIDE geometry (a cell `columnPass` calls walkable by centre), a
  spawn-in-geometry artifact. `narrow` is a true flag; the TRAP verdict is not.
- **`maze-1` ×3 — the maze's outer-boundary seam**, where the shipped levitation bug fires
  (mover rises ~1.25 m instead of walking; `char-move.ts:124-132`).

The levitation bug underlies the `maze-1` ×3 residuals and, depending on how `bore-1`'s
low-clearance lane is attributed, **3–4 of the 10** residuals — consistent with its broad
footprint elsewhere (200 levitating lanes on this world). No miss-safe automatic filter zeroes
the residual: traverse-corroboration would clear a genuine DIRECTIONAL trap (a carved-rim
blocks +x yet walks freely in ±z → a false CLEAR = a MISS), and radius EROSION deletes exactly
the wall-adjacent cells every `narrow`/`lip`/`ledge` hazard lives on (verified: erosion drops
the corpus flags to zero too). Separating these from a real directional trap needs
capsule-aware navigability semantics — F4's job, not a filter bolted on here.

## Per-body frames + the reachability filter's empirical (not structural) miss-safety

Two adaptations were forced by `DEFAULT_WORLD`'s geometry, and both carry real limitations F4
must inherit — stated plainly, not hidden.

- **Per-body local-frame analysis (no merge).** `cave-c` is both off-lattice (x =
  26.380397150479258, not a whole number of 0.5 m cells) AND rotated (`yaw = π`). Verified
  against the loader's own captured `BodyDescriptor.rotation ≈ [0,1,0,0]` (the quaternion for
  yaw π); the geometry is NOT pre-rotated at bake — `createCaveProxyBody` runs the local proxy
  through `placePiece`, which rotates the body POSITION and carries the yaw on the body's
  ROTATION, leaving the voxel coords local. Merging into one grid was rejected (a single lattice
  cannot represent a yawed body's cells; `mergeOccupancies` throws on both conditions). Instead
  each body is analysed in its own local frame and flags are transformed to world through the
  body's real rotation + translation (`occupancyFromProxy` records the descriptor as the
  occupancy's `place`; `cellFloorWorld` / `worldToColumn` cross to world exactly, no resample).
  **Cost — a real limitation, not hidden:** per-body analysis loses adjacency across body /
  region seams. Stage 1's neighbour scans stop at each proxy's own bbox, so a hazard formed by
  two bodies TOGETHER — a rim where a hall's floor meets a bore's, a pinch between a cave wall
  and a corridor — raises no flag and is never swept. On this world that manifested as false
  traps at body boundaries, not missed hazards; but nothing here PROVES the seams are clean.
  (The seams are separately walked by `world-traversal.gpu.test.ts` — different instrument,
  different evidence.) Closing this needs a world-frame resample, which F4 must decide on.

- **The reachability filter is empirically miss-safe FOR THIS WORLD, not miss-safe by
  construction.** Its flood-fill climb allowance (`REACH_CLIMB_M=0.75`) exceeds the mover's real
  climb (~0.70 m), so it errs toward keeping cells connected — the safe direction. But it models
  connectivity **symmetrically and ignores FALLING**: a shelf reachable only by a >0.75 m *fall*,
  sitting >1 m above the body's global-min floor, would be dropped as an unreachable perch even
  though the mover can reach it by walking off an edge. `DEFAULT_WORLD` does not exercise that
  hole — every region it drops is a high shell perch with zero reachable floor stacked above it,
  so the 22-cell removal is sound here. **F4 must NOT treat the filter as sound by construction.**

## Surfaced shipped-code bug: applyGravity levitation (out of F0 scope, filed for the user)

> **RESOLVED 2026-07-15 (pre-gate, branch `one-field-f0-f1`):** headroom-probed lift +
> `REST_GAP` contact offset in `char-move.ts`; repro + regression in
> `tests/char-move-levitation.gpu.test.ts`. The analysis below is the historical record of
> the pre-fix mechanism; the probe's numbers in this report measured the PRE-fix world.

A live gameplay defect was surfaced (outside the F0 charter; filed as task
"SURFACE: char-move.ts levitation bug"). `applyGravity`'s rest sweep
(`char-move.ts:124-132`) lifts the capsule to `pos.y + STEP_HEIGHT` before the down-sweep:

```
position: [pos[0], pos[1] + STEP_HEIGHT, pos[2]], dir: [0, -1, 0]
restY = pos[1] + STEP_HEIGHT - sweep.toi
```

If the lifted pose overlaps rock **in any direction — not just low headroom; it fires laterally
at pit rims too —** `castShape` (which is `stopAtPenetration`, `core/src/physics/query.ts:157`)
returns `toi: 0`. That is read as "ground at the lift height" → `restY = pos.y + STEP_HEIGHT`, so
the capsule **levitates +0.4 m/frame while reporting grounded**. It fires on any walkable floor
with less than `CAPSULE_HEIGHT + STEP_HEIGHT = 2.2 m` of clearance in *some* direction — and
stage 1 calls a floor walkable at 1.8 m, so the sweep spawns capsules into the firing condition
by construction.

This accounts for a large share of the known-good noise (200 levitating lanes; 3–4 of the 10
residual traps) and is the reason the probe carries an explicit two-part levitation guard
(per-frame symptom detection + a lift-free precondition on any CLEAR verdict) so a levitating
walk can never be recorded as a false CLEAR. **It is directly relevant to F1, which digs low
tunnels** — a low tunnel is exactly the sub-2.2 m-clearance floor that triggers it.

## Misses and findings

- **Zero false-negative MISSES on the known-bad corpus.** The one blind-spot class found
  mid-probe (the `stepCells + 2` ledge cap) was closed before seal; regression fixtures guard it.
- **Corpus coverage gap (tight-corner class).** The `slab-pinch` fixture is NOT the backlog's
  "tight-corner mid-turn catch." It is a straight sub-diameter pinch (0.5 m slot < 0.6 m capsule
  diameter) — a `narrow`-flag trap, but not the oblique-join catch the backlog names. The
  mid-turn class was not reproduced: the production 0.5 m XZ lattice cannot even express an
  intermediate 0.55–0.75 m gap (0.55 quantizes to 0.5 or 1.0), so the geometry that would catch
  a capsule mid-turn cannot be built at production resolution. This is a corpus gap F4 inherits.
- **Seam-adjacency limitation.** Per-body analysis is blind to hazards spanning two bodies (see
  above). A real blind spot at every region seam of a multi-body world.
- **The reachability filter's miss-safety is empirical, not structural** (falling ignored; see
  above).

## What F4 inherits

- **Stage 1 as tuned.** The four `columnPass` filters (`lip-near-wall`, `ledge`, `low-clearance`,
  `narrow`) with thresholds strictly tighter than the controller, over the runtime collider's
  own occupancy — plus the ceiling-bounded ledge scan (do NOT revert to `stepCells + 2`; do NOT
  make it uncapped — both are proven-wrong endpoints). The known 0.4–0.7 m `ledge` false-positive
  band is a property F4 must either accept or resolve with a real climb-ceiling threshold.
- **Stage 2's sweep loop.** The per-flag, 4-lane real-mover sweep (`sweep.ts`), its
  trap-precedence miss-safety invariant (a trap in any lane outvotes a clear in another — do NOT
  reorder `verdictOf`), the levitation guard, the `CLEAR_AT_FLAG_CENTRE` bar and the
  `sweepFlags` coarse-lattice precondition. **Repurpose it as a false-positive FILTER, not a
  detector** — its original detector class does not reproduce.
- **The per-class fixture corpus as F4's regression suite** — validity-proven against the real
  mover, and the *only* record of the corpus constants now that the mesh-connector kit's
  single-sourced values are deleted.
- **The affordability estimate.** 540 stage-1 flags, 246 inconclusive, and a ~7-minute per-flag
  world sweep are the false-positive load an incremental / editor-time analyzer must budget
  against. A per-keystroke analyzer cannot run this shape; it is a batch job.
- **The reachability filter — miss-safe only empirically** (falling ignored). Re-derive its
  soundness for any world F4 targets; do not assume it.
- **The levitation-bug dependency.** `char-move.ts:124-132` is a live defect that fires on
  sub-2.2 m-clearance floors. F1 digs low tunnels; F4's analyzer inherits both the noise it
  creates and the guard needed to survive it. Fixing the mover is the clean path; until then the
  guard is load-bearing.
