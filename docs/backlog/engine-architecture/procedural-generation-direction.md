---
summary: procedural generation beyond textures: meshes and geometry, a richer noise/pattern module, and GPU-generated content
---

# Procedural generation as a broader direction (beyond textures)

During the Visual Fidelity epic's Stage 1 (textures) the user flagged broad
interest in procedural generation — "not just textures, but quite a bit more."
Stage 1 ships **basic CPU-side** procedural texture generation: small stateless
pixel-data generators (checkerboard / UV-test grid / basic value-noise) that feed
the same `texture.create({ data })` path as decoded images. This entry tracks the
**broader** ambition: procedural meshes/geometry, a richer procedural module/DSL
(noise libraries, pattern composition), and GPU-generated content.

**Ownership principle established in Stage 1 (reuse it):** a procedural generator
owns nothing persistent — it produces *data* that a consuming resource (texture,
geometry) owns on the GPU side. So procedural generation is a **data source / code
module, not a new ownership system** — *unless* it moves onto the GPU
(compute/render-pass-generated outputs), which pulls in the deferred
storage/compute tranche (generator pipelines + persistent GPU buffers).

**Trigger to revisit:** a demo that wants procedural **meshes** (not just
textures); OR procedural content rich enough to warrant a dedicated
module/namespace; OR GPU-generated procedural content (also fires the
compute/storage tranche).

**Reference:** the storage/compute tranche notes in `binding/types.ts`.
