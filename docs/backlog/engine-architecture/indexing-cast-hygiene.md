---
summary: the engine-side `Vec3`-indexing casts were resolved in A-6 as a recognised intentional-bypass class; what remains is one cookbook mirror site and an unadopted per-directory `noUncheckedIndexedAccess` scope-off
---

# `as number` indexing-cast hygiene (MOSTLY RESOLVED)

> **ENGINE-SIDE RESOLVED in A-6 (2026-05-29).** The `transform/*` + `camera`
> hot-path `Vec3`-indexing casts (~263 sites) are a **recognised
> intentional-bypass class**, documented once in `.claude/rules/typescript.md`
> (no per-site comment needed). The runtime-checked `vec3Get` helper once proposed
> here is **rejected** — it predates A-4's hot-path failure-policy stance and would
> add per-call validation the convention forbids.

**Remaining (small):**

1. **Consumer mirror** — `packages/cookbook/src/demos/animation/entry.ts` uses
   `cubePos[0] as number` (the same pattern in demo code). Give it a
   `// Boundary cast:` comment or fold it under the class note when a cookbook
   hygiene pass next touches that file.
2. **Optional scope-off** — a per-directory `tsconfig` flipping
   `noUncheckedIndexedAccess: false` for `transform/` would delete the casts at
   zero runtime cost. Not adopted (keeps one strictness config).

This track's original "fix option 2" — introduce a `Vec3Tuple = readonly [number,
number, number]` companion type — has since **materialised**: `Vec3Tuple` now
exists (added in Stage 3 Phase 2), and centralizing it is tracked in
`centralize-vec3tuple-input-type.md`.

**Trigger to revisit:** next TypeScript hygiene tranche, OR a
`noUncheckedIndexedAccess` config review, OR if the cast volume becomes a
maintenance irritant.

**Reference:** surfaced Tranche A-1 (T6 camera TSDoc), 2026-05-26 — pre-existing;
resolved in A-6 (2026-05-29). `vec-domain-wrapper-namespaces.md` is the other half of the
same vec-ergonomics pair; the two were kept apart because their triggers differ.