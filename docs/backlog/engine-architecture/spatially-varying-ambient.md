# Spatially-varying ambient — environment volumes / light probes

Stage 3 Phase 2's `ambient` is a **per-frame consumer policy value**: a
`{ sky, ground, intensity }` hemisphere term passed via `RenderOptions.ambient`
(see `packages/core/src/frame/render.ts`) and packed once into the Scene UBO
header. It is **uniform across the whole scene** — every fragment reads the same
sky/ground colours regardless of world position. The consumer recomputes it per
frame (e.g. tinting it to time-of-day), but it has no spatial dimension.

Real scenes want **position-varying ambient**: a character walking from sunlit
outdoors into a red-lit interior should pick up the local indirect colour. The
engine-side answer is an **environment-volume / light-probe** feature — baked or
placed probes (irradiance volumes, SH probes, a probe grid) that the lit shader
samples by world position to get a local ambient/irradiance term, replacing the
single global hemisphere lookup. That is a cohesive subsystem (probe placement,
bake/capture, a probe buffer, shader sampling), not a tweak to the current
per-frame scalar — so it is deferred, not folded into the ambient value.

This also overlaps with the IBL machinery deferred for PBR (see
`pbr-material-pipeline.md`): an irradiance map is the simplest "one global probe"
form of this, and a probe grid generalises it.

**Trigger to revisit:** scenes need position-varying ambient (indoor/outdoor
transitions, locally-coloured indirect light) — design the probe/volume
representation alongside (or after) the IBL work.

**Reference:** `RenderOptions.ambient` in `packages/core/src/frame/render.ts`
(the current per-frame uniform hemisphere term); `pbr-material-pipeline.md` (the
IBL machinery this overlaps with).
