# Many lights — clustered/tiled forward+ or deferred shading

## Context

The engine renders **forward** with a fixed `MAX_LIGHTS = 16` Scene-UBO array
(`packages/core/src/frame/lights.ts:150`; `_packScene` clamps to 16 and
`frame.render` warns once on overflow, never throws). This caps **simultaneous
real light sources at 16** regardless of scene size.

The dungeon (atmospheric crawler) wants *many* light-emitting elements —
scattered glowing crystals / fungi, lava or ember fields, multiple torches —
that **actually illuminate** their surroundings, not just bloom-glow visually.
Slice 2.2.3a ships emissive scatter as **unlit + bloom** (purely visual, no real
light) *precisely because* real scattered lights are impossible under the 16-cap.
Making many emitters cast real light needs a lighting architecture that
**decouples light count from a fixed forward UBO array**.

Ray tracing is out — there is no hardware-RT path in browser WebGPU. The two
realistic candidates (research pass needed before choosing):

- **Clustered / tiled forward+** — bucket lights into view-space clusters via a
  compute pass, then each fragment shades only its cluster's lights. Scales to
  thousands of lights while **keeping the forward path** — so it preserves MSAA
  (the dungeon renders `sampleCount: 4`) and transparency, and is the *least
  invasive* change to the existing forward + bloom→tonemap chain. Likely the
  better fit for furnace.
- **Deferred shading** — a G-buffer decouples lighting from geometry; the classic
  many-lights solution. But it **conflicts with MSAA** (the dungeon's
  `sampleCount: 4`) and transparency, costs more bandwidth, and is a larger
  rewrite of the forward render path. (This was the first instinct raised, but
  the MSAA conflict is the concrete reason to weigh clustered forward+ first.)

Both need WebGPU **compute + storage buffers** (light lists / cluster grids) —
mind the compatibility-mode vertex-stage storage limit noted in the 2.2.3a
instancing research (compute-stage storage is fine; this is a vertex-stage-only
quirk).

## Trigger to revisit

When the dungeon wants **> ~16 simultaneous real light sources** — i.e. when
"emissive glow via unlit + bloom" stops being atmospheric enough and scattered
emitters must genuinely pool light on nearby surfaces. Open with a cited research
pass (clustered forward+ vs deferred) before any implementation.

## Reference

- 2.2.3a brainstorm (emissive glow scatter — the trigger that surfaced this).
- `packages/core/src/frame/lights.ts:150` (`MAX_LIGHTS = 16`); forward render
  path `packages/core/src/frame/render.ts`.
- Related: `pbr-material-pipeline.md`, `shadow-follow-ons.md` (*Advanced shadows*
  section), `area-and-ies-lights.md`, `post-chain-follow-ons.md` (*runtime
  render-graph / FrameGraph (T3)* section).
