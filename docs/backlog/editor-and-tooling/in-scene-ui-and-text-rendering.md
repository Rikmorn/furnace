# In-scene UI and text rendering — deferred primitives + emerging-tech watch

Tracker for the three UI-rendering items left open by the UI Foundation milestone. All
three are keyed to `docs/reference/ui-foundation.md`: the architecture committed to Svelte
+ screen-space projection for world-tracked UI, and these are the cases that approach does
not cover (per-pixel occlusion, sharp/live text) plus the browser-platform change that
would collapse the design space. None is scheduled; each carries its own trigger. Sections
keep their original content.

## In-scene UI primitive — for occluded cases only (γ)

Architecture committed to Svelte + screen-space projection (CSS2DRenderer-style) for world-tracked UI without occlusion needs — HUDs, labels, panels that float above 3D content. For the rare case where 3D geometry must occlude UI per-pixel (a touchpanel on a wall a character can walk in front of), the chosen approach is a WGSL textured-plane primitive — proven end-to-end in commit `7249001` (UI Foundation Phase 2) before being reverted from the tree pending a real use case. The `OffscreenCanvas → texture` content pipeline used in the proof had a non-obvious bug (see `docs/learnings/render-to-texture.md`); a future implementation should use `device.queue.writeTexture` directly. Options δ (static SVG asset pipeline) and ε (resvg in wasm) are no longer in active consideration — the screen-space-projection approach covers the common cases more cleanly.

**Trigger to revisit:** First concrete need for in-scene UI that 3D geometry must occlude per-pixel. Not before — the projection-helper approach handles the common cases.

**Reference:** `docs/reference/ui-foundation.md`, `docs/learnings/render-to-texture.md`, commit `7249001`.

## SDF font atlas + glyph rendering

The UI foundation milestone's in-scene plane uses `OffscreenCanvas.fillText` → texture (CPU 2D-canvas rasterization, suitable for 1Hz updates). Sharp text at varying scales or live per-frame text updates need a real SDF font atlas approach. Estimated ~1 week to ship well (atlas generation, glyph layout, distance-field shader).

**Trigger to revisit:** First in-scene surface needing sharp text at varying scales, or live per-frame text updates.

## Emerging-tech watch: WICG HTML-in-Canvas / Vello browser readiness

The WICG "HTML in Canvas" proposal would let HTML elements live inside a canvas with native rasterization, depth participation, and accessibility object model integration. Linebender's Vello is a GPU vector graphics renderer in Rust+wgpu, but per Linebender's own docs the web is not currently a primary target. Either landing in production would collapse the in-scene UI design space.

**Trigger to revisit:** WICG proposal reaches Stage 2+, or Vello announces production web support.

**Reference:** `docs/reference/ui-foundation.md`, "Research write-up" section.
