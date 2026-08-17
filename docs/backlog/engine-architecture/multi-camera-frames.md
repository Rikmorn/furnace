---
summary: `frame.render` takes exactly one camera, so split-screen, picture-in-picture and mini-map scenes need a passes/viewport extension plus a story for how post-effects and depth compose across passes
---

# Multi-camera / multi-pass scenes

`frame.render(ctx, { ... camera: cam, ... })` takes one camera. Multi-camera setups (split-screen multiplayer, picture-in-picture, mini-map overlay, security-camera view rendered to a texture) need API extension.

Likely shape: `frame.render(ctx, { passes: [{ camera: cam1, draw: [...], viewport: { x, y, w, h } }, { camera: cam2, draw: [...], viewport: { ... } }], effects: [...] })`. Or a `multiRender` variant that takes an array of camera+draw pairings.

Rendering one camera's view into a texture (for the mini-map case) uses `frame.renderToTexture` (shipped in tranche 6); a multi-camera API would need to compose those offscreen passes with the swapchain pass.

Open design questions: how do post-effects compose across multiple cameras (per-pass effects? final composite after all passes?); how are depth buffers shared or separated; whether multi-camera implies multi-uniform-buffer or one giant frame uniform with per-pass slices.

**Trigger to revisit:** First demo needing more than one camera — typically split-screen co-op or a mini-map.

**Reference:** Core architecture design § "Deferred decisions".
