# Deterministic random number generation

A `@furnace/core/rng` module exporting seeded PRNGs (xorshift, PCG, or similar — small, fast, deterministic) for replay-safe randomness. `Math.random()` is non-deterministic across machines and not seedable; for any feature requiring reproducibility (physics, gameplay AI decisions, procedural generation), we need a controlled alternative.

API sketch: `const rng = rng.create(seed); rng.float(); rng.int(0, 100); rng.bool(0.3); rng.pick(arr);`. Each `Context` could have a default RNG instance; consumers can spawn additional named RNGs for subsystems they want isolated (e.g., physics RNG separate from AI RNG so changes to AI behavior don't desync physics replays).

Important for: replay systems, networked physics (deterministic lockstep), procedural generation that needs to be reproducible, debugging (re-run a scenario with the same dice rolls).

**Trigger to revisit:** When the first feature needs reproducibility — physics typically the first (deterministic simulation), procedural content generation second.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "What I'd skip (deliberately)" (originally deferred from Tier 1).
