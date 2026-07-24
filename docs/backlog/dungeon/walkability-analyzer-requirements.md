# Walkability analyzer — requirements + corpus (the one-field direction's premise 1)

**Context.** `docs/research/2026-07-13-one-field-direction.md` §3 re-positions Jolt off
the critical path via a STATIC walkability analyzer over the field: walkable-column
analysis from the single-sourced `walkability.ts` constants, flagging problems live as
you brush, with a flag-and-fix loop (jump to flag → see it → dig the fix). Its premise
(low false-negatives on the known wedge classes) must be corpus-probed BEFORE the field
charter commits to it. This entry collects the known failure classes — distilled at the
W4 sweep from the retiring wing-era entries — as the analyzer's requirements and probe
corpus.

**Failure classes the analyzer must flag (known-bad corpus):**
- **Carved-rim wedge / lip above step height** — the 2.2.1 rim-riding class + the
  substrate spike's carved-patch wedge (spike P5): floor-adjacent lips > `STEP_HEIGHT`
  0.4 that stall the capsule.
- **Sub-capsule pockets** — voids the capsule (r 0.3, half-height 0.6) enters but
  cannot leave (2.2.1's shapecast-ground fix class).
- **Tight-corner capsule catch** — enclosure inner corners / short dogleg turns at
  oblique joins catching the capsule mid-turn (3.1 gate observation).
- **Interior centerline-obstacle stall** — an obstacle (pillar) on the natural
  door→far-side walking lane; door-lane guards (`validateDoorApproach`) cover the
  door band only, not mid-room paths (pillarHall centerline finding, 2.2.2).
- **Vertical-transition sills** — voxel-quantized floors (0.25 steps) meeting
  built sills at organic thresholds; the worst walk-feel class at the 3.1 gate.
- **Lintel clip at walled low portals** — climbing arrivals into a WALLED low portal
  clip the lintel; walledness is the discriminator, not climb direction (an ascending
  low end is a free-floor departure — landings there create wedges, verified 2.2.5b-B1).

**Empirical constants the analyzer inherits.** These were single-sourced in
`walkability.ts`; W4 deleted the orphaned exports (their readers died with the mesh
connector kit), so the measured values are preserved here — git history is the only
other record:

| Constant | Value | Provenance |
|---|---|---|
| Ramp mount success (GPU-traced) | **47.2°** | Slice 2.2.5b-B1 GPU traces |
| Ramp stall (GPU-traced) | **49.64°** | Slice 2.2.5b-B1 GPU traces |
| `RAMP_MOUNT_LIMIT_RAD` (deleted) | **45°** | safety margin below the 47.2° known-good mount |
| `STEP_MARGIN` (deleted) | **0.05 m** | kept generated step rises strictly below `STEP_HEIGHT` |
| `stepCount(rise)` (deleted) | `ceil(rise / (STEP_HEIGHT − STEP_MARGIN))` = `ceil(rise / 0.35)` | — |
| `STEP_HEIGHT` | **0.4 m** | still in `walkability.ts` |
| Slope stand-on limit | **55°** | still in `walkability.ts` (`SLOPE_LIMIT_COS`) |
| `STAIR_RISE` | one FINE cell (**0.25 m**) | still in `connector-built.ts` |
| Voxel proxy Y-cell | **0.25 m** | chosen below `STEP_HEIGHT`; still in source |

The deleted `RAMP_MOUNT_LIMIT_RAD` TSDoc's rationale, verbatim: *"the steepest ramp the
CharacterMover can climb onto from a FLAT approach … a ramp steeper than the mount limit
is a one-way slope in a walk-verb world (descending arrivals put a flat landing at every
ramp foot, so every ramp gets mounted from flat when walked back up). SLOPE_LIMIT_RAD
(55°) remains the physical stand-on/slide limit only."*

**Requirement (REVISED 2026-07-14 — pure static analysis refuted by precedent
research).** The five-lane precedent sweep
(`docs/research/2026-07-14-field-precedent-research.md`, headline verdict 2) found no
precedent for a pure walkable-column analyzer achieving low false negatives on
capsule-scale traps: sub-cell features are structurally invisible, the column model has
no two-contact wedge concept (a lip below step height beside a steep face passes
Recast's filters by design), and solver artifacts are invisible to any geometric
predicate. The design under test is therefore the **hybrid**:
- Stage 1: walkable-column flags (slope/step/headroom/radius) over the **runtime
  collider geometry** (never the source field), cells well under capsule radius,
  thresholds strictly tighter than the controller's real capability, borderline-within-ε
  flags rather than passes.
- Stage 2: swept-capsule probes **executing the real controller move routine**
  headlessly along flagged floor edges (the UE/Unity nav-link shape; Walk Monster's
  "test the code, not the data"). Donor harnesses: the 2.2.1 GPU fuzz-walker + the Jolt
  spike's headless walker.
- The solver-artifact class (internal-edge ghosting) is owned by collider-bake edge
  classification, explicitly outside the analyzer's contract.

Probe (One Field charter F0): run the hybrid over KNOWN-BAD (spike carved patch, 2.2.1
repro shapes) and KNOWN-GOOD (every W2/W3 walked lane); must flag all of the former,
stay quiet on the latter; the measured miss rate is the gate. GPU fuzz-walks remain the
backstop. Fallback ladder on a miss: exhaustive local flood-fill (Walk-Monster style,
offline) → only if that also misses the bar does a physics-engine upgrade return to the
critical path.

**Trigger to revisit:** One Field phase F0 (chartered 2026-07-14; no F4 "seeing"
commitment predates this probe).

**Reference:** `docs/research/2026-07-13-one-field-direction.md` (§3, §5),
`docs/research/2026-07-14-field-precedent-research.md`,
`packages/dungeon/src/walkability.ts`, `docs/learnings/jolt-mesh-collision-spike.md`,
`docs/research/2026-07-23-f3b-p-f3-1-stepped-floor-probe.md` (the F3b cave stepped-floor
walk corpus, below).

**F3b P-F3-1 corpus exists (2026-07-23):** the cave generator's stepped-floor capsule
fuzz-walk probe now lives at `docs/research/2026-07-23-f3b-p-f3-1-stepped-floor-probe.md` —
a 12-config matrix (3 themes × 2 verticality × 2 seeds) walking the real `CharacterMover`
over baked cave voxel colliders, classifying any failure into
wedge/ghost-launch/fall-through/blocked/too-steep. Harness (regenerates the report):
`packages/dungeon/tests/field-cave-walk.gpu.test.ts`. First run: every lane walked
(48/48 passage, 12/12 composite) — the strong-envelope outcome, no failure classes to
route. Feeds this analyzer's corpus as the cave-side known-good set.

**F0 VERDICT (2026-07-15):** The hybrid records ZERO false-negative misses on the
known-bad corpus (every fixture that traps the real mover is flagged by stage 1 and
confirmed by stage 2) — the P1 stop condition is met on the corpus. BUT 2 of the 4
specified classes are non-reproducible against the current mover (incl. the sub-step-height
two-contact wedge that justified stage 2's existence, always climbed; and sub-capsule
pockets, closed by slice 2.2.1 — the corpus substitutes above-step-height and supra-capsule
geometry that does trap), the mover's real climb ceiling is ~0.7 m not `STEP_HEIGHT` 0.4 (so
`ledge` over-flags the 0.4–0.7 m band), and on the shipped `DEFAULT_WORLD` the false-positive
load is 540 stage-1 flags / 32 confirmed traps (ALL harness artifacts, zero genuine — 22
phantom shell-tops + 10 residual) / 246 inconclusive, with a ~7-minute per-flag world sweep.
The brief's zero-traps known-good gate `expect(confirmedTraps).toEqual([])` was reframed to
miss-safe characterization assertions, NOT passed. A shipped levitation bug was surfaced
(`char-move.ts:124-132` rest sweep + `query.ts:157` stopAtPenetration → +0.4 m/frame while
reporting grounded on sub-2.2 m-clearance floors; filed for the user, and directly relevant
to F1's low tunnels). The hybrid is NOT ready to gate F4 unaided; F4 must add capsule-aware
navigability (fall-aware reachability, spawn validation, seam adjacency) before
self-certification — the offline flood-fill / physics-upgrade rungs sit below that.
See `docs/learnings/2026-07-15-analyzer-corpus-probe.md`.

**Levitation bug RESOLVED (2026-07-15, pre-gate, branch `one-field-f0-f1`):** headroom-probed
lift + `REST_GAP` contact offset in `char-move.ts` (a second latent defect — exact-contact rest
stalling the slide on flat voxel floors — fell out of the same fix). Repro:
`tests/char-move-levitation.gpu.test.ts`. F4 NOTE: the probe's `liftPenetrates` clear-guard is
now over-conservative (sub-2.2 m-clearance poses are holdable post-fix but still never graded
CLEAR) — re-measure the false-positive load against the fixed mover before designing F4's
affordability bar; the pre-fix numbers above overstate it.
