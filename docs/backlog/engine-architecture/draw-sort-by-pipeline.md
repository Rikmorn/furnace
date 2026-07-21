# Sort frame.render draws by pipeline

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
