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

**Requirement.** Statically detectable from field geometry + these constants — no
mover simulation. Probe (pre-charter): run over KNOWN-BAD (spike carved patch, 2.2.1
repro shapes) and KNOWN-GOOD (every W2/W3 walked lane); must flag all of the former,
stay quiet on the latter. GPU fuzz-walks remain the backstop. Stop condition: a missed
known wedge → flag-and-fix is unsafe → Jolt returns to the critical path.

**Trigger to revisit:** the field-charter brainstorm (the probe runs BEFORE
chartering).

**Reference:** `docs/research/2026-07-13-one-field-direction.md` (§3, §5),
`packages/dungeon/src/walkability.ts`, `docs/learnings/jolt-mesh-collision-spike.md`.
