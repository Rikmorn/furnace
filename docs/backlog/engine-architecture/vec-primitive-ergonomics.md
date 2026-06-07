# Vec primitive ergonomics — domain wrappers + indexing-cast hygiene

Two ergonomics questions over the engine's raw `Vec3` / `Vec4` (`Float32Array`)
primitives, consolidated here (was: `semantic-wrapper-types-for-vec-primitives.md`
+ `camera-common-vec3-indexing-casts.md`). They share the theme — making raw
typed-array vectors nicer to author and read — but have **distinct triggers**, so
they stay two tracks under one file.

The adjacent **type-shape** question (`Vec3` storage vs `Vec3Tuple` input, and the
rule for which to use where) is tracked separately in
[`centralize-vec3tuple-input-type.md`](./centralize-vec3tuple-input-type.md) — the
canonical home for that rule. This file is about *authoring/reading* ergonomics,
not the storage-vs-input distinction.

---

## Track 1 — Semantic wrapper namespaces (FEATURE; not yet needed)

The engine uses `Vec3` / `Vec4` directly for many domain concepts — colors
(`Vec4`), positions / directions / velocities / normals / tangents (`Vec3`).
Structurally identical, semantically distinct, mixed freely at call sites with no
domain-helper distinction.

Introduce semantic wrapper namespaces that **return** `Vec3` / `Vec4` (wrappers,
not new types) but expose domain-aware constructors and helpers:

```ts
Color.rgba(r, g, b, a): Vec4
Color.fromHex("#1a2b3c"): Vec4
Color.toLinear(srgb): Vec4 / Color.toSrgb(linear): Vec4
Point.xyz(x, y, z): Vec3
Direction.normalized(v): Vec3
```

**Why deferred:** scope-to-current-need. `Color` alone today is a single-member
stub namespace. The pattern earns its keep when concrete domain helpers actually
exist (sRGB/linear conversion, hex/hsv parsing, point distance / dot, direction
normalization).

**Trigger to revisit:** first concrete domain-helper need — likely sRGB/linear
color conversion when richer `textures.load` lands, hex/hsv color authoring in
the cookbook, or world-vs-screen point disambiguation when a hover/tooltip system
lands.

**Reference:** Tranche A brainstorm (Color.rgba option B vs raw `vec4.fromValues`);
`docs/superpowers/specs/2026-05-26-tranche-a-quick-wins-design.md` §1.

---

## Track 2 — `as number` indexing-cast hygiene (MOSTLY RESOLVED)

> **ENGINE-SIDE RESOLVED in A-6 (2026-05-29).** The `transform/*` + `camera`
> hot-path `Vec3`-indexing casts (~263 sites) are a **recognised
> intentional-bypass class**, documented once in `.claude/rules/typescript.md`
> (no per-site comment needed). The runtime-checked `vec3Get` helper once proposed
> here is **rejected** — it predates A-4's hot-path failure-policy stance and would
> add per-call validation the convention forbids. See
> `docs/superpowers/specs/2026-05-29-a6-audit.md` §5.1.

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
[`centralize-vec3tuple-input-type.md`](./centralize-vec3tuple-input-type.md).

**Trigger to revisit:** next TypeScript hygiene tranche, OR a
`noUncheckedIndexedAccess` config review, OR if the cast volume becomes a
maintenance irritant.

**Reference:** surfaced Tranche A-1 (T6 camera TSDoc), 2026-05-26 — pre-existing;
resolution in `docs/superpowers/specs/2026-05-29-a6-audit.md` §5.1.
