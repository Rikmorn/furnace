# Screen-space projection helper for world-tracked Svelte UI

The chosen approach for world-tracked UI is to project world coords to screen coords each frame and position a Svelte overlay element at that screen position, scaled by the projection's `w`-divide so it shrinks naturally with distance. Three.js's `CSS2DRenderer` is the canonical reference. The helper needs reactive access to the camera + projection matrices, must run after physics/animation updates but before render encoding in the same tick (avoid one-frame lag), and must handle behind-camera culling (clip-space `w ≤ 0` → hide). Optional: frustum-side culling for off-screen elements; z-sorting between multiple world-tracked elements that overlap in screen space. Performance ceiling: comfortable up to ~hundreds of elements per frame; thousands would force a different approach.

**Trigger to revisit:** First time we want a label, panel, or HUD anchored to a world-space point. Will likely arrive with ECS, since ECS provides camera transforms and entity positions as first-class concerns.

**Reference:** Three.js `CSS2DRenderer` source. `docs/reference/ui-foundation.md`, "Research write-up" section.
