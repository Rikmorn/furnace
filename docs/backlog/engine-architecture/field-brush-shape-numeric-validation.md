# Brush shape numerics are unvalidated for sphere and box

**Context.** `assertOpValid` (`packages/core/src/field/ops.ts`) validates a CAPSULE
shape's numbers — finite endpoints, a finite positive radius — because F3b's segment
brush builds them from two independent screen-space raycasts. A sphere's `radius` and a
box's `center`/`halfExtents` get no such check, and the two failure modes were MEASURED
on `applyOp` while adding the capsule leg:

- **NaN** anywhere in the shape makes `opSampleBounds` NaN, so the sample loop's
  `z <= z1` is false immediately: the op enters the log, burns an id, pushes an undo
  entry and writes nothing. A ⌘Z that visibly does nothing — the same defect class
  `assertPatchValid`'s "a mutation verb must actually mutate" rule already rejects for
  patches (measured: `dirty.size` 0 in 0.4 ms).
- **Infinity** in a radius/extent makes those bounds ±Infinity, and `z++` off −Infinity
  never advances. `applyOp` was still running at an 8 s cutoff — an unbounded hang, on
  the main thread in the editor.

Neither is reachable from today's editor gestures for sphere/box (the brush radius is
clamped to `[0.25, 4]` and the kit box derives from it), so this is hygiene rather than a
live bug. The natural shape of the fix is one `assertShapeValid(shape)` covering all
three members, replacing the capsule-only leg — deliberately NOT done inline in the F3b
task, because widening validation on two shapes that every existing generator, test
fixture and baked world already emits is a change with its own blast radius.

Note the SECOND gap, which the fix above does not close: `parseOps` checks only closed
STRING unions, so a corrupt or hostile oplog carrying a NaN/Infinity shape reaches
`applyOp` without ever passing `assertOpValid` (loaded ops go straight into `log.ops`).
Numeric validation at the parse boundary is the same deferred decision `core-modules.md`
records for every other numeric field.

**Trigger to revisit:** a shape whose numbers come from an untrusted or computed source —
an LLM op stream, a plugin generator, an imported oplog — or the first report of an
editor freeze during a brush stroke.

**Reference:** `assertCapsuleValid` + `opSampleBounds` in
`packages/core/src/field/ops.ts`; `parseOps`' checked/not-checked line in
`docs/reference/core-modules.md` (`@furnace/core/field` → artifact); the analogous
setup-loud stances in `assertPatchValid` and `assertPlacementsValid`.
