# Editor viewport: four `MIGRATION (until Task 12)` markers are past due

**Context.** `packages/editor/src/viewport-host/` carries four `// MIGRATION (until Task 12):`
markers whose named boundary has long passed — "Task 12" is a task of the **M5B viewport
epic** (sealed), not of any current slice:

- `camera-control.ts:17` — "provisional feel — tune live at the Safari gate"
- `index.ts:266` — "fly/look sensitivities are provisional"
- `index.ts:1003` — "look sensitivity/inversion tuned live at the gate"
- `index.ts:1056` — "trackpad pan/zoom feel verified in Safari at the gate"

All four describe camera-feel constants that were meant to be tuned live at a Safari gate and
then have their markers cleared. The gate happened; the markers did not.

Surfaced by the W4 seal's `grep -rn "MIGRATION (until" packages/` verification step, which
expects no past-due markers. These four are NOT W4-scoped — W4 never touched
`viewport-host/` (`git diff` over the whole W4 branch is empty for that directory) — but they
now make that grep gate ambiguous for every future seal, which is exactly the rot the
MIGRATION convention exists to prevent (`AGENTS.md`: "the grep at the named session boundary
surfaces all comments to revisit").

**Two questions to settle:** are the camera-feel constants actually settled (→ drop the
markers, keep the values), or still provisional (→ re-point the markers at a real, current
trigger)? A marker that names a boundary nobody can find is worse than no marker.

**Trigger to revisit:** the next pass on editor viewport camera feel, OR the next seal whose
`MIGRATION (until` grep must come back clean — whichever lands first.

**Reference:** `packages/editor/src/viewport-host/camera-control.ts`,
`packages/editor/src/viewport-host/index.ts`, `docs/reference/editor-architecture.md` (§M5B
viewport interaction).
