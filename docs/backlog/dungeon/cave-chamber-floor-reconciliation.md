# Cave chambers with unreachable Δy under grade budget — passage vs shared-chamber clamp

**Context.** The F3b cave skeleton (`packages/core/src/field/cave.ts`,
`buildCaveSkeleton`) places chambers at floor heights spread across the region's
Y range (scaled by `verticality`) and connects them with passages under a
per-segment grade budget (`MAX_GRADE = 0.5`, 0.25 m risers, ≥ 0.5 m treads;
D-F3-11 explicit verticality). When two connected chambers are far apart
vertically but close horizontally, the passage becomes a `switchback`, which adds
horizontal run via direction-reversing legs. In a region with enough lateral
room the switchback delivers the full Δy exactly (measured: 0 m endpoint gap for
realistic default/large configs). In an **extreme-aspect-ratio region** (very
tall, very narrow — e.g. a 6×20×6 m box with `verticality: 1`), the lateral
budget cannot fit the legs even at the `MAX_SWITCHBACKS = 4` cap, so the passage
**clamps its own delivered Δy** and lands short of the destination chamber floor
(measured ~3 m short in that box) — a bias, not a guarantee (D-F3-11: report the
gap, never a repair loop).

The clamp is applied to the *passage*, not the chamber, on purpose. Reconciling
by clamping the *chamber* floorY is a **global constraint-satisfaction problem**:
a chamber is shared across multiple passages, so lowering its floor to satisfy one
steep edge can blow the grade budget of another, and cascading clamps across the
whole graph has no obvious deterministic, budget-respecting fixed point. Clamping
the single passage keeps the skeleton local, deterministic, and cheap — at the
cost of a visible floor discontinuity where a clamped passage meets its far
chamber. The residual gap is bounded and TESTED (`field-cave.test.ts` endpoint-
delivery block asserts realistic configs land exactly and over-budget configs
never under-deliver by more than the full intended Δy), so it is a known, visible
limitation rather than a silent geometric disconnect.

**Trigger to revisit.** The F4 walkability pass, OR a Task-4 (P-F3-1) probe
failure class that traces to a chamber-floor discontinuity (a walk lane that
stalls exactly where a clamped switchback meets its chamber). At that point decide
between: (a) a bounded chamber-floor reconciliation pass (respread floors so every
edge fits the grade budget before carving — a constraint solver with its own
budget), (b) rejecting extreme-aspect regions at the generator's schema layer
(setup-loud, Task 3's job), or (c) accepting the discontinuity and papering it in
the carve/mesh (a small ramp/blend at the seam).

**Reference.** Spec D-F3-11 (`docs/superpowers/specs/2026-07-21-epic3-one-field-f3-smart-objects-and-cave-design.md` §2 — bias + probe visibility, never a repair loop); the F3b Task 2 code-quality review finding (switchback endpoint under-delivery); `buildCaveSkeleton`/`CavePassage` TSDoc in `packages/core/src/field/cave.ts`.
