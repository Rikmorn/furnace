# Shader preprocessor / imports

**Folds into Tranche D-1 (`shader-resource.md`), 2026-05-30.** The `// @include` resolution is shader *code* composition — it lives in D-1's shader-loading path (`shader.load` / `shader.create`), not as a standalone item. Trigger has **fired**: `hsv2rgb` is duplicated across `cookbook/shader/plasma.wgsl` + `striped.wgsl`. D-1's brainstorm picks the preprocessor approach (open question #5 there). This entry is retained for the approach options below; delete it when D-1 lands the include path.

WGSL has no native `#include` mechanism. As shaders grow more complex and share common code (camera uniform structs, lighting helpers, noise functions, post-effect utility math), we'll want some form of import/include support.

Options to consider when this is brainstormed:
- **String concatenation with a tiny preprocessor**: `material.loadShader("foo.wgsl")` reads the file, scans for `// @include "bar.wgsl"` comments, recursively inlines. Small implementation, no build-time tooling.
- **Bun-side build-time preprocessor**: a Bun plugin that processes `.wgsl` imports at bundle time. Cleaner output, no runtime overhead, but couples to Bun.
- **Naga-based preprocessor in wasm**: use the same WGSL tooling Rust uses. Heavy but most correct.
- **Template literals in TS**: shaders defined as `const myShader = wgsl\`... ${cameraUniform} ...\`;` with composition via TS string interpolation. No new format; loses WGSL editor tooling.

Whichever path, the goal is to eliminate copy-paste of common shader snippets without inventing a third language.

**Trigger to revisit:** When the same WGSL snippet appears in two or more shader files. Until then, copy-paste with a comment is fine.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Deferred decisions".
