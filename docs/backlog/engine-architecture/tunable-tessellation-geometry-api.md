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
`docs/superpowers/specs/2026-06-03-physics-stage-3-render-shapes-design.md` §0/§1.
