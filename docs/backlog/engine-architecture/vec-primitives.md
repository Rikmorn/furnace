# Vec primitives — type centralization, ergonomics, and the vec2 gap

Tracker for the deferred work on the engine's vector primitives in
`@furnace/core/transform`: centralizing the `Vec3Tuple` input type (and the
storage-vs-input rule that governs it), the authoring/reading ergonomics questions
over the raw `Float32Array` vectors, and the missing `vec2` math module. They are
merged because they all concern the same primitive family and mostly fire on the
same "next api-posture / TypeScript-hygiene tranche, or a new consumer forces it"
trigger. Order: the type-centralization rule first (it is the canonical home the
ergonomics entry points at), then ergonomics, then the vec2 module.

**Absorbed at T5 (2026-08-11):** *Opt-in runtime assertions for hot-path math primitives*,
last section. It is about input validation on `vec3.*` / `quat.*` / `mat4.*` specifically —
the same primitive family, and it fires on the same next-hygiene-tranche trigger.

## Centralize Vec3Tuple input type in transform/types.ts

The `readonly [number, number, number]` array-literal input type is defined in
multiple places across the engine, with no single source of truth:

- `packages/core/src/physics/types.ts:15` — `export type Vec3Tuple = readonly [number, number, number]` (the only **exported** copy)
- `packages/core/src/geometry/factories/cube.ts:6` — local `type Vec3Tuple = readonly [number, number, number]`
- `packages/core/src/frame/lights.ts:15` — local `type Vec3Tuple = readonly [number, number, number]`
- `packages/core/src/texture/procedural.ts:9` — local `type Rgb = readonly [number, number, number]` (same shape, different name)
- `packages/core/src/camera/perspective.ts:11–13` — inline `readonly [number, number, number]` on three `const` defaults
- `packages/core/src/camera/orthographic.ts:15–17` — inline `readonly [number, number, number]` on three `const` defaults + one function parameter

**Proposal:** home a canonical `Vec3Tuple` in `packages/core/src/transform/types.ts`
alongside the existing `Vec3` / `Vec4` storage types. The distinction matters:

- `Vec3` = `Float32Array` — the **storage** type for engine internals and math ops.
- `Vec3Tuple` = `readonly [number, number, number]` — the **input** type for consumer
  call sites that pass array literals like `[0, -1, 0]`. `Float32Array` does not
  accept array literals at the type level, so fields typed `Vec3` reject `[x, y, z]`
  inputs. `Vec3Tuple` is a distinct concept and deserves its own canonical definition,
  not a per-module local copy.

Once centralized, each local definition and inline annotation above becomes an
`import type { Vec3Tuple } from "@furnace/core/transform"` (or an internal path
import). `texture/procedural.ts`'s `Rgb` is a same-shape alias used for
checkerboard/grid pixel colors — it could either adopt `Vec3Tuple` directly or
remain a local alias referencing the canonical type.

**Governing rule (decided 2026-06-07 — codify alongside the centralization).**
The choice between the two types is settled by *layer*, not case-by-case, and
this rule should be the deliverable of the centralization pass (not just a moved
type):

- **`Vec3` (`Float32Array`) — storage / compute.** Long-lived state mutated in
  place, cache-hot or hot-loop data, anything uploaded to the GPU, and math-op
  in/out. E.g. `mesh`/`camera` transforms, matrices, geometry buffers, the
  per-frame Scene UBO scratch buffer.
- **`Vec3Tuple` (`readonly [number, number, number]`) — descriptor / input.**
  Immutable, hand-authored, **bounded-count** data passed by value into a
  setup-time or per-frame API and immediately consumed (copied into a
  `Float32Array`). E.g. `Light` / `Ambient`, physics descriptors, geometry
  factory inputs.

