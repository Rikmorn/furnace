# Orthographic camera fit policy on resize

Tranche A introduced `camera.bindToCanvas(cam, ctx)` + `camera.updateForSize`
with a polymorphic dispatch. For orthographic cameras the dispatch is currently
a no-op — the helper accepts the camera but doesn't update bounds.

This entry tracks the design + implementation of a configurable orthographic
fit policy that fills that branch.

## Discovered context

`camera.setAspect(cam, aspect)` ALREADY handles orthographic cameras today
(`packages/core/src/camera/common.ts:27-42`) — it preserves the vertical range
and recomputes horizontal range centered at zero (`left = -horizontalRange/2,
right = horizontalRange/2`). This is an opinionated hardcoded
"centered-preserve-height" policy. For asymmetric ortho cameras (e.g.,
`{left: 0, right: 10, bottom: 0, top: 6}`) it silently re-centers bounds in a
surprising way.

The A-2 design needs to decide:
- Whether to make this existing behaviour one named policy among several
  (e.g., `centered-preserve-height`) and keep it as the `setAspect` default, OR
- Refactor it out — `setAspect` becomes perspective-only, and orthographic
  resize routes exclusively through the new `fitPolicy` mechanism, OR
- Keep both surfaces working but emit a warning when `setAspect` is called on
  an asymmetric orthographic camera.

## Design questions

- **Which policies to ship in first wave?** Candidates: `stretch` (preserve
  current bounds, distort on resize), `preserve-height` (keep top/bottom,
  recompute left/right with policy for centered vs left-anchored vs etc.),
  `preserve-width` (mirror), `contain` (longer axis preserved), `cover`
  (shorter axis preserved), `fixed-units-visible` (target world-height,
  recompute everything). Probably start with 2: `stretch` + `preserve-height`
  (or whatever the chosen interaction is with the existing setAspect
  behaviour).
- **Reference-state model.** Camera-stored `referenceBounds` at create (with
  `setBounds` updating both current AND reference) vs. an explicit
  `referenceHeight` / `referenceWidth` field replacing `bounds`. Trade-off:
  non-breaking opt-in vs cleaner conceptual model.
- **Default behaviour.** If `fitPolicy` is omitted, what happens on
  `bindToCanvas` resize for an orthographic camera? Likely `stretch` (matches
  the current Tranche A no-op behaviour, non-breaking).
- **API surface.** `fitPolicy?: FitPolicy` on `OrthographicOptions` at create,
  plus a `camera.setFitPolicy(cam, policy)` mutator?
- **Asymmetric-bounds story.** How are policies defined for asymmetric
  bounds? (Anchored at left/bottom? Centered? Per-policy choice?)

## Verification target

The cookbook `camera` demo's orthographic path. Today the demo manages its
orthographic camera's bounds per-frame from `state.zoom × current canvas
aspect`. After A-2 lands, the demo should be able to enable a fit policy
(via the new option) and remove the per-frame manual setBounds call (or keep
it for the zoom slider).

**Trigger to revisit:** Tranche A is complete (this tranche). A-2 is the next
camera-focused session.

**Reference:** `docs/backlog/_AUDIT-2026-05-26.md` §9.6;
`docs/superpowers/specs/2026-05-26-tranche-a-quick-wins-design.md` §3;
existing implementation in `packages/core/src/camera/common.ts:27-42`
(setAspect's hardcoded orthographic policy);
research synthesis: bevy `CameraProjection::update` + `ScalingMode`,
Babylon issue #324 (broken orthographic resize helper).
