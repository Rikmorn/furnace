# Cross-module import doors — what the ratchet did NOT solve

The door rule **shipped** at foundations T2 (2026-08-05). This entry survives it because
the rule covers only two thirds of the tree, and the remaining third is a design question
nobody has answered yet. Read the two halves below as "what is settled" and "what is open".

## What shipped

`packages/core/tests/architecture.test.ts` now names four **door files** — `index.ts`
(consumer surface), `internal.ts` (the engine-private seam siblings reach through), and
the two type leaves `types.ts` / `context-types.ts` — and fails any cross-module import
that lands anywhere else.

Two seams were built to make that possible: `shader/internal.ts` and `binding/internal.ts`,
carrying the `_layoutOf` / `_textureBindingOf` / `_usesSceneOf` / `_usesShadowsOf` /
`_instancedOf` / `_createShader` / `_shadowCasterSrc` / `_cameraBinding` and
`_bufferOf` / `_flushDirtyBindings` / `computeLayout` plumbing that `frame`, `post`,
`material` and each other used to deep-import. That closed 18 edges.

Because a two-thirds rule cannot be a rule, the clause lands as a **RATCHET**: today's
residual is pinned in `RATCHETED_EDGES`, a NEW deep import fails, and a pin whose edge is
gone ALSO fails (a stale pin silently re-authorizes that exact import the day someone
writes it again). Entries may only ever be removed. Both directions are sabotage-verified
and the failure message names the offending edge.

## The measured tree (re-derived at T2, post scene deletion)

Post-seam (the numbers the ratchet was derived from):

| | edges |
|---|---|
| total cross-module edges | **256** |
| landing on `index.ts` / `internal.ts` | 119 |
| landing on all four doors | 188 |
| **residual (pinned)** | **68** |

Pre-seam, for the delta: 251 total / 97 two-door / 165 four-door / **86 residual**. The
seams converted 18 edges and added 5 new (all door-landing) ones of their own.

The residual is NOT the `_`-accessor plumbing the T1a note assumed it would be — the seams
took all of that. What is left is dominated by shared **value** leaves, which no type-door
can absorb:

```
11  resources/handle.ts        4  resources/manager.ts     1  gpu/resize.ts
11  gpu/errors.ts              4  events/emitter.ts        1  texture/sampler-cache.ts
 7  gpu/dispose-cascade.ts     3  resources/dispose.ts     1  mesh/instanced.ts
 5  transform/vec3.ts          3  mesh/mesh.ts             1  post/effect.ts
 5  transform/mat4.ts          3  material/material.ts     1  post/evaluate.ts
 2  transform/vec4.ts          2  stats/state.ts           1  post/format-bytes.ts
                                                           1  post/pool.ts
                                                           1  post/post-sampler.ts
```

Verified at T2 that these cannot simply be redeclared as doors: `gpu/errors.ts` and
`transform/vec3.ts` export values only; `resources/handle.ts` is 12 types **and** 6 values;
`resources/manager.ts` is 2 types and 6 values. The type-door has already done everything
it can do.

## The open question

**What should cross-module access to a shared value leaf look like?** Three shapes, none
chosen:

1. **A door per leaf.** `transform/` and `resources/` grow `internal.ts` seams and every
   importer re-points. Uniform, and turns ~40 of the 68 into door edges — but it makes
   `internal.ts` a barrel over `vec3.ts`/`mat4.ts`, which are hot-path math files where an
   extra module hop is real (bundlers tree-shake it, but the file stops being the obvious
   place to read the code).
2. **Re-export through the existing doors.** `transform/index.ts` already exports the vec3
   surface publicly; several pins may collapse to a one-line import rewrite with no new
   file. **Measured at T2: `camera/bind.ts -> gpu/resize.ts` is exactly this** — rewriting
   it to `../gpu/index.ts` typechecks clean across all five packages. Nobody has audited how
   many of the other 67 are the same. That audit is the cheapest next step and it should
   come before either other option, because it changes the size of the problem.
3. **Accept shared leaves as leaves.** Declare that a module-shaped *leaf* (no state, no
   lifecycle, pure functions or brand types) is legitimately importable directly, and give
   the test a LEAF_FILES allowlist beside DOOR_FILES. Cheapest, and arguably honest — the
   coupling `camera/ray.ts -> transform/mat4.ts` expresses is real and healthy. Risk: "is
   it a leaf?" is a judgement the test cannot make, so the allowlist becomes a second pin
   list with softer semantics than the ratchet it sits next to.

Two sub-questions ride along:

- **`gpu/errors.ts` (11 edges) and `resources/handle.ts` (11 edges) are the two biggest
  targets and they are different problems.** `errors.ts` is a value leaf (error classes)
  that eight modules throw; `handle.ts` is the brand-type registry that every `types.ts`
  imports — i.e. it is a leaf of the type-door layer itself. A design that treats both the
  same is probably wrong.
- **`frame/render.ts` alone owns 11 of the 68 pins** (into `post/`×5, `mesh/`×2,
  `material/material.ts`, `transform/vec4.ts`, `gpu/`×2 — the single largest importer). It
  is the engine's one true integrator, so it may deserve
  an explicit exemption rather than a door — or its pins are the signal that `post/` needs
  the same seam treatment `shader`/`binding` just got.

## Trigger to revisit

Any ONE of:

- **The next module gets an `internal.ts`.** Whoever writes the third seam is already
  holding the design question and should settle it rather than growing the pattern by
  instinct.
- **A pin blocks real work** — someone needs an import the ratchet refuses and the honest
  fix is a door that does not exist yet.
- **The residual stops falling.** If a tranche lands with 68 still at 68, the ratchet has
  become a floor rather than a ratchet, and the burn-down needs the design instead of
  goodwill.

Option 2's audit ("how many of the 68 are a one-line rewrite to an existing door?") is
independently worth doing at any time — it is an afternoon and it is the input every other
option needs.

## Reference

- `packages/core/tests/architecture.test.ts` — the five landed clauses, `scanImportEdges()`
  (the scanner that produced every number above), `DOOR_FILES`, and `RATCHETED_EDGES` with
  the full pinned list.
- `packages/core/src/shader/internal.ts`, `packages/core/src/binding/internal.ts` — the two
  seams T2 built; the shape any further seam should follow.
- `docs/reference/api-posture.md` §R8 enforcement — the door rule and ratchet posture as
  committed convention.
