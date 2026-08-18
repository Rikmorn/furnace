---
summary: in-scene text is `OffscreenCanvas.fillText` to a texture, CPU rasterization fit for ~1 Hz updates; sharp text at varying scales or live per-frame updates needs a real SDF atlas, glyph layout and distance-field shader (~1 week)
---

# SDF font atlas + glyph rendering

The UI foundation milestone's in-scene plane uses `OffscreenCanvas.fillText` → texture (CPU 2D-canvas rasterization, suitable for 1Hz updates). Sharp text at varying scales or live per-frame text updates need a real SDF font atlas approach. Estimated ~1 week to ship well (atlas generation, glyph layout, distance-field shader).

**Trigger to revisit:** First in-scene surface needing sharp text at varying scales, or live per-frame text updates.

**Reference:** `docs/reference/ui-foundation.md` — the committed architecture this is a gap
in (Svelte + screen-space projection for world-tracked UI, with the in-scene plane as the
occlusion-only escape hatch); `occluded-in-scene-ui-primitive.md` — the plane whose text
this would sharpen.
