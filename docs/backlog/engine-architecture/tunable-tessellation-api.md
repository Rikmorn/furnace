---
summary: `geometry.sphere`/`cylinder` ship fixed internal tessellation with no segment params, matching the Unity/Unreal basic-primitive posture — tunable density should arrive as a distinct generation surface, not as segment counts bolted onto the basic factories
---

# Tunable tessellation geometry API

## Context
`geometry.sphere`/`cylinder` (Stage 3) ship with FIXED internal tessellation and
no segment params — matching `cube`/`plane` and the Unity/Unreal basic-primitive
posture (the 7-engine survey put tunable tessellation behind a separate procedural
API: Unity ProBuilder, Unreal Geometry Script `AppendSphereLatLong`). When furnace
needs tunable density, add a distinct geometry-generation surface rather than
bolting segment counts onto the basic factories.

## Trigger to revisit
A demo needs a low-poly aesthetic, a hero close-up, or LOD that the fixed default
can't serve.

## Reference
Physics Stage 3 (render shapes) design §0/§1.
