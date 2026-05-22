# Multi-camera / multi-pass scenes

`frame.render(ctx, { ... camera: cam, ... })` takes one camera. Multi-camera setups (split-screen multiplayer, picture-in-picture, mini-map overlay, security-camera view rendered to a texture) need API extension.

Likely shape: `frame.render(ctx, { passes: [{ camera: cam1, draw: [...], viewport: { x, y, w, h } }, { camera: cam2, draw: [...], viewport: { ... } }], effects: [...] })`. Or a `multiRender` variant that takes an array of camera+draw pairings.

Related to `render-to-texture.md` — rendering one camera's view into a texture (for the mini-map case) requires offscreen render targets, which is its own design area.

Open design questions: how do post-effects compose across multiple cameras (per-pass effects? final composite after all passes?); how are depth buffers shared or separated; whether multi-camera implies multi-uniform-buffer or one giant frame uniform with per-pass slices.

**Trigger to revisit:** First demo needing more than one camera — typically split-screen co-op or a mini-map.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Deferred decisions".
