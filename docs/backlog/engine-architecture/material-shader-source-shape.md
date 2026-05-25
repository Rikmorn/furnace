# Material shader source shape

`MaterialDescriptor` currently takes `vertex: string` and `fragment: string`. Every call site (`unlit`, `normalColor`, hello-world SDF) passes the same WGSL string to both — every material in the codebase is single-source with two entry points (`vs_main`, `fs_main`). The two-field API doesn't pay for itself: `buildPipelineDescriptor` calls `createShaderModule` twice on identical source, producing two `GPUShaderModule` objects per material with no dedup. So the API implies flexibility (mode 2: split-source) but the implementation pays mode 2's cost while always being used as mode 1 (single source, multiple entry points).

Three options, listed by ambition:

- **(A) Collapse to single source.** Replace `vertex` + `fragment` with `shader: string` and optional `vertexEntry`/`fragmentEntry` defaulting to `"vs_main"`/`"fs_main"`. Engine creates one `GPUShaderModule` per material. Three call sites to update; ~4 lines of consumer churn. Matches every current use, eliminates duplicate module allocation. The most aggressive "scope to current need" move.
- **(B) Keep both fields but dedup at the engine.** If `vertex === fragment`, reuse one `GPUShaderModule`. Zero consumer churn, eliminates the duplicate allocation. Keeps the option of split-source open without committing to it. Lazy middle ground.
- **(C) Commit to module sharing.** Expose `GPUShaderModule` as a first-class engine resource (`shader.create(ctx, wgsl) → Shader`), and have `MaterialDescriptor` take `vertexShader: Shader, fragmentShader: Shader` (or one `Shader` for the common case). This is what production engines do — one shared vertex shader paired with many fragment variants. Bigger refactor; only worth it once there's a real need for the same vertex shader across many materials.

Open design questions:
- Is split-source ever going to be a real need? Likely yes once a UI/text-rendering material reuses a generic vertex shader across N font/atlas/SDF fragment variants. But not today.
- Should `vertexEntry` / `fragmentEntry` be exposed even in (A)? Lets a single WGSL file declare alternative entry points (`vs_main_skinned`, `vs_main_rigid`) for variant generation later.
- The smoke signal in `unlit.ts:8` (`// gwsl file lazy loaded?`) hints at a related open question — should built-in shaders be loaded from `.wgsl` files instead of embedded as template literals? Different question, but worth bundling into the same design pass.

**Trigger to revisit:** Next material variant that actually wants a different vertex shader from the previous one — text rendering, skinned mesh, instanced batch with a different transform path. Or: any time we add a fourth built-in material, because the duplicate `createShaderModule` cost grows with every material the engine ships.

**Reference:** `packages/core/src/material/material.ts:46-47` (the duplicate-module construction), `packages/core/src/material/unlit.ts` and `packages/core/src/material/normal-color.ts` (current call sites).
