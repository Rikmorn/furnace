---
summary: the WGSL textured-plane primitive for the rare UI that 3-D geometry must occlude per-pixel — proven end to end then reverted from the tree pending a real use case, and a re-implementation should write the texture with `device.queue.writeTexture`
---

# In-scene UI primitive — for occluded cases only (γ)

Architecture committed to Svelte + screen-space projection (CSS2DRenderer-style) for world-tracked UI without occlusion needs — HUDs, labels, panels that float above 3D content. For the rare case where 3D geometry must occlude UI per-pixel (a touchpanel on a wall a character can walk in front of), the chosen approach is a WGSL textured-plane primitive — proven end-to-end in commit `7249001` (UI Foundation Phase 2) before being reverted from the tree pending a real use case. The `OffscreenCanvas → texture` content pipeline used in the proof had a non-obvious bug (see `docs/learnings/2026-05-17-render-to-texture.md`); a future implementation should use `device.queue.writeTexture` directly. Options δ (static SVG asset pipeline) and ε (resvg in wasm) are no longer in active consideration — the screen-space-projection approach covers the common cases more cleanly.

**Trigger to revisit:** First concrete need for in-scene UI that 3D geometry must occlude per-pixel. Not before — the projection-helper approach handles the common cases.

**Reference:** `docs/reference/ui-foundation.md`, `docs/learnings/2026-05-17-render-to-texture.md`, commit `7249001`.
