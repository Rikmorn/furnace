# `lightingHelpers` hard-requires `usesShadows` — split the shadow term behind a flag

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
