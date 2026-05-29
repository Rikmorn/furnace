# ECS / data-oriented SoA layout

The vision from `docs/reference/engine-architecture.md` §9 — SoA `Float32Array`s for positions/velocities/etc., with systems declaring read/write component sets for parallel scheduling. Lands as the `@furnace/core/ecs` Tier 2 module (per the core architecture design spec). Not relevant until we render >1 entity; target ~1000+ entities justifies the machinery.

Connects to `docs/backlog/engine-architecture/component-schemas.md` — how component types are defined and stored is the central design question alongside the storage layout itself.

**A-8 note (2026-05-29):** the API-posture tranche classified ECS as a higher-tier module built *on top* of the core handle layer (`api-posture.md` R8 — abstraction tier). This affirms the Tier-2 framing above; A-8 routed it here (not built) per the anti-spiral rule.

**Trigger to revisit:** First time we render multiple meshes or want to manage entities.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Tier 2 modules".
