# Per-object dynamic-offset uniform buffer

Tranche 4 allocates one 64-byte `GPUBuffer` per mesh for the object's model matrix. For N meshes, that's N buffers + N bind group entries per pass — fine for handfuls, expensive at thousands.

The standard optimization is a single shared object uniform buffer (sized e.g. 64 KB) with dynamic offsets: `pass.setBindGroup(0, group0, [meshOffset])`. One bind group, one buffer, N draws.

Implementation sketch:
- Engine maintains a per-context "object uniform pool" (`GPUBuffer` with `UNIFORM | COPY_DST` usage, dynamic-offset-aligned).
- Each `mesh.create` reserves a 256-byte-aligned slot in the pool (WebGPU's `minUniformBufferOffsetAlignment` is at least 256).
- `frame.render`'s per-mesh `writeBuffer` goes to `mesh.poolOffset`; `setBindGroup` passes `[mesh.poolOffset]` as the dynamic offset array.
- Pool grows when exhausted.

Open design questions:
- Pool size: small initial (e.g. 64 slots → 16 KB), grow on demand vs large fixed (e.g. 64 KB upfront → 256 slots).
- Slot reuse on `mesh.destroy`: free-list vs append-only.
- Backward-compat: existing per-mesh buffers can coexist (legacy path) or be removed wholesale.

**Trigger to revisit:** First profile showing per-object uniform churn as a measurable cost. Usually triggers at hundreds of draws per frame.

**Reference:** Tranche-4 design § Section 3 ("Per-mesh object uniform buffer"), § Out.
