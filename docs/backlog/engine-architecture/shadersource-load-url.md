---
summary: a lazy runtime `ShaderSource.load(url)` fetch as a dev/editor convenience, and the lint that would keep it out of production builds where the safe path is static import plus bundler inlining
---

# `ShaderSource.load(url)` — lazy runtime fragment fetch

**The composition spine LANDED as Visual Fidelity Stage 2.5 (2026-06-07):** `ShaderSource`
(`shader.source` tagged + call forms) → `toWgsl()` (DFS, dedup by object identity) →
`shader.create` accepts `ShaderSource | string`. Composition is pure in-memory JS string
work — NOT runtime URL fetch. That is the deliberate posture this item asks for an exception
to, which is why the exception carries a guard rather than just an API.

The `toWgsl`/dedup core operates on the `ShaderSource` DAG independent of how the DAG was
built, so this item slots in without reshaping it.

**`ShaderSource.load(url)`** — lazy runtime fetch of a fragment; a dev/editor convenience
that must not leak into prod (the prod-safe path is static import + bundler inline). A
future lint/CLI could flag `.load` in prod builds.

**Not planned (recorded here because it is the natural next ask):** a node-graph /
typed-IO shader editor (Unreal Material Function / Unity Sub Graph) — a higher layer that
*generates* `ShaderSource`; out of the Visual Fidelity epic.

**Trigger to revisit:** a concrete runtime-fetched-composition need.

**Reference:** Stage 2.5 spec (the composition spine above);
`docs/research/2026-05-30-shader-resource-prior-art.md`. The prod-leak lint this wants is
the same build-time seam as `composition-validation-cli.md`. Siblings from the same
section: `include-composition-resolver.md`, `composition-validation-cli.md`.
