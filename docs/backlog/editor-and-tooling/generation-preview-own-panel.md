# Generation preview should be its own dockview panel, not a viewport takeover

Found at the Slice 3.2.2 editor gate (2026-07-09). The generation cockpit preview renders
on a SECOND canvas that shares the Viewport panel and swaps in via `visibility` when
`state.generationActive` (`packages/editor/src/frontend/components/Viewport.tsx` ~:143–160).
Activating a preview therefore HIDES the scene viewport — "it takes over the viewport tab."
The user wants preview as its own surface so the scene stays visible while previewing.

**Why this isn't a mechanical "add a panel".** The visibility-swap exists for a hard reason
stated in the code: a `display:none` canvas has zero client size, and core `bindToCanvas`
throws when a host inits (or resizes) on a zero-size surface. dockview BACKGROUNDS inactive
tabs with `display:none`, so the moment preview becomes a tab stacked behind Viewport,
whichever panel is backgrounded goes zero-size — reopening the exact failure the swap was
built to dodge, now against dockview's less-controllable tab lifecycle. A correct
implementation must handle init-on-first-show, pause-render-on-hide, and resize/re-bind on
re-show for the preview host.

**And a tab alone doesn't satisfy the ask.** Tabs in one dockview group are mutually
exclusive — activating a "Preview" tab still hides the Viewport. To genuinely keep the scene
visible, preview must be a separate side-by-side GROUP: TWO live WebGPU canvases rendering at
once (double GPU cost, two render loops) plus the zero-size problem for whichever group is
collapsed.

**So this is a mini-slice, not a fix:** (1) a UX decision — swappable tab vs side-by-side
group; (2) a WebGPU-canvas-lifecycle spike for the chosen shape (init / pause / resize under
dockview panel visibility, the availability-class probe before committing); then (3) build.
User-approved deferral at the 3.2.2 gate ("backlog 3, we can handle it after this").

**Trigger to revisit:** immediately after Slice 3.2.2 seals — the user flagged it as the next
thing to pick up.

**Reference:** `packages/editor/src/frontend/components/Viewport.tsx` (the two-canvas
visibility swap + the zero-size init comment), `packages/editor/src/frontend/components/App.tsx`
(dockview panel registration, `previewHostRef`), `packages/editor/src/frontend/lib/panels.ts`
(`PANELS` registry), sibling `generation-cockpit-ux-gate-findings.md`.
