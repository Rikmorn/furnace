# Box / parallelepiped primitive

## Context
Axis-aligned boxes are served today by `geometry.cube` + `mesh.setScale` (the
bowling lane). A dedicated `geometry.box({ width, height, depth })` would bake
correct per-face normals (no inverse-transpose needed under non-uniform dims),
and a parallelepiped would add shear. Neither is load-bearing for bowling.

## Trigger to revisit
A demo needs correct normals under non-uniform box dimensions without the
deferred inverse-transpose normal fix, or a sheared parallelepiped.

## Reference
`docs/superpowers/specs/2026-06-03-physics-stage-3-render-shapes-design.md` §1 OUT.
