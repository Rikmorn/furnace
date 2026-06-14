# `@furnace/core/assets` — Tier 2 module

Asset loading pipeline: glTF for meshes (de-facto interchange format), OBJ for simple mesh debugging, KTX2/Basis for compressed textures, MP3/OGG/Opus for audio. Async-first by nature (network I/O); follows the `load`/`request`/`fetch` naming convention from the Tier 1 design language.

Open design questions: caching (per-context cache? global LRU? consumer-managed?), progress reporting (per-asset `onProgress` callback? aggregated load-queue depth?), error handling (typed `FurnaceLoadError` with kind discriminator?), texture color-space inference (assume sRGB for `.png`/`.jpg`, linear for `.exr`, follow KTX2 metadata?), retry/timeout semantics, parallel loading limits.

Should integrate with `stats` for load-queue depth, bytes-loaded gauges, and per-asset timing.

**Trigger to revisit:** First demo loading a non-primitive mesh (glTF) or compressed texture. Mesh primitives (`mesh.primitives.cube/sphere/...`) and the existing texture-load helper cover most early needs.

**Reference:** Core architecture design § "Tier 2 modules".
