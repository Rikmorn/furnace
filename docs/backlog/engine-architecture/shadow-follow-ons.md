# Shadow follow-ons

Tracker for the shadow-system follow-ons deferred out of the Visual Fidelity epic's
Stage 4 (which shipped one shadow map per caster covering spot + orthographic
directional lights, a depth-only caster pass, a comparison sampler, and a
`texture_depth_2d_array` indexed by light slot). Every entry below is an additive
quality/coverage extension or a hygiene finding on that Stage-4 substrate — none
requires a different foundation. They are merged here because they share the same
subsystem and mostly the same "shadows became a real cost / a scene outgrew the
single map" family of triggers. Sections are ordered feature-first (CSM/point →
auto-fit → resolution/kernel → texel single-source → caching → per-mesh opt-in →
instanced casters → transparent casters → the lighting/shadow weld).

## Advanced shadows — cascaded (CSM) + point-light cube maps

Deferred out of the Visual Fidelity epic, whose Stage 4
ships **one shadow map per caster** covering spot + orthographic directional
lights (both single-map). Two genuine subsystems are fenced out:

- **Cascaded shadow maps (CSM)** — a single orthographic directional map has poor
  resolution over a large view frustum; quality at scene scale needs frustum
  splitting into multiple cascades with per-cascade maps and a selection in the
  shader. (Fine to skip while the demo scene is small, e.g. the bowling alley.)
- **Point-light cube-map shadows** — omnidirectional shadows need a cube map
  (6 depth renders) or a dual-paraboloid/distance variant. The most expensive
  shadow path; deferred because Stage 4's point lights simply won't cast shadows.

Both build on Stage 4's single-map plumbing (depth-only pass, compare sampler,
bias, PCF) — they are quality/coverage extensions, not a different foundation.

**Trigger to revisit:** a demo whose scene is large enough that single-map
directional shadows look low-res (→ CSM), OR a demo that needs a point light to
cast shadows (→ cube maps).

**Reference:** the *Shared pipeline factory* section of `render-code-hygiene-on-next-touch.md` (depth-only shadow pipeline).

**Update (Stage 4, 2026-06-08):** The single-map shadow substrate this entry builds on has now
LANDED — a depth-only caster pass (`frame/shadow-map.ts`), a comparison sampler, and a
`texture_depth_2d_array` indexed by light slot (engine-owned; `Light` stays plain per-frame data).
CSM (directional cascades) and point-light cube shadows are now true extensions of this foundation:
CSM splits the directional frustum into multiple layers of the same array + adds a per-cascade
selection in the shader; cube shadows add 6 depth renders per point light. Neither needs a different
foundation — both reuse the depth pass, the comparison sampler, and the `texture_depth_2d_array`
plumbing that shipped in Stage 4.

## Directional shadow frustum — auto-fit to scene bounds

Stage 4's directional shadow uses an **orthographic** light frustum whose extent is
a **consumer-specified** `orthoHalfExtent` (with a `target` point the light looks
at) — see `packages/core/src/frame/shadow-projection.ts`. The consumer hand-sizes
the half-extent to bracket the part of the scene that should cast/receive shadows.

There is **no auto-fit**: the engine does not compute the ortho box from the
scene's geometry, because furnace has **no world-bounds / scene-AABB
infrastructure** — there is no retained scene graph to walk for bounds, and no
per-mesh AABB aggregation. Auto-fitting a directional shadow frustum (and, later,
fitting CSM cascade splits) both depend on that missing world-bounds layer.

The consumer-extent primitive is deliberately the substrate auto-fit and CSM build
*on*: once world-bounds exist, auto-fit becomes "compute `orthoHalfExtent` +
`target` from the scene AABB instead of taking them from the consumer," and CSM
becomes "split that fitted frustum into cascades." The current hand-tuned extent is
the manual version of the same knob.

**Trigger to revisit:** hand-tuning `orthoHalfExtent` / `target` per scene becomes
painful (e.g. a scene that moves or grows, where a fixed extent wastes resolution
or clips shadows), OR CSM work begins (the *Advanced shadows* section above) —
both want a world-bounds layer first.

**Reference:** `packages/core/src/frame/shadow-projection.ts` (the
consumer-specified `orthoHalfExtent` + `target`); the *Advanced shadows* section above
(CSM, which also needs the fitted/split frustum); `transform-hierarchy-helpers.md` (the
absent retained-hierarchy/world-bounds infrastructure auto-fit would require).

