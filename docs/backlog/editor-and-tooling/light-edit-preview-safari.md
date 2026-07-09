# Light-edit preview: transform-direction bug FIXED; Safari per-property verification pending

**Investigation (Slice 3.2.2 Task 13).** The bug report ("light component edits
don't stick in Safari"; M1 Chrome gate saw intensity work) resolved into TWO
separate questions, answered by a source trace of the host preview path:

- **Transform-derived DIRECTION — was broken UNIVERSALLY, now FIXED.**
  `previewEntity`'s `transform` fast-path (`setEntityTransform`) pokes only mesh
  transforms; a light's direction is transform-derived and refreshed only by
  `rebuildEntity`. So editing a light entity's rotation never previewed its
  direction — in Chrome OR Safari. Fixed by gating the fast-path: light/camera
  entities route through clone+rebuild. Regression-pinned (`transformEditNeedsRebuild`
  predicate test + a host GPU test).

- **INTENSITY / COLOR / TYPE — have a working host preview path (code-verified).**
  These go through clone+rebuild → `rebuildEntity` → `result.lights` refreshed.
  So the seal did NOT fully over-generalize: these DO preview at the host level
  (Chrome-confirmed for intensity).

**Residual Safari-specific unknown (needs the user's Safari gate — not
reproducible without Safari in this session).** If light intensity/color still
"don't stick" in Safari despite the working host path, the failure is in the
inspector→preview/commit event path, most likely the ColorField change-vs-blur
class for light COLOR (the prior `4e22f4f`/`9f8bb41` saga). The Task-1 harness
now pins ColorField's commit-on-native-change / blur-never-commits behavior, so
that class is guarded — but Safari's native `<input type="color">` event timing
is only verifiable in Safari.

**Reproduction matrix to run at the Safari gate (Chrome verify after):** for a
directional light entity, edit each of {intensity (NumberField), color
(ColorField), type (enum Select), rotation (transform → direction)} and record
preview-updates? / commits-and-sticks? in BOTH browsers. Direction should now
preview in both (this fix). If intensity/color fail in Safari only, the fix is
in the inspector event path (ColorField), not the host — file a follow-up.

**Reference:** `packages/editor/src/viewport-host/index.ts` `previewEntity` +
`packages/editor/src/viewport-host/preview-gate.ts` `transformEditNeedsRebuild`;
`packages/core/src/scene/loader.ts` `setEntityTransform`/`rebuildEntity`;
`packages/core/src/scene/builtins.ts` `buildLight`.
