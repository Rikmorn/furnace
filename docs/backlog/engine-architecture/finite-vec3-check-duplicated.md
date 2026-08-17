---
summary: three sites in `physics/body.ts` validate an all-finite `Vec3Tuple` and the hot-path setters deliberately skip `isFiniteVec3`'s structural checks, so unifying them needs a lighter predicate rather than a swap
---

# Unify the finite-vec3 check across physics setters

`packages/core/src/physics/body.ts` now has three sites that validate a `Vec3Tuple` is all-finite: `createBody` (via the module-private `isFiniteVec3`), `setBodyLinearVelocity`, and `setBodyNextKinematicTranslation` (the last two inline `pos.every((c) => Number.isFinite(c))`). That's the "extract on the third occurrence" threshold from `.claude/rules/clean-code.md`.

It is **not** a pure mechanical swap, which is why it's deferred rather than inline-fixed: `isFiniteVec3` also runs `Array.isArray(v)` + `v.length === VEC3_LEN` defensive checks, but the hot-path setters intentionally skip those (the failure policy trusts the caller and the type system already guarantees a 3-tuple). Folding the setters onto `isFiniteVec3` would add per-call work the hot path deliberately avoids. The real design question: introduce a lighter `everyFinite(v)` predicate for the trust-the-type hot-path setters (and keep `isFiniteVec3`'s structural checks for the descriptor-validation path), or accept the duplication. Decide the helper shape, then unify both setters onto it.

Surfaced during Epic 2 Slice 2.0 Task 3 code review (the new setter added the third inlining site).

**Trigger to revisit:** next time a fourth physics setter needs the same finite-vec3 guard, or during a physics-module hygiene pass.

**Reference:** `.claude/rules/clean-code.md` §"Tolerate duplication until the third occurrence"; `docs/reference/engine-conventions.md` §Failure policy (hot-path trust-the-caller stance).
