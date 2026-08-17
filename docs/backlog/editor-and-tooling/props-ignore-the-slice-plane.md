---
summary: `setSlice` clips the field and the kit but not the props, the stamp ghost or the void cast — three display layers that disagree with the slice, and the cull rule is a design decision landing on the slider's hot path
---

# Placed props ignore the slice plane — they draw full-height over a sliced field

**Context.** F3b Task 10 added the editor's committed prop layer (`rebuildProps` in
`packages/editor/src/field-host/field-props.ts`), gated by the `props` layer flag alone.
`setSlice(y)` clips the FIELD and the KIT by re-meshing every chunk through the worker's
apron clamp (samples at/above the plane read as air), and it makes every gesture raycast
slice-coherent. Props get none of that: turn the slice on and the cave's floor is cut away
while its rocks and stalagmites still hover at full height over the cut.

The stamp GHOST has the same v0 gap and it is already documented as deliberate
(`applyStampGhost`: "the stamp ghost renders FULL-HEIGHT even over a sliced field").

**Third instance, F3b Task 12 — the void cast.** `requestVoidCast` sends the worker no
`sliceY`, so the X-ray casts the whole air volume and draws it with `compare: "always"`;
enable both and the cast paints over the cut the slice just made. Unlike the props, the
right answer here is not obviously "clip it": an X-ray that ignores the slice is arguably
what an X-ray is for. It joins the list because whatever rule the other two settle on has
to say something about this one, and because the three of them are now the whole set of
display layers that disagree with the slice.

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
committed layer disagree with each other). The void cast rides along on whichever fires.

**Reference:** `packages/editor/src/field-host/field-render.ts` (`renderScene`'s `props`
gate — now there); `packages/editor/src/field-host/field-host.ts` (`setSlice`);
`packages/editor/src/field-host/field-machine.ts` (`applyStampGhost`'s existing
full-height note — now there);
`packages/editor/src/field-host/field-protocol.ts` (`sliceAprons` — how the field is
actually clipped); `docs/reference/editor-architecture.md` §16 (Layers + slice) and §18
(the prop layer).