## Shadow-map resolution + PCF kernel — make them configurable

Stage 4 (shadows) ships with both the shadow-map resolution and the PCF softening
kernel **fixed**:

- **Resolution** — every shadow layer is `2048²` texels, hardcoded as
  `SHADOW_MAP_SIZE` in `packages/core/src/frame/shadow-map.ts`. No consumer knob
  to raise it (sharper, more memory) or lower it (cheaper, blockier).
- **PCF kernel** — the comparison-sampler filter is a fixed **3×3** tap pattern in
  `packages/core/src/shader/shadows.ts` (`fr_shadowFactor`). No knob for a wider
  (softer, more expensive) or narrower / single-tap (hard-edged, cheapest) filter.

Both are scope-to-current-need: `2048²` + 3×3 PCF look good on the Stage 4 bowling
scene at the demo's draw distance. The natural exposure shape is a per-light or
per-config field (resolution per shadow-casting light, kernel as an enum / tap
count), additive to the current fixed substrate — no rework of the depth pass or
the sampler required.

**Trigger to revisit:** a scene where `2048²` looks low-res (large directional
coverage — note CSM is the other answer there, see the *Advanced shadows* section
above), OR a consumer wanting softer shadows (wider PCF) or cheaper ones
(single-tap) than the fixed 3×3 delivers.

