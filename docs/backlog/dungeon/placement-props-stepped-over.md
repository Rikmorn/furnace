# Scatter-sized placement props are stepped over, not blocked

Surfaced building the F3b Task 8 placement walk-gate (`packages/dungeon/tests/field-placements.gpu.test.ts`). The placement loader derives each prop's static collider correctly from the catalog (`field-world.ts` `placementCollider`), but the collider is centred at the prop's surface-projection point (the scatter record's `position`), so a prop sits HALF-BURIED: its above-floor collider extent is only the box half-height (catalog rock `halfExtents.y = 0.35`, so `0.35 × scale`).

The `CharacterMover` (`char-move.ts`) climbs short obstacles via its `STEP_HEIGHT` (0.4 m) step-up plus the `applyGravity` rim-ride (rests on the highest support under the capsule footprint). Measured with the real mover: a box rising `≤ ~0.56 m` above the floor is CLIMBED (the capsule ends up on top and walks over); a box rising `≥ ~0.77 m` reliably BLOCKS. Scatter's rock `scaleRange` is `[0.6, 1.6]`, giving above-floor collider heights of `0.21–0.56 m` — the entire realistic range lands in the "stepped over" band. So scatter props RENDER but do not reliably block the player; the Task 8 walk-gate had to author a deliberately large rock (scale 2.5, above-floor 0.875 m) to prove the collider blocks at all.

This is not a loader bug — the collider is derived faithfully — it is a mover/prop-size interaction. It means the F3b "props collide" goal only holds for large props at scatter's authored sizes.

Options to weigh (a design decision, not an inline fix):
- Raise prop colliders to sit ON the surface (collider bottom at `position.y`) rather than centred — gives the full mesh height as blocking extent, at the cost of a collider that no longer matches the half-buried visual.
- Suppress the mover's step-up / rim-ride against entity (non-field) colliders, so any prop collider blocks regardless of height.
- Accept small props as decorative-only (walkable-over) and reserve blocking for large props — document the size threshold.

**Trigger to revisit:** F4 traversal/interaction pass, or the first time a design calls for player-blocking scatter props at their authored sizes. Related rim-ride items: `organic-cave-mouth-offaxis-rimride.md`, `charmover-stepup-into-low-ceiling-guard.md`.

**Reference:** `packages/dungeon/src/char-move.ts` (`resolve` step-up + `applyGravity` rim-ride); `packages/dungeon/tests/field-placements.gpu.test.ts` (the collide test's large-rock comment records the measured 0.56/0.77 climb threshold).
