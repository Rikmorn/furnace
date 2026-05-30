# Shader preprocessor / imports

**DEFERRED to its own session — decided in the D-1 brainstorm (2026-05-30, reversing the earlier "folds into D-1" plan).** D-1 ships the *substrate* (`Shader` resource + `shader.load(ctx, url)` = fetch + create), but **`shader.load` resolves NO includes yet**. The `// @include` preprocessor is **additive behaviour on `shader.load`** — adding it later does not change the signature or force a migration — so it is cleanly separable and does not need to ride D-1's breaking reshape. Trigger has **fired** (`hsv2rgb` duplicated across `cookbook/shader/plasma.wgsl` + `striped.wgsl`); we **accept that duplication for now** rather than half-ass the resolver. Build it well in a dedicated session.

**What a proper session must think through (D-1 brainstorm, 2026-05-30):**
- **Graph traversal** — recursive include resolution with **cycle detection** (a `Set` of visited absolute URLs; a cyclic include must not infinite-loop / fetch-storm).
- **Combination / dedup** — including the same file twice must not emit duplicate **top-level declarations** (WGSL has no redefinition tolerance, unlike GLSL snippet inlining); dedup-within-graph is a **correctness** requirement, not just an optimization.
- **Relative URL resolution** — `new URL(spec, includingFileUrl)` referrer-relative (as CSS `@import` / ES modules resolve), since `shader.load` fetches arbitrary author URLs (three.js's flat `ShaderChunk` registry sidesteps this; furnace cannot).
- **Compilation cost & main-loop impact** — when does resolution/compile happen, and does it block frames? (`shader.load` is async/setup; but a future hot-reload or lazy path could touch the loop.)
- **Prerequisite infrastructure** — is a fetch/asset layer, an in-flight-dedup cache, or a "never cache failures" loader (three.js #17635) needed first? These may be their own items.
- **Failure modes from prior art** — see `docs/research/shader-resource-prior-art.md` §Q5: cache by URL but **never cache HTTP failures**, dedup in-flight requests, the build-time-vs-runtime tension (WESL/naga_oil lean build-time).

The approach options below remain the menu; the research doc (§1.10–1.12) is the verified prior-art survey for them.

WGSL has no native `#include` mechanism. As shaders grow more complex and share common code (camera uniform structs, lighting helpers, noise functions, post-effect utility math), we'll want some form of import/include support.

Options to consider when this is brainstormed:
- **String concatenation with a tiny preprocessor**: `material.loadShader("foo.wgsl")` reads the file, scans for `// @include "bar.wgsl"` comments, recursively inlines. Small implementation, no build-time tooling.
- **Bun-side build-time preprocessor**: a Bun plugin that processes `.wgsl` imports at bundle time. Cleaner output, no runtime overhead, but couples to Bun.
- **Naga-based preprocessor in wasm**: use the same WGSL tooling Rust uses. Heavy but most correct.
- **Template literals in TS**: shaders defined as `const myShader = wgsl\`... ${cameraUniform} ...\`;` with composition via TS string interpolation. No new format; loses WGSL editor tooling.

Whichever path, the goal is to eliminate copy-paste of common shader snippets without inventing a third language.

**Trigger to revisit:** When the same WGSL snippet appears in two or more shader files. Until then, copy-paste with a comment is fine.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Deferred decisions".
