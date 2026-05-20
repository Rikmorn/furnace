# ECS / data-oriented SoA layout

The vision from `docs/reference/engine-architecture.md` §11 — SoA `Float32Array`s for positions/velocities/etc., with systems declaring read/write component sets for parallel scheduling. Not relevant until we render >1 entity.

**Trigger to revisit:** First time we render multiple meshes or want to manage entities.
