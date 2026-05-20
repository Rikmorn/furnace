# SDF font atlas + glyph rendering

The UI foundation milestone's in-scene plane uses `OffscreenCanvas.fillText` → texture (CPU 2D-canvas rasterization, suitable for 1Hz updates). Sharp text at varying scales or live per-frame text updates need a real SDF font atlas approach. Estimated ~1 week to ship well (atlas generation, glyph layout, distance-field shader).

**Trigger to revisit:** First in-scene surface needing sharp text at varying scales, or live per-frame text updates.
