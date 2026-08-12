---
summary: an unclamped canvas resize can feed zero-size depth/MSAA texture creation — a probe, not yet reproduced
---

# Unclamped canvas resize can feed zero-size texture creation

**Context.** Found by the F2b fix-round-2 executor (2026-07-21), not yet reproduced.
`computeResizeEvent` in `gpu/resize.ts` computes `Math.floor(cssWidth * dpr)` with no
lower clamp and assigns it to `ctx.canvas.width`; `_ensureDepthTexture` in
`frame/render.ts` feeds those dimensions to
`createTexture` (depth / MSAA color targets) with no zero guard. Two unclamped hops: a
zero-CSS-size canvas (collapsed layout, `display: none`) would request a 0×N texture —
a WebGPU validation error, and under the F2b MSAA line-overlay path potentially a
per-frame error flood. The editor's Field panel now floors its canvas cell at
`min-h-24` (fix round 2, item 3), which blocks the panel-drag route — but that CSS
floor cannot block a `display: none` route if dockview uses one for hidden tabs; that
half is unverified.

**Probe (cheap, do first):** in the editor, stack the Field panel behind another tab in
the same dockview group and watch the console for texture-creation validation errors;
also drive `gpu.onResize` directly in a headless test with a 0×0 canvas.

**Fix shape (if confirmed):** clamp both dimensions to ≥1 in `resize.ts` (the standard
swapchain-guard idiom) and/or early-return the frame when the canvas has no area —
decide which layer owns the guard (setup-loud vs quiet-skip per
`engine-conventions.md` §Failure policy: this is a runtime condition, so quiet-skip
with a debug-level note is the likely posture).

**Trigger to revisit:** the probe firing, any zero-size validation error in the wild,
or the next `gpu/` module hygiene pass.

**Reference:** `computeResizeEvent` in `packages/core/src/gpu/resize.ts`,
`_ensureDepthTexture` / `_ensureSceneColorTarget` in
`packages/core/src/frame/render.ts`, F2b fix-round-2 executor report;
`packages/editor/src/frontend/components/FieldPanel.tsx` (gone) (`min-h-24` canvas floor).
