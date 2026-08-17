---
summary: `material.create`'s three-branch `@group(1)` dispatch and its exactly-one-source invariant live in two places; extracting `resolveGroup1` carries the pipeline-cache-release ownership, so it waits on a fourth source
---

# Extract `resolveGroup1` from `material.create`

*Adjacent finding. Surfaced during Visual Fidelity Stage 1, Task 8 (material texture path) code-quality review, 2026-06-05.*

`material.create` (`packages/core/src/material/material.ts`) now resolves the
`@group(1)` bind group via a three-branch dispatch — `texture` | `binding` |
`bindings`, "exactly one" enforced by a mutual-exclusion guard earlier in the
function. Today this reads cleanly as a linear if/else-if and the invariant is
cross-referenced by comments, so it was NOT extracted in Task 8.

The "exactly one `@group(1)` source" invariant currently lives in two places: the
setup-loud guards (mutual-exclusion + the two completeness checks) and the group1
dispatch block. A `resolveGroup1(ctx, descriptor, pipeline, pipelineKey)` helper
would give that invariant a single named home and shrink `create` by ~33 lines.

Not done now because: the block is a clean linear dispatch (not interleaved
concerns); the helper would carry the `pipelineKey`-release ownership coupling,
which is currently explicit and easy to audit; and clean-code says tolerate until
it actually hurts.

## Fix shape
- Extract `resolveGroup1(...)` owning the texture|binding|bindings dispatch,
  returning `GPUBindGroup | null` and preserving the pipeline-cache-release-on-error
  discipline (the stale-handle and `buildGroup1` failure paths must still release the
  acquired pipeline slot).
- Consider also naming the "one `@group(1)` source" invariant once (a small typed
  helper that classifies the descriptor into `none | uniform | raw | texture`).

## Trigger to revisit
- A **fourth** `@group(1)` source is added (e.g. multi-texture / PBR maps in the
  PBR epic, or a storage-buffer bind path from the compute/storage tranche). At that
  point the dispatch stops being trivially linear and the extraction earns its place.

## Related (do not duplicate)
- A second, lower-value note from the same review: passing `texture` to a
  non-`textureBinding` shader (layout null, textureBinding false) currently falls
  through to `buildGroup1`'s generic "shader declares no @group(1) bindings" error
  rather than a dedicated message. Correct + setup-loud, just less specific. Fold a
  dedicated guard in only if this extraction is done.

## Reference
- `packages/core/src/material/material.ts` (`create`, group1 resolution).