**Reference:** `packages/core/src/frame/shadow-map.ts` (`SHADOW_MAP_SIZE`);
`packages/core/src/shader/shadows.ts` (`fr_shadowFactor`, the 3×3 PCF tap);
the *Advanced shadows* section above (CSM is the answer for large-frustum
resolution, distinct from raising a single map's size).

## Single-source the shadow-map texel size across WGSL sites

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

The shadow-map texel size — `1.0 / 2048.0`, the reciprocal of `SHADOW_MAP_SIZE` —
is **hardcoded as a literal in two WGSL sites**, each carrying a comment that ties
it back to the TS constant:

- `packages/core/src/shader/shadows.ts` (`fr_shadowFactor`) — `let texel = 1.0 / 2048.0;`
  (commented `2048 = SHADOW_MAP_SIZE`).
- `packages/core/src/shader/lighting.ts` (`fr_shade`) — the normal-offset bias uses
  `* (1.0 / 2048.0)` (commented `2048 = SHADOW_MAP_SIZE`).

The canonical value lives in TS as `SHADOW_MAP_SIZE` (`frame/shadow-map.ts`), but
**WGSL can't import a TS constant**, so the texel size is duplicated as a literal in
both shader fragments. If `SHADOW_MAP_SIZE` ever changes, three places must move in
lockstep (the TS const + both WGSL literals) with nothing to catch a missed one.

A single-source fix exists — inject the value via `source` string interpolation
(`${1 / SHADOW_MAP_SIZE}`) so the WGSL is generated from the TS const — **but that
crosses the `shader/` → `frame/` layer boundary** (the shader fragments would need
to import `SHADOW_MAP_SIZE` from `frame/shadow-map.ts`, or have it injected by a
frame-layer assembler). That layering question is a real design decision, not a
mechanical edit, which is why it's deferred rather than done inline.

**Trigger to revisit:** making `SHADOW_MAP_SIZE` **configurable** (the literals
become wrong the moment resolution is a knob — see the *Shadow-map resolution + PCF
kernel* section above), OR a deliberate decision to
single-source the value regardless. Resolve the shader→frame layering question
first.

**Reference:** `packages/core/src/shader/shadows.ts` (`fr_shadowFactor` texel
literal); `packages/core/src/shader/lighting.ts` (`fr_shade` normal-offset literal);
`packages/core/src/frame/shadow-map.ts` (`SHADOW_MAP_SIZE`, the canonical const);
the *Shadow-map resolution + PCF kernel* section above (configurability is the likely trigger).

## Static shadow-map caching — dirty-flag skip for unchanged casters

Stage 4 re-renders the **entire depth pass every frame**: all casters are drawn
into the shadow array on each frame (`frame/shadow-map.ts` `_recordShadowPasses`),
with no caching of the result and no dirty-flag skip for casters/lights that did
not move since last frame. A static scene under a static directional light
re-renders an identical depth map 60× a second.

The optimization is **static shadow-map caching**: skip the depth re-render when
neither the casters nor the casting light changed, reusing the previous frame's
shadow texture. This is the win that a *light-identity* concept would naturally
enable (a stable per-light handle whose shadow map persists across frames with a
dirty bit) — but it is **addable without changing the `Light` type**: the engine
already owns the shadow array, so it can keep a per-slot "last rendered hash"
(caster transforms + light view-projection) and skip the pass when unchanged, with
`Light` staying plain per-frame value data. The decision to keep `Light` as value
data (Stage 4) does **not** foreclose this optimization.

**Trigger to revisit:** the shadow depth pass shows up as a meaningful cost in a
profile (many casters, high-poly casters, or multiple shadow-casting lights) —
i.e. when re-rendering unchanged shadows is measurably wasteful.

**Reference:** `packages/core/src/frame/shadow-map.ts` (`_recordShadowPasses` —
unconditional per-frame depth render; the engine-owned shadow array that a
per-slot dirty cache would key on); the Stage-4 decision to keep `Light` as plain
per-frame value data (this optimization does not require reversing it).

## Per-mesh cast / receive shadow opt-in

Stage 4's shadow policy is **uniform, not per-mesh**:

- **Casting** — every opaque mesh drawn in a frame is also drawn into the depth-only
  caster pass (`frame/shadow-map.ts` `_recordShadowPasses`). There is no per-mesh
  `castShadow` flag; you cannot exclude a specific mesh from casting.
- **Receiving** — a material receives shadows iff it `usesShadows` (the shader flag
  threaded through `_createShader` / `MaterialSlot.usesShadows`). Receiving is a
  *material* property, not a *mesh* property; there is no per-mesh `receiveShadow`.

This is intentionally simpler than three.js's per-`Object3D` `castShadow` /
`receiveShadow` booleans. For the Stage 4 bowling scene every solid object should
both cast and receive, so the uniform policy is correct and avoids per-mesh state.

Adding opt-out is additive: a per-mesh `castShadow` flag would gate inclusion in the
depth pass; per-mesh receive is murkier because receiving is currently a
material/shader-flag concern, so per-mesh receive would need either a material
variant or a per-draw uniform — a small design decision, not just a flag.

**Trigger to revisit:** a mesh that must be **excluded from casting** (e.g. a large
ground plane that should receive but not self-cast, a skybox, a debug gizmo), OR a
mesh that must not receive shadows while sharing a material with meshes that do.

**Reference:** `packages/core/src/frame/shadow-map.ts` (`_recordShadowPasses` —
all opaque meshes cast); `packages/core/src/shader/shader.ts` (`usesShadows` flag —
receiving is per-material, not per-mesh); `packages/core/src/material/material.ts`
(`MaterialSlot.usesShadows`).

## Instanced meshes don't cast shadows

### Context

Slice 2.2.3a added first-class GPU instancing to `@furnace/core` (`mesh.createInstanced` → an
`InstancedMesh` resource, instanced shader variants `shader.litInstanced` / `unlitInstanced`,
a separate `instanced?: InstancedMesh[]` render param on `frame.render` / `renderToTexture`).
Instanced meshes source their model matrix from a per-instance vertex buffer (`stepMode:
"instance"`, slot 1) and **bypass `@group(2)`**.

The depth-only shadow caster pass (`packages/core/src/frame/shadow-map.ts`) renders casters
through a pipeline that reads the per-object model matrix from an **Object UBO bind group**
(`casterObjectGroup` — **bind group 1** in the caster pipeline; group 0 is the light
view-projection) — which instanced meshes don't have (their model rides a per-instance vertex
buffer instead). So `_recordShadowPasses` explicitly `continue`s past any non-`"mesh"` draw —
**instanced meshes cast no shadows**: they are lit and can receive shadows, but they cast
none. For the dungeon's current scatter (small decorative props — rubble, fungus, crystals)
this is acceptable; the props are small and mostly self-shadowed / ambient-lit. (Note: on the
*main* render path the per-object Object UBO sits at `@group(2)`; the caster pipeline has its
own layout and rebinds it at group 1.)