Rationale: performance is governed by the **storage** layer (always
`Float32Array`), not the input shape. At bounded input counts (e.g.
`MAX_LIGHTS = 16`) the tuple's costs — an `f64` backing store, and a per-frame
allocation to "move" a `readonly` tuple instead of an in-place `Float32Array`
write — are negligible and never become a hot path, so the input-type choice is
decided by **posture** (immutable value-data vs. mutable buffer) and ergonomics,
not cache layout. Lights/ambient keep `Vec3Tuple` (immutable value-data,
mirroring `Camera` and physics; literal authoring); the cache-friendly
`Float32Array` decision is preserved where it counts — the Scene UBO is a reused
`Float32Array` and the tuple never reaches the GPU. The centralization pass
should land this rule in `docs/reference/` (engine-conventions or api-posture)
so contributors pick the right type by layer without re-deriving the tradeoff
per module.

**Why deferred:** multi-module change with no new consumer surface — all
occurrences are internal types. Touches 6+ files across 5 sub-modules. No
design decision is open (the canonical location and distinction are settled here);
the work is straightforward but wide.

**Trigger to revisit:** next api-posture / naming-hygiene tranche, OR when a
further module needs to define the tuple-input type (making the count 7+), OR
before first npm publish of `@furnace/core` (since `Vec3Tuple` may warrant a
public export from `@furnace/core/transform`).

**Reference:** `packages/core/src/frame/lights.ts` (local `Vec3Tuple` added in
Stage 3 Phase 2 Task 3, originally coined `Vec3Input` — renamed to `Vec3Tuple`
in the same commit after spec review found it synonymous with the engine's
existing name); `packages/core/src/physics/types.ts:15` (currently the only
exported copy).

## Vec primitive ergonomics — domain wrappers + indexing-cast hygiene

Two ergonomics questions over the engine's raw `Vec3` / `Vec4` (`Float32Array`)
primitives, consolidated here (was: `semantic-wrapper-types-for-vec-primitives.md`
+ `camera-common-vec3-indexing-casts.md`). They share the theme — making raw
typed-array vectors nicer to author and read — but have **distinct triggers**, so
they stay two tracks under one heading.

The adjacent **type-shape** question (`Vec3` storage vs `Vec3Tuple` input, and the
rule for which to use where) is tracked in the *Centralize Vec3Tuple input type in
transform/types.ts* section above — the canonical home for that rule. This entry is
about *authoring/reading* ergonomics, not the storage-vs-input distinction.

### Track 1 — Semantic wrapper namespaces (FEATURE; not yet needed)

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

**Reference:** Tranche A brainstorm (Color.rgba option B vs raw `vec4.fromValues`).

### Track 2 — `as number` indexing-cast hygiene (MOSTLY RESOLVED)

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
exists (added in Stage 3 Phase 2), and centralizing it is tracked in the
*Centralize Vec3Tuple input type in transform/types.ts* section above.

**Trigger to revisit:** next TypeScript hygiene tranche, OR a
`noUncheckedIndexedAccess` config review, OR if the cast volume becomes a
maintenance irritant.

**Reference:** surfaced Tranche A-1 (T6 camera TSDoc), 2026-05-26 — pre-existing;
resolved in A-6 (2026-05-29).

## vec2 module for `@furnace/core/transform`

The `Vec2` type is exported from `transform/types.ts` (`Float32Array` of
length 2) but there is no `vec2.ts` module — no `vec2.create`, no
`vec2.fromValues`, no `vec2.copy`, no math helpers. The siblings (`vec3`,
`vec4`, `mat4`, `quat`) all have their respective modules.

### Discovered during

Tranche A-2 (orthographic fit policy, 2026-05-27). The fit policy needed an
anchor field; using `Vec2` would have required `new Float32Array([x, y])`
construction everywhere or shipping a vec2 module as part of A-2.
Sidestepped by introducing a plain-object `Anchor = { x: number; y: number }`
type for the policy variants — which is consistent with furnace's
configuration-data shape convention (`OrthographicBounds`,
`{ width, height }`). The `Vec2` type itself is still exported but no
factory or helpers exist for it.

