---
summary: only exponential distance fog ships, and since the authored-scene-document seam was deleted, height-banded, linear and per-area fog need both a decision on where their params come from and a second Scene-UBO lane
---

# Height-banded fog and additional fog modes

**Context:** Epic 1 ships exponential distance fog only — the `Fog` mechanism on
the Scene UBO `fog` lane (`mix(color, fog.rgb, 1 - exp(-density * dist))`). There
is no height-banded fog, no linear (start/end) fog, and no per-area fog authored
as scene data.

**Trigger to revisit:** When a scene needs height-banded fog (denser low to the
floor), linear start/end fog, or per-area fog authored as data rather than set
imperatively in the render call.

**Reference / design seam:** *(Restated at T5, 2026-08-11. The original paragraph
routed the data path through `settings.fog` → `LoadedScene.fog` →
`scene/loader.ts`, mirroring `settings.ambient`. None of those exist: foundations
T2 deleted `@furnace/core/scene` and with it the text-JSON document format, its
loader, and `LoadedScene`. There is no authored-scene-data seam to hang fog on any
more; the capability below is unchanged, only the seam is.)*

Fog is a **per-call render argument** now, not authored document data: the caller
passes a `Fog` (`{ color, density }`) into `frame.render`, which packs it into the
Scene UBO's single `fog` vec4 (rgb = color, a = density) — see
`packages/core/src/frame/lights.ts` (`Fog`, `_packScene`, and the unwritten-lane
contract that governs what happens when it is omitted). The shader side is
`fr_applyFog` in `packages/core/src/shader/lighting.ts`.

So the work has two parts, and the first one is now a question rather than a
given: **(1) where do additional fog params come from** — still a per-call
argument, a field-artifact setting, or something the world tier owns; and
**(2) how do they reach the shader** — either overloading the existing `fog` vec4
or adding a follow-on lane to the Scene UBO header, plus the matching branches in
`fr_applyFog`. Height-banded fog needs at least one more vec4 (band height,
falloff); linear fog needs start/end in place of density.