Closing it needs an **instanced caster pipeline variant** — a depth-only pipeline that sources
the model matrix from the instance vertex buffer (slot 1) exactly like the visible
`*Instanced` variants do, plus a caster-pass branch that binds the instance buffer and issues
the instanced `drawIndexed(indexCount, count)` for each `InstancedMesh` flagged to cast.

### Trigger to revisit

When scattered decoration — or any instanced geometry — needs to **cast** shadows (e.g. large
instanced pillars / foliage / debris that should drop visible shadows, not just receive them).

### Reference

- `packages/core/src/frame/shadow-map.ts` — `_recordShadowPasses` (the caster pass that skips
  instanced meshes) + `casterObjectGroup` (the group-1 Object-UBO dependency).
- `packages/core/src/frame/render.ts` — the instanced draw path (the model-from-instance-buffer
  pattern to mirror in a caster variant).
- `packages/core/src/shader/builtins.ts` — `litInstanced` / `unlitInstanced` variants.
- Related: the *Per-mesh cast / receive shadow opt-in* and *Advanced shadows* sections of this doc.

## Transparent / alpha-tested shadow casters

Stage 4's shadow casters are **opaque only**. The depth-only caster pipeline
(`frame/shadow-map.ts` `_ensureShadowCasterPipeline`) writes solid depth with no
fragment-side alpha handling — there is **no alpha test** (no `discard` on a
sampled alpha threshold) and no alpha-to-coverage. Every caster contributes a
fully-opaque silhouette to the depth map regardless of its material's blend state
or texture alpha.

Consequences when this matters:

- An **alpha-tested** caster (cutout foliage, chain-link fence, a leaf texture)
  casts a solid rectangular shadow of its quad, not the cutout silhouette.
- A **blended / translucent** caster (glass, smoke) casts a fully-opaque shadow as
  if solid, with no attenuation.

Correct alpha-tested shadows need the caster pipeline to sample the albedo's alpha
and `discard` below a threshold (a fragment shader on the depth pass + the texture
binding, which the current depth-only caster intentionally omits). Translucent
shadows are a harder, separate problem (colored/attenuated shadow maps, deep
shadow maps) — out of scope of even the alpha-test fix.

**Trigger to revisit:** an alpha-tested caster (cutout textures) needs its true
silhouette in shadow, OR a blended caster needs attenuated/colored shadows.

**Reference:** `packages/core/src/frame/shadow-map.ts`
(`_ensureShadowCasterPipeline` — depth-only, no fragment alpha test); the
alpha-test side is this entry; colored/translucent shadows
would be a further follow-on.

## `lightingHelpers` hard-requires `usesShadows` — split the shadow term behind a flag

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

Stage 4 wired the shadow term into the shared lighting toolkit: `lightingHelpers`
(`packages/core/src/shader/lighting.ts`) now **composes** `shadowHelpers`
(`packages/core/src/shader/shadows.ts`). As a result, any custom shader that uses
the public `lightingHelpers` WGSL toolkit **transitively declares the shadow
`@group(0)` bindings 2/3** (the `texture_depth_2d_array` + comparison sampler) and
therefore **MUST** be created with `usesShadows: true` — otherwise pipeline
validation fails on unbound bindings at create time.

Lighting and shadows are thus **welded**: there is no way to use Blinn-Phong from
the public toolkit without also paying for the shadow sampler bindings. This is an
**acceptable Stage 4 trade-off** — the failure is *loud and at create time* (a clear
validation error, not a silent wrong-render), and the common case (lit materials
that also receive shadows) wants both anyway.

The fix, when it matters, is to **split the shadow term behind a flag** — either a
separate fragment (`lightingHelpers` without shadows + an opt-in `shadowHelpers`),
or a `usesShadows`-conditioned branch in the composed WGSL so a consumer can take
the Blinn-Phong term without declaring the shadow bindings.

**Trigger to revisit:** a consumer wants Blinn-Phong lighting from the public
toolkit **without** the shadow sampler bindings (e.g. a perf-sensitive
no-shadow material, or a platform where the comparison-sampler binding is
unavailable).

**Reference:** `packages/core/src/shader/lighting.ts` (`lightingHelpers` composes
`shadowHelpers`); `packages/core/src/shader/shadows.ts` (the `@group(0)` 2/3 shadow
bindings); the `usesShadows` flag threaded through `shader/shader.ts` `_createShader`.
