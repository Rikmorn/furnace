---
summary: shader composition is prod-safe but unvalidated — `toWgsl()` plus a WGSL compile-check would make broken composition fail the build rather than the frame
---

# Build-time shader-composition validation tool / CLI

**The composition spine LANDED as Visual Fidelity Stage 2.5 (2026-06-07):** `ShaderSource`
(`shader.source` tagged + call forms) → `toWgsl()` (DFS, dedup by object identity) →
`shader.create` accepts `ShaderSource | string`. Composition is pure in-memory JS string
work — NOT runtime URL fetch.

The `toWgsl`/dedup core operates on the `ShaderSource` DAG independent of how the DAG was
built, so this item slots in without reshaping it.

**Build-time validation tool / CLI** — `toWgsl()` + a WGSL compile-check (naga-wasm, or a
`*.gpu.test.ts` using bun-webgpu's validation error scope — available today) so broken
composition fails the build, not the frame. Composition is already prod-safe (JS imports
are bundler-inlined; `toWgsl` is in-memory concat, no runtime file I/O) — this item is about
*validation*, not avoiding I/O.

**Trigger to revisit:** prod-hardening / unvalidated-composition pain.

**Reference:** Stage 2.5 spec (the composition spine above);
`docs/research/2026-05-30-shader-resource-prior-art.md`. A build-time gate over composed
WGSL is the same posture as `wgsl-to-ts-schema-codegen.md`'s staleness gate, and would
likely share its harness home. Siblings from the same section:
`include-composition-resolver.md`, `shadersource-load-url.md`.
