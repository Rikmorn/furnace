# Render submission and batching

Tracker for the **per-draw cost** of `frame`'s submission path — the API-call and GPU-state
overhead that shows up once a scene stops being a handful of meshes. Each section is one
previously standalone entry, keeping its Context, *Trigger to revisit* and *Reference*.

They are merged because all four propose the same class of change (submit fewer, larger
units of work without changing what is drawn) and share the same trigger family: *a frame
whose draw count or state-change count is measurably the bottleneck*. None of them is a
correctness fix, and none needs a new module — each is an internal reshaping of how
`frame.render` / `frame.drawLines` hand work to WebGPU. Sections are ordered by where the
cost sits: pipeline switches → per-object uniform writes → instance-attribute uploads →
line-pass count.

## Sort frame.render draws by pipeline

`frame.render` iterates the `draw` array in submission order and calls `pass.setPipeline` per mesh. If two consecutive meshes share a pipeline, the second `setPipeline` is a no-op at the driver level but the API call still costs. If they don't, switching pipelines flushes pipeline state — measurably expensive on some platforms.

The standard fix is to sort draws by pipeline before iterating, minimizing transitions. Tranche-4 punts on this — submission order is fine for handfuls of draws.

Implementation sketch: inside `frame.render`, before the loop, sort a shallow-copied draw array by `mesh.material.pipelineKey` (already computed by tranche 4 for the cache). Same-pipeline draws cluster together. Optional further sort by other state (cull mode, depth state) to share more.

Open design questions:
- Is sort stability important for layered/translucent rendering? **Partially answered
  (F2b fix round 2, 2026-07-21):** `frame.render` now PARTITIONS draws — opaque meshes →
  opaque instanced → blended meshes → blended instanced (`MaterialSlot.blended`),
  submission order preserved within each group (`render-draw-order.test.ts` pins it).
  Any future pipeline sort must sort WITHIN those groups; the opaque groups are free to
  reorder, the blended groups are painter's-order and must stay stable.
- Should the consumer opt out per `frame.render` call (`{ sortByPipeline: false }`)?
- Does this matter once instancing lands? Instancing reduces draw count by orders of magnitude.

**Trigger to revisit:** First profile showing pipeline-switch cost in the draw loop. Tends to appear in scenes with dozens of materials.

**Reference:** Tranche-4 design § Out.

## Per-object dynamic-offset uniform buffer

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

## Bulk `setInstanceTints` to mirror `setInstanceMatrices`

### Context

Slice 2.2.3a's `InstancedMesh` resource (`packages/core/src/mesh/instanced.ts`) exposes a
**bulk** transform upload — `mesh.setInstanceMatrices(ctx, handle, matrices)` (a single
column-major `Float32Array` of all instance mat4s, one buffer write) — alongside the
per-instance `setInstanceTransform`. But there is **no symmetric bulk tint path**: tints can
only be set one instance at a time via `setInstanceTint`.

The asymmetry shows up in the dungeon's `packages/dungeon/src/realize.ts`, which bakes an
`InstanceGroup` into an `InstancedMesh`: it can upload all transforms in one
`setInstanceMatrices` call, but must **loop `setInstanceTint` per instance** for the tints. A
bulk `setInstanceTints(ctx, handle, tints)` (a single `Float32Array` of all instance `vec4`s,
one buffer write — mirroring the matrices path exactly) would collapse that loop and restore
API symmetry.

This is **deferred, not blocking** — the per-instance tint loop is correct and runs once at
build for a few hundred static decorations (not a measured hot path).

### Trigger to revisit

When per-instance-tint upload becomes a **measured** hot path (large or frequently-rebaked
instance counts), or as a small API-symmetry cleanup taken alongside other instancing work.

### Reference

- `packages/core/src/mesh/instanced.ts` — `setInstanceMatrices` (the bulk pattern to mirror) +
  `setInstanceTint` (the per-instance path).
- `packages/dungeon/src/realize.ts` — the per-instance `setInstanceTint` loop that a bulk path
  would collapse.

## drawLines: batch per-frame calls to cut MSAA resolve cost

**Context.** The F2b MSAA fix (2026-07-21) made every `drawLines` call on an MSAA
context a real render pass: load the stored MSAA scene color, draw, resolve to the
swapchain. The editor FieldHost issues ~3 per frame steady-state (grid minor/major +
ghost) and 6–7 with a selection + stamp session live — each a full-canvas resolve.
Previously these were free because the passes were invalid and dropped (see
`docs/learnings/2026-07-21-invisible-line-overlays.md`). Not a correctness issue; the
executor flagged it as the known cost of the fix.

**Fix shape:** accept multiple batches in one call (`drawLines(ctx, opts[])`) or an
internal per-frame accumulator that encodes all line draws into ONE pass with one
resolve. Pipeline switches between occlude modes can live inside the single pass.

**Re-priced at T5 (2026-08-11) — the cost premise above is currently dead, the fix
shape is not.** The paragraph prices the whole case in editor MSAA resolves, and
the editor no longer pays them: foundations T4c fixed its context at
`sampleCount: 1` and stated it rather than defaulting it
(`packages/editor/src/field-host/field-host.ts`, `requestContext(canvas, { sampleCount: 1 })`).
At `sampleCount: 1` there is no resolve, so the editor's ~3–7 line passes per frame
cost pass overhead only. Nor does the cost live anywhere else today: the dungeon
runs `sampleCount: 4` (`packages/dungeon/src/main.ts`) but calls `drawLines`
nowhere, and the one remaining MSAA-capable consumer —
`packages/hello-world/src/demos/bowling/scene.ts`, whose `sampleCount` is a
user-toggled `1 | 4` — issues a single collider overlay call that `drawLines`
**skips outright** under MSAA + a post chain (the documented warn-once SKIP, since
the resolve would clobber post output).

The fix shape stands unchanged and is still worth doing when it fires: one pass
with one resolve for all line batches is strictly better than N, and it is the
prerequisite for a `sampleCount > 1` context ever carrying multiple per-frame
overlays at all.

**Trigger to revisit:** *(re-stated with the above)* a consumer running
`sampleCount > 1` that issues more than one `drawLines` batch per frame — which is
what would make the resolve cost real again — or a measured frame-cost regression
from line-pass overhead alone in an overlay-heavy editor scene (the user's F2b
gate feel-check reported none, and that was still under MSAA).

**Reference:** `packages/core/src/frame/render-lines.ts`;
`packages/editor/src/field-host/field-render.ts` (renderScene overlay draws — now there).
