# `camera-control.ts`'s orbit family has no caller

**RESOLVED — both halves. Kept only until the F4.5 seal's prune (F4.5b Task 14
disposes of it); nothing here is still open.**

**Gizmo half (F4.5b Task 5, 2026-07-31): `viewport-host/gizmo.ts` is PROMOTED.**
The trigger below fired the way the "keep it" case predicted — F4.5b chartered
entity manipulation, and the field host's translate gizmo now calls `pickAxis`,
`closestPointParamOnAxis`, `isViewParallel`, `gizmoSpan` and `axisLines`. The
module gained the handle GEOMETRY at the same time (span derivation + the line
batch), so the drawn arm and the pickable arm come from one derivation, plus an
`innerLen` dead zone at the origin. `field-move.ts` and `field-host.ts` both
import it; it is still deliberately not re-exported from `viewport-host/index.ts`
(the chrome has no business with handle math).

**Camera half (F4.5b Task 6, 2026-07-31): SPLIT — and not the way the plan
guessed.**

- **DELETED: `orbit`, `zoom`, `pan`, `fromEyeTarget`**, with the `MIN_DISTANCE` /
  `ZOOM_SCALE` constants and their test cases.
- **PROMOTED: `dolly`** — the wheel under the `pointer` tool travels the camera,
  that tool having no brush radius to size. Every other arming keeps the radius.
- **ADDED, each with a caller in the same commit: `orbitAbout`, `frameBox`,
  `axisView`** — right-drag orbit about the selected entity, `F` frame, and the
  corner triad's six snap views.

`orbit` was deleted rather than promoted because **`orbitAbout(s, pivot, …)`
subsumes it**: pass the state's own target as the pivot and it reduces to exactly
`orbit`'s "bump yaw/pitch, leave the target alone", so keeping both would be two
spellings of one thing. `fromEyeTarget` briefly looked like a promotion — it is
exactly the tool for re-pivoting the rig on the selection while holding the eye
still — until that SHAPE was rejected on its own merits: it snaps the view to face
the selection on every right-button press, and with `pointer` armed by default
that press is the editor's primary navigation gesture. `orbitAbout` holds the
pivot at the pixel it is already on and costs nothing at press time.

The counter-argument this entry recorded held up: `lib/theme.ts` was kept for a
whole slice on "a later slice will want it" reasoning, was never wanted, and was
deleted. Of the five camera orphans, one was wanted as written, one was wanted in
a different shape, and three were not wanted at all. **Test-only-consumed code is
a standing claim about the future, and here the claim was 20% right.**

**Reference:** `packages/editor/src/viewport-host/camera-control.ts` (the module as
it now stands — every export has a caller); `packages/editor/src/viewport-host/gizmo.ts`
(the promoted half); `docs/reference/editor-architecture.md` §11 (the banner
recording both promotions) and §20.5 (the pose seam, and the triad that is now a
control).
