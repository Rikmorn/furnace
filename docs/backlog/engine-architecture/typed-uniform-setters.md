# Typed uniform setters for material + post

**Paired into the "uniform/params session" with `material-uniform-setters.md`, 2026-05-30.** When the `Shader` resource (Tranche D-1, `shader-resource.md`) drew the code-vs-params seam, this item stayed on the **params** side: it's the `@group(1)` uniform-*data* layer, orthogonal to the shader-code resource. It does **not** go in D-1. This is the uniform-schema-DSL question A-4 deliberately avoided; it spans material + post and should be designed with `material-uniform-setters` (per-built-in `setColor`) as one session. Trigger met at 7 `writeBuffer` call sites.

Today, material and post both follow the same pattern: consumer creates a
GPUBuffer with the right alignment, writes initial values via
`ctx.queue.writeBuffer(buf, 0, new Float32Array([...]))`, and passes the
buffer in `bindings`. Per-frame updates are also raw `writeBuffer` calls.

Repetitive at the call site. The hello-world demo today has three such
patterns (halo, emissive, bloom params). When the count grows, the
ergonomic cost becomes real.

Likely shape:
- `material.create` / `post.create` grow an optional typed-uniforms field:
  ```ts
  uniforms: { threshold: 0.7, intensity: 1.5, radius: 0.004 }
  ```
- Engine introspects the WGSL struct layout (alignment, padding) and
  allocates the buffer.
- Setter: `material.setUniform(mat, "threshold", 0.9)` /
  `post.setUniform(fx, "threshold", 0.9)`.
- Internal implementation choices:
  - Vendor a WGSL parser (heavy)
  - Consumer-provided layout descriptor (`uniformLayout: { threshold: { offset: 0, type: "f32" }, ... }`)
  - Shader reflection (WebGPU doesn't expose this)

Cross-cutting lift — both material and post should land it together,
not piecemeal.

**Trigger to revisit:** Third or fourth call site doing repetitive
`writeBuffer(buf, 0, new Float32Array([...]))` for shader params.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-6-post-process-design.md` §1 Out.
