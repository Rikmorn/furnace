# The CAMERA's own position is still unreadable, and there is still no go-to-coordinates

Filed at the T4c gate walk (2026-08-11) — the user's own finding, live. **Narrowed at
foundations T5 (2026-08-11): the bar now says where the SELECTION is; the camera's own
pivot and the go-to affordance are what remain.**

## What shipped

`packages/editor/src/frontend/components/shell/StatusBar.tsx`'s selection chip carries a
world-space location: the selection box's centre on the bar (`sel 240 cells · at 5.5 12.8
13.5`, one decimal, also in the chip's accessible name) and the per-axis extents in its
popover, in the phrasing the agent's own answers use (`x 4.0 – 7.0`). Same axes and metres
`session_query` reports — for `about: "selection"` it is literally this box — so a number
read off the bar and a number in an agent's answer are comparable without conversion.
Pinned in `packages/editor/tests/chrome/shell.test.tsx`.

## What is left, and why each was not taken

**The CAMERA's own pivot.** This is what the entry originally asked for, and the chrome
cannot see it. `CameraPose` — the only camera fact on the `FieldHost` surface — is
`{yaw, pitch}`, orientation only. `CameraRig.orbit()` does carry the pivot and is
deliberately NOT a `FieldHost` member: its docblock refuses widening the pose because that
shape is published on the wire as `SessionState.camera`, and the chrome's pose latch has a
value-equality guard specifically so a move that changes only the TARGET does not re-render
the overlay at frame rate. So this rung needs either a new host seam or a wire-format
change, and it wants the re-render budget answered first. The selection box is the nearest
honest stand-in and is nearer than it sounds — `generate` defaults its region to exactly
that box, and `view.frame` pivots to exactly its centre whenever no entity is selected
(`frameTargetBox` prefers a selected entity's footprint, then falls back to the same
`selectionAabb`) — but it is a stand-in, and it is absent whenever nothing is selected.

**A go-to affordance ("go to x y z").** Read against `CommandPalette.tsx` at T5 and left
here rather than taken. Two blockers, either alone sufficient: (1) the palette is a VIEW —
"every label is `def.label(ctx)`, every refusal is `controlVerdict`", and a row that parsed
free-text coordinates out of the search input would be the D-12 violation that file exists
to make obvious; (2) no host verb moves the camera to a world POINT. `frameChunks` takes
`ChunkKey[]`, and `shared/` exposes no chunk or voxel size, so the chrome cannot even
derive one — `frameSelection` / `frameWorld` / `snapView` take no target at all. This needs
a `FieldHost` member first, then a home for the verb that is not the palette's row list.

**A minimap.** A design pass, not this entry.

## Trigger to revisit

The first pass that opens the `FieldHost` camera surface (either rung needs it), or the
next editor-UX pass — whichever first.

## Reference

- `packages/editor/src/frontend/components/shell/StatusBar.tsx` (`centreOf` holds the
  argument, including what the bar deliberately cannot say);
  `packages/editor/src/field-host/field-camera-rig.ts` (`orbit()`'s docblock refuses the
  pose widening). `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md`.
