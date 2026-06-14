# Height-banded fog and additional fog modes

**Context:** Epic 1 ships exponential distance fog only — the `Fog` mechanism on
the Scene UBO `fog` lane (`mix(color, fog.rgb, 1 - exp(-density * dist))`). There
is no height-banded fog, no linear (start/end) fog, and no per-area fog authored
as scene data.

**Trigger to revisit:** When a scene needs height-banded fog (denser low to the
floor), linear start/end fog, or per-area fog authored as data rather than set
imperatively in the render call.

**Reference / design seam:** The data path mirrors `settings.ambient` —
`settings.fog` in the scene format → `LoadedScene.fog` → `frame.render` (today
`settings.ambient` already flows `scene/loader.ts` → `LoadedScene.ambient` →
render; `settings.fog` is not wired yet and is the first slice of this work).
Additional fog params fit either the existing `fog` Scene-UBO vec4 (rgb = color,
a = density) or a follow-on lane. Source:
`packages/core/src/frame/lights.ts` (`Fog`, `_packScene`);
`packages/core/src/shader/lighting.ts` (`fr_applyFog`).
