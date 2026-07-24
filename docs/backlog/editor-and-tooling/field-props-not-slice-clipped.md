# Placed props ignore the slice plane — they draw full-height over a sliced field

**Context.** F3b Task 10 added the editor's committed prop layer (`rebuildProps` in
`packages/editor/src/viewport-host/field-host.ts`), gated by the `props` layer flag alone.
`setSlice(y)` clips the FIELD and the KIT by re-meshing every chunk through the worker's
apron clamp (samples at/above the plane read as air), and it makes every gesture raycast
slice-coherent. Props get none of that: turn the slice on and the cave's floor is cut away
while its rocks and stalagmites still hover at full height over the cut.

The stamp GHOST has the same v0 gap and it is already documented as deliberate
(`applyStampGhost`: "the stamp ghost renders FULL-HEIGHT even over a sliced field").

This did NOT qualify for the AGENTS.md inline-fix threshold, on two of its four conditions:

- **It needs a design decision.** The field's slice is a geometric clamp; a prop has no
  geometry the editor owns (it is a proxy primitive, and eventually a `.fmesh`). The
  candidate rules are cull-whole-prop-by-anchor-Y, cull-by-AABB-overlap, or a real
  per-instance clip in the shader — visibly different answers for a prop straddling the
  plane, which is the common case for a floor scatter under a floor-height slice.
- **It is not a small change.** Instanced draws have a fixed count set at creation, so a
  cull rule means rebuilding the whole layer on every slice-slider tick (the slider is a
  drag), or splitting the layer into per-slice partitions, or moving the decision into the
  shader. Each of those is a different cost profile, and the slider is a hot path.

**Trigger to revisit:** the F3b Safari gate, if slicing a props world reads as broken
rather than as a known display gap; OR whenever the stamp ghost's identical full-height gap
is closed (the two want the same answer, and closing one alone would make the ghost and the
committed layer disagree with each other).

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`renderScene`'s `props`
gate; `setSlice`; `applyStampGhost`'s existing full-height note);
`packages/editor/src/frontend/lib/field-protocol.ts` (`sliceAprons` — how the field is
actually clipped); `docs/reference/editor-architecture.md` §16 (Layers + slice) and §18
(the prop layer).