### Trigger to revisit

First 2D-game consumer that needs screen-space helpers: cursor position
tracking, UV coordinate math, anchor lerping for smooth-following cameras,
collision AABBs in 2D, tile coords. Any of these would benefit from a
proper `vec2` module with the same shape as `vec3`.

### Reference

- `packages/core/src/transform/types.ts` (Vec2 type definition)
- `packages/core/src/transform/vec3.ts` (template for what vec2 would look like)

### Jurisdiction note (added at the T3 objectives audit, 2026-08-08)

The foundations sweep's vector-vocabulary item carried one instruction that had no
tracked home until now: **the field/rng split is deliberate — do NOT merge.** The field
module's vector/rng helpers and the transform module's are separate on purpose (layer
posture, not oversight — see the storage-vs-input type rule in
`docs/reference/engine-conventions.md`). Any vec2/vocabulary cleanup that fires this
entry must keep that split.



## Opt-in runtime assertions for hot-path math primitives

*Filed during Tranche A-4 (2026-05-28). Not in A-4 scope; out of band.*

Hot-path math primitives (`vec3.*`, `quat.*`, `mat4.*`) trust the caller
and do not validate inputs (see `docs/reference/engine-conventions.md`
§Failure policy, "Hot-path trust"). The TSDoc documents preconditions
per export.

In production this is the correct stance — a `Number.isFinite` guard
per call at hot-path frequencies (1k–100k calls/frame) costs 3μs–300μs
per frame, eating 1–18% of a 16.67ms budget. The same argument holds
for the planned wasm-SIMD math kernels: a JS-side guard at the wasm
boundary would erase the SIMD gain.

But during development, a consumer hitting a NaN propagation in a
deeply-nested transform chain currently has no signal from the engine.
The bug surfaces visually (everything invisible, NaN positions) or
through GPU validation errors much later, with no stack-frame linking
back to the original bad input.

### Fix shape (research-grounded)

[`glam-rs`](https://docs.rs/glam) ships this exact problem as two
opt-in cargo features: `debug-glam-assert` (debug builds only) and
`glam-assert` (all builds). With either flag set, math primitives
panic on degenerate input with named messages. Without the flag,
they trust the caller — production stance.

A TS/JS analog: a module-level switch `assertions.enable()` / `.disable()`
that hot-path primitives consult once at module-load (so the branch
gets dead-code-eliminated in production builds). When on, math
primitives throw `FurnaceError` with descriptive messages on non-finite
input. When off (default), behaviour is unchanged.

Two open design questions:

1. **Where is "production" vs "development"?** Build-time `process.env`
   isn't visible to the browser. Options: (a) consumer explicitly calls
   `assertions.enable()` in their dev entry-point; (b) infer from the
   bundler's `import.meta.env.DEV` or similar; (c) tie to a custom
   environment variable the harness substitutes.
2. **What about per-call cost when assertions ARE on?** Even with the
   branch, the `Number.isFinite` checks themselves cost ~3 ns per
   component. For development that's irrelevant. For "all builds" mode
   (like `glam-assert`), it's the same trade we explicitly rejected
   in A-4 — so the dev-only flavour is probably the only useful one.

### Trigger to revisit

- When a consumer reports a NaN-propagation debugging session and asks
  for stronger engine-side signal during development, OR
- When the wasm-SIMD math kernels land and we need to decide whether
  the wasm path validates (and if so, under what flag).

### What to verify when fixing

- The "off" path remains genuinely allocation-free and branch-free at
  hot-path call sites (verify via the existing perf bench, or add one
  if missing).
- Throwing in dev mode produces a message naming the bad input and a
  stack trace pointing at the caller, not at the math primitive.
- `bun run check`, `bun run typecheck`, and `bun test` pass with the
  flag both enabled and disabled.

**Reference:** Filed during Tranche A-4 (failure-policy hygiene),
2026-05-28. Pattern reference: glam-rs `glam_assert` feature flag.
